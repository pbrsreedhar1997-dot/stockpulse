import React, { useMemo } from 'react';
import { useAppContext } from '../../../contexts/AppContext';
import { fmtPrice } from '../../../utils/currency';
import './tabs.scss';

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/* ── Score helpers ────────────────────────────────────────────────────────── */
function scoreColor(s) {
  if (s == null) return 'var(--text3)';
  if (s >= 7.5) return 'var(--up)';
  if (s >= 5)   return 'var(--accent)';
  return 'var(--down)';
}
function scoreBg(s) {
  if (s == null) return 'var(--card2)';
  if (s >= 7.5) return 'var(--up-dim)';
  if (s >= 5)   return 'var(--accent-dim)';
  return 'var(--down-dim)';
}
function scoreLabel(s) {
  if (s == null) return 'N/A';
  if (s >= 8.5) return 'Excellent';
  if (s >= 7)   return 'Good';
  if (s >= 5)   return 'Moderate';
  if (s >= 3)   return 'Weak';
  return 'Poor';
}

/* ── Score calculation ────────────────────────────────────────────────────── */
function calcScores(q, f) {
  let valuation = null, growth = null, quality = null, risk = null;

  if (f?.pe_ratio != null && f.pe_ratio > 0) {
    const pe = f.pe_ratio;
    valuation = pe < 10 ? 9.5 : pe < 15 ? 8.5 : pe < 25 ? 7 : pe < 40 ? 5 : pe < 60 ? 3 : 1.5;
  }

  const rg = f?.revenue_growth, eg = f?.earnings_growth;
  if (rg != null || eg != null) {
    const vals = [rg, eg].filter(v => v != null);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    growth = avg >= 30 ? 9.5 : avg >= 20 ? 8 : avg >= 10 ? 6.5 : avg >= 0 ? 4.5 : avg >= -10 ? 2.5 : 1;
  }

  let qPts = 0, qCnt = 0;
  if (f?.gross_margin    != null) { qPts += f.gross_margin > 50 ? 9.5 : f.gross_margin > 30 ? 7 : f.gross_margin > 15 ? 4.5 : 2;        qCnt++; }
  if (f?.net_margin      != null) { qPts += f.net_margin   > 20 ? 9.5 : f.net_margin   > 8  ? 7 : f.net_margin   > 0  ? 4.5 : 1;        qCnt++; }
  if (f?.return_on_equity != null) { qPts += f.return_on_equity > 20 ? 9.5 : f.return_on_equity > 12 ? 7 : f.return_on_equity > 0 ? 4.5 : 1; qCnt++; }
  if (qCnt > 0) quality = qPts / qCnt;

  let rPts = 0, rCnt = 0;
  if (f?.beta           != null) { const b = f.beta;            rPts += b  < 0.8 ? 9 : b  < 1.2 ? 7 : b  < 1.5 ? 5 : b  < 2 ? 3 : 1.5; rCnt++; }
  if (f?.debt_to_equity != null) { const d = f.debt_to_equity;  rPts += d  < 0.3 ? 9 : d  < 1   ? 7 : d  < 2   ? 4.5 : 2;               rCnt++; }
  if (rCnt > 0) risk = rPts / rCnt;

  return { valuation, growth, quality, risk };
}

/* ── Signal generator ─────────────────────────────────────────────────────── */
function buildSignals(q, f, p) {
  const bulls = [], bears = [];

  if (f?.pe_ratio != null) {
    if (f.pe_ratio < 15)   bulls.push(`Low P/E of ${f.pe_ratio.toFixed(1)}x — possible value opportunity`);
    else if (f.pe_ratio > 45) bears.push(`High P/E of ${f.pe_ratio.toFixed(1)}x — premium valuation at risk`);
  }
  if (f?.revenue_growth != null) {
    if (f.revenue_growth >= 15) bulls.push(`Strong top-line growth +${f.revenue_growth.toFixed(1)}%`);
    else if (f.revenue_growth < 0) bears.push(`Revenue declining ${f.revenue_growth.toFixed(1)}% YoY`);
  }
  if (f?.earnings_growth != null) {
    if (f.earnings_growth >= 20) bulls.push(`Exceptional earnings growth +${f.earnings_growth.toFixed(1)}%`);
    else if (f.earnings_growth < 0) bears.push(`Earnings contracting ${f.earnings_growth.toFixed(1)}% YoY`);
  }
  if (f?.return_on_equity != null) {
    if (f.return_on_equity >= 20) bulls.push(`High ROE ${f.return_on_equity.toFixed(1)}% — efficient capital use`);
    else if (f.return_on_equity < 8) bears.push(`Low ROE ${f.return_on_equity.toFixed(1)}% — poor capital returns`);
  }
  if (f?.gross_margin != null) {
    if (f.gross_margin >= 40) bulls.push(`Strong gross margin ${f.gross_margin.toFixed(1)}% — pricing power`);
    else if (f.gross_margin < 15) bears.push(`Thin gross margin ${f.gross_margin.toFixed(1)}% — cost pressure risk`);
  }
  if (f?.debt_to_equity != null) {
    if (f.debt_to_equity < 0.3) bulls.push(`Low leverage (D/E ${f.debt_to_equity.toFixed(2)}) — financial fortress`);
    else if (f.debt_to_equity > 2) bears.push(`High leverage (D/E ${f.debt_to_equity.toFixed(2)}) — rate cycle risk`);
  }
  if (f?.beta != null) {
    if (f.beta < 0.8) bulls.push(`Low beta ${f.beta.toFixed(2)} — defensive, cushions downturns`);
    else if (f.beta > 1.5) bears.push(`High beta ${f.beta.toFixed(2)} — amplifies both gains and losses`);
  }
  if (f?.dividend_yield >= 3) {
    bulls.push(`Attractive dividend yield ${f.dividend_yield.toFixed(2)}% — income support`);
  }
  if (q?.price && f?.week52_high) {
    const fromHigh = ((q.price - f.week52_high) / f.week52_high) * 100;
    if (fromHigh >= -8)  bulls.push(`Trading near 52W high — strong price momentum`);
    else if (fromHigh <= -40) bears.push(`${Math.abs(fromHigh).toFixed(0)}% below 52W high — significant underperformance`);
  }
  if (q?.price && f?.week52_low) {
    const fromLow = ((q.price - f.week52_low) / f.week52_low) * 100;
    if (fromLow <= 10) bears.push(`Near 52W low — possible distress or sector rotation`);
  }

  return { bulls, bears };
}

/* ── Score tile ───────────────────────────────────────────────────────────── */
function ScoreTile({ label, score, icon }) {
  const color = scoreColor(score);
  const bg    = scoreBg(score);
  const lbl   = scoreLabel(score);
  const pct   = score != null ? Math.round((score / 10) * 100) : 0;

  return (
    <div className="ins-tile" style={{ background: bg, borderColor: `${color}33` }}>
      <div className="ins-tile__icon">{icon}</div>
      <div className="ins-tile__label">{label}</div>
      {score != null ? (
        <>
          <div className="ins-tile__score" style={{ color }}>
            {score.toFixed(1)}<span>/10</span>
          </div>
          <div className="ins-tile__bar">
            <div className="ins-tile__bar-fill" style={{ width: `${pct}%`, background: color }} />
          </div>
          <div className="ins-tile__tag" style={{ color }}>{lbl}</div>
        </>
      ) : (
        <div className="ins-tile__score ins-tile__score--na">N/A</div>
      )}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
export default function InsightsTab({ symbol }) {
  const { state } = useAppContext();
  const q = state.quotes[symbol];
  const f = state.financials[symbol];
  const p = state.profiles[symbol];
  const cur = q?.currency || (symbol?.match(/\.(NS|BO)$/i) ? 'INR' : 'USD');

  const scores  = useMemo(() => calcScores(q, f),           [q?.price, f?.pe_ratio, f?.gross_margin, f?.return_on_equity, f?.beta, f?.debt_to_equity]);
  const signals = useMemo(() => buildSignals(q, f, p),      [q?.price, f, p?.sector]);

  if (!q || !f) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
        Load stock data to see insights.
      </div>
    );
  }

  const hasScores  = Object.values(scores).some(v => v != null);
  const { bulls, bears } = signals;

  /* Composite overall score */
  const scoreParts = Object.values(scores).filter(v => v != null);
  const overall    = scoreParts.length ? scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length : null;

  /* Quick text summary */
  const peStr    = f.pe_ratio  != null ? `P/E ${f.pe_ratio.toFixed(1)}x` : null;
  const epsStr   = f.eps       != null ? `EPS ${fmtPrice(f.eps, cur)}` : null;
  const betaStr  = f.beta      != null ? `Beta ${f.beta.toFixed(2)}` : null;
  const w52Str   = f.week52_high && f.week52_low
    ? `52W range ${fmtPrice(f.week52_low, cur)} – ${fmtPrice(f.week52_high, cur)}`
    : null;

  return (
    <div className="tab-panel">

      {/* ── Score grid ───────────────────────────────────────────── */}
      {hasScores && (
        <div className="ins-header">
          <div className="ins-overall">
            <div className="ins-overall__label">Overall Score</div>
            <div className="ins-overall__value" style={{ color: scoreColor(overall) }}>
              {overall != null ? overall.toFixed(1) : 'N/A'}
              {overall != null && <span>/10</span>}
            </div>
            <div className="ins-overall__tag" style={{ color: scoreColor(overall) }}>
              {scoreLabel(overall)}
            </div>
          </div>
          <div className="ins-scores">
            <ScoreTile label="Valuation" score={scores.valuation} icon="📊" />
            <ScoreTile label="Growth"    score={scores.growth}    icon="📈" />
            <ScoreTile label="Quality"   score={scores.quality}   icon="⭐" />
            <ScoreTile label="Risk"      score={scores.risk}      icon="🛡" />
          </div>
        </div>
      )}

      {/* ── Bull / Bear signals ───────────────────────────────────── */}
      {(bulls.length > 0 || bears.length > 0) && (
        <div className="ins-signals">
          {bulls.length > 0 && (
            <div className="ins-col ins-col--bull">
              <div className="ins-col__hdr">
                <span className="ins-col__dot ins-col__dot--bull" />
                Positives ({bulls.length})
              </div>
              {bulls.map((b, i) => (
                <div key={i} className="ins-row ins-row--bull">
                  <span>▲</span>{b}
                </div>
              ))}
            </div>
          )}
          {bears.length > 0 && (
            <div className="ins-col ins-col--bear">
              <div className="ins-col__hdr">
                <span className="ins-col__dot ins-col__dot--bear" />
                Watch Out ({bears.length})
              </div>
              {bears.map((b, i) => (
                <div key={i} className="ins-row ins-row--bear">
                  <span>▼</span>{b}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Snapshot stats strip ─────────────────────────────────── */}
      {[peStr, epsStr, betaStr, w52Str].filter(Boolean).length > 0 && (
        <div className="ins-strip">
          {[peStr, epsStr, betaStr, w52Str].filter(Boolean).map((s, i) => (
            <div key={i} className="ins-strip__item">{s}</div>
          ))}
        </div>
      )}

      {/* ── Text analysis ─────────────────────────────────────────── */}
      <div className="insights-block">
        <div className="insights-block__label">Quick Analysis</div>

        {f.pe_ratio != null && (
          <p>
            <strong>{p?.name || symbol}</strong> trades at a P/E of <strong>{f.pe_ratio.toFixed(1)}x</strong>
            {f.pe_ratio < 15  && ' — in value territory relative to most sectors'}.
            {f.pe_ratio > 45  && ' — a premium that demands strong growth delivery'}.
            {f.eps != null    && ` EPS stands at ₹${f.eps.toFixed(2)}.`}
          </p>
        )}

        {(f.gross_margin != null || f.net_margin != null) && (
          <p>
            {f.gross_margin != null && <>Gross margin of <strong>{f.gross_margin.toFixed(1)}%</strong>
              {f.gross_margin > 40 ? ' signals strong pricing power' : f.gross_margin < 15 ? ' is thin — watch cost pressures' : ' is in a healthy range'}. </>}
            {f.net_margin != null && <>Net margin of <strong>{f.net_margin.toFixed(1)}%</strong>
              {f.net_margin > 20 ? ' reflects excellent bottom-line efficiency' : f.net_margin < 0 ? ' indicates current losses' : ''}.</>}
          </p>
        )}

        {(f.revenue_growth != null || f.earnings_growth != null) && (
          <p>
            {f.revenue_growth != null && <>Revenue grew <strong>{f.revenue_growth > 0 ? '+' : ''}{f.revenue_growth.toFixed(1)}%</strong> YoY. </>}
            {f.earnings_growth != null && <>Earnings growth is <strong>{f.earnings_growth > 0 ? '+' : ''}{f.earnings_growth.toFixed(1)}%</strong>.</>}
          </p>
        )}

        {f.beta != null && (
          <p>
            With a beta of <strong>{f.beta.toFixed(2)}</strong>, the stock is{' '}
            {f.beta < 0.8 ? 'defensive — it moves less than the broader market, making it resilient in downturns' :
             f.beta > 1.5 ? 'high-beta — it amplifies market swings, offering higher reward but higher risk' :
             'broadly correlated with the Nifty 50'}.
          </p>
        )}

        {p?.sector && (
          <p>
            Operates in the <strong>{p.sector}</strong> sector
            {p.industry ? `, specifically in ${p.industry}` : ''}.
          </p>
        )}

        <p style={{ color: 'var(--text3)', fontSize: 12, marginTop: 8 }}>
          <em>Automated summary based on available data. Not financial advice.</em>
        </p>
      </div>
    </div>
  );
}
