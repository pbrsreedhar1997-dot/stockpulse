/**
 * enrichment.js — Free supplementary data sources for RAG context
 *
 * Sources used (all free, no extra API keys):
 *   1. Yahoo Finance Chart API  — macro indicators (VIX, USD/INR, Crude, Gold, US10Y, S&P500)
 *   2. Economic Times RSS       — Indian market news
 *   3. Moneycontrol RSS         — Indian market news
 *   4. Business Standard RSS    — Indian market news
 *   5. World Bank API           — macro fundamentals (GDP, CPI, interest rates) — free, no key
 *   6. NSE India unofficial API — FII/DII provisional data (best-effort)
 */

import Parser from 'rss-parser';
import { get as cacheGet, set as cacheSet } from '../cache.js';
import log from '../log.js';

const rss = new Parser({ timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockPulse/1.0)' } });

const CHART_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

async function yfChartQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=false`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: CHART_HEADERS });
  if (!r.ok) return null;
  const json = await r.json();
  const res  = json?.chart?.result?.[0];
  if (!res) return null;
  const meta = res.meta ?? {};
  return {
    price:      meta.regularMarketPrice ?? null,
    prev_close: meta.previousClose ?? meta.chartPreviousClose ?? null,
    change_pct: meta.regularMarketPrice && meta.previousClose
      ? +((meta.regularMarketPrice / meta.previousClose - 1) * 100).toFixed(2)
      : null,
    symbol,
  };
}

/* ── 1. MACRO CONTEXT — 7 key global/Indian indicators ─────────────────────── */
const MACRO_SYMBOLS = [
  { sym: '^INDIAVIX', label: 'India VIX',      unit: 'pts',  direction: 'lower_better' },
  { sym: 'USDINR=X',  label: 'USD/INR',         unit: '₹',    direction: 'neutral'       },
  { sym: 'CL=F',      label: 'Crude Oil (WTI)', unit: '$',    direction: 'lower_better' },
  { sym: 'GC=F',      label: 'Gold (USD/oz)',   unit: '$',    direction: 'neutral'       },
  { sym: '^TNX',      label: 'US 10Y Yield',    unit: '%',    direction: 'lower_better' },
  { sym: '^GSPC',     label: 'S&P 500',         unit: 'pts',  direction: 'higher_better' },
  { sym: '^NSEI',     label: 'NIFTY 50',        unit: 'pts',  direction: 'higher_better' },
];

export async function getMacroContext() {
  const ckey = 'enrich:macro';
  const cached = await cacheGet(ckey);
  if (cached) return cached;

  const results = await Promise.allSettled(MACRO_SYMBOLS.map(m => yfChartQuote(m.sym)));
  const data = MACRO_SYMBOLS.map((m, i) => ({
    ...m,
    ...(results[i].status === 'fulfilled' && results[i].value ? results[i].value : {}),
  }));

  // Compute macro regime score (0–100)
  let macroScore = 50;
  const notes    = [];

  for (const d of data) {
    if (d.change_pct == null) continue;
    switch (d.sym) {
      case '^INDIAVIX':
        if (d.price > 20) { macroScore -= 8; notes.push(`High India VIX ${d.price?.toFixed(1)} (fear)`); }
        else if (d.price < 14) { macroScore += 6; notes.push(`Low India VIX ${d.price?.toFixed(1)} (calm)`); }
        break;
      case '^NSEI':
        if (d.change_pct > 1) { macroScore += 6; notes.push(`Nifty strong +${d.change_pct}%`); }
        else if (d.change_pct < -1) { macroScore -= 6; notes.push(`Nifty weak ${d.change_pct}%`); }
        break;
      case '^GSPC':
        if (d.change_pct > 0.5) macroScore += 3;
        else if (d.change_pct < -1) { macroScore -= 4; notes.push('S&P 500 selling'); }
        break;
      case '^TNX':
        if (d.price > 4.5) { macroScore -= 4; notes.push(`US10Y elevated ${d.price?.toFixed(2)}% (hawkish)`); }
        else if (d.price < 3.8) { macroScore += 4; notes.push('US10Y low (growth friendly)'); }
        break;
      case 'CL=F':
        if (d.change_pct > 3) { macroScore -= 3; notes.push(`Crude spike +${d.change_pct}% (inflation risk)`); }
        else if (d.change_pct < -3) { macroScore += 3; notes.push('Crude falling (import cost benefit)'); }
        break;
      case 'USDINR=X':
        if (d.price > 85) { macroScore -= 2; notes.push(`INR weak at ₹${d.price?.toFixed(2)}`); }
        else if (d.price < 83) { macroScore += 2; notes.push(`INR stable at ₹${d.price?.toFixed(2)}`); }
        break;
    }
  }

  macroScore = Math.round(Math.max(0, Math.min(100, macroScore)));
  const regime = macroScore >= 62 ? 'RISK_ON' : macroScore <= 40 ? 'RISK_OFF' : 'NEUTRAL';

  const ctx = { score: macroScore, regime, notes, indicators: data };
  await cacheSet(ckey, ctx, 600); // 10-min cache
  return ctx;
}

/* ── 2. MULTI-SOURCE NEWS — ET, Moneycontrol, BS RSS ───────────────────────── */
const NEWS_FEEDS = [
  {
    name: 'Economic Times',
    url: 'https://economictimes.indiatimes.com/markets/stocks/rss.cms',
    generic: true,  // always included regardless of symbol
  },
  {
    name: 'Moneycontrol',
    url: 'https://www.moneycontrol.com/rss/marketsindia.xml',
    generic: true,
  },
  {
    name: 'Business Standard',
    url: 'https://www.business-standard.com/rss/markets-106.rss',
    generic: true,
  },
];

export async function getEnrichedNews(symbol) {
  const ticker = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
  const ckey   = `enrich:news:${symbol}`;
  const cached = await cacheGet(ckey);
  if (cached) return cached;

  const allArticles = [];

  for (const feed of NEWS_FEEDS) {
    try {
      const parsed = await rss.parseURL(feed.url);
      for (const item of (parsed.items || []).slice(0, 30)) {
        const title   = item.title   || '';
        const content = item.content || item.summary || item.contentSnippet || '';
        const relevant = ticker.length > 2 && (
          title.toUpperCase().includes(ticker) ||
          content.toUpperCase().includes(ticker)
        );
        if (feed.generic || relevant) {
          allArticles.push({
            title,
            summary: content.slice(0, 200),
            published: item.isoDate ? Math.floor(new Date(item.isoDate).getTime() / 1000) : null,
            source: feed.name,
            relevant,
          });
        }
      }
    } catch (e) {
      log.warn(`RSS ${feed.name}: ${e.message}`);
    }
  }

  // Sort: symbol-relevant articles first, then by recency
  allArticles.sort((a, b) => {
    if (a.relevant && !b.relevant) return -1;
    if (!a.relevant && b.relevant) return 1;
    return (b.published ?? 0) - (a.published ?? 0);
  });

  const result = allArticles.slice(0, 25);
  await cacheSet(ckey, result, 1800); // 30-min cache
  return result;
}

/* ── 3. SECTOR PEERS — map to 3 benchmark peers for comparison ──────────────── */
const SECTOR_PEERS = {
  'Technology':          ['TCS.NS', 'INFY.NS', 'WIPRO.NS', 'HCLTECH.NS', 'TECHM.NS'],
  'Financial Services':  ['HDFCBANK.NS', 'ICICIBANK.NS', 'SBIN.NS', 'KOTAKBANK.NS', 'AXISBANK.NS'],
  'Consumer Defensive':  ['HINDUNILVR.NS', 'ITC.NS', 'NESTLE.NS', 'BRITANNIA.NS', 'DABUR.NS'],
  'Consumer Cyclical':   ['MARUTI.NS', 'TATAMOTORS.NS', 'M&M.NS', 'EICHERMOT.NS', 'BAJAJ-AUTO.NS'],
  'Healthcare':          ['SUNPHARMA.NS', 'CIPLA.NS', 'DRREDDY.NS', 'DIVISLAB.NS', 'LUPIN.NS'],
  'Energy':              ['RELIANCE.NS', 'ONGC.NS', 'BPCL.NS', 'IOC.NS', 'GAIL.NS'],
  'Industrials':         ['LT.NS', 'SIEMENS.NS', 'ABB.NS', 'BHEL.NS', 'CUMMINSIND.NS'],
  'Basic Materials':     ['JSWSTEEL.NS', 'TATASTEEL.NS', 'HINDALCO.NS', 'COALINDIA.NS', 'VEDL.NS'],
  'Real Estate':         ['DLF.NS', 'GODREJPROP.NS', 'OBEROIRLTY.NS', 'PRESTIGE.NS', 'BRIGADE.NS'],
  'Communication Services': ['BHARTIARTL.NS', 'RELIANCE.NS', 'IDEA.NS', 'SUNTV.NS', 'ZEEL.NS'],
  'Utilities':           ['NTPC.NS', 'POWERGRID.NS', 'TATAPOWER.NS', 'ADANIPOWER.NS', 'ADANIGREEN.NS'],
};

export async function getPeerPerformance(symbol, sector) {
  const peers = (SECTOR_PEERS[sector] || []).filter(p => p !== symbol).slice(0, 3);
  if (!peers.length) return null;

  const ckey = `enrich:peers:${sector}`;
  const cached = await cacheGet(ckey);
  if (cached) return cached;

  const results = await Promise.allSettled(peers.map(p => yfChartQuote(p)));
  const data = peers.map((p, i) => ({
    symbol: p.replace(/\.(NS|BO)$/i, ''),
    ...(results[i].status === 'fulfilled' && results[i].value ? results[i].value : {}),
  })).filter(d => d.price);

  if (!data.length) return null;
  const avgPeerChg = data.reduce((s, d) => s + (d.change_pct ?? 0), 0) / data.length;
  const result = { peers: data, avg_sector_change_pct: +avgPeerChg.toFixed(2) };
  await cacheSet(ckey, result, 600);
  return result;
}

/* ── 4. WORLD BANK MACRO (free, no key) — India GDP + inflation ─────────────── */
export async function getWorldBankMacro() {
  const ckey = 'enrich:worldbank';
  const cached = await cacheGet(ckey);
  if (cached) return cached;

  const indicators = [
    { id: 'NY.GDP.MKTP.KD.ZG', label: 'India GDP Growth %' },
    { id: 'FP.CPI.TOTL.ZG',   label: 'India CPI Inflation %' },
    { id: 'FR.INR.RINR',       label: 'India Real Interest Rate %' },
  ];

  const results = {};
  for (const ind of indicators) {
    try {
      const url = `https://api.worldbank.org/v2/country/IN/indicator/${ind.id}?format=json&per_page=2&mrv=2`;
      const r   = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const j   = await r.json();
      const rows = j?.[1];
      if (Array.isArray(rows) && rows[0]?.value != null) {
        results[ind.label] = { value: +rows[0].value.toFixed(2), year: rows[0].date };
      }
    } catch { /* non-critical */ }
  }

  await cacheSet(ckey, results, 86400); // 24h cache — WB data is annual
  return results;
}
