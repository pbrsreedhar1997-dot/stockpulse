import Groq from 'groq-sdk';
import { GROQ_API_KEY, ANTHROPIC_API_KEY } from '../config.js';
import { getQuote, getProfile, getFinancials, getNews, getHistory } from './yahoo.js';
import log from '../log.js';

const groqClient = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// ─────────────────────────────────────────────────────────────────────────────
// RAG SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are StockPulse AI, a financial analyst assistant for the StockPulse trading app. You specialise in NSE/BSE equities, Indian macro (RBI policy, FII/DII flows, sector rotation), and global markets.

BEHAVIOUR:
- Respond naturally to greetings and general questions (keep it brief, 1–3 lines).
- When stock data is provided in a RAG RETRIEVAL RESULTS block, answer the user's question using that data. Be specific — use the actual numbers, scores, and signals from the context.
- If no stock data is provided, answer from general financial knowledge and tell the user to mention a specific stock if they want live analysis.
- Match response length to the question: short question → concise answer. "Full analysis" → detailed breakdown.
- Never say buy/sell/hold — frame as probability estimates and analysis.
- **Bold** key numbers. Use bullet points for lists. Keep answers useful, not padded.

FULL ANALYSIS STRUCTURE (use only when asked for a full breakdown):
  1. **Ensemble Score** — BULLISH / NEUTRAL / BEARISH + confidence %
  2. **Fundamentals** — key metrics + score/100
  3. **Technicals** — MA cross, RSI, MACD, Bollinger %B + score/100
  4. **News Sentiment** — themes + score/100
  5. **Price Targets** — bear / base / bull with rationale
  6. Top 3 catalysts | Top 3 risks
  7. Contrarian perspective
  8. Macro regime (for Indian stocks: RBI, FII/DII, sector context)`;

// ─────────────────────────────────────────────────────────────────────────────
// TECHNICAL INDICATORS  (computed from 252-day OHLCV)
// ─────────────────────────────────────────────────────────────────────────────
function ema(values, period) {
  const k = 2 / (period + 1);
  const result = [];
  let prev = null;
  for (const v of values) {
    if (v == null) { result.push(null); continue; }
    prev = prev == null ? v : v * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function sma(values, period) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1).filter(v => v != null);
    return slice.length === period ? slice.reduce((a, b) => a + b, 0) / period : null;
  });
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

function computeTechnicals(candles) {
  if (!candles || candles.length < 30) return null;

  // Sort ascending by timestamp
  const sorted = [...candles].sort((a, b) => a.ts - b.ts);
  const closes = sorted.map(c => c.close ?? c.c);
  const highs   = sorted.map(c => c.high  ?? c.h);
  const lows    = sorted.map(c => c.low   ?? c.l);
  const vols    = sorted.map(c => c.volume ?? c.v ?? 0);
  const n = closes.length;

  // MAs
  const ma50arr  = sma(closes, 50);
  const ma200arr = sma(closes, 200);
  const ma50     = ma50arr[n - 1];
  const ma200    = ma200arr[n - 1];
  const price    = closes[n - 1];

  // Golden/death cross: MA50 crossing MA200 in last 20 bars
  let crossSignal = 'NONE';
  if (ma50arr[n - 1] != null && ma200arr[n - 1] != null) {
    for (let i = Math.max(1, n - 20); i < n; i++) {
      if (ma50arr[i] != null && ma200arr[i] != null && ma50arr[i - 1] != null && ma200arr[i - 1] != null) {
        if (ma50arr[i - 1] < ma200arr[i - 1] && ma50arr[i] > ma200arr[i]) { crossSignal = 'GOLDEN_CROSS'; break; }
        if (ma50arr[i - 1] > ma200arr[i - 1] && ma50arr[i] < ma200arr[i]) { crossSignal = 'DEATH_CROSS'; break; }
      }
    }
    if (crossSignal === 'NONE') {
      crossSignal = ma50 > ma200 ? 'ABOVE_BOTH' : 'BELOW_BOTH';
    }
  }

  // RSI
  const rsi = computeRSI(closes.slice(-30));

  // MACD (12, 26, 9)
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => (v != null && ema26[i] != null) ? v - ema26[i] : null);
  const signalLine = ema(macdLine.filter(v => v != null), 9);
  const macdVal   = macdLine[n - 1];
  const signalVal = signalLine[signalLine.length - 1];
  const macdHist  = (macdVal != null && signalVal != null) ? macdVal - signalVal : null;
  let macdSignal = 'NEUTRAL';
  if (macdHist != null) macdSignal = macdHist > 0 ? 'BULLISH' : 'BEARISH';

  // Bollinger Bands (20, 2σ)
  const bb20 = sma(closes, 20);
  const bbStd = closes.map((_, i) => {
    if (i < 19) return null;
    const slice = closes.slice(i - 19, i + 1);
    const mean  = bb20[i];
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20;
    return Math.sqrt(variance);
  });
  const bbUpper = bb20[n - 1] != null ? bb20[n - 1] + 2 * bbStd[n - 1] : null;
  const bbLower = bb20[n - 1] != null ? bb20[n - 1] - 2 * bbStd[n - 1] : null;
  const bbPct   = (bbUpper && bbLower && price)
    ? Math.round(((price - bbLower) / (bbUpper - bbLower)) * 100) / 100
    : null;

  // Volume trend: avg volume last 20d vs prior 20d
  const recentVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const priorVol  = vols.slice(-40, -20).length
    ? vols.slice(-40, -20).reduce((a, b) => a + b, 0) / Math.min(20, vols.slice(-40, -20).length)
    : null;
  const volTrend  = (recentVol && priorVol) ? (recentVol / priorVol - 1) * 100 : null;

  // Technical score (0–100)
  let score = 50;
  // MA position (25%)
  if (ma50 && ma200 && price) {
    if (price > ma50 && price > ma200) score += 12.5;
    else if (price < ma50 && price < ma200) score -= 12.5;
    if (crossSignal === 'GOLDEN_CROSS') score += 12.5;
    else if (crossSignal === 'DEATH_CROSS') score -= 12.5;
    else if (ma50 > ma200) score += 6;
    else score -= 6;
  }
  // RSI (20%)
  if (rsi != null) {
    if (rsi < 30) score += 10;
    else if (rsi < 45) score += 5;
    else if (rsi > 70) score -= 10;
    else if (rsi > 60) score -= 3;
  }
  // MACD (20%)
  if (macdHist != null) {
    score += macdHist > 0 ? 10 : -10;
  }
  // Bollinger %B (15%)
  if (bbPct != null) {
    if (bbPct < 0.2) score += 7;   // oversold
    else if (bbPct > 0.8) score -= 7; // overbought
  }
  // Volume trend (10%)
  if (volTrend != null) {
    score += volTrend > 20 ? 5 : volTrend < -20 ? -5 : 0;
  }

  score = Math.round(Math.max(0, Math.min(100, score)));

  return {
    score,
    trend: score >= 65 ? 'BULLISH' : score <= 35 ? 'BEARISH' : 'NEUTRAL',
    price_vs_ma50:  ma50  ? `₹${price?.toFixed(2)} vs MA50 ₹${ma50.toFixed(2)} (${((price/ma50-1)*100).toFixed(1)}%)` : 'N/A',
    price_vs_ma200: ma200 ? `₹${price?.toFixed(2)} vs MA200 ₹${ma200.toFixed(2)} (${((price/ma200-1)*100).toFixed(1)}%)` : 'N/A',
    ma_cross: crossSignal,
    rsi: rsi != null ? `${rsi} (${rsi < 30 ? 'OVERSOLD ↑' : rsi > 70 ? 'OVERBOUGHT ↓' : 'NEUTRAL'})` : 'N/A',
    macd: macdHist != null ? `${macdSignal} (hist: ${macdHist.toFixed(3)})` : 'N/A',
    bollinger_pct_b: bbPct != null ? `${bbPct.toFixed(2)} (${bbPct < 0.2 ? 'Near lower band' : bbPct > 0.8 ? 'Near upper band' : 'Mid range'})` : 'N/A',
    volume_trend: volTrend != null ? `${volTrend > 0 ? '+' : ''}${volTrend.toFixed(1)}% vs prior 20d` : 'N/A',
    data_points: n,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWS SENTIMENT  (keyword-based + exponential decay)
// ─────────────────────────────────────────────────────────────────────────────
const POS_TERMS = ['beat', 'surge', 'rally', 'growth', 'profit', 'upgrade', 'strong', 'gain', 'record', 'outperform', 'bullish', 'buy', 'target raised', 'dividend', 'partnership', 'deal', 'launch', 'expansion', 'positive', 'winner', 'soars', 'jumps', 'rises'];
const NEG_TERMS = ['miss', 'drop', 'decline', 'loss', 'downgrade', 'weak', 'risk', 'fine', 'lawsuit', 'fraud', 'recall', 'cut', 'target lowered', 'concern', 'warning', 'bear', 'sell', 'falls', 'crashes', 'slumps', 'disappoints', 'layoffs', 'regulation'];

function classifyArticle(article) {
  const text = (article.title + ' ' + (article.summary || '')).toLowerCase();
  const pos = POS_TERMS.filter(t => text.includes(t)).length;
  const neg = NEG_TERMS.filter(t => text.includes(t)).length;
  if (pos > neg) return { sentiment: 'POSITIVE', confidence: Math.min(0.5 + pos * 0.1, 0.95) };
  if (neg > pos) return { sentiment: 'NEGATIVE', confidence: Math.min(0.5 + neg * 0.1, 0.95) };
  return { sentiment: 'NEUTRAL', confidence: 0.5 };
}

function extractThemes(article) {
  const text = (article.title + ' ' + (article.summary || '')).toLowerCase();
  const themes = [];
  if (/beat|exceed|above expect/.test(text))     themes.push('earnings_beat');
  if (/miss|below expect|disappoint/.test(text)) themes.push('earnings_miss');
  if (/upgrade|raised target|buy rating/.test(text)) themes.push('analyst_upgrade');
  if (/downgrade|lower target|sell rating/.test(text)) themes.push('analyst_downgrade');
  if (/regulat|sebi|rbi|fine|penalty/.test(text)) themes.push('regulatory_risk');
  if (/ceo|cfo|manage|appoint|resign/.test(text)) themes.push('leadership_change');
  if (/lawsuit|legal|court|litig/.test(text)) themes.push('lawsuit');
  if (/partner|deal|acqui|merge/.test(text)) themes.push('partnership');
  if (/guidance|forecast|outlook/.test(text)) themes.push('guidance_change');
  if (/macro|inflation|fed|rbi|rate|gdp/.test(text)) themes.push('macro');
  return themes.length ? themes : ['general'];
}

function scoreSentiment(articles) {
  if (!articles?.length) return { score: 50, label: 'NEUTRAL', scored: [] };
  const now = Date.now();
  let weightedSum = 0, totalWeight = 0;

  const scored = articles.slice(0, 20).map(a => {
    const published = a.published ? a.published * 1000 : now;
    const daysOld   = (now - published) / 86400000;
    const decayW    = Math.exp(-daysOld / 7);
    const { sentiment, confidence } = classifyArticle(a);
    const themes = extractThemes(a);
    const signal = sentiment === 'POSITIVE' ? 1 : sentiment === 'NEGATIVE' ? -1 : 0;
    weightedSum  += signal * decayW * confidence;
    totalWeight  += decayW;
    return { title: a.title, date: a.published ? new Date(a.published * 1000).toISOString().slice(0, 10) : '—', sentiment, confidence: Math.round(confidence * 100), themes, decay_weight: Math.round(decayW * 100) / 100 };
  });

  const weighted = totalWeight ? weightedSum / totalWeight : 0;
  const rawScore = (weighted + 1) * 50;
  const score    = Math.round(Math.max(0, Math.min(100, rawScore)));
  const label    = score >= 65 ? 'POSITIVE_BIAS' : score <= 35 ? 'NEGATIVE_BIAS' : 'NEUTRAL';

  return { score, label, article_count: articles.length, scored: scored.slice(0, 5) };
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNDAMENTAL SCORE  (0–100 from available financials)
// ─────────────────────────────────────────────────────────────────────────────
function scoreFundamentals(fin, quote) {
  if (!fin && !quote) return null;
  let score = 50;
  const notes = [];

  // P/E vs sector (rough thresholds for Indian large-caps)
  const pe = fin?.pe_ratio ?? quote?.pe_ratio;
  if (pe != null) {
    if (pe > 0 && pe < 15) { score += 10; notes.push(`Low P/E ${pe}x (value)`); }
    else if (pe > 50)      { score -= 8;  notes.push(`High P/E ${pe}x (premium)`); }
    else if (pe < 0)       { score -= 12; notes.push('Negative P/E (loss-making)'); }
    else notes.push(`P/E ${pe}x`);
  }

  // Gross margin
  const gm = fin?.gross_margin;
  if (gm != null) {
    if (gm > 40)      { score += 8; notes.push(`Strong gross margin ${gm}%`); }
    else if (gm < 15) { score -= 5; notes.push(`Thin gross margin ${gm}%`); }
  }

  // Net margin
  const nm = fin?.net_margin;
  if (nm != null) {
    if (nm > 15)  { score += 6; notes.push(`Healthy net margin ${nm}%`); }
    else if (nm < 0) { score -= 10; notes.push('Net loss'); }
  }

  // Revenue growth
  const rg = fin?.revenue_growth;
  if (rg != null) {
    if (rg > 15)  { score += 8; notes.push(`Strong revenue growth ${rg}%`); }
    else if (rg < 0) { score -= 6; notes.push(`Revenue declining ${rg}%`); }
  }

  // ROE
  const roe = fin?.return_on_equity;
  if (roe != null) {
    if (roe > 20)  { score += 7; notes.push(`High ROE ${roe}%`); }
    else if (roe < 8) { score -= 4; notes.push(`Low ROE ${roe}%`); }
  }

  // Debt/equity
  const de = fin?.debt_to_equity;
  if (de != null) {
    if (de > 2)   { score -= 6; notes.push(`High D/E ${de}x`); }
    else if (de < 0.5) { score += 5; notes.push(`Low debt D/E ${de}x`); }
  }

  // EPS positive
  const eps = fin?.eps ?? quote?.eps;
  if (eps != null && eps <= 0) { score -= 8; notes.push('Negative EPS'); }

  // Dividend yield bonus
  const dy = fin?.dividend_yield;
  if (dy > 2)  { score += 3; notes.push(`Dividend yield ${dy}%`); }

  score = Math.round(Math.max(0, Math.min(100, score)));
  return {
    score,
    label: score >= 65 ? 'STRONG' : score <= 40 ? 'WEAK' : 'MODERATE',
    key_metrics: {
      pe_ratio:       pe   ?? '—',
      gross_margin:   gm   != null ? `${gm}%` : '—',
      net_margin:     nm   != null ? `${nm}%` : '—',
      revenue_growth: rg   != null ? `${rg}%` : '—',
      roe:            roe  != null ? `${roe}%` : '—',
      debt_to_equity: de   ?? '—',
      eps:            eps  ?? '—',
      dividend_yield: dy   != null ? `${dy}%` : '—',
      beta:           fin?.beta ?? '—',
    },
    notes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG CONTEXT BUILDER  — assembles full analysis context per symbol
// ─────────────────────────────────────────────────────────────────────────────
async function buildRagContext(symbols) {
  if (!symbols?.length) return '';
  const sections = [];

  for (const sym of symbols.slice(0, 2)) {
    try {
      // Parallel fetch: quote, profile, financials, news, 1Y daily history
      const [qR, pR, fR, nR, hR] = await Promise.allSettled([
        getQuote(sym),
        getProfile(sym),
        getFinancials(sym),
        getNews(sym),
        getHistory(sym, '1y'),
      ]);

      const q    = qR.status === 'fulfilled' ? qR.value   : null;
      const p    = pR.status === 'fulfilled' ? pR.value   : null;
      const fin  = fR.status === 'fulfilled' ? fR.value   : null;
      const news = nR.status === 'fulfilled' ? nR.value   : [];
      const hist = hR.status === 'fulfilled' ? hR.value   : null;

      if (!q?.price) continue;

      const cur = q.currency === 'INR' ? '₹' : '$';
      const ticker = sym.replace(/\.(NS|BO)$/i, '');

      // ── Compute modules ─────────────────────────────────────────────────────
      const technicals   = computeTechnicals(hist);
      const sentiment    = scoreSentiment(news);
      const fundamentals = scoreFundamentals(fin, q);

      // ── Ensemble prediction score ────────────────────────────────────────────
      const fScore = fundamentals?.score ?? 50;
      const tScore = technicals?.score   ?? 50;
      const sScore = sentiment?.score    ?? 50;
      const ensemble = Math.round(fScore * 0.4 + tScore * 0.3 + sScore * 0.3);
      const direction  = ensemble >= 65 ? 'BULLISH' : ensemble <= 35 ? 'BEARISH' : 'NEUTRAL';
      const confidence = Math.min(100, Math.round(Math.abs(ensemble - 50) * 2));

      // ── 52W position ─────────────────────────────────────────────────────────
      const w52h = q.week52_high ?? fin?.week52_high;
      const w52l = q.week52_low  ?? fin?.week52_low;
      const w52pos = (w52h && w52l && q.price)
        ? `${Math.round(((q.price - w52l) / (w52h - w52l)) * 100)}% of 52W range`
        : '—';

      // ── Context document ─────────────────────────────────────────────────────
      let doc = `
━━━ RETRIEVED CONTEXT: ${ticker} (${sym}) ━━━
[Source authority: Live quote=0.95 | Financials=0.85 | News=0.75]
[Data staleness: quote < 1h | news < 30 days | history: 252 trading days]

── LIVE QUOTE ───────────────────────────────────────────
Company:    ${p?.name || sym}
Sector:     ${p?.sector || fin?.sector || '—'} | Industry: ${p?.industry || '—'}
Price:      ${cur}${q.price.toFixed(2)} | Change: ${q.change?.toFixed(2) ?? '—'} (${q.change_pct?.toFixed(2) ?? '—'}%)
Open: ${cur}${q.open?.toFixed(2) ?? '—'} | High: ${cur}${q.high?.toFixed(2) ?? '—'} | Low: ${cur}${q.low?.toFixed(2) ?? '—'}
Prev Close: ${cur}${q.prev_close?.toFixed(2) ?? '—'} | Volume: ${q.volume ? (q.volume / 1e5).toFixed(2) + 'L' : '—'}
Mkt Cap:    ${q.mkt_cap ? `${cur}${(q.mkt_cap / 1e7).toFixed(0)} Cr` : '—'}
52W Range:  ${cur}${w52l?.toFixed(2) ?? '—'} – ${cur}${w52h?.toFixed(2) ?? '—'} | Position: ${w52pos}

── FUNDAMENTAL ANALYSIS (score: ${fScore}/100 — ${fundamentals?.label ?? '—'}) ───
${fundamentals ? Object.entries(fundamentals.key_metrics).map(([k, v]) => `  ${k.padEnd(18)}: ${v}`).join('\n') : '  Financials data unavailable'}
${fundamentals?.notes?.length ? '  Signals: ' + fundamentals.notes.join(' | ') : ''}

── TECHNICAL ANALYSIS (score: ${tScore}/100 — ${technicals?.trend ?? '—'}) ───
${technicals ? `  MA Cross:          ${technicals.ma_cross}
  Price vs MA50:    ${technicals.price_vs_ma50}
  Price vs MA200:   ${technicals.price_vs_ma200}
  RSI(14):          ${technicals.rsi}
  MACD:             ${technicals.macd}
  Bollinger %B:     ${technicals.bollinger_pct_b}
  Volume Trend:     ${technicals.volume_trend}
  Data points:      ${technicals.data_points} trading days` : '  Historical data unavailable (need ≥30 candles)'}

── NEWS SENTIMENT (score: ${sScore}/100 — ${sentiment.label}) ───
  Articles scanned: ${sentiment.article_count ?? 0} (last 30 days, decay-weighted)
${sentiment.scored?.length ? sentiment.scored.map(a =>
  `  [${a.sentiment.padEnd(8)} ${a.confidence}% conf | w=${a.decay_weight}] ${a.title?.slice(0, 80) ?? ''}`
).join('\n') : '  No recent news found'}

── ENSEMBLE PREDICTION ──────────────────────────────────
  Fundamental (40%): ${fScore} × 0.40 = ${Math.round(fScore * 0.4)}
  Technical   (30%): ${tScore} × 0.30 = ${Math.round(tScore * 0.3)}
  Sentiment   (30%): ${sScore} × 0.30 = ${Math.round(sScore * 0.3)}
  ──────────────────────────────────────────────────────
  ENSEMBLE SCORE:    ${ensemble}/100 → ${direction} (confidence: ${confidence}%)
  ${confidence < 40 ? '⚠ CONFIDENCE < 40% — INSUFFICIENT_DATA for high-conviction prediction' : ''}
`.trim();

      sections.push(doc);
    } catch (e) {
      log.warn(`RAG context failed for ${sym}: ${e.message}`);
    }
  }

  return sections.length
    ? `\n\n${'═'.repeat(60)}\nRAG RETRIEVAL RESULTS (${sections.length} symbol${sections.length > 1 ? 's' : ''})\n${'═'.repeat(60)}\n${sections.join('\n\n')}\n${'═'.repeat(60)}`
    : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// SYMBOL EXTRACTOR  — parses question text to find NSE/BSE stock mentions
// ─────────────────────────────────────────────────────────────────────────────
const NSE_MAP = {
  // Nifty 50 + large caps — name/alias → symbol
  'reliance': 'RELIANCE.NS', 'ril': 'RELIANCE.NS',
  'tcs': 'TCS.NS', 'tata consultancy': 'TCS.NS',
  'hdfc bank': 'HDFCBANK.NS', 'hdfcbank': 'HDFCBANK.NS', 'hdfc': 'HDFCBANK.NS',
  'infosys': 'INFY.NS', 'infy': 'INFY.NS',
  'icici bank': 'ICICIBANK.NS', 'icicibank': 'ICICIBANK.NS', 'icici': 'ICICIBANK.NS',
  'hindunilvr': 'HINDUNILVR.NS', 'hul': 'HINDUNILVR.NS', 'hindustan unilever': 'HINDUNILVR.NS',
  'bajaj finance': 'BAJFINANCE.NS', 'bajfinance': 'BAJFINANCE.NS',
  'bajaj finserv': 'BAJAJFINSV.NS', 'bajajfinsv': 'BAJAJFINSV.NS',
  'larsen': 'LT.NS', 'l&t': 'LT.NS', 'lt': 'LT.NS',
  'kotak': 'KOTAKBANK.NS', 'kotakbank': 'KOTAKBANK.NS', 'kotak bank': 'KOTAKBANK.NS', 'kotak mahindra': 'KOTAKBANK.NS',
  'asian paints': 'ASIANPAINT.NS', 'asianpaint': 'ASIANPAINT.NS',
  'wipro': 'WIPRO.NS',
  'hcl tech': 'HCLTECH.NS', 'hcltech': 'HCLTECH.NS', 'hcl technologies': 'HCLTECH.NS',
  'axis bank': 'AXISBANK.NS', 'axisbank': 'AXISBANK.NS',
  'itc': 'ITC.NS',
  'sbi': 'SBIN.NS', 'state bank': 'SBIN.NS', 'sbin': 'SBIN.NS',
  'maruti': 'MARUTI.NS', 'maruti suzuki': 'MARUTI.NS',
  'ultratech': 'ULTRACEMCO.NS', 'ultracemco': 'ULTRACEMCO.NS', 'ultratech cement': 'ULTRACEMCO.NS',
  'titan': 'TITAN.NS',
  'nestle': 'NESTLEIND.NS', 'nestleind': 'NESTLEIND.NS', 'nestle india': 'NESTLEIND.NS',
  'ntpc': 'NTPC.NS',
  'power grid': 'POWERGRID.NS', 'powergrid': 'POWERGRID.NS',
  'ongc': 'ONGC.NS',
  'm&m': 'M&M.NS', 'mahindra': 'M&M.NS', 'mahindra and mahindra': 'M&M.NS',
  'sun pharma': 'SUNPHARMA.NS', 'sunpharma': 'SUNPHARMA.NS',
  'divis': 'DIVISLAB.NS', 'divislab': 'DIVISLAB.NS', "divi's": 'DIVISLAB.NS',
  'dr reddy': 'DRREDDY.NS', 'drreddy': 'DRREDDY.NS', "dr. reddy's": 'DRREDDY.NS',
  'cipla': 'CIPLA.NS',
  'britannia': 'BRITANNIA.NS',
  'bajaj auto': 'BAJAJ-AUTO.NS',
  'hero motocorp': 'HEROMOTOCO.NS', 'heromotoco': 'HEROMOTOCO.NS', 'hero moto': 'HEROMOTOCO.NS',
  'eicher': 'EICHERMOT.NS', 'eichermot': 'EICHERMOT.NS', 'royal enfield': 'EICHERMOT.NS',
  'tata motors': 'TATAMOTORS.NS', 'tatamotors': 'TATAMOTORS.NS',
  'tata steel': 'TATASTEEL.NS', 'tatasteel': 'TATASTEEL.NS',
  'jswsteel': 'JSWSTEEL.NS', 'jsw steel': 'JSWSTEEL.NS', 'jsw': 'JSWSTEEL.NS',
  'hindalco': 'HINDALCO.NS',
  'vedanta': 'VEDL.NS', 'vedl': 'VEDL.NS',
  'coal india': 'COALINDIA.NS', 'coalindia': 'COALINDIA.NS',
  'bhel': 'BHEL.NS',
  'bpcl': 'BPCL.NS',
  'iocl': 'IOC.NS', 'ioc': 'IOC.NS', 'indian oil': 'IOC.NS',
  'gail': 'GAIL.NS',
  'indusind bank': 'INDUSINDBK.NS', 'indusindbk': 'INDUSINDBK.NS', 'indusind': 'INDUSINDBK.NS',
  'shree cement': 'SHREECEM.NS', 'shreecem': 'SHREECEM.NS',
  'dmart': 'DMART.NS', 'avenue supermarts': 'DMART.NS',
  'siemens': 'SIEMENS.NS',
  'havells': 'HAVELLS.NS',
  'pidilite': 'PIDILITIND.NS', 'pidilitind': 'PIDILITIND.NS', 'fevicol': 'PIDILITIND.NS',
  'page industries': 'PAGEIND.NS', 'pageind': 'PAGEIND.NS', 'jockey': 'PAGEIND.NS',
  'mrf': 'MRF.NS',
  'bosch': 'BOSCHLTD.NS', 'boschltd': 'BOSCHLTD.NS',
  'abb': 'ABB.NS',
  'godrej consumer': 'GODREJCP.NS', 'godrejcp': 'GODREJCP.NS', 'gcpl': 'GODREJCP.NS',
  'dabur': 'DABUR.NS',
  'marico': 'MARICO.NS',
  'colgate': 'COLPAL.NS', 'colpal': 'COLPAL.NS', 'colgate palmolive': 'COLPAL.NS',
  'emami': 'EMAMILTD.NS',
  'zomato': 'ZOMATO.NS',
  'nykaa': 'NYKAA.NS', 'fsn': 'NYKAA.NS',
  'paytm': 'PAYTM.NS', 'one97': 'PAYTM.NS',
  'policybazaar': 'POLICYBZR.NS', 'policybzr': 'POLICYBZR.NS',
  'irctc': 'IRCTC.NS',
  'adani ports': 'ADANIPORTS.NS', 'adaniports': 'ADANIPORTS.NS',
  'adani enterprises': 'ADANIENT.NS', 'adanient': 'ADANIENT.NS',
  'adani green': 'ADANIGREEN.NS', 'adanigreen': 'ADANIGREEN.NS',
  'adani power': 'ADANIPOWER.NS',
  'adani total gas': 'ATGL.NS', 'atgl': 'ATGL.NS',
  'tata power': 'TATAPOWER.NS', 'tatapower': 'TATAPOWER.NS',
  'tata consumer': 'TATACONSUM.NS', 'tataconsum': 'TATACONSUM.NS',
  'tech mahindra': 'TECHM.NS', 'techm': 'TECHM.NS',
  'mphasis': 'MPHASIS.NS',
  'persistent': 'PERSISTENT.NS', 'persistent systems': 'PERSISTENT.NS',
  'coforge': 'COFORGE.NS',
  'ltimindtree': 'LTIM.NS', 'ltim': 'LTIM.NS', 'lti': 'LTIM.NS',
  'tanla': 'TANLA.NS',
  'dixon': 'DIXON.NS', 'dixon technologies': 'DIXON.NS',
  'amber enterprises': 'AMBER.NS',
  'blue dart': 'BLUEDART.NS', 'bluedart': 'BLUEDART.NS',
  'indigo': 'INDIGO.NS', 'interglobe': 'INDIGO.NS',
  'spicejet': 'SPICEJET.NS',
  'pnb': 'PNB.NS', 'punjab national bank': 'PNB.NS',
  'bank of baroda': 'BANKBARODA.NS', 'bankbaroda': 'BANKBARODA.NS', 'bob': 'BANKBARODA.NS',
  'canara bank': 'CANBK.NS', 'canbk': 'CANBK.NS',
  'union bank': 'UNIONBANK.NS', 'unionbank': 'UNIONBANK.NS',
  'federal bank': 'FEDERALBNK.NS', 'federalbnk': 'FEDERALBNK.NS',
  'bandhan bank': 'BANDHANBNK.NS', 'bandhanbnk': 'BANDHANBNK.NS',
  'idfc first': 'IDFCFIRSTB.NS', 'idfcfirstb': 'IDFCFIRSTB.NS', 'idfc': 'IDFCFIRSTB.NS',
  'yes bank': 'YESBANK.NS', 'yesbank': 'YESBANK.NS',
  'motherson': 'MOTHERSON.NS', 'samvardhana motherson': 'MOTHERSON.NS',
  'balkrisind': 'BALKRISIND.NS', 'balkrishna': 'BALKRISIND.NS', 'bkt': 'BALKRISIND.NS',
  'astral': 'ASTRAL.NS', 'astral poly': 'ASTRAL.NS',
  'polycab': 'POLYCAB.NS',
  'cg power': 'CGPOWER.NS', 'cgpower': 'CGPOWER.NS',
  'bharat electronics': 'BEL.NS', 'bel': 'BEL.NS',
  'hal': 'HAL.NS', 'hindustan aeronautics': 'HAL.NS',
  'bharat forge': 'BHARATFORG.NS', 'bharatforg': 'BHARATFORG.NS',
  'cummins': 'CUMMINSIND.NS', 'cumminsind': 'CUMMINSIND.NS',
  'thermax': 'THERMAX.NS',
  'voltas': 'VOLTAS.NS',
  'whirlpool': 'WHIRLPOOL.NS',
  'crompton': 'CROMPTON.NS', 'crompton greaves': 'CROMPTON.NS',
  'orient electric': 'ORIENTELEC.NS',
  'escorts': 'ESCORTS.NS', 'escorts kubota': 'ESCORTS.NS',
  'tractors india': 'TIL.NS',
  'kpit': 'KPITTECH.NS', 'kpittech': 'KPITTECH.NS',
  'trent': 'TRENT.NS', 'westside': 'TRENT.NS',
  'vedant fashions': 'MANYAVAR.NS', 'manyavar': 'MANYAVAR.NS',
  'metro brands': 'METROBRAND.NS',
  'avenue': 'DMART.NS',
  'star health': 'STARHEALTH.NS',
  'hdfc life': 'HDFCLIFE.NS', 'hdfclife': 'HDFCLIFE.NS',
  'sbi life': 'SBILIFE.NS', 'sbilife': 'SBILIFE.NS',
  'lic': 'LICI.NS', 'lici': 'LICI.NS', 'life insurance': 'LICI.NS',
  'general insurance': 'GICRE.NS', 'gicre': 'GICRE.NS',
  'icici lombard': 'ICICIGI.NS', 'icicigi': 'ICICIGI.NS',
  'new india': 'NIACL.NS', 'niacl': 'NIACL.NS',
  'irb infra': 'IRB.NS', 'irb': 'IRB.NS',
  'container corp': 'CONCOR.NS', 'concor': 'CONCOR.NS',
  'apl apollo': 'APLAPOLLO.NS',
  'jindal steel': 'JSWSTEEL.NS',
  'nmdc': 'NMDC.NS',
  'hindustan zinc': 'HINDZINC.NS', 'hindzinc': 'HINDZINC.NS',
  'godrej properties': 'GODREJPROP.NS', 'godrejprop': 'GODREJPROP.NS',
  'dlf': 'DLF.NS',
  'oberoi realty': 'OBEROIRLTY.NS', 'oberoirlty': 'OBEROIRLTY.NS',
  'prestige': 'PRESTIGE.NS', 'prestige estates': 'PRESTIGE.NS',
  'brigade': 'BRIGADE.NS', 'brigade enterprises': 'BRIGADE.NS',
  'suntv': 'SUNTV.NS', 'sun tv': 'SUNTV.NS',
  'zee entertainment': 'ZEEL.NS', 'zeel': 'ZEEL.NS', 'zee': 'ZEEL.NS',
  'pvr inox': 'PVRINOX.NS', 'pvrinox': 'PVRINOX.NS', 'pvr': 'PVRINOX.NS', 'inox': 'PVRINOX.NS',
  'nazara': 'NAZARA.NS',
  'aptus value': 'APTUS.NS',
  'home first': 'HOMEFIRST.NS',
  'aavas financiers': 'AAVAS.NS', 'aavas': 'AAVAS.NS',
  'five star': 'FIVESTAR.NS',
  'manappuram': 'MANAPPURAM.NS', 'muthoot': 'MUTHOOTFIN.NS', 'muthootfin': 'MUTHOOTFIN.NS',
  'chola': 'CHOLAFIN.NS', 'cholafin': 'CHOLAFIN.NS', 'cholamandalam': 'CHOLAFIN.NS',
  'shriram finance': 'SHRIRAMFIN.NS', 'shriramfin': 'SHRIRAMFIN.NS',
  'piramal': 'PIRAMALENT.NS', 'piramalent': 'PIRAMALENT.NS',
  'alkem': 'ALKEM.NS', 'alkem labs': 'ALKEM.NS',
  'lupin': 'LUPIN.NS',
  'gland pharma': 'GLAND.NS', 'gland': 'GLAND.NS',
  'biocon': 'BIOCON.NS',
  'laurus': 'LAURUSLABS.NS', 'lauruslabs': 'LAURUSLABS.NS',
  'natco': 'NATCOPHARM.NS',
  'indiamart': 'INDIAMART.NS',
  'just dial': 'JUSTDIAL.NS', 'justdial': 'JUSTDIAL.NS',
  'info edge': 'NAUKRI.NS', 'naukri': 'NAUKRI.NS',
  'cartrade': 'CARTRADE.NS',
  'devyani': 'DEVYANI.NS', 'kfc india': 'DEVYANI.NS',
  'jubilant food': 'JUBLFOOD.NS', 'jublfood': 'JUBLFOOD.NS', 'dominos': 'JUBLFOOD.NS',
  'westlife': 'WESTLIFE.NS', 'mcdonald india': 'WESTLIFE.NS',
  'campus activewear': 'CAMPUS.NS',
  'vedant': 'MANYAVAR.NS',
  'bse': 'BSE.NS', 'bombay stock exchange': 'BSE.NS',
  'cdsl': 'CDSL.NS', 'central depository': 'CDSL.NS',
  'msei': 'BSE.NS',
  'mcx': 'MCX.NS', 'multi commodity': 'MCX.NS',
};

// Sorted by length descending so longer phrases match before shorter ones
const NSE_PHRASES = Object.keys(NSE_MAP).sort((a, b) => b.length - a.length);

function extractSymbolsFromQuestion(question) {
  const q = question.toLowerCase();
  const found = new Set();

  // 1. Explicit .NS/.BO ticker patterns (e.g. "RELIANCE.NS", "TCS.NS")
  const tickerRe = /\b([A-Z]{2,}(?:-[A-Z]+)?)\.(NS|BO)\b/gi;
  for (const m of question.matchAll(tickerRe)) {
    found.add(`${m[1].toUpperCase()}.${m[2].toUpperCase()}`);
  }

  // 2. Plain uppercase tickers (e.g. "RELIANCE", "TCS", "HDFCBANK")
  const upperRe = /\b([A-Z]{3,}(?:-[A-Z]+)?)\b/g;
  for (const m of question.matchAll(upperRe)) {
    const candidate = m[1].toUpperCase() + '.NS';
    if (NSE_MAP[m[1].toLowerCase()]) {
      found.add(NSE_MAP[m[1].toLowerCase()]);
    }
  }

  // 3. Company name / common alias matching
  for (const phrase of NSE_PHRASES) {
    if (q.includes(phrase) && !found.has(NSE_MAP[phrase])) {
      found.add(NSE_MAP[phrase]);
      if (found.size >= 2) break;
    }
  }

  return [...found].slice(0, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE DEPTH — determines token budget based on question intent
// ─────────────────────────────────────────────────────────────────────────────
const DEEP_KEYWORDS = [
  'analys', 'breakdown', 'comprehensive', 'full', 'complete', 'detail',
  'technical', 'fundamental', 'sentiment', 'predict', 'forecast', 'target',
  'rsi', 'macd', 'bollinger', 'moving average', 'pe ratio', 'valuation',
  'dcf', 'score', 'signal', 'sector', 'fii', 'dii', 'macro', 'outlook',
];

function responseDepth(question) {
  const q = question.toLowerCase();
  return DEEP_KEYWORDS.some(k => q.includes(k)) ? 'deep' : 'concise';
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAM ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────
export async function streamChat({ question, symbols = [], history = [], onDelta, onDone, onError }) {
  if (!groqClient && !ANTHROPIC_API_KEY) {
    onError('AI not configured — add GROQ_API_KEY to environment variables.');
    return;
  }
  if (!groqClient && ANTHROPIC_API_KEY) {
    return streamAnthropic({ question, symbols, history, onDelta, onDone, onError });
  }

  try {
    const depth    = responseDepth(question);
    // Extract symbols from question text; fall back to any passed-in symbols
    const extracted = extractSymbolsFromQuestion(question);
    const symsToUse = extracted.length ? extracted : symbols;
    const context  = symsToUse.length ? await buildRagContext(symsToUse) : '';
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + context },
      ...history.slice(-10).map(m => ({ role: m.role, content: String(m.content) })),
      { role: 'user', content: question },
    ];

    const stream = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: depth === 'deep' ? 2000 : 500,
      temperature: depth === 'deep' ? 0.4 : 0.65,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) onDelta(text);
    }
    onDone();
  } catch (e) {
    log.error('Chat (Groq):', e.message);
    onError(e.message || 'Chat failed');
  }
}

async function streamAnthropic({ question, symbols, history, onDelta, onDone, onError }) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client   = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const depth    = responseDepth(question);
    const extracted = extractSymbolsFromQuestion(question);
    const symsToUse = extracted.length ? extracted : symbols;
    const context  = symsToUse.length ? await buildRagContext(symsToUse) : '';
    const messages = [
      ...history.slice(-10).map(m => ({ role: m.role, content: String(m.content) })),
      { role: 'user', content: question },
    ];

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: depth === 'deep' ? 2000 : 500,
      system: SYSTEM_PROMPT + context,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) onDelta(event.delta.text);
    }
    onDone();
  } catch (e) {
    log.error('Chat (Anthropic):', e.message);
    onError(e.message || 'Chat failed');
  }
}
