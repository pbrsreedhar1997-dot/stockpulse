import YahooFinance from 'yahoo-finance2';
import { get as cacheGet, set as cacheSet, del as cacheDel } from '../cache.js';
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
import log from '../log.js';

const OPT       = { validateResult: false };
const CACHE_KEY = 'screener3:value-picks';
const CACHE_TTL = 6 * 3600;

const FINANCIAL_SECTORS = new Set([
  'Financial Services','Financial Services Stocks','Banking','Banks',
  'Insurance','Capital Markets','Diversified Financial Services',
]);

function safeNum(v) {
  if (v == null) return null;
  const n = typeof v === 'object' && 'raw' in v ? v.raw : Number(v);
  return isFinite(n) ? n : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

let running = false;

async function fetchOne(symbol) {
  try {
    const q = await yf.quote(symbol, {}, OPT);
    const price  = safeNum(q?.regularMarketPrice);
    const mktCap = safeNum(q?.marketCap);
    const w52h   = safeNum(q?.fiftyTwoWeekHigh);
    const w52l   = safeNum(q?.fiftyTwoWeekLow);

    if (!price || !mktCap || !w52h || w52h <= 0) return null;
    const mktCapCr = mktCap / 1e7;
    if (mktCapCr < 10000) return null;
    const decline = ((w52h - price) / w52h) * 100;
    if (decline < 10) return null;

    const sum = await yf.quoteSummary(symbol, {
      modules: ['financialData','defaultKeyStatistics','summaryDetail','assetProfile'],
    }, OPT).catch(() => null);

    const fd = sum?.financialData        || {};
    const ks = sum?.defaultKeyStatistics || {};
    const sd = sum?.summaryDetail        || {};
    const ap = sum?.assetProfile         || {};

    const eps = safeNum(ks.trailingEps);
    if (!eps || eps <= 0) return null;

    const sector = ap.sector || '';
    const isFin  = FINANCIAL_SECTORS.has(sector) ||
                   sector.toLowerCase().includes('bank') ||
                   sector.toLowerCase().includes('financ');

    const grossM = safeNum(fd.grossMargins);
    if (!isFin && (grossM == null || grossM < 0.08)) return null;

    const round2 = n => n != null ? Math.round(n * 100) / 100 : null;
    const round1 = n => n != null ? Math.round(n * 10) / 10 : null;
    const pct    = n => n != null ? Math.round(n * 1000) / 10 : null;

    return {
      symbol,
      name:         q.longName || q.shortName || symbol,
      sector,
      industry:     ap.industry || '',
      price:        round2(price),
      week52_high:  round2(w52h),
      week52_low:   w52l ? round2(w52l) : null,
      decline_pct:  round1(decline),
      mkt_cap_cr:   Math.round(mktCapCr),
      change_pct:   safeNum(q.regularMarketChangePercent),
      pe_ratio:     round1(safeNum(sd.trailingPE)),
      eps:          round2(eps),
      gross_margin: pct(grossM),
      net_margin:   pct(safeNum(fd.profitMargins)),
      roe:          pct(safeNum(fd.returnOnEquity)),
      revenue_cr:   safeNum(fd.totalRevenue) ? Math.round(safeNum(fd.totalRevenue) / 1e7) : null,
      beta:         round2(safeNum(ks.beta)),
      de_ratio:     safeNum(fd.debtToEquity) ? round2(safeNum(fd.debtToEquity) / 100) : null,
    };
  } catch (e) {
    log.warn(`Screener ${symbol}:`, e.message);
    return null;
  }
}

async function runScreener() {
  log.info(`Screener: scanning ${INDIA_LARGE_CAP.length} stocks…`);
  const results = [];
  for (let i = 0; i < INDIA_LARGE_CAP.length; i++) {
    if (i > 0) await sleep(1800 + Math.random() * 1200);
    const item = await fetchOne(INDIA_LARGE_CAP[i]);
    if (item) results.push(item);
  }
  results.sort((a, b) => b.decline_pct - a.decline_pct);
  log.info(`Screener done: ${results.length} picks`);
  return results;
}

export async function getValuePicks() {
  const cached = await cacheGet(CACHE_KEY);
  if (cached) return { status: 'ready', data: cached };
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
