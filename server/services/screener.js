import { getQuote, getFinancials } from './yahoo.js';
import { get as cacheGet, set as cacheSet, del as cacheDel } from '../cache.js';
import log from '../log.js';

const CACHE_KEY = 'screener5:value-picks';
const CACHE_TTL = 3 * 3600; // 3 hours

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Nifty 100 large-cap list
const INDIA_LARGE_CAP = [
  'ADANIENT.NS','ADANIPORTS.NS','APOLLOHOSP.NS','ASIANPAINT.NS','AXISBANK.NS',
  'BAJAJ-AUTO.NS','BAJFINANCE.NS','BAJAJFINSV.NS','BHARTIARTL.NS','BPCL.NS',
  'BRITANNIA.NS','CIPLA.NS','COALINDIA.NS','DIVISLAB.NS','DRREDDY.NS',
  'EICHERMOT.NS','GRASIM.NS','HCLTECH.NS','HDFCBANK.NS','HDFCLIFE.NS',
  'HEROMOTOCO.NS','HINDALCO.NS','HINDUNILVR.NS','ICICIBANK.NS','INDUSINDBK.NS',
  'INFY.NS','ITC.NS','JSWSTEEL.NS','KOTAKBANK.NS','LT.NS',
  'MARUTI.NS','NESTLEIND.NS','NTPC.NS','ONGC.NS','POWERGRID.NS',
  'RELIANCE.NS','SBILIFE.NS','SBIN.NS','SUNPHARMA.NS','TATACONSUM.NS',
  'TATAMOTORS.NS','TATASTEEL.NS','TCS.NS','TECHM.NS','TITAN.NS',
  'ULTRACEMCO.NS','WIPRO.NS','ZOMATO.NS',
  'ABB.NS','AMBUJACEM.NS','AUROPHARMA.NS','BANKBARODA.NS','BEL.NS',
  'BERGEPAINT.NS','CANBK.NS','CHOLAFIN.NS','COLPAL.NS','DMART.NS',
  'GAIL.NS','GODREJCP.NS','HAL.NS','HAVELLS.NS','INDIGO.NS',
  'IOC.NS','IRCTC.NS','LICI.NS','LTIM.NS','LUPIN.NS',
  'MARICO.NS','MPHASIS.NS','NMDC.NS','OFSS.NS','PAGEIND.NS',
  'PERSISTENT.NS','PIDILITIND.NS','PNB.NS','POLYCAB.NS','RECLTD.NS',
  'SIEMENS.NS','TATAPOWER.NS','TORNTPHARM.NS','TRENT.NS','VEDL.NS',
  'ZYDUSLIFE.NS','DABUR.NS','DLF.NS','INDHOTEL.NS','IRFC.NS',
  'JUBLFOOD.NS','NAUKRI.NS','PFC.NS','DIXON.NS','MANKIND.NS',
];

const round1 = n => n != null ? Math.round(n * 10)   / 10   : null;
const round2 = n => n != null ? Math.round(n * 100)  / 100  : null;

async function fetchOne(symbol) {
  try {
    // Use the full fallback chain (chart API → NSE → AV) already implemented in getQuote/getFinancials
    const [q, f] = await Promise.all([
      getQuote(symbol).catch(() => null),
      getFinancials(symbol).catch(() => null),
    ]);

    const price  = q?.price;
    const w52h   = q?.week52_high  ?? f?.week52_high;
    const w52l   = q?.week52_low   ?? f?.week52_low;
    const mktCap = q?.mkt_cap      ?? f?.market_cap;
    const pe     = f?.pe_ratio     ?? q?.pe_ratio;
    const eps    = f?.eps          ?? q?.eps;

    if (!price || !w52h || w52h <= 0) return null;

    // ≥ ₹5,000 Cr market cap
    const mktCapCr = mktCap ? mktCap / 1e7 : 0;
    if (mktCapCr < 5000) return null;

    // ≥ 10% below 52W high (lowered from 20% — Yahoo blocker made 20% too strict)
    const decline = ((w52h - price) / w52h) * 100;
    if (decline < 10) return null;

    // Must be profitable (EPS > 0) — skip loss-making companies
    if (!eps || eps <= 0) return null;

    // Reasonable P/E (not crazy overvalued): 0–60
    if (pe != null && (pe <= 0 || pe > 70)) return null;

    return {
      symbol,
      name:         q?.name || symbol,
      sector:       f?.sector || '',
      industry:     f?.industry || '',
      price:        round2(price),
      week52_high:  round2(w52h),
      week52_low:   round2(w52l),
      decline_pct:  round1(decline),
      mkt_cap_cr:   mktCapCr ? Math.round(mktCapCr) : null,
      change_pct:   q?.change_pct ?? null,
      pe_ratio:     round1(pe),
      eps:          round2(eps),
      gross_margin: f?.gross_margin  ?? null,
      net_margin:   f?.net_margin    ?? null,
      roe:          f?.return_on_equity ?? null,
      revenue_cr:   f?.revenue_ttm   ? Math.round(f.revenue_ttm / 1e7) : null,
    };
  } catch (e) {
    log.warn(`Screener ${symbol}:`, e.message);
    return null;
  }
}

let running = false;

async function runScreener() {
  log.info(`Screener: scanning ${INDIA_LARGE_CAP.length} stocks…`);
  const results = [];
  for (let i = 0; i < INDIA_LARGE_CAP.length; i++) {
    if (i > 0) await sleep(400 + Math.random() * 300);
    const item = await fetchOne(INDIA_LARGE_CAP[i]);
    if (item) results.push(item);
  }
  results.sort((a, b) => b.decline_pct - a.decline_pct);
  log.info(`Screener done: ${results.length} value picks found`);
  return results;
}

export async function getValuePicks() {
  const cached = await cacheGet(CACHE_KEY);
  if (cached?.length) return { status: 'ready', data: cached };
  if (running) return { status: 'loading', data: [] };

  running = true;
  runScreener()
    .then(r => cacheSet(CACHE_KEY, r, CACHE_TTL))
    .catch(e => log.error('Screener failed:', e.message))
    .finally(() => { running = false; });

  return { status: 'loading', data: [] };
}

export async function refreshScreener() {
  await cacheDel(CACHE_KEY);
  running = false;
}
