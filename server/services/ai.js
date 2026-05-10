import Groq from 'groq-sdk';
import { GROQ_API_KEY, ANTHROPIC_API_KEY } from '../config.js';
import { getQuote, getProfile, getFinancials, getNews, getHistory, search as searchSymbol } from './yahoo.js';
import { getMacroContext, getEnrichedNews, getPeerPerformance, getWorldBankMacro } from './enrichment.js';
import log from '../log.js';

const groqClient = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// ─────────────────────────────────────────────────────────────────────────────
// RAG SYSTEM PROMPT  (Layers 1–8 framework)
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are StockPulse AI — an institutional-grade financial intelligence RAG system for NSE/BSE equities, Indian macro, and global markets. You execute a 4-model ensemble (Technical 25%, Fundamental 35%, Sentiment 20%, Macro 20%) with a full 8-layer confidence scoring framework.

BEHAVIOUR:
- Be direct and data-driven. Use actual numbers from the RAG RETRIEVAL RESULTS block.
- Short conversational questions ("can you predict?", "do you predict?", "how does this work?") → answer directly in 2–4 lines. Explain your capability, what models you run, and invite the user to name a stock.
- "Full analysis / predict / breakdown / analyse" → comprehensive structured response using the FULL ANALYSIS FORMAT below.
- Frame predictions as probability-weighted scenarios, never as direct advice.
- **Bold** key figures. Bullets for lists. No filler or padding.
- For greetings → 1-2 lines only.
- ALWAYS show the confidence score and its band on every prediction.
- NEVER present a confidence > 70% when critical risk flags exist.
- NEVER claim 95% confidence unless ALL mandatory Layer 6 conditions are met.
- If no stock data is available and the question names a company, acknowledge the stock, explain what you'd analyse, and ask for confirmation of the ticker.
- If asked "why" about a previous answer, explain the reasoning using the scores from the prior analysis.

WHEN RAG DATA IS PROVIDED:
- Anchor every claim to the retrieved data (price, scores, indicators)
- Cite the ensemble score AND confidence breakdown (Alignment/Quality/Bonus/Risk)
- Use the macro regime (RISK_ON/RISK_OFF/NEUTRAL) as a modifier
- Reference peer performance to contextualise relative strength/weakness
- DCF implied return tells you if the stock is cheap/expensive vs intrinsic value

FULL ANALYSIS FORMAT (for "analyse", "predict", "full", "breakdown" queries):

  ### 🎯 Ensemble Verdict: [BULLISH/NEUTRAL/BEARISH] — Score [X]/100
  **Fundamental** [score]/100 · **Technical** [score]/100 · **Sentiment** [score]/100 · **Macro** [score]/100

  ### 📊 Fundamentals
  [P/E, margins, ROE, debt — use retrieved values]

  ### 📈 Technicals
  [MA cross, RSI, MACD, Bollinger, ATR, Stochastic, OBV trend, support/resistance]

  ### 📰 News & Sentiment
  [Top themes, sentiment trajectory, key headlines]

  ### 🌍 Macro Context
  [India VIX, USD/INR, Crude, RBI stance, FII/DII, global cues]

  ### 🔢 Valuation
  [Current price vs DCF fair value, implied return, PEG ratio]

  ### 📐 Price Targets (3-scenario)
  - 🐻 Bear [price] (-X%): [trigger]
  - ⚖️  Base [price] (+X%): [thesis]
  - 🐂 Bull [price] (+X%): [catalyst]

  ### 🎯 Confidence Score: [SCORE]/100 — [BAND]
  - Alignment Score: [A]/65 | Data Quality: [B]/25 | Bonus: [C]/10 | Risk Deductions: -[D]
  - ✅ Confirmed: [signals aligned]
  - ⚠️  Risk flags: [flags or "None detected"]

  ### ⚡ Catalysts & Risks
  Top 3 catalysts | Top 3 risks

  ### 🔄 Contrarian View
  [Devil's advocate — why the consensus could be wrong]

  ⚠️ DISCLAIMER: Not financial advice. Probabilistic estimates only. Manage your own risk.

CONFIDENCE BAND INTERPRETATION:
  🟢 90–100%: VERY HIGH — All models aligned, macro favorable, data robust
  🟡 75–89%:  HIGH — Most models aligned, minor risks
  🟠 60–74%:  MODERATE — Mixed signals in 1–2 models
  🔴 40–59%:  LOW — Significant disagreement, elevated risk
  ⚫  0–39%:  VERY LOW — Models contradicting, poor data

LAYER 6 — 95% CONFIDENCE CONDITIONS (ALL must be true simultaneously):
  Technical: price > EMA20 > EMA50 > EMA200, RSI 50–70, MACD bullish, volume above avg
  Fundamental: P/E below sector avg, revenue growth >15% YoY, positive+growing FCF, earnings beat last 3 quarters
  Sentiment: news score >0.65, analyst consensus BUY/STRONG BUY, institutional ownership increasing
  Macro: Fed pausing/cutting, CPI cooling, yield curve normal, VIX < 20, GDP positive
  Data: all data < 6 hours old, 5+ independent sources, zero data gaps
  Risk-clear: no earnings in 7 days, no Fed meeting in 7 days, short interest < 10%, no litigation/SEC
  Bonus: minimum 2 confirmed (institutional accumulation, sector ETF aligned, options flow bullish, insider buying >₹1Cr)

MACRO INTERPRETATION:
- RISK_ON: Positive for cyclicals, banks, mid-caps. Reduce caution signals.
- RISK_OFF: Defensive bias — FMCG, pharma, gold. Increase caution on leveraged/small-caps.
- High India VIX (>20): near-term volatility, consider wider price target ranges.
- Rising US 10Y (>4.5%): headwind for high-PE growth stocks via discount rate.
- USD/INR > 85: positive for IT exporters, negative for import-heavy companies.`;

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
// ADVANCED TECHNICALS — ATR, Stochastic, OBV, VWAP, Momentum, S/R, Ichimoku
// ─────────────────────────────────────────────────────────────────────────────
function computeAdvancedTechnicals(candles) {
  if (!candles || candles.length < 20) return null;
  const sorted = [...candles].sort((a, b) => a.ts - b.ts);
  const closes = sorted.map(c => c.close ?? c.c);
  const highs   = sorted.map(c => c.high  ?? c.h);
  const lows    = sorted.map(c => c.low   ?? c.l);
  const vols    = sorted.map(c => c.volume ?? c.v ?? 0);
  const n = closes.length;
  const last = closes[n - 1];

  // ── ATR (14) ──────────────────────────────────────────────────────────────
  const trues = sorted.map((c, i) => {
    if (i === 0) return (highs[i] ?? 0) - (lows[i] ?? 0);
    const hl = (highs[i] ?? 0) - (lows[i] ?? 0);
    const hc = Math.abs((highs[i] ?? 0) - closes[i - 1]);
    const lc = Math.abs((lows[i]  ?? 0) - closes[i - 1]);
    return Math.max(hl, hc, lc);
  });
  const atr14 = trues.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const atrPct = last ? (atr14 / last * 100).toFixed(2) : null;

  // ── Stochastic %K / %D (14, 3) ────────────────────────────────────────────
  let stochK = null, stochD = null;
  if (n >= 14) {
    const h14 = Math.max(...highs.slice(-14));
    const l14 = Math.min(...lows.slice(-14));
    stochK = h14 !== l14 ? Math.round(((last - l14) / (h14 - l14)) * 100) : 50;
    // %D = 3-day SMA of %K (approximate with last 3 %K values)
    const ks = [];
    for (let i = Math.max(0, n - 16); i < n; i++) {
      const h = Math.max(...highs.slice(Math.max(0, i - 13), i + 1));
      const l = Math.min(...lows.slice(Math.max(0, i - 13), i + 1));
      ks.push(h !== l ? ((closes[i] - l) / (h - l)) * 100 : 50);
    }
    stochD = ks.length >= 3 ? Math.round(ks.slice(-3).reduce((a, b) => a + b, 0) / 3) : stochK;
  }
  const stochSignal = stochK != null
    ? (stochK < 20 ? 'OVERSOLD' : stochK > 80 ? 'OVERBOUGHT' : 'NEUTRAL')
    : 'N/A';

  // ── OBV trend (20 bars) ───────────────────────────────────────────────────
  let obv = 0;
  const obvSeries = [0];
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1])      obv += vols[i];
    else if (closes[i] < closes[i - 1]) obv -= vols[i];
    obvSeries.push(obv);
  }
  const obvTrend = obvSeries.length >= 20
    ? (obvSeries[n - 1] > obvSeries[n - 20] ? 'RISING' : 'FALLING')
    : 'N/A';

  // ── VWAP (20-day approximate) ─────────────────────────────────────────────
  const slice = sorted.slice(-20);
  const sumTPV = slice.reduce((s, c, i) => {
    const tp = ((c.high ?? c.close) + (c.low ?? c.close) + c.close) / 3;
    return s + tp * (c.volume ?? 1);
  }, 0);
  const sumV = slice.reduce((s, c) => s + (c.volume ?? 1), 0);
  const vwap = sumV ? sumTPV / sumV : null;
  const priceVsVwap = vwap && last
    ? `${last > vwap ? 'ABOVE' : 'BELOW'} VWAP (₹${vwap.toFixed(2)}, ${((last / vwap - 1) * 100).toFixed(1)}%)`
    : 'N/A';

  // ── Price momentum (multiple horizons) ────────────────────────────────────
  const momentum = {};
  const periods = { '1W': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 252 };
  for (const [label, bars] of Object.entries(periods)) {
    if (n > bars) {
      const ret = ((last / closes[n - 1 - bars]) - 1) * 100;
      momentum[label] = `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%`;
    }
  }

  // ── Support / Resistance (swing highs/lows last 60 bars) ──────────────────
  const lookback = Math.min(60, n);
  const swingHighs = [], swingLows = [];
  for (let i = 2; i < lookback - 2; i++) {
    const idx = n - lookback + i;
    if (highs[idx] > highs[idx - 1] && highs[idx] > highs[idx - 2] &&
        highs[idx] > highs[idx + 1] && highs[idx] > highs[idx + 2]) {
      swingHighs.push(highs[idx]);
    }
    if (lows[idx] < lows[idx - 1] && lows[idx] < lows[idx - 2] &&
        lows[idx] < lows[idx + 1] && lows[idx] < lows[idx + 2]) {
      swingLows.push(lows[idx]);
    }
  }
  const nearestResistance = swingHighs.filter(h => h > last).sort((a, b) => a - b)[0];
  const nearestSupport    = swingLows.filter(l => l < last).sort((a, b) => b - a)[0];

  // ── Pivot Points (Classic, based on last complete candle) ─────────────────
  const prevH = highs[n - 2] ?? highs[n - 1];
  const prevL = lows[n - 2]  ?? lows[n - 1];
  const prevC = closes[n - 2] ?? closes[n - 1];
  const pivot  = (prevH + prevL + prevC) / 3;
  const r1 = 2 * pivot - prevL;
  const s1 = 2 * pivot - prevH;

  // ── Ichimoku (simplified: Tenkan/Kijun) ───────────────────────────────────
  let tenkan = null, kijun = null, ichimokuSignal = 'N/A';
  if (n >= 26) {
    tenkan = (Math.max(...highs.slice(-9))  + Math.min(...lows.slice(-9)))  / 2;
    kijun  = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
    ichimokuSignal = last > tenkan && last > kijun && tenkan > kijun ? 'BULLISH'
      : last < tenkan && last < kijun && tenkan < kijun ? 'BEARISH'
      : 'NEUTRAL';
  }

  return {
    atr:            atr14 ? `₹${atr14.toFixed(2)} (${atrPct}% of price)` : 'N/A',
    stochastic:     stochK != null ? `%K=${stochK} %D=${stochD} → ${stochSignal}` : 'N/A',
    obv_trend:      obvTrend,
    price_vs_vwap:  priceVsVwap,
    momentum,
    support:        nearestSupport    ? `₹${nearestSupport.toFixed(2)}`    : 'N/A',
    resistance:     nearestResistance ? `₹${nearestResistance.toFixed(2)}` : 'N/A',
    pivot_r1:       `₹${r1.toFixed(2)}`,
    pivot_s1:       `₹${s1.toFixed(2)}`,
    ichimoku:       ichimokuSignal,
    raw: { atr14, stochK, stochD, obvTrend, vwap, nearestSupport, nearestResistance },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DCF / VALUATION ESTIMATE
// ─────────────────────────────────────────────────────────────────────────────
function estimateDCF(fin, quote, profile) {
  try {
    const eps       = fin?.eps ?? quote?.eps;
    const roe       = fin?.return_on_equity; // %
    const rg        = fin?.revenue_growth;    // %
    const pe        = fin?.pe_ratio ?? quote?.pe_ratio;
    const price     = quote?.price;

    if (!eps || eps <= 0 || !price) return null;

    // Estimate EPS growth: blend of revenue growth and ROE signal
    const growthEst = Math.min(Math.max(
      (rg ?? 8) * 0.5 + (roe ? Math.min(roe, 30) * 0.3 : 8 * 0.3),
      -5), 35) / 100;

    // Simple DDM / Gordon Growth Model assuming 5Y explicit + terminal
    const discountRate = 0.12; // 12% WACC for Indian equities
    const terminalGrowth = 0.05; // 5% perpetuity
    let dcfValue = 0;
    let eps_ = eps;
    for (let y = 1; y <= 5; y++) {
      eps_ *= (1 + growthEst);
      dcfValue += eps_ / Math.pow(1 + discountRate, y);
    }
    const terminalEps = eps_ * (1 + terminalGrowth);
    const terminalValue = terminalEps / (discountRate - terminalGrowth);
    dcfValue += terminalValue / Math.pow(1 + discountRate, 5);

    const impliedReturn = ((dcfValue / price) - 1) * 100;
    const peg = pe && growthEst > 0 ? (pe / (growthEst * 100)).toFixed(2) : null;

    return {
      fair_value:     `₹${dcfValue.toFixed(0)}`,
      current_price:  `₹${price.toFixed(2)}`,
      implied_return: `${impliedReturn >= 0 ? '+' : ''}${impliedReturn.toFixed(1)}%`,
      margin_of_safety: `${((dcfValue - price) / dcfValue * 100).toFixed(1)}%`,
      peg_ratio:      peg ? `${peg}x ${peg < 1 ? '(attractive)' : peg > 2 ? '(expensive)' : '(fair)'}` : 'N/A',
      growth_assumption: `${(growthEst * 100).toFixed(1)}% 5Y EPS CAGR`,
      raw: { dcfValue, impliedReturn },
    };
  } catch { return null; }
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
// LAYER 5: CONFIDENCE SCORING ENGINE  (Section A/B/C/D)
// ─────────────────────────────────────────────────────────────────────────────
function computeConfidenceScore({
  technicalScore, fundamentalScore, sentimentScore, macroScore,
  dataAgeHours = 24, sourceCount = 3, indicatorCount = 6, apiSuccessRate = 0.8,
  vix = null, revenueDecline = false, negativeFCF = false,
  shortInterest = null, yieldCurveInverted = false,
  institutionalAccumulation = false, sectorETFAligned = false, macroTailwindAligned = false,
}) {
  // ── Section A: Signal Alignment (max 65) ────────────────────────────────────
  const bullish = (s) => s >= 60;
  const bearish = (s) => s <= 40;
  const tB = bullish(technicalScore),  tBr = bearish(technicalScore);
  const fB = bullish(fundamentalScore),fBr = bearish(fundamentalScore);
  const sB = bullish(sentimentScore),  sBr = bearish(sentimentScore);
  const mB = bullish(macroScore),      mBr = bearish(macroScore);

  let A = 0;
  // Technical ↔ Fundamental
  if (tB && fB)       A += 15;
  else if ((tB && fBr) || (tBr && fB)) A -= 10;
  else                A += 5;
  // Technical ↔ Sentiment
  if (tB && sB)       A += 15;
  else if ((tB && sBr) || (tBr && sB)) A -= 10;
  else                A += 5;
  // Fundamental ↔ Sentiment
  if (fB && sB)       A += 15;
  else if ((fB && sBr) || (fBr && sB)) A -= 10;
  else                A += 5;
  // All 3 ↔ Macro
  const allAligned = tB && fB && sB;
  if (mB && allAligned)      A += 20;
  else if (!mBr && allAligned) A += 10;
  else if (mBr)              A -= 15;
  else                       A += 5;

  // ── Section B: Data Quality (max 25) ────────────────────────────────────────
  let B = 0;
  if (dataAgeHours < 1)       B += 5;
  else if (dataAgeHours < 24) B += 3;
  if (dataAgeHours > 168)     B -= 5; // > 7 days old

  if (sourceCount >= 5)       B += 5;
  else if (sourceCount >= 3)  B += 3;

  // Pattern reliability: no hit-rate tracking yet, give moderate score
  B += 3;

  if (indicatorCount >= 8)    B += 5;
  else if (indicatorCount >= 5) B += 3;

  if (apiSuccessRate >= 0.9)  B += 5;
  else if (apiSuccessRate >= 0.6) B += 2;
  else                        B -= 5;

  // ── Section C: Bonus (max 10) ─────────────────────────────────────────────
  let C = 0;
  if (institutionalAccumulation) C += 3;
  if (sectorETFAligned)          C += 2;
  if (macroTailwindAligned)      C += 2;

  // ── Section D: Risk Deductions ────────────────────────────────────────────
  let D = 0;
  if (vix != null) {
    if (vix > 35)      D += 10;
    else if (vix > 25) D += 5;
  }
  if (yieldCurveInverted)          D += 3;
  if (shortInterest != null && shortInterest > 20) D += 3;
  if (revenueDecline)              D += 4;
  if (negativeFCF)                 D += 3;

  const score = Math.max(0, Math.min(100, A + B + C - D));
  const band  = score >= 90 ? '🟢 VERY HIGH CONFIDENCE'
              : score >= 75 ? '🟡 HIGH CONFIDENCE'
              : score >= 60 ? '🟠 MODERATE CONFIDENCE'
              : score >= 40 ? '🔴 LOW CONFIDENCE'
              :               '⚫ VERY LOW CONFIDENCE';

  return { score, band, A: Math.max(0, A), B: Math.max(0, B), C, D };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 8: STORE PREDICTION  (non-blocking, best-effort)
// ─────────────────────────────────────────────────────────────────────────────
async function storePrediction(data) {
  try {
    const { query: dbQuery } = await import('../db.js');
    await dbQuery(`
      INSERT INTO predictions_tracking
        (ticker, confidence_score, alignment_score, quality_score, bonus_points,
         risk_deductions, predicted_at, price_at_signal, bear_target, base_target,
         bull_target, technical_score, fundamental_score, sentiment_score,
         macro_score, ensemble_score, ensemble_signal)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT DO NOTHING`,
      [data.ticker, data.confidence, data.A, data.B, data.C, data.D,
       data.predictedAt, data.price, data.bear, data.base, data.bull,
       data.tScore, data.fScore, data.sScore, data.mScore,
       data.ensemble, data.direction]
    );
  } catch (_) { /* non-blocking — DB may not be available */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG CONTEXT BUILDER  — 4-model ensemble + macro + advanced technicals + DCF
// ─────────────────────────────────────────────────────────────────────────────
async function buildRagContext(symbols) {
  if (!symbols?.length) return '';
  const sections = [];

  // Fetch macro context + World Bank in parallel (shared across all symbols)
  const [macroCtx, wbMacro] = await Promise.allSettled([getMacroContext(), getWorldBankMacro()]);
  const macro   = macroCtx.status === 'fulfilled' ? macroCtx.value : null;
  const wb      = wbMacro.status  === 'fulfilled' ? wbMacro.value  : null;

  for (const sym of symbols.slice(0, 3)) {
    try {
      const ticker = sym.replace(/\.(NS|BO)$/i, '');

      // Parallel fetch: all data sources simultaneously
      const [qR, pR, fR, nR, hR, enR] = await Promise.allSettled([
        getQuote(sym),
        getProfile(sym),
        getFinancials(sym),
        getNews(sym),
        getHistory(sym, '1y'),
        getEnrichedNews(sym),
      ]);

      const q        = qR.status === 'fulfilled'  ? qR.value   : null;
      const p        = pR.status === 'fulfilled'  ? pR.value   : null;
      const fin      = fR.status === 'fulfilled'  ? fR.value   : null;
      const yahooNews= nR.status === 'fulfilled'  ? nR.value   : [];
      const hist     = hR.status === 'fulfilled'  ? hR.value   : null;
      const extNews  = enR.status === 'fulfilled' ? enR.value  : [];

      if (!q?.price) continue;

      // Merge all news; deduplicate by title
      const allNews = [...(yahooNews || []), ...extNews].filter((a, i, arr) =>
        arr.findIndex(b => b.title === a.title) === i
      );

      const sector = p?.sector || fin?.sector || '';
      const cur    = q.currency === 'INR' ? '₹' : (q.currency || '$');

      // ── Compute all modules ──────────────────────────────────────────────────
      const technicals    = computeTechnicals(hist);
      const advTech       = computeAdvancedTechnicals(hist);
      const sentiment     = scoreSentiment(allNews);
      const fundamentals  = scoreFundamentals(fin, q);
      const dcf           = estimateDCF(fin, q, p);

      // Peer performance (best-effort, non-blocking)
      let peers = null;
      try { peers = sector ? await getPeerPerformance(sym, sector) : null; } catch {}

      // ── 4-model ensemble ─────────────────────────────────────────────────────
      const fScore = fundamentals?.score ?? 50;
      const tScore = (() => {
        let s = technicals?.score ?? 50;
        // Adjust with advanced technical signals
        if (advTech?.raw?.stochK != null) {
          if (advTech.raw.stochK < 20) s += 5;
          else if (advTech.raw.stochK > 80) s -= 5;
        }
        if (advTech?.raw?.obvTrend === 'RISING')  s += 3;
        if (advTech?.raw?.obvTrend === 'FALLING') s -= 3;
        if (advTech?.ichimoku === 'BULLISH') s += 4;
        if (advTech?.ichimoku === 'BEARISH') s -= 4;
        return Math.round(Math.max(0, Math.min(100, s)));
      })();
      const sScore = sentiment?.score ?? 50;
      const mScore = macro?.score     ?? 50;

      const ensemble  = Math.round(fScore * 0.30 + tScore * 0.30 + sScore * 0.20 + mScore * 0.20);
      const direction = ensemble >= 63 ? 'BULLISH' : ensemble <= 37 ? 'BEARISH' : 'NEUTRAL';

      // ── Layer 5: Full confidence scoring engine (Section A/B/C/D) ────────────
      const vixVal = macro?.indicators?.find(i => i.sym === '^INDIAVIX')?.price ?? null;
      const apiSuccessRate = [qR, pR, fR, nR, hR, enR].filter(r => r.status === 'fulfilled').length / 6;
      const sourceCount    = 2 + (allNews.length > 0 ? 2 : 0) + (macro ? 1 : 0) + (wb ? 1 : 0);
      const indicatorCount = [
        technicals?.ma_cross, technicals?.rsi, technicals?.macd,
        technicals?.bollinger_pct_b, technicals?.volume_trend,
        advTech?.stochastic, advTech?.obv_trend, advTech?.ichimoku,
        advTech?.price_vs_vwap, dcf?.fair_value,
      ].filter(Boolean).length;

      const revenueDecline = (fin?.revenue_growth ?? 0) < 0;
      const negativeFCF    = false; // FCF not directly available from Yahoo
      const sectorETFAligned = peers?.avg_sector_change_pct != null
        ? (direction === 'BULLISH' ? peers.avg_sector_change_pct > 0 : peers.avg_sector_change_pct < 0)
        : false;
      const macroTailwindAligned = direction === 'BULLISH' ? (macro?.score ?? 50) > 60
                                                           : (macro?.score ?? 50) < 40;

      const confResult = computeConfidenceScore({
        technicalScore: tScore, fundamentalScore: fScore,
        sentimentScore: sScore, macroScore: mScore,
        dataAgeHours: 1, // data just fetched
        sourceCount, indicatorCount, apiSuccessRate,
        vix: vixVal, revenueDecline, negativeFCF,
        sectorETFAligned, macroTailwindAligned,
      });

      // ── 52W position ─────────────────────────────────────────────────────────
      const w52h = q.week52_high ?? fin?.week52_high;
      const w52l = q.week52_low  ?? fin?.week52_low;
      const w52pos = (w52h && w52l && q.price)
        ? `${Math.round(((q.price - w52l) / (w52h - w52l)) * 100)}% of 52W range`
        : '—';

      // ── Bear/Base/Bull price targets ─────────────────────────────────────────
      const atr = advTech?.raw?.atr14 ?? (q.price * 0.015);
      const bearTarget = q.price - atr * 8;
      const bullTarget = q.price + atr * 12;
      const baseTarget = dcf?.raw?.dcfValue ?? (q.price * (1 + (ensemble - 50) / 200));

      // ── Layer 8: Store prediction (non-blocking) ─────────────────────────────
      storePrediction({
        ticker, confidence: confResult.score, A: confResult.A, B: confResult.B,
        C: confResult.C, D: confResult.D, predictedAt: Math.floor(Date.now() / 1000),
        price: q.price, bear: bearTarget, base: baseTarget, bull: bullTarget,
        tScore, fScore, sScore, mScore, ensemble, direction,
      });

      // ── Context document ─────────────────────────────────────────────────────
      const doc = `
━━━ RETRIEVED CONTEXT: ${ticker} (${sym}) ━━━
[Sources: Yahoo Finance · ET/Moneycontrol/BS RSS · World Bank API · Macro indices | Fetched: just now]
[Coverage: Live quote · 1Y OHLCV (${hist?.length ?? 0} bars) · ${allNews.length} news articles · Macro data | APIs: ${Math.round(apiSuccessRate * 100)}% success]

── LIVE QUOTE ───────────────────────────────────────────
Company:    ${p?.name || sym}
Sector:     ${sector || '—'} | Industry: ${p?.industry || '—'}
Price:      ${cur}${q.price.toFixed(2)} | Change: ${q.change?.toFixed(2) ?? '—'} (${q.change_pct?.toFixed(2) ?? '—'}%)
Open: ${cur}${q.open?.toFixed(2) ?? '—'} | High: ${cur}${q.high?.toFixed(2) ?? '—'} | Low: ${cur}${q.low?.toFixed(2) ?? '—'}
Volume:     ${q.volume ? (q.volume / 1e5).toFixed(2) + 'L' : '—'} | Mkt Cap: ${q.mkt_cap ? `${cur}${(q.mkt_cap / 1e7).toFixed(0)} Cr` : '—'}
52W Range:  ${cur}${w52l?.toFixed(2) ?? '—'} – ${cur}${w52h?.toFixed(2) ?? '—'} | Position: ${w52pos}

── FUNDAMENTAL ANALYSIS (score: ${fScore}/100 — ${fundamentals?.label ?? '—'}) ───
${fundamentals ? Object.entries(fundamentals.key_metrics).map(([k, v]) => `  ${k.padEnd(18)}: ${v}`).join('\n') : '  Financials unavailable'}
${fundamentals?.notes?.length ? '  Signals: ' + fundamentals.notes.join(' | ') : ''}

── TECHNICAL ANALYSIS (score: ${tScore}/100 — ${technicals?.trend ?? '—'}) ───
${technicals ? `  MA Cross:          ${technicals.ma_cross}
  Price vs MA50:    ${technicals.price_vs_ma50}
  Price vs MA200:   ${technicals.price_vs_ma200}
  RSI(14):          ${technicals.rsi}
  MACD:             ${technicals.macd}
  Bollinger %B:     ${technicals.bollinger_pct_b}
  Volume Trend:     ${technicals.volume_trend}` : '  Historical data insufficient'}
${advTech ? `  ATR(14):          ${advTech.atr}
  Stochastic:       ${advTech.stochastic}
  OBV Trend:        ${advTech.obv_trend}
  Price vs VWAP:    ${advTech.price_vs_vwap}
  Ichimoku:         ${advTech.ichimoku}
  Support:          ${advTech.support} | Resistance: ${advTech.resistance}
  Pivot R1:         ${advTech.pivot_r1} | S1: ${advTech.pivot_s1}
  Momentum:         ${Object.entries(advTech.momentum).map(([k,v]) => `${k}=${v}`).join(' | ')}` : ''}

── NEWS & SENTIMENT (score: ${sScore}/100 — ${sentiment.label}) ───
  Articles: ${sentiment.article_count ?? 0} total (Yahoo Finance + ET + Moneycontrol + Business Standard)
${sentiment.scored?.length ? sentiment.scored.map(a =>
  `  [${a.sentiment.padEnd(8)} ${a.confidence}% | ${a.decay_weight}w] ${a.title?.slice(0, 80) ?? ''}`
).join('\n') : '  No recent news'}

── VALUATION & DCF ──────────────────────────────────────
${dcf ? `  DCF Fair Value:   ${dcf.fair_value}
  Implied Return:   ${dcf.implied_return}
  Margin of Safety: ${dcf.margin_of_safety}
  PEG Ratio:        ${dcf.peg_ratio}
  Growth Assumed:   ${dcf.growth_assumption}` : '  DCF unavailable (EPS data missing)'}

── SECTOR PEERS (${sector || 'unknown sector'}) ─────────────────────────────
${peers?.peers?.length
  ? `  Sector avg today: ${peers.avg_sector_change_pct >= 0 ? '+' : ''}${peers.avg_sector_change_pct}%
${peers.peers.map(peer => `  ${peer.symbol.padEnd(12)}: ₹${peer.price?.toFixed(2) ?? '—'} (${peer.change_pct >= 0 ? '+' : ''}${peer.change_pct?.toFixed(2) ?? '—'}%)`).join('\n')}
  Stock vs sector:  ${((q.change_pct ?? 0) - peers.avg_sector_change_pct).toFixed(2)}% relative`
  : '  Peer data unavailable'}

── MACRO CONTEXT (score: ${mScore}/100 — ${macro?.regime ?? 'NEUTRAL'}) ───
${macro?.indicators?.filter(i => i.price).map(i =>
  `  ${i.label.padEnd(20)}: ${i.unit === '₹' ? '₹' : ''}${i.price?.toFixed(2) ?? '—'} (${i.change_pct >= 0 ? '+' : ''}${i.change_pct?.toFixed(2) ?? '—'}%)`
).join('\n') ?? '  Macro data unavailable'}
${macro?.notes?.length ? '  Signals: ' + macro.notes.join(' | ') : ''}
${wb ? Object.entries(wb).map(([k, v]) => `  ${k}: ${v.value}% (${v.year})`).join('\n') : ''}

── 4-MODEL ENSEMBLE (Layer 4) ───────────────────────────
  Fundamental (30%): ${fScore} × 0.30 = ${Math.round(fScore * 0.30)}
  Technical   (30%): ${tScore} × 0.30 = ${Math.round(tScore * 0.30)}
  Sentiment   (20%): ${sScore} × 0.20 = ${Math.round(sScore * 0.20)}
  Macro       (20%): ${mScore} × 0.20 = ${Math.round(mScore * 0.20)}
  ────────────────────────────────────────────────────────
  ENSEMBLE SCORE:    ${ensemble}/100 → ${direction}

── CONFIDENCE SCORE (Layer 5) ───────────────────────────
  ${confResult.band}: ${confResult.score}/100
  Alignment Score:    ${confResult.A}/65
  Data Quality Score: ${confResult.B}/25
  Bonus Points:       ${confResult.C}/10
  Risk Deductions:   -${confResult.D}
  ${confResult.score < 40 ? '⚠ VERY LOW CONFIDENCE — predictions directional only' : ''}
  Risk flags: ${[
    revenueDecline ? 'Revenue declining' : '',
    vixVal > 20 ? `High VIX ${vixVal?.toFixed(1)}` : '',
    vixVal > 35 ? 'EXTREME FEAR' : '',
  ].filter(Boolean).join(' | ') || 'None detected'}

── SCENARIO PRICE TARGETS ───────────────────────────────
  Bear:  ${cur}${bearTarget.toFixed(2)} (${(((bearTarget/q.price)-1)*100).toFixed(1)}%) — ATR-based downside
  Base:  ${cur}${baseTarget.toFixed(2)} (${(((baseTarget/q.price)-1)*100).toFixed(1)}%) — DCF / trend projection
  Bull:  ${cur}${bullTarget.toFixed(2)} (+${(((bullTarget/q.price)-1)*100).toFixed(1)}%) — ATR-based upside
`.trim();

      sections.push(doc);
    } catch (e) {
      log.warn(`RAG context failed for ${sym}: ${e.message}`);
    }
  }

  return sections.length
    ? `\n\n${'═'.repeat(64)}\nRAG RETRIEVAL RESULTS — ${sections.length} symbol(s) | 4-Model Ensemble\n${'═'.repeat(64)}\n${sections.join('\n\n')}\n${'═'.repeat(64)}`
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
  'apollo micro systems': 'APMOSYS.NS', 'apmosys': 'APMOSYS.NS', 'apollo micro': 'APMOSYS.NS',
  'apollo hospitals': 'APOLLOHOSP.NS', 'apollohosp': 'APOLLOHOSP.NS', 'apollo hospital': 'APOLLOHOSP.NS',
  'apollo tyres': 'APOLLOTYRE.NS', 'apollotyre': 'APOLLOTYRE.NS', 'apollo tyre': 'APOLLOTYRE.NS',
  'rvnl': 'RVNL.NS', 'rail vikas': 'RVNL.NS', 'rail vikas nigam': 'RVNL.NS',
  'irfc': 'IRFC.NS', 'indian railway finance': 'IRFC.NS',
  'ircon': 'IRCON.NS',
  'rites': 'RITES.NS',
  'cochin shipyard': 'COCHINSHIP.NS', 'cslavp': 'COCHINSHIP.NS',
  'mazagon dock': 'MAZDOCK.NS', 'mdl': 'MAZDOCK.NS', 'mazdock': 'MAZDOCK.NS',
  'garden reach': 'GRSE.NS', 'grse': 'GRSE.NS',
  'hbl power': 'HBLPOWER.NS', 'hblpower': 'HBLPOWER.NS',
  'data patterns': 'DATAPATTNS.NS', 'datapattns': 'DATAPATTNS.NS',
  'paras defence': 'PARAS.NS',
  'astra microwave': 'ASTRAMICRO.NS', 'astramicro': 'ASTRAMICRO.NS',
  'ideaforge': 'IDEAFORGE.NS', 'idea forge': 'IDEAFORGE.NS',
  'zen technologies': 'ZENTEC.NS', 'zentec': 'ZENTEC.NS',
  'dcx systems': 'DCXINDIA.NS',
  'sansera engineering': 'SANSERA.NS',
  'kaynes technology': 'KAYNES.NS', 'kaynes': 'KAYNES.NS',
  'latent view': 'LATENTVIEW.NS',
  'nuvama': 'NUVAMA.NS',
  'nuvoco': 'NUVOCO.NS',
  'sapphire foods': 'SAPPHIRE.NS',
  'campus': 'CAMPUS.NS',
  'elin electronics': 'ELIN.NS',
  'jio financial': 'JIOFIN.NS', 'jiofin': 'JIOFIN.NS', 'jio finance': 'JIOFIN.NS',
  'tata technologies': 'TATATECH.NS', 'tatatech': 'TATATECH.NS',
  'premier energies': 'PREMIERENE.NS',
  'waaree energies': 'WAAREE.NS', 'waaree': 'WAAREE.NS',
  'suzlon': 'SUZLON.NS', 'suzlon energy': 'SUZLON.NS',
  'inox wind': 'INOXWIND.NS', 'inoxwind': 'INOXWIND.NS',
  'green power': 'GREENPOWER.NS',
  'rpower': 'RPOWER.NS', 'reliance power': 'RPOWER.NS',
  'yes bank': 'YESBANK.NS', 'yesbank': 'YESBANK.NS',
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

// Extract potential company names from free text for search fallback
function extractCandidateNames(question) {
  const candidates = [];

  // Quoted phrases first (highest confidence)
  for (const m of question.matchAll(/"([^"]+)"|'([^']+)'/g)) {
    candidates.push(m[1] || m[2]);
  }

  // ALL CAPS multi-word company names (e.g. "APOLLO MICRO SYSTEMS LTD", "RAIL VIKAS NIGAM")
  // Must match BEFORE the mixed-case pattern so it takes priority
  const capsRe = /\b([A-Z]{3,}(?:\s+[A-Z]{2,}){1,6})\b/g;
  for (const m of question.matchAll(capsRe)) {
    const phrase = m[1]
      .replace(/\s*\b(?:LTD|LIMITED|CORP|CORPORATION|INC|CO|PVT|PRIVATE|LLP|PLC)\.?$/i, '')
      .trim();
    if (phrase.length > 4 && !candidates.some(c => c.toLowerCase() === phrase.toLowerCase())) {
      candidates.push(phrase);
    }
  }

  // Mixed-case multi-word sequences: 2–4 words starting with a capital (e.g. "Apollo Micro Systems")
  for (const m of question.matchAll(/\b([A-Z][a-z]{1,}(?:\s+(?:[A-Z][a-z]{1,}|[A-Z]{2,}|&)){1,3})\b/g)) {
    if (!candidates.some(c => c.toLowerCase() === m[1].toLowerCase())) candidates.push(m[1]);
  }

  // Single capitalized words > 4 chars that aren't common English words or sentence starters
  const SKIP = new Set(['Give', 'What', 'How', 'Tell', 'Show', 'Which', 'Does', 'Can', 'Will', 'Is', 'Are', 'Please', 'When', 'Why', 'Analyse', 'Analyze', 'Price', 'Stock', 'Share', 'Market', 'For', 'The', 'This', 'That', 'Their', 'About', 'News', 'Risk', 'Risks', 'Full', 'Latest', 'Predict', 'Give', 'Analyse']);
  for (const m of question.matchAll(/\b([A-Z][a-zA-Z]{3,})\b/g)) {
    if (!SKIP.has(m[1]) && !candidates.some(c => c.includes(m[1]))) candidates.push(m[1]);
  }

  return [...new Set(candidates)].slice(0, 4);
}

// Async symbol resolver: static map first, then Yahoo/NSE search fallback
async function resolveSymbolsFromQuestion(question) {
  // 1. Fast path — static NSE_MAP
  const mapped = extractSymbolsFromQuestion(question);
  if (mapped.length) return mapped;

  // 2. Search fallback for unrecognised stocks
  const candidates = extractCandidateNames(question);
  for (const candidate of candidates) {
    try {
      const results = await searchSymbol(candidate);
      // Prefer NSE (.NS) stocks; accept BSE (.BO) as fallback
      const ns = results.filter(r => r.symbol?.endsWith('.NS'));
      const bo = results.filter(r => r.symbol?.endsWith('.BO'));
      const hit = ns[0] || bo[0];
      if (hit) {
        log.info(`Resolved "${candidate}" → ${hit.symbol} via search`);
        return [hit.symbol];
      }
    } catch (e) {
      log.warn(`resolveSymbolsFromQuestion search failed for "${candidate}": ${e.message}`);
    }
  }

  return [];
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
// HISTORY TRIMMER  — prevents context overflow for large analysis responses
// ─────────────────────────────────────────────────────────────────────────────
function trimHistory(history, maxMessages = 6, maxCharsPerMsg = 1200) {
  return history
    .slice(-maxMessages)
    .map(m => {
      const content = String(m.content || '');
      return {
        role: m.role,
        content: content.length > maxCharsPerMsg
          ? content.slice(0, maxCharsPerMsg) + '\n[… response truncated for context …]'
          : content,
      };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAM ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────
export async function streamChat({ question, symbols = [], history = [], skipRag = false, onDelta, onDone, onError }) {
  if (!groqClient && !ANTHROPIC_API_KEY) {
    onError('AI not configured — add GROQ_API_KEY or ANTHROPIC_API_KEY to environment variables.');
    return;
  }
  if (!groqClient && ANTHROPIC_API_KEY) {
    return streamAnthropic({ question, symbols, history, skipRag, onDelta, onDone, onError });
  }

  try {
    const depth = responseDepth(question);

    let context = '';
    if (!skipRag) {
      const extracted = await resolveSymbolsFromQuestion(question);
      const symsToUse = extracted.length ? extracted : symbols;
      context = symsToUse.length ? await buildRagContext(symsToUse) : '';
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + context },
      ...trimHistory(history),
      { role: 'user', content: question },
    ];

    const stream = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: depth === 'deep' ? 3000 : 800,
      temperature: depth === 'deep' ? 0.3 : 0.5,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) onDelta(text);
    }
    onDone();
  } catch (e) {
    log.error(`Chat (Groq) error: ${e.message} — falling back to Anthropic`);
    // Fallback: try Anthropic if Groq fails (rate limit, context overflow, etc.)
    if (ANTHROPIC_API_KEY) {
      return streamAnthropic({ question, symbols, history, skipRag, onDelta, onDone, onError });
    }
    onError(`AI service unavailable. Please try again in a moment.`);
  }
}

async function streamAnthropic({ question, symbols, history, skipRag = false, onDelta, onDone, onError }) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const depth  = responseDepth(question);

    let context = '';
    if (!skipRag) {
      const extracted = await resolveSymbolsFromQuestion(question);
      const symsToUse = extracted.length ? extracted : symbols;
      context = symsToUse.length ? await buildRagContext(symsToUse) : '';
    }

    const messages = [
      ...trimHistory(history),
      { role: 'user', content: question },
    ];

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: depth === 'deep' ? 3000 : 800,
      system: SYSTEM_PROMPT + context,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) onDelta(event.delta.text);
    }
    onDone();
  } catch (e) {
    log.error('Chat (Anthropic):', e.message);
    onError(`I'm having trouble connecting to the AI service. Please try again in a moment.`);
  }
}
