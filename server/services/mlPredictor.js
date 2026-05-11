/**
 * Pure-JS Random Forest price direction predictor
 * No external dependencies — trains on the ticker's own OHLCV history.
 *
 * Pipeline:
 *   buildDataset(candles) → (X, y) training pairs
 *   RandomForest.fit(X, y)
 *   RandomForest.predictProba(features) → 0–1 probability of price UP
 *   trainAndPredict(candles) → { probUp, signal, accuracy, importance }
 */

// ── Micro indicator helpers ───────────────────────────────────────────────────

function ema(values, period) {
  const k = 2 / (period + 1);
  let prev = null;
  for (const v of values) {
    prev = prev == null ? v : v * k + prev * (1 - k);
  }
  return prev;
}

function smaArr(values, period) {
  return values.map((_, i) =>
    i < period - 1 ? null : values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  );
}

function rsiAt(closes) {
  const period = 14;
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-period - 1);
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const avgG = gains / period, avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function macdHistAt(closes) {
  if (closes.length < 26) return 0;
  const macdLine  = ema(closes, 12) - ema(closes, 26);
  const signalLine = ema(closes.slice(-9).map(() => macdLine), 9);
  return macdLine - signalLine;
}

function bollingerBAt(closes, period = 20) {
  if (closes.length < period) return 0.5;
  const slice = closes.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const std   = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  if (std === 0) return 0.5;
  const upper = mean + 2 * std;
  const lower = mean - 2 * std;
  const price = closes[closes.length - 1];
  return Math.max(0, Math.min(1, (price - lower) / (upper - lower)));
}

function volRatioAt(volumes) {
  if (volumes.length < 20) return 1;
  const avg = volumes.slice(-20, -1).reduce((a, b) => a + b, 0) / 19;
  return avg === 0 ? 1 : volumes[volumes.length - 1] / avg;
}

// ── Feature extraction  ───────────────────────────────────────────────────────
// Returns a 10-element feature vector from the trailing window of candles.

export function extractFeatures(candles) {
  if (candles.length < 60) return null;
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume ?? 0);
  const price   = closes[closes.length - 1];

  const ema20  = ema(closes, 20)  ?? price;
  const ema50  = ema(closes, 50)  ?? price;
  const ema200 = ema(closes, 200) ?? price;

  const rsi    = rsiAt(closes);
  const macdH  = macdHistAt(closes);
  const pctB   = bollingerBAt(closes);
  const volR   = volRatioAt(volumes);
  const mom5   = closes.length >= 6   ? (price / closes[closes.length - 6]  - 1) * 100 : 0;
  const mom10  = closes.length >= 11  ? (price / closes[closes.length - 11] - 1) * 100 : 0;

  const trueRange = candles.slice(-14).reduce((sum, c, i, arr) => {
    if (i === 0) return sum;
    const prev = arr[i - 1].close;
    return sum + Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  }, 0) / 13;
  const atrPct = price > 0 ? (trueRange / price) * 100 : 1;

  return [
    rsi / 100,                     // 0 RSI normalised 0–1
    Math.sign(macdH),             // 1 MACD histogram sign
    pctB,                          // 2 Bollinger %B
    (price / ema20 - 1) * 10,     // 3 price vs EMA20 (scaled %)
    (price / ema50 - 1) * 10,     // 4 price vs EMA50
    (price / ema200 - 1) * 10,    // 5 price vs EMA200
    Math.min(volR, 5) / 5,        // 6 volume ratio (capped at 5×)
    mom5  / 20,                    // 7 5-day momentum (scaled)
    mom10 / 30,                    // 8 10-day momentum (scaled)
    Math.min(atrPct, 10) / 10,    // 9 ATR% (capped)
  ];
}

// ── Build training dataset  ───────────────────────────────────────────────────

function buildDataset(candles, horizonDays = 20) {
  const X = [], y = [];
  const minBar = 60;
  const maxBar = candles.length - horizonDays - 1;

  for (let i = minBar; i <= maxBar; i++) {
    const feats = extractFeatures(candles.slice(0, i + 1));
    if (!feats) continue;
    const curr  = candles[i].close;
    const fut   = candles[i + horizonDays].close;
    X.push(feats);
    y.push(fut > curr ? 1 : 0);
  }
  return { X, y };
}

// ── Decision Tree (CART, Gini) ────────────────────────────────────────────────

function gini(labels) {
  const n = labels.length;
  if (n === 0) return 0;
  const p = labels.reduce((s, v) => s + v, 0) / n;
  return 1 - p * p - (1 - p) * (1 - p);
}

function sampleIndices(n, k) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k);
}

function buildTree(X, y, depth, maxDepth, minSamples, nFeats) {
  const n = X.length;
  const pos = y.reduce((s, v) => s + v, 0);
  const proba = pos / n;

  if (depth >= maxDepth || n < minSamples || proba === 0 || proba === 1) {
    return { proba };
  }

  const featureIndices = sampleIndices(X[0].length, nFeats);
  let bestGain = -1, bestFeat = -1, bestThresh = 0;

  for (const fi of featureIndices) {
    const vals = [...new Set(X.map(x => x[fi]))].sort((a, b) => a - b);
    for (let vi = 0; vi < vals.length - 1; vi++) {
      const thresh = (vals[vi] + vals[vi + 1]) / 2;
      const leftY  = y.filter((_, i) => X[i][fi] <= thresh);
      const rightY = y.filter((_, i) => X[i][fi] >  thresh);
      if (!leftY.length || !rightY.length) continue;
      const gain = gini(y) - (leftY.length / n) * gini(leftY) - (rightY.length / n) * gini(rightY);
      if (gain > bestGain) { bestGain = gain; bestFeat = fi; bestThresh = thresh; }
    }
  }

  if (bestFeat < 0) return { proba };

  const leftIdx  = X.map((x, i) => x[bestFeat] <= bestThresh ? i : -1).filter(i => i >= 0);
  const rightIdx = X.map((x, i) => x[bestFeat] >  bestThresh ? i : -1).filter(i => i >= 0);
  if (!leftIdx.length || !rightIdx.length) return { proba };

  return {
    featureIdx: bestFeat,
    threshold:  bestThresh,
    proba,
    left:  buildTree(leftIdx.map(i => X[i]), leftIdx.map(i => y[i]),  depth + 1, maxDepth, minSamples, nFeats),
    right: buildTree(rightIdx.map(i => X[i]), rightIdx.map(i => y[i]), depth + 1, maxDepth, minSamples, nFeats),
  };
}

function treePredict(node, x) {
  while (node.left) {
    node = x[node.featureIdx] <= node.threshold ? node.left : node.right;
  }
  return node.proba;
}

// ── Random Forest ─────────────────────────────────────────────────────────────

class RandomForest {
  constructor({ nTrees = 50, maxDepth = 5, minSamples = 4 } = {}) {
    this.nTrees = nTrees;
    this.maxDepth = maxDepth;
    this.minSamples = minSamples;
    this.trees = [];
    this.nFeats = 0;
  }

  fit(X, y) {
    this.trees = [];
    const n = X.length;
    this.nFeats = Math.max(2, Math.round(Math.sqrt(X[0].length)));

    for (let t = 0; t < this.nTrees; t++) {
      const bootIdx = Array.from({ length: n }, () => Math.floor(Math.random() * n));
      const Xb = bootIdx.map(i => X[i]);
      const yb = bootIdx.map(i => y[i]);
      this.trees.push(buildTree(Xb, yb, 0, this.maxDepth, this.minSamples, this.nFeats));
    }
  }

  predictProba(x) {
    const sum = this.trees.reduce((s, tree) => s + treePredict(tree, x), 0);
    return sum / this.trees.length;
  }

  // OOB accuracy estimate (rough — uses all training data as proxy)
  oobAccuracy(X, y) {
    let correct = 0;
    for (let i = 0; i < X.length; i++) {
      const prob = this.predictProba(X[i]);
      const pred = prob >= 0.5 ? 1 : 0;
      if (pred === y[i]) correct++;
    }
    return Math.round((correct / X.length) * 100);
  }
}

// ── Main export: train on ticker history + predict current direction ───────────

export function trainAndPredict(candles, horizonDays = 20) {
  try {
    if (!candles || candles.length < 80) {
      return { available: false, reason: 'Insufficient history (<80 bars)' };
    }

    const { X, y } = buildDataset(candles, horizonDays);
    if (X.length < 30) {
      return { available: false, reason: 'Too few training samples' };
    }

    const rf = new RandomForest({ nTrees: 50, maxDepth: 5 });
    rf.fit(X, y);

    const currentFeatures = extractFeatures(candles);
    if (!currentFeatures) {
      return { available: false, reason: 'Cannot extract current features' };
    }

    const probUp    = rf.predictProba(currentFeatures);
    const trainAcc  = rf.oobAccuracy(X, y);
    const posRate   = Math.round((y.filter(v => v === 1).length / y.length) * 100);

    const signal    = probUp >= 0.60 ? 'BULLISH'
                    : probUp <= 0.40 ? 'BEARISH'
                    :                  'NEUTRAL';

    const confidence = Math.round(Math.abs(probUp - 0.5) * 200); // 0–100 scale

    return {
      available:    true,
      probUp:       Math.round(probUp * 100),
      signal,
      confidence,
      trainingSamples: X.length,
      trainingAccuracy: trainAcc,
      horizonDays,
      baseRate: posRate, // % of time market went up in training data
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}
