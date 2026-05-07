import { get as cacheGet, set as cacheSet } from '../cache.js';
import { FINNHUB_API_KEY } from '../config.js';
import log from '../log.js';

const KEY = FINNHUB_API_KEY;
const BASE = 'https://finnhub.io/api/v1';

// Convert Yahoo Finance symbol format to Finnhub format
function toFh(symbol) {
  if (symbol.endsWith('.NS')) return `NSE:${symbol.slice(0, -3)}`;
  if (symbol.endsWith('.BO')) return `BSE:${symbol.slice(0, -3)}`;
  return symbol;
}

async function fhGet(path) {
  if (!KEY) throw new Error('FINNHUB_API_KEY not configured');
  const res = await fetch(`${BASE}${path}&token=${KEY}`, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': 'StockPulse/1.0' },
  });
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
  return res.json();
}

function safe(v) {
  const n = Number(v);
  return (v != null && isFinite(n)) ? n : null;
}

function round1(v) {
  const n = safe(v);
  return n != null ? Math.round(n * 10) / 10 : null;
}

// ── Quote ─────────────────────────────────────────────────────────────────────
export async function fhQuote(symbol) {
  const ckey = `fhq3:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const fh = toFh(symbol);
  log.info(`Finnhub quote: ${fh}`);

  const [qRes, mRes, pRes] = await Promise.allSettled([
    fhGet(`/quote?symbol=${fh}`),
    fhGet(`/stock/metric?symbol=${fh}&metric=all`),
    fhGet(`/stock/profile2?symbol=${fh}`),
  ]);

  const q = qRes.status === 'fulfilled' ? qRes.value : {};
  const m = (mRes.status === 'fulfilled' ? mRes.value?.metric : null) || {};
  const p = pRes.status === 'fulfilled' ? pRes.value : {};

  if (!q.c) {
    log.warn(`Finnhub: no price for ${fh}`);
    return null;
  }

  const mktCapRaw = p.marketCapitalization ?? m.marketCapitalization;
  const result = {
    price:       safe(q.c),
    open:        safe(q.o),
    high:        safe(q.h),
    low:         safe(q.l),
    prev_close:  safe(q.pc),
    change:      safe(q.d),
    change_pct:  safe(q.dp),
    volume:      safe(q.v) || null,
    mkt_cap:     mktCapRaw ? mktCapRaw * 1e6 : null,
    currency:    p.currency || 'INR',
    name:        p.name || symbol,
    week52_high: safe(m['52WeekHigh']),
    week52_low:  safe(m['52WeekLow']),
  };

  await cacheSet(ckey, result, 60);
  return result;
}

// ── Profile ───────────────────────────────────────────────────────────────────
export async function fhProfile(symbol) {
  const ckey = `fhp3:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const fh = toFh(symbol);
  log.info(`Finnhub profile: ${fh}`);

  const p = await fhGet(`/stock/profile2?symbol=${fh}`).catch(e => {
    log.warn(`Finnhub profile ${fh}: ${e.message}`);
    return null;
  });

  if (!p?.name) return null;

  const host = p.weburl
    ? p.weburl.replace(/^https?:\/\//, '').split('/')[0]
    : null;

  const result = {
    name:        p.name,
    sector:      p.finnhubIndustry || null,
    industry:    p.finnhubIndustry || null,
    exchange:    p.exchange || null,
    currency:    p.currency || 'INR',
    website:     p.weburl || null,
    description: null,
    employees:   p.employeeTotal ? Number(p.employeeTotal) : null,
    country:     p.country || null,
    logo_url:    p.logo || (host ? `https://logo.clearbit.com/${host}` : null),
  };

  await cacheSet(ckey, result, 86400);
  return result;
}

// ── Financials ────────────────────────────────────────────────────────────────
export async function fhFinancials(symbol) {
  const ckey = `fhf3:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const fh = toFh(symbol);
  log.info(`Finnhub financials: ${fh}`);

  const data = await fhGet(`/stock/metric?symbol=${fh}&metric=all`).catch(e => {
    log.warn(`Finnhub metric ${fh}: ${e.message}`);
    return null;
  });

  if (!data?.metric) return null;
  const m = data.metric;

  const result = {
    market_cap:       m.marketCapitalization ? m.marketCapitalization * 1e6 : null,
    revenue_ttm:      safe(m.revenueTTM),
    gross_margin:     round1(m.grossMarginAnnual ?? m.grossMarginTTM),
    net_margin:       round1(m.netMarginTTM ?? m.netMarginAnnual),
    pe_ratio:         safe(m.peBasicExclExtraItemsTTM ?? m.peTTM),
    eps:              safe(m.epsBasicExclExtraItemsTTM ?? m.epsTTM),
    dividend_yield:   round1(m.dividendYieldIndicatedAnnual),
    beta:             safe(m.beta),
    week52_high:      safe(m['52WeekHigh']),
    week52_low:       safe(m['52WeekLow']),
    avg_volume:       safe(m.averageVolume10Day),
    price_to_book:    safe(m.pbAnnual),
    debt_to_equity:   safe(m['totalDebt/totalEquityAnnual']),
    return_on_equity: round1(m.roaeTTM),
    revenue_growth:   round1(m.revenueGrowthAnnual),
    earnings_growth:  round1(m.epsGrowthTTMYoy),
  };

  await cacheSet(ckey, result, 21600);
  return result;
}
