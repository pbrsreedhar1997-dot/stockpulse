import YahooFinance from 'yahoo-finance2';
import Parser from 'rss-parser';
import { get as cacheGet, set as cacheSet } from '../cache.js';
import { quoteTtl } from '../market.js';
import log from '../log.js';
import { avQuote, avOverview, avFinancials } from './alphavantage.js';
import { nseQuote, nseProfile, nseFinancials } from './nse.js';
import { upstoxQuote, upstoxHistory, upstoxAvailable } from './upstox.js';
import { fhFinancials } from './finnhub.js';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const rss = new Parser({ timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
const OPT = { validateResult: false };

function safeNum(v) {
  if (v == null) return null;
  const n = typeof v === 'object' && 'raw' in v ? v.raw : Number(v);
  return isFinite(n) ? n : null;
}

// ── Yahoo Finance Chart API (no crumb needed — works on cloud servers) ────────
const CHART_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

// ── Raw quoteSummary via query1 + crumb ───────────────────────────────────────
// The yahoo-finance2 SDK (quote/quoteSummary) is often blocked from datacenter
// IPs (e.g. Render), returning null for financials/profile. This raw call hits
// the same query1 host the chart API uses (which DOES work from cloud) with a
// proper cookie+crumb, restoring fundamentals + company profile in production.
let _crumbCache = null; // { crumb, cookie, ts }
const CRUMB_TTL_MS = 30 * 60 * 1000;

async function getYahooCrumb() {
  if (_crumbCache && Date.now() - _crumbCache.ts < CRUMB_TTL_MS) return _crumbCache;
  let cookie = '';
  try {
    const r1 = await fetch('https://fc.yahoo.com/', { headers: CHART_HEADERS, signal: AbortSignal.timeout(8000) });
    const sc = r1.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
  } catch { /* cookie is best-effort */ }
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...CHART_HEADERS, Cookie: cookie }, signal: AbortSignal.timeout(8000),
  });
  const crumb = (await r2.text())?.trim();
  if (!crumb || crumb.length > 40) throw new Error('Invalid crumb');
  _crumbCache = { crumb, cookie, ts: Date.now() };
  return _crumbCache;
}

async function quoteSummaryRaw(symbol, modules) {
  const { crumb, cookie } = await getYahooCrumb();
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + `?modules=${modules.join(',')}&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { ...CHART_HEADERS, Cookie: cookie }, signal: AbortSignal.timeout(12000) });
  if (r.status === 401 || r.status === 403) { _crumbCache = null; throw new Error(`quoteSummary HTTP ${r.status}`); }
  if (!r.ok) throw new Error(`quoteSummary HTTP ${r.status}`);
  const j = await r.json();
  return j?.quoteSummary?.result?.[0] || null;
}

async function chartApiFetch(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: CHART_HEADERS });
  if (!r.ok) throw new Error(`Chart API HTTP ${r.status}`);
  const json = await r.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No chart result');
  return result;
}

// Intraday history via chart API (5m for 1d, 30m for 5d) — avoids yf.historical interval limitation
async function getIntradayFromChartApi(symbol, range) {
  const interval = range === '1d' ? '5m' : '30m';
  const result = await chartApiFetch(symbol, range, interval);
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  if (!timestamps.length) throw new Error('No intraday data');
  return timestamps
    .map((ts, i) => ({
      ts,
      open:   q.open?.[i]   ?? null,
      high:   q.high?.[i]   ?? null,
      low:    q.low?.[i]    ?? null,
      close:  q.close?.[i]  ?? null,
      volume: q.volume?.[i] ?? null,
    }))
    .filter(row => row.close != null);
}

async function getQuoteFromChartApi(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!r.ok) throw new Error(`Chart API HTTP ${r.status}`);
  const json = await r.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No chart result');

  const meta  = result.meta || {};
  const price = safeNum(meta.regularMarketPrice);
  if (!price) throw new Error('No price in chart meta');

  const prevClose = safeNum(meta.chartPreviousClose || meta.previousClose);
  const change    = prevClose ? price - prevClose : null;
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;

  // Get today's open from first intraday bar
  const opens = result.indicators?.quote?.[0]?.open || [];
  const open  = safeNum(opens.find(v => v != null));

  return {
    price,
    open,
    high:        safeNum(meta.regularMarketDayHigh),
    low:         safeNum(meta.regularMarketDayLow),
    prev_close:  prevClose,
    change,
    change_pct:  changePct,
    volume:      safeNum(meta.regularMarketVolume),
    mkt_cap:     null,
    currency:    meta.currency || 'INR',
    name:        meta.longName || meta.shortName || symbol,
    week52_high: safeNum(meta.fiftyTwoWeekHigh),
    week52_low:  safeNum(meta.fiftyTwoWeekLow),
  };
}

// ── Quote ─────────────────────────────────────────────────────────────────────
export async function getQuote(symbol) {
  const key = `q6:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const isIndian = symbol.endsWith('.NS') || symbol.endsWith('.BO');

  // 0. Upstox (live Indian market data, primary source when token is set)
  if (isIndian && upstoxAvailable()) {
    const upResult = await upstoxQuote(symbol).catch(e => {
      log.warn(`Upstox quote failed for ${symbol}: ${e.message}`);
      return null;
    });
    if (upResult?.price) {
      // Merge NSE data for market cap
      const nse = await nseQuote(symbol).catch(() => null);
      if (nse?.mkt_cap) upResult.mkt_cap = nse.mkt_cap;
      if (!upResult.name || upResult.name === symbol) upResult.name = nse?.name || upResult.name;
      if (!upResult.pe_ratio && nse?.pe_ratio) upResult.pe_ratio = nse.pe_ratio;
      if (!upResult.eps && nse?.eps) upResult.eps = nse.eps;
      await cacheSet(key, upResult, quoteTtl(symbol));
      return upResult;
    }
  }

  // 1. Try yahoo-finance2 (works locally and on some servers)
  const d = await yf.quote(symbol, {}, OPT).catch(() => null);
  if (d?.regularMarketPrice != null) {
    const result = {
      price:       safeNum(d.regularMarketPrice),
      open:        safeNum(d.regularMarketOpen),
      high:        safeNum(d.regularMarketDayHigh),
      low:         safeNum(d.regularMarketDayLow),
      prev_close:  safeNum(d.regularMarketPreviousClose),
      change:      safeNum(d.regularMarketChange),
      change_pct:  safeNum(d.regularMarketChangePercent),
      volume:      safeNum(d.regularMarketVolume),
      mkt_cap:     safeNum(d.marketCap),
      currency:    d.currency || 'INR',
      name:        d.longName || d.shortName || symbol,
      week52_high: safeNum(d.fiftyTwoWeekHigh),
      week52_low:  safeNum(d.fiftyTwoWeekLow),
    };
    await cacheSet(key, result, quoteTtl(symbol));
    return result;
  }

  // 2. Fallback: Yahoo Finance chart API + NSE for market cap (parallel)
  log.info(`Yahoo quote blocked for ${symbol} — using chart API`);
  const [chartResult, nseForMktCap] = await Promise.all([
    getQuoteFromChartApi(symbol).catch(e => {
      log.warn(`Chart API failed for ${symbol}: ${e.message}`);
      return null;
    }),
    isIndian ? nseQuote(symbol).catch(() => null) : Promise.resolve(null),
  ]);
  if (chartResult) {
    if (nseForMktCap?.mkt_cap) chartResult.mkt_cap = nseForMktCap.mkt_cap;
    if (!chartResult.pe_ratio && nseForMktCap?.pe_ratio) chartResult.pe_ratio = nseForMktCap.pe_ratio;
    if (!chartResult.eps && nseForMktCap?.eps) chartResult.eps = nseForMktCap.eps;
    await cacheSet(key, chartResult, quoteTtl(symbol));
    return chartResult;
  }

  // 3. NSE India API (Indian stocks only) — full fallback
  if (isIndian) {
    log.info(`Chart API failed for ${symbol} — trying NSE India`);
    if (nseForMktCap) {
      await cacheSet(key, nseForMktCap, quoteTtl(symbol));
      return nseForMktCap;
    }
  }

  // 4. Last resort: Alpha Vantage
  log.info(`Trying Alpha Vantage for ${symbol}`);
  const avResult = await avQuote(symbol).catch(() => null);
  if (avResult) {
    await cacheSet(key, avResult, quoteTtl(symbol));
    return avResult;
  }

  log.warn(`All quote sources failed for ${symbol}`);
  return null;
}

// ── Profile ───────────────────────────────────────────────────────────────────
export async function getProfile(symbol) {
  const key = `profile4:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const [qRes, sumRes] = await Promise.allSettled([
    yf.quote(symbol, {}, OPT),
    yf.quoteSummary(symbol, { modules: ['assetProfile', 'price'] }, OPT),
  ]);

  const q  = qRes.status   === 'fulfilled' ? (qRes.value   || {}) : {};
  const ap = sumRes.status === 'fulfilled' ? (sumRes.value?.assetProfile || {}) : {};
  const pr = sumRes.status === 'fulfilled' ? (sumRes.value?.price        || {}) : {};

  const hasName = pr.longName || q.longName || q.shortName;
  // Only accept the SDK profile if it carries the rich fields (sector/description).
  // On cloud IPs the SDK often returns just a name with everything else null —
  // fall through to the raw quoteSummary in that case.
  if (hasName && (ap.sector || ap.longBusinessSummary)) {
    const website = ap.website || null;
    const host    = website ? website.replace(/^https?:\/\//, '').split('/')[0] : null;
    const result = {
      name:        pr.longName || q.longName || q.shortName || symbol,
      sector:      ap.sector   || null,
      industry:    ap.industry || null,
      exchange:    q.fullExchangeName || q.exchange || null,
      currency:    q.currency || 'INR',
      website,
      description: ap.longBusinessSummary || null,
      employees:   safeNum(ap.fullTimeEmployees),
      country:     ap.country || null,
      logo_url:    host ? `https://logo.clearbit.com/${host}` : null,
    };
    await cacheSet(key, result, 86400);
    return result;
  }

  // Yahoo SDK blocked — try raw query1 quoteSummary (works from datacenter)
  log.info(`Yahoo profile SDK failed for ${symbol} — trying raw quoteSummary`);
  const rawProf = await quoteSummaryRaw(symbol, ['assetProfile', 'price'])
    .catch(e => { log.warn(`Raw profile failed for ${symbol}: ${e.message}`); return null; });
  if (rawProf) {
    const ap = rawProf.assetProfile || {};
    const pr = rawProf.price || {};
    const name = pr.longName || pr.shortName;
    if (name || ap.sector) {
      const website = ap.website || null;
      const host = website ? website.replace(/^https?:\/\//, '').split('/')[0] : null;
      const result = {
        name:        name || symbol,
        sector:      ap.sector || null,
        industry:    ap.industry || null,
        exchange:    pr.exchangeName || null,
        currency:    pr.currency || 'INR',
        website,
        description: ap.longBusinessSummary || null,
        employees:   safeNum(ap.fullTimeEmployees),
        country:     ap.country || null,
        logo_url:    host ? `https://logo.clearbit.com/${host}` : null,
      };
      await cacheSet(key, result, 86400);
      return result;
    }
  }

  // Still nothing — try NSE India (Indian stocks), then AV, then chart API name
  log.info(`Raw profile empty for ${symbol} — using API fallbacks`);

  const isIndian = symbol.endsWith('.NS') || symbol.endsWith('.BO');

  const [chartRes, nseRes, avRes] = await Promise.allSettled([
    getQuoteFromChartApi(symbol),
    isIndian ? nseProfile(symbol) : Promise.resolve(null),
    avOverview(symbol),
  ]);

  const chart = chartRes.status === 'fulfilled' ? chartRes.value : null;
  const nse   = nseRes.status   === 'fulfilled' ? nseRes.value   : null;
  const av    = avRes.status    === 'fulfilled' ? avRes.value    : null;

  const name     = nse?.name    || chart?.name || av?.name    || symbol;
  const currency = chart?.currency || av?.currency || 'INR';
  const sector   = nse?.sector   || av?.sector   || null;
  const industry = nse?.industry || av?.industry || null;
  const host     = av?.website ? av.website.replace(/^https?:\/\//, '').split('/')[0] : null;

  const result = {
    name,
    sector,
    industry,
    exchange:    nse?.exchange  || av?.exchange  || null,
    currency,
    website:     av?.website    || null,
    description: av?.description || null,
    employees:   av?.employees   || null,
    country:     nse?.country   || av?.country   || null,
    logo_url:    host ? `https://logo.clearbit.com/${host}` : null,
  };

  await cacheSet(key, result, 86400);
  return result;
}

// ── Financials ────────────────────────────────────────────────────────────────
export async function getFinancials(symbol) {
  const key = `fin5:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const sum = await yf.quoteSummary(symbol, {
    modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail'],
  }, OPT).catch(() => null);

  if (sum) {
    const fd = sum.financialData        || {};
    const ks = sum.defaultKeyStatistics || {};
    const sd = sum.summaryDetail        || {};
    const pct = n => n != null ? Math.round(n * 1000) / 10 : null;

    const result = {
      market_cap:      safeNum(sd.marketCap),
      revenue_ttm:     safeNum(fd.totalRevenue),
      gross_margin:    pct(safeNum(fd.grossMargins)),
      net_margin:      pct(safeNum(fd.profitMargins)),
      pe_ratio:        safeNum(sd.trailingPE),
      eps:             safeNum(ks.trailingEps),
      dividend_yield:  pct(safeNum(sd.dividendYield)),
      beta:            safeNum(ks.beta),
      week52_high:     safeNum(sd.fiftyTwoWeekHigh),
      week52_low:      safeNum(sd.fiftyTwoWeekLow),
      avg_volume:      safeNum(sd.averageVolume),
      price_to_book:   safeNum(ks.priceToBook),
      debt_to_equity:  safeNum(fd.debtToEquity),
      return_on_equity: pct(safeNum(fd.returnOnEquity)),
      revenue_growth:  pct(safeNum(fd.revenueGrowth)),
      earnings_growth: pct(safeNum(fd.earningsGrowth)),
      free_cash_flow:  safeNum(fd.freeCashflow),
    };
    // Only trust the SDK result if it actually carries data — on cloud IPs the
    // SDK can return a truthy-but-empty object (all nulls). Fall through if so.
    if (result.pe_ratio != null || result.market_cap != null || result.eps != null || result.revenue_ttm != null) {
      await cacheSet(key, result, 21600);
      return result;
    }
  }

  // Yahoo SDK blocked (common on cloud IPs) — try the raw query1 quoteSummary
  // with crumb, which works from datacenter where the SDK does not.
  log.info(`Yahoo financials SDK failed for ${symbol} — trying raw quoteSummary`);
  const rawSum = await quoteSummaryRaw(symbol, ['financialData', 'defaultKeyStatistics', 'summaryDetail'])
    .catch(e => { log.warn(`Raw quoteSummary failed for ${symbol}: ${e.message}`); return null; });
  if (rawSum) {
    const fd = rawSum.financialData || {};
    const ks = rawSum.defaultKeyStatistics || {};
    const sd = rawSum.summaryDetail || {};
    const pct = n => n != null ? Math.round(n * 1000) / 10 : null;
    const result = {
      market_cap:      safeNum(sd.marketCap),
      revenue_ttm:     safeNum(fd.totalRevenue),
      gross_margin:    pct(safeNum(fd.grossMargins)),
      net_margin:      pct(safeNum(fd.profitMargins)),
      pe_ratio:        safeNum(sd.trailingPE),
      eps:             safeNum(ks.trailingEps),
      dividend_yield:  pct(safeNum(sd.dividendYield)),
      beta:            safeNum(ks.beta),
      week52_high:     safeNum(sd.fiftyTwoWeekHigh),
      week52_low:      safeNum(sd.fiftyTwoWeekLow),
      avg_volume:      safeNum(sd.averageVolume),
      price_to_book:   safeNum(ks.priceToBook),
      debt_to_equity:  safeNum(fd.debtToEquity),
      return_on_equity: pct(safeNum(fd.returnOnEquity)),
      revenue_growth:  pct(safeNum(fd.revenueGrowth)),
      earnings_growth: pct(safeNum(fd.earningsGrowth)),
      free_cash_flow:  safeNum(fd.freeCashflow),
    };
    if (result.pe_ratio != null || result.market_cap != null || result.eps != null) {
      await cacheSet(key, result, 21600);
      return result;
    }
  }

  // Still nothing — try NSE India (P/E, EPS), then Alpha Vantage
  log.info(`Raw quoteSummary empty for ${symbol} — using API fallbacks`);
  const isIndian = symbol.endsWith('.NS') || symbol.endsWith('.BO');

  if (isIndian) {
    const nseResult = await nseFinancials(symbol).catch(e => {
      log.warn(`NSE financials failed for ${symbol}: ${e.message}`);
      return null;
    });
    if (nseResult?.pe_ratio != null || nseResult?.market_cap != null) {
      await cacheSet(key, nseResult, 21600);
      return nseResult;
    }
  }

  const avResult = await avFinancials(symbol).catch(e => {
    log.warn(`AV financials failed for ${symbol}: ${e.message}`);
    return null;
  });
  if (avResult) {
    // Alpha Vantage's OVERVIEW endpoint never returns debt_to_equity — Finnhub's
    // metric endpoint does, so fill just that gap when available (best-effort,
    // and weakest for NSE/BSE names since Finnhub's free tier favors US coverage).
    if (avResult.debt_to_equity == null) {
      const fh = await fhFinancials(symbol).catch(() => null);
      if (fh?.debt_to_equity != null) avResult.debt_to_equity = fh.debt_to_equity;
    }
    await cacheSet(key, avResult, 21600);
    return avResult;
  }

  const fhResult = await fhFinancials(symbol).catch(e => {
    log.warn(`Finnhub financials failed for ${symbol}: ${e.message}`);
    return null;
  });
  if (fhResult) {
    await cacheSet(key, fhResult, 21600);
    return fhResult;
  }

  log.warn(`All financials sources failed for ${symbol}`);
  return null;
}

// ── Live Price (WebSocket tick — direct chart API, no cache) ─────────────────
export async function getLivePrice(symbol) {
  return getQuoteFromChartApi(symbol).catch(() => null);
}

// ── History ───────────────────────────────────────────────────────────────────
const RANGE_DAYS = { '5d': 10, '1wk': 7, '1mo': 35, '3mo': 95, '6mo': 185, '1y': 370, '2y': 740, '3y': 1100, '5y': 1830, max: 3650 };

export async function getHistory(symbol, range = '1mo') {
  const key = `hist7:${symbol}:${range}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  let result;
  const isIndian = symbol.endsWith('.NS') || symbol.endsWith('.BO');

  // Try Upstox first for Indian stocks (best reliability on cloud)
  if (isIndian && upstoxAvailable()) {
    result = await upstoxHistory(symbol, range).catch(e => {
      log.warn(`Upstox history failed ${symbol}/${range}: ${e.message}`);
      return null;
    });
  }

  if (!result?.length && range === '1d') {
    // Intraday (5m bars) for 1D only
    result = await getIntradayFromChartApi(symbol, '1d').catch(e => {
      log.warn(`Intraday chart failed ${symbol}/1d: ${e.message}`);
      return null;
    });
  } else if (!result?.length && range === '5d') {
    // Daily bars for 5D — use chart API with 1d interval
    result = await chartApiFetch(symbol, '5d', '1d').then(res => {
      const timestamps = res.timestamp || [];
      const q = res.indicators?.quote?.[0] || {};
      return timestamps.map((ts, i) => ({
        ts, open: q.open?.[i] ?? null, high: q.high?.[i] ?? null,
        low: q.low?.[i] ?? null, close: q.close?.[i] ?? null, volume: q.volume?.[i] ?? null,
      })).filter(row => row.close != null);
    }).catch(e => {
      log.warn(`5D chart API failed ${symbol}: ${e.message}`);
      return null;
    });
  } else if (!result?.length) {
    const days    = RANGE_DAYS[range] || 30;
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - days * 86400000);
    const rows = await yf.historical(symbol, {
      period1:  period1.toISOString().split('T')[0],
      period2:  period2.toISOString().split('T')[0],
      interval: '1d',
    }, OPT).catch(() => null);
    if (Array.isArray(rows)) {
      result = rows.filter(r => r.close != null).map(r => ({
        ts:     Math.floor(new Date(r.date).getTime() / 1000),
        open:   r.open   ?? r.close,
        high:   r.high   ?? r.close,
        low:    r.low    ?? r.close,
        close:  r.close,
        volume: r.volume || 0,
      }));
    }
  }

  if (!result?.length) return null;

  const ttl = range === '1d' ? 60 : range === '5d' ? 120 : 300;
  await cacheSet(key, result, ttl);
  return result;
}

// ── News ──────────────────────────────────────────────────────────────────────
// Classify a headline into the categories NewsTab filters by.
function classifyNews(title = '') {
  const t = title.toLowerCase();
  if (/\b(q[1-4]|results|profit|revenue|earnings|net profit|pat|ebitda)\b/.test(t)) return 'results';
  if (/\b(order|contract|deal win|bags|wins|awarded|tender)\b/.test(t))            return 'contract';
  if (/\b(acqui|merger|takeover|stake buy|buyout)\b/.test(t))                       return 'acquisition';
  if (/\b(partner|tie-?up|collaborat|joint venture|jv|mou)\b/.test(t))              return 'partnership';
  return 'general';
}

export async function getNews(symbol) {
  const key = `news6:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const ticker = symbol.replace(/\.(NS|BO|BSE|NSE)$/i, '');
  let articles = [];

  // 1. Yahoo Finance RSS (works from residential IPs)
  try {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=IN&lang=en-IN`;
    const feed = await rss.parseURL(url);
    articles = (feed.items || []).slice(0, 12).map(item => ({
      title:     item.title || '',
      url:       item.link  || '',
      source:    'Yahoo Finance',
      published: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : null,
      summary:   item.contentSnippet || '',
      relevance: 'medium',
      category:  classifyNews(item.title),
    }));
  } catch (e) {
    log.warn(`Yahoo news RSS ${symbol}: ${e.message}`);
  }

  // 2. Google News RSS — datacenter-friendly, symbol-specific, always current.
  //    Primary source on cloud (Render) where Yahoo RSS is blocked.
  if (articles.length < 4) {
    try {
      const q   = encodeURIComponent(`${ticker} share price NSE`);
      const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
      const feed = await rss.parseURL(url);
      const gn = (feed.items || []).slice(0, 15).map(item => {
        // Google News titles end with " - Publisher"; split it out.
        const raw   = item.title || '';
        const idx   = raw.lastIndexOf(' - ');
        const title = idx > 0 ? raw.slice(0, idx) : raw;
        const src   = item.source?.name || item.creator || (idx > 0 ? raw.slice(idx + 3) : 'Google News');
        return {
          title,
          url:       item.link || '',
          source:    src,
          published: item.isoDate ? Math.floor(new Date(item.isoDate).getTime() / 1000)
                   : item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : null,
          summary:   (item.contentSnippet || '').slice(0, 220),
          relevance: 'high',
          category:  classifyNews(title),
        };
      });
      // Merge, dedupe by title
      const seen = new Set(articles.map(a => a.title));
      for (const a of gn) if (!seen.has(a.title)) { articles.push(a); seen.add(a.title); }
    } catch (e) {
      log.warn(`Google news RSS ${symbol}: ${e.message}`);
    }
  }

  articles.sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
  articles = articles.slice(0, 20);
  await cacheSet(key, articles, 900);
  return articles;
}

// ── Search ────────────────────────────────────────────────────────────────────
export async function search(q) {
  const key = `search3:${q.toLowerCase()}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const mapRow = r => ({
    symbol:   r.symbol,
    name:     r.shortname || r.longname || r.symbol,
    exchange: r.exchDisp  || r.exchange || '',
    type:     r.quoteType || 'EQUITY',
  });

  // 1. yahoo-finance2 SDK
  const res = await yf.search(q, { newsCount: 0 }, OPT).catch(() => null);
  let results = (res?.quotes || [])
    .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
    .slice(0, 10)
    .map(mapRow);

  // 2. Direct Yahoo Finance search API (more reliable on cloud IPs)
  if (!results.length) {
    try {
      const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=en-US&region=IN&quotesCount=10&newsCount=0&enableFuzzyQuery=true&enableNavLinks=false`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: CHART_HEADERS });
      if (r.ok) {
        const json = await r.json();
        results = (json?.finance?.result?.[0]?.quotes || [])
          .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
          .slice(0, 10)
          .map(mapRow);
      }
    } catch (e) {
      log.warn(`Direct search API failed for "${q}": ${e.message}`);
    }
  }

  // 3. NSE search autocomplete (Indian stocks only)
  if (!results.length) {
    try {
      const url = `https://www.nseindia.com/api/search-autocomplete?q=${encodeURIComponent(q)}`;
      const r = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://www.nseindia.com' },
      });
      if (r.ok) {
        const json = await r.json();
        results = (json?.data || [])
          .filter(d => d.symbol)
          .slice(0, 10)
          .map(d => ({ symbol: d.symbol + '.NS', name: d.symbol_info || d.symbol, exchange: 'NSE', type: 'EQUITY' }));
      }
    } catch (e) {
      log.warn(`NSE search failed for "${q}": ${e.message}`);
    }
  }

  await cacheSet(key, results, 86400);
  return results;
}

// ── Performance ───────────────────────────────────────────────────────────────
export async function getPerformance(symbol) {
  const key = `perf4:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const now = new Date();
  const p1  = new Date(now.getTime() - 5 * 365.25 * 86400000);

  const rows = await yf.historical(symbol, {
    period1:  p1.toISOString().split('T')[0],
    period2:  now.toISOString().split('T')[0],
    interval: '1mo',
  }, OPT).catch(() => null);

  if (!Array.isArray(rows) || rows.length < 2) return null;

  const byYear = {};
  rows.forEach(r => {
    if (!r.close) return;
    const y = new Date(r.date).getFullYear();
    (byYear[y] = byYear[y] || []).push(r.close);
  });

  const annual_returns = Object.entries(byYear)
    .filter(([, prices]) => prices.length >= 2)
    .map(([yr, prices]) => ({
      year: parseInt(yr),
      return_pct: ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100,
    }))
    .sort((a, b) => a.year - b.year);

  const oneYearAgo = new Date(now.getTime() - 365 * 86400000);
  let cagr_1y = null;
  const recent = rows.filter(r => new Date(r.date) >= oneYearAgo);
  if (recent.length >= 1) {
    const s = recent[0].close, e = rows[rows.length - 1].close;
    if (s && e) cagr_1y = ((e - s) / s) * 100;
  }

  let cagr_5y = null;
  const s5 = rows[0].close, e5 = rows[rows.length - 1].close;
  const yrs = (new Date(rows[rows.length - 1].date) - new Date(rows[0].date)) / (365.25 * 86400000);
  if (s5 && e5 && yrs > 0) cagr_5y = (Math.pow(e5 / s5, 1 / yrs) - 1) * 100;

  const result = { cagr_1y, cagr_5y, annual_returns };
  await cacheSet(key, result, 86400);
  return result;
}
