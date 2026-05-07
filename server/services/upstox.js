import { get as cacheGet, set as cacheSet } from '../cache.js';
import { UPSTOX_ACCESS_TOKEN } from '../config.js';
import log from '../log.js';

// Convert Yahoo-style symbol to Upstox instrument key
// RELIANCE.NS → NSE_EQ|RELIANCE, RELIANCE.BO → BSE_EQ|RELIANCE
function toInstrumentKey(symbol) {
  if (symbol.endsWith('.NS')) return `NSE_EQ|${symbol.slice(0, -3)}`;
  if (symbol.endsWith('.BO')) return `BSE_EQ|${symbol.slice(0, -3)}`;
  return `NSE_EQ|${symbol}`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${UPSTOX_ACCESS_TOKEN}`,
    Accept: 'application/json',
  };
}

function safeNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// Check if access token is configured
export function upstoxAvailable() {
  return !!(UPSTOX_ACCESS_TOKEN && UPSTOX_ACCESS_TOKEN.length > 10);
}

export async function upstoxQuote(symbol) {
  if (!upstoxAvailable()) return null;
  const key = `upstox_q:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const instrKey = toInstrumentKey(symbol);
  const url = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(instrKey)}`;

  const r = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: authHeaders(),
  });

  if (r.status === 401) {
    log.warn('Upstox access token expired or invalid');
    return null;
  }
  if (!r.ok) throw new Error(`Upstox quote HTTP ${r.status}`);

  const json = await r.json();
  if (json.status !== 'success') return null;

  const data = json.data?.[instrKey];
  if (!data) return null;

  const price     = safeNum(data.last_price);
  const prevClose = safeNum(data.ohlc?.close) || safeNum(data.prev_close_price);
  const change    = price && prevClose ? price - prevClose : null;
  const changePct = price && prevClose ? ((price - prevClose) / prevClose) * 100 : null;

  const depth  = data.depth || {};
  const ohlc   = data.ohlc || {};

  const result = {
    price,
    open:        safeNum(ohlc.open),
    high:        safeNum(ohlc.high),
    low:         safeNum(ohlc.low),
    prev_close:  prevClose,
    change,
    change_pct:  changePct,
    volume:      safeNum(data.volume),
    mkt_cap:     null,
    currency:    'INR',
    name:        symbol,
    week52_high: safeNum(data['52_week_high']),
    week52_low:  safeNum(data['52_week_low']),
  };

  await cacheSet(key, result, 30); // 30s TTL for live quotes
  return result;
}

// Historical candles — range: '1mo', '3mo', '6mo', '1y', '2y', '5y'
export async function upstoxHistory(symbol, range = '1y') {
  if (!upstoxAvailable()) return null;
  const key = `upstox_h:${symbol}:${range}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const instrKey = toInstrumentKey(symbol);
  const toDate   = new Date();
  const fromDate = new Date();

  const rangeMap = { '1d': 1, '5d': 7, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825 };
  const days = rangeMap[range] || 365;
  fromDate.setDate(fromDate.getDate() - days);

  const fmt = d => d.toISOString().slice(0, 10);

  let url;
  if (range === '1d') {
    // 5-min intraday for today only
    url = `https://api.upstox.com/v2/historical-candle/intraday/${encodeURIComponent(instrKey)}/5minute`;
  } else {
    // Daily candles for 5d and all longer ranges
    url = `https://api.upstox.com/v2/historical-candle/${encodeURIComponent(instrKey)}/day/${fmt(toDate)}/${fmt(fromDate)}`;
  }

  const r = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: authHeaders(),
  });

  if (r.status === 401) {
    log.warn('Upstox access token expired');
    return null;
  }
  if (!r.ok) throw new Error(`Upstox history HTTP ${r.status}`);

  const json = await r.json();
  if (json.status !== 'success') return null;

  // Candle format: [timestamp, open, high, low, close, volume, oi]
  const candles = json.data?.candles || [];
  const result = candles
    .map(c => ({
      ts:     Math.floor(new Date(c[0]).getTime() / 1000),
      open:   safeNum(c[1]),
      high:   safeNum(c[2]),
      low:    safeNum(c[3]),
      close:  safeNum(c[4]),
      volume: safeNum(c[5]),
    }))
    .filter(row => row.close != null)
    .sort((a, b) => a.ts - b.ts);

  const ttl = range === '1d' ? 60 : range === '5d' ? 300 : 3600;
  await cacheSet(key, result, ttl);
  return result;
}
