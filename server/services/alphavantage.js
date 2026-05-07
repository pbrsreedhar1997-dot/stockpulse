import { get as cacheGet, set as cacheSet } from '../cache.js';
import log from '../log.js';

const KEY  = process.env.ALPHA_VANTAGE_KEY;
const BASE = 'https://www.alphavantage.co/query';

// Alpha Vantage uses BSE format for Indian stocks
function toAv(symbol) {
  if (symbol.endsWith('.NS')) return symbol.slice(0, -3) + '.BSE';
  if (symbol.endsWith('.BO')) return symbol.slice(0, -3) + '.BSE';
  return symbol;
}

async function avGet(params) {
  if (!KEY) throw new Error('ALPHA_VANTAGE_KEY not configured');
  const qs = new URLSearchParams({ ...params, apikey: KEY }).toString();
  const r = await fetch(`${BASE}?${qs}`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Alpha Vantage HTTP ${r.status}`);
  const json = await r.json();
  if (json?.Information || json?.Note) throw new Error('Alpha Vantage rate limit reached');
  return json;
}

function safe(v) {
  const n = parseFloat(v);
  return (v != null && v !== 'None' && isFinite(n)) ? n : null;
}

function pct(v) {
  // AV overview returns percentages already (e.g., "0.045" = 4.5%)
  // Some fields are fractions, some are already pct — treat as fraction and multiply by 100
  const n = safe(v);
  if (n == null) return null;
  // If value is already > 1, it's probably already a percentage
  return Math.abs(n) > 1 ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 10;
}

// ── Quote via GLOBAL_QUOTE ────────────────────────────────────────────────────
export async function avQuote(symbol) {
  const ckey = `avq2:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const av = toAv(symbol);
  log.info(`Alpha Vantage quote: ${av}`);

  const data = await avGet({ function: 'GLOBAL_QUOTE', symbol: av });
  const q = data?.['Global Quote'];
  if (!q?.['05. price']) return null;

  const price    = safe(q['05. price']);
  const prevClose = safe(q['08. previous close']);
  const change   = safe(q['09. change']);
  const changePct = q['10. change percent']
    ? safe(q['10. change percent'].replace('%', ''))
    : (price && prevClose ? ((price - prevClose) / prevClose) * 100 : null);

  const result = {
    price,
    open:        safe(q['02. open']),
    high:        safe(q['03. high']),
    low:         safe(q['04. low']),
    prev_close:  prevClose,
    change,
    change_pct:  changePct,
    volume:      safe(q['06. volume']),
    mkt_cap:     null,
    currency:    symbol.endsWith('.NS') || symbol.endsWith('.BO') ? 'INR' : 'USD',
    name:        symbol,
    week52_high: null,
    week52_low:  null,
  };

  await cacheSet(ckey, result, 60);
  return result;
}

// ── Fundamentals via OVERVIEW ─────────────────────────────────────────────────
export async function avOverview(symbol) {
  const ckey = `avov2:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const av = toAv(symbol);
  log.info(`Alpha Vantage overview: ${av}`);

  const ov = await avGet({ function: 'OVERVIEW', symbol: av });
  if (!ov?.Symbol) return null;

  const result = {
    name:     ov.Name || null,
    sector:   ov.Sector || null,
    industry: ov.Industry || null,
    exchange: ov.Exchange || null,
    currency: ov.Currency || 'INR',
    website:  null,
    description: ov.Description || null,
    employees: safe(ov.FullTimeEmployees),
    country:  ov.Country || null,
    logo_url: null,
  };

  await cacheSet(ckey, result, 86400);
  return result;
}

// ── Financials via OVERVIEW ───────────────────────────────────────────────────
export async function avFinancials(symbol) {
  const ckey = `avf2:${symbol}`;
  const hit = await cacheGet(ckey);
  if (hit) return hit;

  const av = toAv(symbol);
  log.info(`Alpha Vantage financials: ${av}`);

  const ov = await avGet({ function: 'OVERVIEW', symbol: av });
  if (!ov?.Symbol) return null;

  const result = {
    market_cap:       safe(ov.MarketCapitalization),
    revenue_ttm:      safe(ov.RevenueTTM),
    gross_margin:     pct(ov.GrossProfitTTM && ov.RevenueTTM
      ? (safe(ov.GrossProfitTTM) / safe(ov.RevenueTTM)) : null),
    net_margin:       pct(ov.ProfitMargin),
    pe_ratio:         safe(ov.PERatio),
    eps:              safe(ov.EPS),
    dividend_yield:   pct(ov.DividendYield),
    beta:             safe(ov.Beta),
    week52_high:      safe(ov['52WeekHigh']),
    week52_low:       safe(ov['52WeekLow']),
    avg_volume:       safe(ov['50DayMovingAverage']) ? null : null, // not in OVERVIEW
    price_to_book:    safe(ov.PriceToBookRatio),
    debt_to_equity:   null, // not reliably in OVERVIEW
    return_on_equity: pct(ov.ReturnOnEquityTTM),
    revenue_growth:   pct(ov.QuarterlyRevenueGrowthYOY),
    earnings_growth:  pct(ov.QuarterlyEarningsGrowthYOY),
  };

  await cacheSet(ckey, result, 21600);
  return result;
}
