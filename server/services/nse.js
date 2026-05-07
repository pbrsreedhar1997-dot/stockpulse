import { get as cacheGet, set as cacheSet } from '../cache.js';
import log from '../log.js';

const BASE    = 'https://www.nseindia.com';
const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://www.nseindia.com/',
};

// Cookie cache — NSE requires a prior visit to set session cookies
let _cookies    = '';
let _cookieTime = 0;
const COOKIE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCookies() {
  if (Date.now() - _cookieTime < COOKIE_TTL && _cookies) return _cookies;
  try {
    const r = await fetch(`${BASE}/`, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    const raw = r.headers.getSetCookie?.() || [];
    _cookies   = raw.map(c => c.split(';')[0]).join('; ');
    _cookieTime = Date.now();
  } catch (e) {
    log.warn('NSE cookie fetch failed:', e.message);
  }
  return _cookies;
}

async function nseGet(path) {
  const cookies = await getCookies();
  const r = await fetch(`${BASE}${path}`, {
    headers: { ...HEADERS, ...(cookies ? { Cookie: cookies } : {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`NSE HTTP ${r.status}`);
  return r.json();
}

// Convert Yahoo Finance symbol (RELIANCE.NS) to NSE symbol (RELIANCE)
function toNse(symbol) {
  return symbol.replace(/\.(NS|BO|BSE|NSE)$/i, '').toUpperCase();
}

function safe(v) {
  const n = Number(v);
  return (v != null && isFinite(n)) ? n : null;
}

// ── Quote ─────────────────────────────────────────────────────────────────────
export async function nseQuote(symbol) {
  const ckey = `nseq2:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const nse = toNse(symbol);
  log.info(`NSE quote: ${nse}`);

  const d = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(nse)}`);

  const pi = d?.priceInfo      || {};
  const wh = pi.weekHighLow    || {};
  const ih = pi.intraDayHighLow || {};
  const md = d?.metadata       || {};

  const price    = safe(pi.lastPrice);
  if (!price) return null;

  const prevClose = safe(pi.previousClose);
  const change    = safe(pi.change)  ?? (prevClose ? price - prevClose : null);
  const changePct = safe(pi.pChange) ?? (prevClose ? ((price - prevClose) / prevClose) * 100 : null);

  const pe  = safe(md.pdSymbolPe);
  const eps = (price && pe) ? Math.round((price / pe) * 100) / 100 : null;

  const result = {
    price,
    open:        safe(pi.open)    || price,
    high:        safe(ih.max)     || price,
    low:         safe(ih.min)     || price,
    prev_close:  prevClose,
    change,
    change_pct:  changePct,
    volume:      safe(pi.totalTradedVolume) || null,
    mkt_cap:     null,
    currency:    'INR',
    name:        md.companyName   || symbol,
    week52_high: safe(wh.max),
    week52_low:  safe(wh.min),
    pe_ratio:    pe,
    eps,
  };

  await cacheSet(ckey, result, 60);
  return result;
}

// ── Profile ───────────────────────────────────────────────────────────────────
export async function nseProfile(symbol) {
  const ckey = `nsep2:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const nse = toNse(symbol);
  log.info(`NSE profile: ${nse}`);

  const d = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(nse)}`);

  const md = d?.metadata     || {};
  const ii = d?.industryInfo || {};

  if (!md.symbol) return null;

  const result = {
    name:        md.companyName || symbol,
    sector:      ii.sector      || ii.macro   || null,
    industry:    ii.industry    || ii.basicIndustry || null,
    exchange:    'NSE',
    currency:    'INR',
    website:     null,
    description: null,
    employees:   null,
    country:     'IN',
    logo_url:    null,
  };

  await cacheSet(ckey, result, 86400);
  return result;
}

// ── Financials ────────────────────────────────────────────────────────────────
export async function nseFinancials(symbol) {
  const ckey = `nsef2:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const nse = toNse(symbol);
  log.info(`NSE financials: ${nse}`);

  const d = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(nse)}`);

  const pi = d?.priceInfo   || {};
  const wh = pi.weekHighLow || {};
  const md = d?.metadata    || {};

  if (!md.symbol) return null;

  const price = safe(pi.lastPrice);
  const pe    = safe(md.pdSymbolPe);
  const eps   = (price && pe) ? Math.round((price / pe) * 100) / 100 : null;

  const result = {
    market_cap:       null,
    revenue_ttm:      null,
    gross_margin:     null,
    net_margin:       null,
    pe_ratio:         pe,
    eps,
    dividend_yield:   null,
    beta:             null,
    week52_high:      safe(wh.max),
    week52_low:       safe(wh.min),
    avg_volume:       null,
    price_to_book:    null,
    debt_to_equity:   null,
    return_on_equity: null,
    revenue_growth:   null,
    earnings_growth:  null,
  };

  await cacheSet(ckey, result, 21600);
  return result;
}
