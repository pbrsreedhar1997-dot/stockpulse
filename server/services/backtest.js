/**
 * Walk-forward backtesting engine (pure JS, no dependencies)
 *
 * Tests our existing technical signal framework against historical OHLCV data.
 * Slides a lookback window across the history, generates a signal at each bar,
 * then checks whether the price was actually higher after `horizonDays`.
 *
 * Reports:
 *   - Overall directional accuracy %
 *   - Accuracy per signal (BULLISH / BEARISH)
 *   - Accuracy per confidence band (HIGH / MEDIUM / LOW)
 *   - Best & worst performing indicator rules
 */

// ── Lightweight signal computation (mirrors ai.js logic, self-contained) ──────

function ema(values, period) {
  const k = 2 / (period + 1);
  let prev = null;
  for (const v of values) {
    if (v == null) continue;
    prev = prev == null ? v : v * k + prev * (1 - k);
  }
  return prev;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const avgG = gains / period, avgL = losses / period;
  return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
}

function macdLine(closes) {
  if (closes.length < 26) return 0;
  return ema(closes, 12) - ema(closes, 26);
}

function bollinger(closes, period = 20) {
  if (closes.length < period) return { pctB: 0.5, bandwidth: 0 };
  const slice = closes.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const std   = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  const upper = mean + 2 * std;
  const lower = mean - 2 * std;
  const price = closes[closes.length - 1];
  const range = upper - lower;
  return {
    pctB:      range > 0 ? (price - lower) / range : 0.5,
    bandwidth: range / mean,
  };
}

function computeSignal(candles) {
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume ?? 0);
  const price   = closes[closes.length - 1];

  const e20  = ema(closes, 20);
  const e50  = ema(closes, 50);
  const rsiV = rsi(closes);
  const macd = macdLine(closes);
  const { pctB } = bollinger(closes);

  const volAvg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 || 1;
  const volRatio = volumes[volumes.length - 1] / volAvg;

  let score = 50;

  // MA cross
  if (price > e20 && price > e50)           score += 10;
  else if (price < e20 && price < e50)      score -= 10;

  // RSI
  if (rsiV > 60)      score += 8;
  else if (rsiV < 40) score -= 8;
  else if (rsiV > 50) score += 3;

  // MACD
  if (macd > 0) score += 8; else score -= 8;

  // Bollinger
  if (pctB > 0.7)     score -= 5;
  else if (pctB < 0.3) score += 5;

  // Volume confirmation
  if (volRatio > 1.5) {
    if (price > e20) score += 4; else score -= 4;
  }

  score = Math.max(0, Math.min(100, score));
  const signal = score >= 62 ? 'BULLISH' : score <= 38 ? 'BEARISH' : 'NEUTRAL';

  // Confidence (distance from neutral 50)
  const confScore = Math.round(Math.abs(score - 50) * 2);
  const confBand  = confScore >= 50 ? 'HIGH' : confScore >= 25 ? 'MEDIUM' : 'LOW';

  return { signal, score, confScore, confBand };
}

// ── Walk-forward engine ───────────────────────────────────────────────────────

export function walkForwardBacktest(candles, horizonDays = 20) {
  if (!candles || candles.length < 120) {
    return { available: false, reason: 'Need at least 120 bars for backtesting' };
  }

  const results = [];
  const minLookback = 80;
  const maxBar      = candles.length - horizonDays - 1;

  for (let i = minLookback; i <= maxBar; i++) {
    const slice    = candles.slice(0, i + 1);
    const { signal, confBand, confScore } = computeSignal(slice);
    if (signal === 'NEUTRAL') continue; // skip neutral signals for accuracy calc

    const currPrice = candles[i].close;
    const futPrice  = candles[i + horizonDays].close;
    const actualUp  = futPrice > currPrice;
    const correct   = (signal === 'BULLISH' && actualUp) || (signal === 'BEARISH' && !actualUp);

    results.push({ signal, confBand, confScore, correct, actualUp });
  }

  if (results.length < 10) {
    return { available: false, reason: 'Insufficient directional signals in history' };
  }

  // ── Summary stats ─────────────────────────────────────────────────────────

  const total   = results.length;
  const correct = results.filter(r => r.correct).length;

  const bySignal = ['BULLISH', 'BEARISH'].reduce((acc, s) => {
    const group = results.filter(r => r.signal === s);
    acc[s] = {
      count:    group.length,
      accuracy: group.length ? Math.round(group.filter(r => r.correct).length / group.length * 100) : null,
    };
    return acc;
  }, {});

  const byBand = ['HIGH', 'MEDIUM', 'LOW'].reduce((acc, b) => {
    const group = results.filter(r => r.confBand === b);
    acc[b] = {
      count:    group.length,
      accuracy: group.length ? Math.round(group.filter(r => r.correct).length / group.length * 100) : null,
    };
    return acc;
  }, {});

  const overallAccuracy = Math.round((correct / total) * 100);

  // ── Calibration check: is high confidence actually more accurate? ──────────
  const highAcc   = byBand['HIGH'].accuracy ?? 50;
  const medAcc    = byBand['MEDIUM'].accuracy ?? 50;
  const calibrated = highAcc >= medAcc; // ideally true

  return {
    available:       true,
    horizonDays,
    totalSignals:    total,
    overallAccuracy,
    bySignal,
    byBand,
    calibrated,
    summary: `${overallAccuracy}% directional accuracy over ${total} signals (${horizonDays}-day horizon) | BULLISH: ${bySignal['BULLISH'].accuracy ?? '—'}% | BEARISH: ${bySignal['BEARISH'].accuracy ?? '—'}% | High-confidence: ${highAcc}%`,
  };
}
