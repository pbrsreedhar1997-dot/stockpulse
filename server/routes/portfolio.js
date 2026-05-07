import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { getQuote, getFinancials, getHistory } from '../services/yahoo.js';

const router = Router();
router.use(requireAuth);

// ── Recommendation engine ─────────────────────────────────────────────────────
function getRecommendation(avgPrice, currentPrice, peRatio, week52High, week52Low) {
  if (!currentPrice || !avgPrice) return null;
  const gainPct = ((currentPrice - avgPrice) / avgPrice) * 100;

  let positionPct = null;
  if (week52High && week52Low && week52High > week52Low) {
    positionPct = ((currentPrice - week52Low) / (week52High - week52Low)) * 100;
  }

  let action, reason, confidence;

  if (gainPct >= 35) {
    action = 'SELL'; confidence = 'HIGH';
    reason = `Up ${gainPct.toFixed(1)}% from your cost — strong profits. Consider booking full gains.`;
  } else if (gainPct >= 20 && peRatio && peRatio > 28) {
    action = 'SELL'; confidence = 'HIGH';
    reason = `${gainPct.toFixed(1)}% gain with stretched P/E ${peRatio.toFixed(1)}. Good time to exit.`;
  } else if (gainPct >= 15 && peRatio && peRatio > 22) {
    action = 'SELL_PARTIAL'; confidence = 'MEDIUM';
    reason = `Solid ${gainPct.toFixed(1)}% gain. Book 50% to lock profits at P/E ${peRatio.toFixed(1)}.`;
  } else if (gainPct >= 15) {
    action = 'SELL_PARTIAL'; confidence = 'MEDIUM';
    reason = `Up ${gainPct.toFixed(1)}%. Consider trimming position to lock in gains.`;
  } else if (gainPct <= -25) {
    action = 'REVIEW'; confidence = 'HIGH';
    reason = `Down ${Math.abs(gainPct).toFixed(1)}% from cost. Re-evaluate fundamentals before averaging.`;
  } else if (gainPct <= -10 && peRatio && peRatio > 0 && peRatio < 15) {
    action = 'BUY_MORE'; confidence = 'HIGH';
    reason = `Pullback of ${Math.abs(gainPct).toFixed(1)}% with attractive P/E ${peRatio.toFixed(1)}. Strong averaging opportunity.`;
  } else if (gainPct <= -10) {
    action = 'HOLD'; confidence = 'MEDIUM';
    reason = `Down ${Math.abs(gainPct).toFixed(1)}%. Hold and wait — avoid panic selling.`;
  } else if (peRatio && peRatio > 0 && peRatio < 12 && gainPct < 5) {
    action = 'BUY_MORE'; confidence = 'HIGH';
    reason = `Deeply undervalued at P/E ${peRatio.toFixed(1)}. Excellent opportunity to build position.`;
  } else if (peRatio && peRatio > 0 && peRatio < 18 && gainPct < 10) {
    action = 'BUY_MORE'; confidence = 'MEDIUM';
    reason = `Fair valuation at P/E ${peRatio.toFixed(1)}.${gainPct >= 0 ? ' Gradual accumulation advisable.' : ' Averaging down may reduce cost.'}`;
  } else if (positionPct !== null && positionPct < 20) {
    action = 'BUY_MORE'; confidence = 'MEDIUM';
    reason = `Near 52-week low — historically strong entry zone.`;
  } else if (positionPct !== null && positionPct > 85) {
    action = 'SELL_PARTIAL'; confidence = 'MEDIUM';
    reason = `Near 52-week high. Consider taking partial profits.`;
  } else {
    action = 'HOLD'; confidence = 'LOW';
    reason = gainPct >= 0
      ? `Up ${gainPct.toFixed(1)}% — well positioned. Continue holding.`
      : `Small loss of ${Math.abs(gainPct).toFixed(1)}%. Hold patiently.`;
  }

  const upside   = action === 'BUY_MORE' ? 1.20 : action === 'HOLD' ? 1.12 : 1.08;
  const downside = gainPct > 15
    ? Math.max(avgPrice * 1.05, currentPrice * 0.92)
    : currentPrice * 0.90;
  const targetPrice = Math.round(currentPrice * upside * 100) / 100;
  const stopLoss    = Math.round(downside * 100) / 100;

  return {
    action, reason, confidence,
    gain_pct:     Math.round(gainPct * 100) / 100,
    target_price: targetPrice,
    stop_loss:    stopLoss,
  };
}

// ── Enrich one holding ────────────────────────────────────────────────────────
async function enrichHolding(h) {
  const [qR, fR] = await Promise.allSettled([getQuote(h.symbol), getFinancials(h.symbol)]);
  const q = qR.status === 'fulfilled' ? qR.value : null;
  const f = fR.status === 'fulfilled' ? fR.value : null;
  const price    = q?.price ?? 0;
  const pe       = f?.pe_ratio ?? q?.pe_ratio ?? null;
  const shares   = parseFloat(h.shares);
  const avgPrice = parseFloat(h.avg_price);
  const invested = Math.round(shares * avgPrice * 100) / 100;
  const curVal   = Math.round(shares * price * 100) / 100;
  const pnl      = Math.round((curVal - invested) * 100) / 100;
  const pnlPct   = invested ? Math.round(((curVal - invested) / invested) * 10000) / 100 : 0;
  const rec      = getRecommendation(avgPrice, price, pe, q?.week52_high, q?.week52_low);
  const stopLoss = h.stop_loss ? parseFloat(h.stop_loss) : rec?.stop_loss ?? null;

  return {
    id:            h.id,
    symbol:        h.symbol,
    name:          h.name || q?.name || h.symbol,
    shares,
    avg_price:     avgPrice,
    current_price: price,
    invested,
    current_value: curVal,
    pnl,
    pnl_pct:       pnlPct,
    pe_ratio:      pe,
    week52_high:   q?.week52_high ?? null,
    week52_low:    q?.week52_low  ?? null,
    change_pct:    q?.change_pct  ?? null,
    stop_loss:     stopLoss,
    purchase_date: h.purchase_date ? parseInt(h.purchase_date) : null,
    notes:         h.notes || null,
    recommendation: rec,
  };
}

// ── GET /api/portfolio ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM portfolio WHERE user_id=$1 ORDER BY created_at DESC',
      [req.userId]
    );

    const enriched = await Promise.all(rows.map(enrichHolding));
    const totalInvested = enriched.reduce((s, h) => s + h.invested,      0);
    const totalValue    = enriched.reduce((s, h) => s + h.current_value, 0);
    const totalPnl      = Math.round((totalValue - totalInvested) * 100) / 100;
    const totalPnlPct   = totalInvested
      ? Math.round(((totalValue - totalInvested) / totalInvested) * 10000) / 100
      : 0;

    res.json({
      ok: true,
      data: {
        holdings: enriched,
        summary: {
          total_invested: Math.round(totalInvested * 100) / 100,
          total_value:    Math.round(totalValue * 100) / 100,
          total_pnl:      totalPnl,
          total_pnl_pct:  totalPnlPct,
          count:          enriched.length,
        },
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST /api/portfolio ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { symbol, name, shares, avg_price, stop_loss, purchase_date, notes } = req.body;
    if (!symbol)              return res.status(400).json({ ok: false, error: 'symbol required' });
    if (!shares || shares <= 0)       return res.status(400).json({ ok: false, error: 'shares must be > 0' });
    if (!avg_price || avg_price <= 0) return res.status(400).json({ ok: false, error: 'avg_price must be > 0' });

    const sym = symbol.toUpperCase();
    const now = Math.floor(Date.now() / 1000);

    await query(
      `INSERT INTO portfolio (user_id, symbol, name, shares, avg_price, stop_loss, purchase_date, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT (user_id, symbol) DO UPDATE
         SET shares=$4, avg_price=$5, stop_loss=$6, purchase_date=COALESCE($7, portfolio.purchase_date),
             name=COALESCE($3, portfolio.name), notes=$8, updated_at=$9`,
      [req.userId, sym, name || sym, shares, avg_price,
       stop_loss || null, purchase_date || null, notes || null, now]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PUT /api/portfolio/:symbol ────────────────────────────────────────────────
router.put('/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    const { shares, avg_price, stop_loss, purchase_date, notes } = req.body;
    const now = Math.floor(Date.now() / 1000);
    const { rowCount } = await query(
      `UPDATE portfolio SET shares=$3, avg_price=$4, stop_loss=$5, purchase_date=COALESCE($6, purchase_date),
       notes=$7, updated_at=$8 WHERE user_id=$1 AND symbol=$2`,
      [req.userId, sym, shares, avg_price, stop_loss ?? null, purchase_date ?? null, notes ?? null, now]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'Holding not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DELETE /api/portfolio/:symbol ─────────────────────────────────────────────
router.delete('/:symbol', async (req, res) => {
  try {
    await query('DELETE FROM portfolio WHERE user_id=$1 AND symbol=$2',
      [req.userId, req.params.symbol.toUpperCase()]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /api/portfolio/history/:symbol ───────────────────────────────────────
// Returns full price history for a holding — range determined by purchase_date
router.get('/history/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    const { rows } = await query(
      'SELECT purchase_date, avg_price, shares FROM portfolio WHERE user_id=$1 AND symbol=$2',
      [req.userId, sym]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Holding not found' });

    const { purchase_date, avg_price, shares } = rows[0];
    const purchaseTs = purchase_date ? parseInt(purchase_date) : null;
    const now = Math.floor(Date.now() / 1000);
    const ageSeconds = purchaseTs ? now - purchaseTs : 365 * 86400;
    const ageDays = ageSeconds / 86400;

    let range = '1y';
    if (ageDays > 4 * 365) range = '5y';
    else if (ageDays > 365) range = '2y';
    else if (ageDays > 90)  range = '1y';
    else if (ageDays > 30)  range = '3mo';
    else range = '1mo';

    const history = await getHistory(sym, range);
    if (!history?.length) return res.json({ ok: true, data: [] });

    // Filter from purchase date + compute value on each date
    const invested  = parseFloat(avg_price) * parseFloat(shares);
    const sharesNum = parseFloat(shares);
    const filtered  = history
      .filter(row => !purchaseTs || row.ts >= purchaseTs)
      .map(row => ({
        ts:    row.ts,
        close: row.close,
        value: Math.round(row.close * sharesNum * 100) / 100,
        cost:  Math.round(invested * 100) / 100,
      }));

    res.json({ ok: true, data: filtered, invested, avg_price: parseFloat(avg_price), shares: sharesNum });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
