import YahooFinance from 'yahoo-finance2';
import Parser from 'rss-parser';
import { get as cacheGet, set as cacheSet } from '../cache.js';
import { quoteTtl } from '../market.js';
import log from '../log.js';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const rss = new Parser({ timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
const OPT = { validateResult: false };

function safeNum(v) {
  if (v == null) return null;
  const n = typeof v === 'object' && 'raw' in v ? v.raw : Number(v);
  return isFinite(n) ? n : null;
}

// ── Quote ─────────────────────────────────────────────────────────────────────
export async function getQuote(symbol) {
  const key = `q3:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const d = await yf.quote(symbol, {}, OPT);
  if (!d || d.regularMarketPrice == null) return null;

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

// ── Profile ───────────────────────────────────────────────────────────────────
export async function getProfile(symbol) {
  const key = `profile3:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const [qRes, sumRes] = await Promise.allSettled([
    yf.quote(symbol, {}, OPT),
    yf.quoteSummary(symbol, { modules: ['assetProfile', 'price'] }, OPT),
  ]);

  const q  = qRes.status   === 'fulfilled' ? qRes.value   : {};
  const ap = sumRes.status === 'fulfilled' ? (sumRes.value?.assetProfile || {}) : {};
  const pr = sumRes.status === 'fulfilled' ? (sumRes.value?.price        || {}) : {};

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

// ── Financials ────────────────────────────────────────────────────────────────
export async function getFinancials(symbol) {
  const key = `fin4:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const sum = await yf.quoteSummary(symbol, {
    modules: ['financialData', 'defaultKeyStatistics', 'summaryDetail'],
  }, OPT).catch(() => null);

  if (!sum) return null;

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
  };

  await cacheSet(key, result, 21600);
  return result;
}

// ── History ───────────────────────────────────────────────────────────────────
const RANGE_DAYS = { '1d': 5, '5d': 10, '1wk': 7, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '5y': 1825, max: 3650 };

export async function getHistory(symbol, range = '1mo') {
  const key = `hist4:${symbol}:${range}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const days    = RANGE_DAYS[range] || 30;
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - days * 86400000);

  const rows = await yf.historical(symbol, {
    period1:  period1.toISOString().split('T')[0],
    period2:  period2.toISOString().split('T')[0],
    interval: '1d',
  }, OPT).catch(() => null);

  if (!Array.isArray(rows)) return null;

  const result = rows.filter(r => r.close != null).map(r => ({
    ts:     Math.floor(new Date(r.date).getTime() / 1000),
    open:   r.open  ?? r.close,
    high:   r.high  ?? r.close,
    low:    r.low   ?? r.close,
    close:  r.close,
    volume: r.volume || 0,
  }));

  await cacheSet(key, result, 300);
  return result;
}

// ── News ──────────────────────────────────────────────────────────────────────
export async function getNews(symbol) {
  const key = `news4:${symbol}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const ticker = symbol.replace(/\.(NS|BO|BSE|NSE)$/i, '');
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=IN&lang=en-IN`;
  let articles = [];
  try {
    const feed = await rss.parseURL(url);
    articles = (feed.items || []).slice(0, 12).map(item => ({
      title:     item.title || '',
      url:       item.link  || '',
      source:    'Yahoo Finance',
      published: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : null,
      summary:   item.contentSnippet || '',
      relevance: 'medium',
      category:  'gen',
    }));
  } catch (e) {
    log.warn(`News RSS ${symbol}:`, e.message);
  }

  await cacheSet(key, articles, 600);
  return articles;
}

// ── Search ────────────────────────────────────────────────────────────────────
export async function search(q) {
  const key = `search3:${q.toLowerCase()}`;
  const hit = await cacheGet(key);
  if (hit) return hit;

  const res = await yf.search(q, { newsCount: 0 }, OPT).catch(() => null);
  const results = (res?.quotes || [])
    .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
    .slice(0, 10)
    .map(r => ({
      symbol:   r.symbol,
      name:     r.shortname || r.longname || r.symbol,
      exchange: r.exchDisp  || r.exchange || '',
      type:     r.quoteType || 'EQUITY',
    }));

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
