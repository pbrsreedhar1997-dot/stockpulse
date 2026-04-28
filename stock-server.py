#!/usr/bin/env python3
"""
StockPulse Backend — Flask + yfinance + PostgreSQL (pgvector) or SQLite
Serves Indian (NSE/BSE) and US stock data without CORS issues.
"""

import os, json, time, threading, logging, re, secrets, concurrent.futures
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
import requests as http_requests
import feedparser
import yfinance as yf
import numpy as np
import groq as groq_sdk
import anthropic
from flask import Flask, jsonify, request, Response, stream_with_context, send_from_directory
from flask_cors import CORS
from db import (
    get_db, close_db, init_db,
    store_embedding_vec, retrieve_top_chunks as db_retrieve_top_chunks,
    thread_connection,
)

# ── Config ──────────────────────────────────────────────────────────────────
CACHE_TTL = 60          # seconds — quote cache lifetime
HIST_TTL  = 300         # seconds — history cache lifetime
NEWS_TTL  = 600         # seconds — news cache lifetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('stockpulse')

app = Flask(__name__)
CORS(app, origins='*')
app.teardown_appcontext(close_db)

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

# ── Embedding model (lazy-loaded) ────────────────────────────────────────────
_embed_model      = None
_embed_model_lock = threading.Lock()

def get_embed_model():
    """Lazily load fastembed BGE model if available (optional dependency)."""
    global _embed_model
    if _embed_model is None:
        with _embed_model_lock:
            if _embed_model is None:
                try:
                    from fastembed import TextEmbedding
                    log.info('Loading embedding model BAAI/bge-small-en-v1.5 …')
                    _embed_model = TextEmbedding('BAAI/bge-small-en-v1.5')
                    log.info('Embedding model ready.')
                except ImportError:
                    log.info('fastembed not installed — RAG embeddings disabled (chat still works).')
                except Exception as e:
                    log.warning(f'Embedding model load failed: {e}')
    return _embed_model

# ── Database — delegated to db.py ────────────────────────────────────────────
# get_db, close_db, init_db are imported from db.py at the top of this file.

# ── Helpers ──────────────────────────────────────────────────────────────────
SESSION_TTL = 30 * 24 * 3600  # 30 days

def now_ts():
    return int(time.time())

def stale(fetched_at, ttl):
    return (now_ts() - (fetched_at or 0)) > ttl

def get_current_user_id():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth[7:].strip()
    if not token:
        return None
    db = get_db()
    row = db.execute(
        'SELECT user_id FROM user_sessions WHERE token=? AND expires_at>?',
        (token, now_ts())
    ).fetchone()
    return row['user_id'] if row else None

def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

# ── Embedding helpers ────────────────────────────────────────────────────────

def _embed_vec(text: str):
    """Encode text → float32 numpy array (384-dim).  Returns None on failure."""
    model = get_embed_model()
    if not model:
        return None
    try:
        return np.array(next(model.embed([text])), dtype=np.float32)
    except Exception as e:
        log.warning(f'_embed_vec: {e}')
        return None

def store_embedding(conn, symbol: str, content: str, source: str,
                    article_url: str = '', ts: int = None):
    """Encode content and persist via db.store_embedding_vec (PG or SQLite)."""
    vec = _embed_vec(content)
    if vec is None:
        return
    store_embedding_vec(conn, symbol, content, vec, source, article_url, ts or now_ts())

RAG_SCORE_THRESHOLD = 0.30  # minimum cosine similarity to include a chunk in context

def retrieve_top_chunks(symbols: list, query: str, top_k: int = 6) -> list:
    """Embed query and return top-k chunks scoring above RAG_SCORE_THRESHOLD."""
    q_vec = _embed_vec(query)
    if q_vec is None or not symbols:
        return []
    chunks = db_retrieve_top_chunks(symbols, q_vec, top_k * 3)  # over-fetch, then threshold
    scored = [c for c in chunks if c.get('score', 1.0) >= RAG_SCORE_THRESHOLD]
    return scored[:top_k]

# ── Chunking helpers ──────────────────────────────────────────────────────────

def _chunk_text(text: str, window: int = 150, overlap: int = 30) -> list[str]:
    """Split text into overlapping word-window chunks."""
    words = text.split()
    if len(words) <= window:
        return [text]
    chunks, i = [], 0
    while i < len(words):
        chunks.append(' '.join(words[i:i + window]))
        i += window - overlap
    return chunks

# ── Background embedding workers ─────────────────────────────────────────────

def _embed_articles_bg(symbol: str, articles: list):
    """Embed news articles with rich context per chunk."""
    try:
        with thread_connection() as conn:
            for a in articles:
                title   = a.get('title', '')
                summary = a.get('summary', '')
                source  = a.get('source', 'news')
                url     = a.get('url', '')
                ts      = a.get('published')
                cat     = a.get('category', 'gen')
                cat_tag = {'contract': 'Contract/deal', 'results': 'Earnings results',
                           'earn': 'Earnings', 'acq': 'Acquisition/M&A',
                           'part': 'Partnership'}.get(cat, 'News')
                # Chunk 1: headline + summary with category context
                body = f"[{cat_tag}] {title}"
                if summary:
                    body += f"\n{summary}"
                store_embedding(conn, symbol, body, source=source,
                                article_url=url, ts=ts)
                # Chunk 2: if summary is long, embed it separately for better recall
                if summary and len(summary.split()) > 60:
                    for chunk in _chunk_text(summary, window=120, overlap=20):
                        store_embedding(conn, symbol, f"{title} — {chunk}",
                                        source=source, article_url=url, ts=ts)
    except Exception as e:
        log.warning(f'_embed_articles_bg({symbol}): {e}')

def _embed_profile_bg(symbol: str, profile: dict):
    """Embed company profile as multiple overlapping description chunks."""
    try:
        with thread_connection() as conn:
            name    = profile.get('name', symbol)
            sector  = profile.get('sector', '')
            ind     = profile.get('industry', '')
            country = profile.get('country', '')
            emp     = profile.get('employees')
            website = profile.get('website', '')
            desc    = profile.get('description', '')

            # Chunk 1: identity overview
            overview = f"{name} ({symbol}) is a {sector} company"
            if ind:     overview += f" in the {ind} industry"
            if country: overview += f", based in {country}"
            if emp:     overview += f", with approximately {emp:,} employees"
            if website: overview += f". Website: {website}"
            store_embedding(conn, symbol, overview,
                            source='profile', article_url=f'profile:overview:{symbol}')

            # Chunk 2+: overlapping windows of the business description
            if desc:
                for i, chunk in enumerate(_chunk_text(desc, window=150, overlap=30)):
                    store_embedding(conn, symbol,
                                    f"{name} — {chunk}",
                                    source='profile',
                                    article_url=f'profile:desc:{symbol}:{i}')
    except Exception as e:
        log.warning(f'_embed_profile_bg({symbol}): {e}')

def _embed_financials_bg(symbol: str, data: dict):
    """Embed financials as separate human-readable narrative chunks."""
    try:
        with thread_connection() as conn:
            cur = data.get('currency', 'USD')
            sym_label = symbol

            def _fmtn(v, unit=''):
                if v is None: return 'N/A'
                if abs(v) >= 1e12: return f'{v/1e12:.2f}T {unit}'.strip()
                if abs(v) >= 1e9:  return f'{v/1e9:.2f}B {unit}'.strip()
                if abs(v) >= 1e7:  return f'{v/1e7:.2f}Cr {unit}'.strip()
                return f'{v:,.2f} {unit}'.strip()

            pe   = data.get('pe_ratio')
            eps  = data.get('eps')
            gm   = data.get('gross_margin')
            rev  = data.get('revenue_ttm')
            ni   = data.get('net_income_ttm')
            beta = data.get('beta')
            dy   = data.get('dividend_yield')
            w52h = data.get('week52_high')
            w52l = data.get('week52_low')
            mc   = data.get('market_cap')
            revq = data.get('revenue_q')
            revp = data.get('revenue_q_prev')

            # Chunk 1: Valuation
            val_parts = [f"{sym_label} valuation metrics:"]
            if pe:  val_parts.append(f"P/E ratio is {pe:.1f} ({'cheap' if pe < 15 else 'fair' if pe < 25 else 'expensive'} by historical standards).")
            if eps: val_parts.append(f"Earnings per share (EPS) is {cur} {eps:.2f}.")
            if mc:  val_parts.append(f"Market capitalisation is {_fmtn(mc)} {cur}.")
            store_embedding(conn, symbol, ' '.join(val_parts),
                            source='financials', article_url=f'fin:valuation:{symbol}')

            # Chunk 2: Revenue & Profitability
            prof_parts = [f"{sym_label} revenue and profitability:"]
            if rev: prof_parts.append(f"Trailing twelve-month revenue is {_fmtn(rev)} {cur}.")
            if ni:  prof_parts.append(f"Net income (TTM) is {_fmtn(ni)} {cur}.")
            if gm:  prof_parts.append(f"Gross margin is {gm*100:.1f}% ({'strong' if gm > 0.4 else 'moderate' if gm > 0.2 else 'thin'}).")
            if revq and revp and revp:
                yoy = (revq - revp) / abs(revp) * 100
                prof_parts.append(f"Latest quarter revenue {'grew' if yoy >= 0 else 'fell'} {abs(yoy):.1f}% quarter-over-quarter.")
            if len(prof_parts) > 1:
                store_embedding(conn, symbol, ' '.join(prof_parts),
                                source='financials', article_url=f'fin:profitability:{symbol}')

            # Chunk 3: Risk & Dividend
            risk_parts = [f"{sym_label} risk and dividend profile:"]
            if beta: risk_parts.append(f"Beta is {beta:.2f} ({'defensive' if beta < 0.8 else 'market-correlated' if beta < 1.2 else 'volatile'}).")
            if dy:   risk_parts.append(f"Dividend yield is {dy*100:.2f}%.")
            if w52h and w52l:
                spread = ((w52h - w52l) / w52l * 100) if w52l else 0
                risk_parts.append(f"52-week price range: {w52l:.2f}–{w52h:.2f} {cur} ({spread:.0f}% spread).")
            if len(risk_parts) > 1:
                store_embedding(conn, symbol, ' '.join(risk_parts),
                                source='financials', article_url=f'fin:risk:{symbol}')
    except Exception as e:
        log.warning(f'_embed_financials_bg({symbol}): {e}')

def _embed_price_history_bg(symbol: str, name: str = ''):
    """Embed a price-performance narrative derived from cached history."""
    try:
        with thread_connection() as conn:
            label = name or symbol
            narratives = []
            for rng, label_str in [('1mo', '1 month'), ('3mo', '3 months'), ('1y', '1 year')]:
                rows = conn.execute(
                    'SELECT close, ts FROM history WHERE symbol=? AND range_key=? '
                    'ORDER BY ts ASC', (symbol, rng)
                ).fetchall()
                if len(rows) < 2:
                    continue
                start_p = rows[0]['close']
                end_p   = rows[-1]['close']
                if not start_p or start_p == 0:
                    continue
                chg_pct = (end_p - start_p) / start_p * 100
                direction = 'gained' if chg_pct >= 0 else 'lost'
                highs = [r['close'] for r in rows]
                period_high = max(highs)
                period_low  = min(highs)
                narrative = (
                    f"{label} ({symbol}) {direction} {abs(chg_pct):.1f}% over the past {label_str}, "
                    f"moving from {start_p:.2f} to {end_p:.2f}. "
                    f"Period high: {period_high:.2f}, period low: {period_low:.2f}."
                )
                narratives.append((narrative, rng))

            for text, rng in narratives:
                store_embedding(conn, symbol, text,
                                source='price_history',
                                article_url=f'history:{symbol}:{rng}')
    except Exception as e:
        log.warning(f'_embed_price_history_bg({symbol}): {e}')

def _rag_ingest_symbol(symbol: str):
    """Full RAG ingestion for one symbol. Uses thread_connection (safe outside Flask requests).
    Fetches live data when the DB cache is cold."""
    try:
        with thread_connection() as conn:
            # ── Profile ───────────────────────────────────────────────────────
            p = row_to_dict(conn.execute('SELECT * FROM profiles WHERE symbol=?', (symbol,)).fetchone())
            if not p or not p.get('description'):
                p = fetch_profile(symbol)
                if p and p.get('description'):
                    conn.execute("""
                        INSERT OR REPLACE INTO profiles
                            (symbol,name,sector,industry,exchange,currency,website,description,
                             employees,country,logo_url,fetched_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (symbol, p.get('name'), p.get('sector'), p.get('industry'),
                          p.get('exchange'), p.get('currency'), p.get('website'),
                          p.get('description'), p.get('employees'), p.get('country'),
                          p.get('logo_url'), now_ts()))
                    conn.commit()
            if p and p.get('description'):
                _embed_profile_bg(symbol, p)

            # ── Financials ────────────────────────────────────────────────────
            f = row_to_dict(conn.execute('SELECT * FROM financials WHERE symbol=?', (symbol,)).fetchone())
            if not f:
                f = fetch_financials(symbol)
                if f:
                    conn.execute("""
                        INSERT OR REPLACE INTO financials
                            (symbol,market_cap,revenue_ttm,revenue_q,revenue_q_prev,
                             net_income_ttm,gross_margin,pe_ratio,eps,dividend_yield,
                             beta,week52_high,week52_low,avg_volume,fetched_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (symbol, f.get('market_cap'), f.get('revenue_ttm'), f.get('revenue_q'),
                          f.get('revenue_q_prev'), f.get('net_income_ttm'), f.get('gross_margin'),
                          f.get('pe_ratio'), f.get('eps'), f.get('dividend_yield'),
                          f.get('beta'), f.get('week52_high'), f.get('week52_low'),
                          f.get('avg_volume'), now_ts()))
                    conn.commit()
            if f:
                _embed_financials_bg(symbol, f)

            # ── News ──────────────────────────────────────────────────────────
            news = rows_to_list(conn.execute(
                'SELECT title,source,url,published,summary,category FROM news '
                'WHERE symbol=? ORDER BY published DESC LIMIT 30', (symbol,)
            ).fetchall())
            if not news:
                name_for_news = (p.get('name') if p else None) or symbol
                rss  = fetch_news(symbol, name_for_news)
                fh   = fetch_finnhub_news(symbol)
                yf_n = fetch_yf_news(symbol) if not (rss or fh) else []
                all_ = {a['url']: a for a in (rss + fh + yf_n) if a.get('url')}.values()
                news = sorted(all_, key=lambda x: x['published'], reverse=True)[:30]
                if news:
                    conn.executemany("""
                        INSERT OR IGNORE INTO news
                            (symbol,source,title,url,published,summary,relevance,category,fetched_at)
                        VALUES (?,?,?,?,?,?,?,?,?)
                    """, [(symbol, a['source'], a['title'], a['url'], a['published'],
                           a.get('summary'), a.get('relevance','medium'), a.get('category','gen'),
                           now_ts()) for a in news])
                    conn.commit()
            if news:
                _embed_articles_bg(symbol, list(news))

            # ── Price history narrative ────────────────────────────────────────
            for rng in ('1mo', '3mo', '1y'):
                cached = conn.execute(
                    'SELECT COUNT(*) as n FROM history WHERE symbol=? AND range_key=?',
                    (symbol, rng)
                ).fetchone()['n']
                if not cached:
                    pts = fetch_history(symbol, rng)  # returns list of dicts
                    if pts:
                        rows_hist = [(symbol, rng, p['ts'],
                                      p.get('open'), p.get('high'), p.get('low'),
                                      p.get('close'), p.get('volume')) for p in pts]
                        conn.executemany("""
                            INSERT OR IGNORE INTO history
                                (symbol,range_key,ts,open,high,low,close,volume)
                            VALUES (?,?,?,?,?,?,?,?)
                        """, rows_hist)
                        conn.commit()

            name = (p.get('name') if p else None) or symbol
            _embed_price_history_bg(symbol, name)

        log.info(f'RAG ingestion complete for {symbol}')
    except Exception as e:
        log.warning(f'_rag_ingest_symbol({symbol}): {e}')

# ── India large-cap screener universe (Nifty 100 + select large caps) ────────
INDIA_LARGE_CAP = [
    # Nifty 50
    'ADANIENT.NS','ADANIPORTS.NS','APOLLOHOSP.NS','ASIANPAINT.NS','AXISBANK.NS',
    'BAJAJ-AUTO.NS','BAJFINANCE.NS','BAJAJFINSV.NS','BHARTIARTL.NS','BPCL.NS',
    'BRITANNIA.NS','CIPLA.NS','COALINDIA.NS','DIVISLAB.NS','DRREDDY.NS',
    'EICHERMOT.NS','GRASIM.NS','HCLTECH.NS','HDFCBANK.NS','HDFCLIFE.NS',
    'HEROMOTOCO.NS','HINDALCO.NS','HINDUNILVR.NS','ICICIBANK.NS','INDUSINDBK.NS',
    'INFY.NS','ITC.NS','JSWSTEEL.NS','KOTAKBANK.NS','LT.NS',
    'M&M.NS','MARUTI.NS','NESTLEIND.NS','NTPC.NS','ONGC.NS',
    'POWERGRID.NS','RELIANCE.NS','SBILIFE.NS','SBIN.NS','SHRIRAMFIN.NS',
    'SUNPHARMA.NS','TATACONSUM.NS','TATAMOTORS.NS','TATASTEEL.NS','TCS.NS',
    'TECHM.NS','TITAN.NS','ULTRACEMCO.NS','WIPRO.NS','ZOMATO.NS',
    # Nifty Next 50
    'ABB.NS','ADANIGREEN.NS','AMBUJACEM.NS','AUROPHARMA.NS','BANKBARODA.NS',
    'BEL.NS','BERGEPAINT.NS','BOSCHLTD.NS','CANBK.NS','CHOLAFIN.NS',
    'COLPAL.NS','DMART.NS','GAIL.NS','GODREJCP.NS','HAL.NS',
    'HAVELLS.NS','INDIGO.NS','IOC.NS','IRCTC.NS','JINDALSTEL.NS',
    'LICI.NS','LTIM.NS','LUPIN.NS','MARICO.NS','MOTHERSON.NS',
    'MPHASIS.NS','NHPC.NS','NMDC.NS','NYKAA.NS','OFSS.NS',
    'PAGEIND.NS','PERSISTENT.NS','PETRONET.NS','PIDILITIND.NS','PNB.NS',
    'POLYCAB.NS','RECLTD.NS','SAIL.NS','SIEMENS.NS','TATAPOWER.NS',
    'TORNTPHARM.NS','TRENT.NS','UBL.NS','UNIONBANK.NS','VEDL.NS',
    'VBL.NS','ZYDUSLIFE.NS',
    # Additional Nifty 100
    'DABUR.NS','DLF.NS','GODREJPROP.NS','HPCL.NS','INDHOTEL.NS',
    'IRFC.NS','JUBLFOOD.NS','LICHSGFIN.NS','MAXHEALTH.NS','NAUKRI.NS',
    'PFC.NS','PIIND.NS','PRESTIGE.NS','SUNTV.NS','TORNTPOWER.NS',
    'VOLTAS.NS','MCDOWELL-N.NS','OBEROIRLTY.NS','ATGL.NS','CGPOWER.NS',
]

SCREENER_TTL = 6 * 3600  # 6-hour cache

def _screener_fetch_one(sym: str) -> dict | None:
    """Fetch one stock for the value-picks screener. Returns None if disqualified."""
    try:
        t  = yf.Ticker(sym)
        fi = t.fast_info
        price   = getattr(fi, 'last_price',  None)
        mkt_cap = getattr(fi, 'market_cap',  None)
        # yfinance 1.3+ renamed fifty_two_week_high → year_high
        w52h    = getattr(fi, 'year_high',   None)
        w52l    = getattr(fi, 'year_low',    None)

        if not price or not mkt_cap or not w52h or w52h <= 0:
            return None

        mkt_cap_cr = mkt_cap / 1e7
        if mkt_cap_cr < 50000:          # < ₹50,000 Cr → skip
            return None

        decline = ((w52h - price) / w52h) * 100
        if decline < 20:                # not fallen ≥20% from 52W peak
            return None

        # Qualifies on price/mktcap — now fetch fundamentals
        info = t.info
        eps         = info.get('trailingEps')      or 0
        gross_m     = info.get('grossMargins')     or 0
        net_m       = info.get('profitMargins')    or 0
        pe          = info.get('trailingPE')
        roe         = info.get('returnOnEquity')
        revenue     = info.get('totalRevenue')
        beta        = info.get('beta')
        de_ratio    = info.get('debtToEquity')
        curr_ratio  = info.get('currentRatio')

        if eps <= 0:                    # must be profitable
            return None
        if gross_m < 0.15:             # gross margin < 15% → weak business
            return None

        return {
            'symbol':       sym,
            'name':         info.get('longName') or info.get('shortName', sym),
            'sector':       info.get('sector', ''),
            'industry':     info.get('industry', ''),
            'price':        round(float(price), 2),
            'week52_high':  round(float(w52h), 2),
            'week52_low':   round(float(w52l), 2) if w52l else None,
            'decline_pct':  round(decline, 1),
            'mkt_cap_cr':   round(mkt_cap_cr, 0),
            'pe_ratio':     round(pe, 1)        if pe        else None,
            'eps':          round(eps, 2),
            'gross_margin': round(gross_m * 100, 1),
            'net_margin':   round(net_m  * 100, 1) if net_m  else None,
            'roe':          round(roe    * 100, 1) if roe    else None,
            'revenue_cr':   round(revenue / 1e7, 0) if revenue else None,
            'beta':         round(beta, 2)       if beta      else None,
            'de_ratio':     round(de_ratio / 100, 2) if de_ratio else None,
            'curr_ratio':   round(curr_ratio, 2) if curr_ratio else None,
        }
    except Exception as e:
        log.warning(f'Screener {sym}: {e}')
        return None

def _run_value_picks() -> list:
    from concurrent.futures import ThreadPoolExecutor
    # Keep workers low — Render free tier has 0.1 CPU / 512 MB RAM
    results = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for item in ex.map(_screener_fetch_one, INDIA_LARGE_CAP):
            if item:
                results.append(item)
    results.sort(key=lambda x: x['decline_pct'], reverse=True)
    return results

# ── Background screener state ────────────────────────────────────────────────
_screener_running = False
_screener_lock    = threading.Lock()

def _run_screener_bg():
    """Run value-picks screener in a background thread and persist results."""
    global _screener_running
    with _screener_lock:
        if _screener_running:
            return
        _screener_running = True
    try:
        log.info('Background screener: scanning %d stocks…', len(INDIA_LARGE_CAP))
        results = _run_value_picks()
        with thread_connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO screener_cache (screener_id, results, fetched_at) VALUES (?,?,?)",
                ('value-picks', json.dumps(results), now_ts())
            )
            conn.commit()
        log.info('Background screener: done — %d qualifying stocks', len(results))
    except Exception as e:
        log.error(f'Background screener failed: {e}')
    finally:
        with _screener_lock:
            _screener_running = False

def _maybe_start_screener():
    """Start background screener if cache is missing or stale."""
    try:
        with thread_connection() as conn:
            row = conn.execute(
                "SELECT fetched_at FROM screener_cache WHERE screener_id='value-picks'"
            ).fetchone()
            if row and not stale(row['fetched_at'], SCREENER_TTL):
                return  # cache is fresh — no need to run
    except Exception:
        pass
    threading.Thread(target=_run_screener_bg, daemon=True).start()

# ── yfinance wrappers ────────────────────────────────────────────────────────
RANGE_MAP = {
    '1d':  ('1d',  '5m'),
    '5d':  ('5d',  '60m'),
    '1mo': ('1mo', '1d'),
    '3mo': ('3mo', '1d'),
    '1y':  ('1y',  '1wk'),
    '5y':  ('5y',  '1mo'),
}

_YF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
}

def _quote_from_yf(symbol: str) -> dict | None:
    """Source 1 — yfinance fast_info (lightweight JSON, ~100 ms)."""
    try:
        fi = yf.Ticker(symbol).fast_info
        price      = getattr(fi, 'last_price',                None)
        prev_close = getattr(fi, 'previous_close',            None)
        if price is None: price = prev_close   # market closed fallback
        if price is None: return None
        opn     = getattr(fi, 'open',                     None)
        high    = getattr(fi, 'day_high',                 None)
        low     = getattr(fi, 'day_low',                  None)
        volume  = getattr(fi, 'three_month_average_volume', None)
        mkt_cap = getattr(fi, 'market_cap',               None)
        currency = getattr(fi, 'currency', None) or ('INR' if '.NS' in symbol or '.BO' in symbol else 'USD')
        change     = round(price - prev_close, 2) if prev_close else 0
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
        return {
            'symbol': symbol, 'price': round(float(price), 2),
            'open':   round(float(opn), 2) if opn else None,
            'high':   round(float(high), 2) if high else None,
            'low':    round(float(low), 2)  if low  else None,
            'prev_close': round(float(prev_close), 2) if prev_close else None,
            'change': change, 'change_pct': change_pct,
            'volume': int(volume) if volume else None,
            'mkt_cap': float(mkt_cap) if mkt_cap else None,
            'currency': currency, '_source': 'yfinance',
        }
    except Exception as e:
        log.debug(f'_quote_from_yf({symbol}): {e}')
        return None


def _quote_from_yf_direct(symbol: str) -> dict | None:
    """Source 2 — Yahoo Finance chart API via direct HTTP (bypasses yfinance library issues)."""
    try:
        url = f'https://query2.finance.yahoo.com/v8/finance/chart/{symbol}'
        r   = http_requests.get(url, params={'interval': '1d', 'range': '5d'},
                                headers=_YF_HEADERS, timeout=12)
        if r.status_code != 200:
            return None
        data   = r.json()
        result = (data.get('chart') or {}).get('result') or []
        if not result:
            return None
        meta   = result[0].get('meta', {})
        price  = meta.get('regularMarketPrice') or meta.get('previousClose')
        if not price:
            return None
        prev_close = meta.get('chartPreviousClose') or meta.get('previousClose')
        currency   = meta.get('currency', 'INR' if '.NS' in symbol or '.BO' in symbol else 'USD')
        change     = round(price - prev_close, 2) if prev_close else 0
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
        return {
            'symbol': symbol, 'price': round(float(price), 2),
            'open':   round(float(meta.get('regularMarketOpen', price)), 2),
            'high':   round(float(meta.get('regularMarketDayHigh', price)), 2),
            'low':    round(float(meta.get('regularMarketDayLow', price)), 2),
            'prev_close': round(float(prev_close), 2) if prev_close else None,
            'change': change, 'change_pct': change_pct,
            'volume': meta.get('regularMarketVolume'),
            'mkt_cap': meta.get('marketCap'),
            'currency': currency, '_source': 'yahoo-direct',
        }
    except Exception as e:
        log.debug(f'_quote_from_yf_direct({symbol}): {e}')
        return None


def _stooq_symbol(symbol: str) -> str:
    """Map a Yahoo Finance symbol to its Stooq equivalent."""
    s = symbol.upper()
    if s.endswith('.NS') or s.endswith('.BO'):
        return s.lower()          # stooq accepts reliance.ns directly
    if '.' not in s:
        return s.lower() + '.us'  # US stocks need .us suffix on stooq
    return s.lower()


def _quote_from_stooq(symbol: str) -> dict | None:
    """Source 3 — Stooq.com CSV API (independent data provider)."""
    try:
        import io, csv
        sq = _stooq_symbol(symbol)
        r  = http_requests.get(f'https://stooq.com/q/d/l/?s={sq}&i=d',
                               headers=_YF_HEADERS, timeout=12)
        if r.status_code != 200 or 'No data' in r.text or not r.text.strip():
            return None
        rows = list(csv.DictReader(io.StringIO(r.text)))
        if len(rows) < 1:
            return None
        last = rows[-1]
        prev = rows[-2] if len(rows) >= 2 else last
        price  = float(last.get('Close') or 0)
        if not price:
            return None
        prev_close = float(prev.get('Close') or price)
        opn  = float(last.get('Open')   or price)
        high = float(last.get('High')   or price)
        low  = float(last.get('Low')    or price)
        vol  = int(float(last.get('Volume') or 0)) or None
        currency = 'INR' if '.NS' in symbol or '.BO' in symbol else 'USD'
        change     = round(price - prev_close, 2)
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0
        return {
            'symbol': symbol, 'price': round(price, 2),
            'open': round(opn, 2), 'high': round(high, 2), 'low': round(low, 2),
            'prev_close': round(prev_close, 2),
            'change': change, 'change_pct': change_pct,
            'volume': vol, 'mkt_cap': None, 'currency': currency,
            '_source': 'stooq',
        }
    except Exception as e:
        log.debug(f'_quote_from_stooq({symbol}): {e}')
        return None


def fetch_quote(symbol: str) -> dict | None:
    """Try three sources in order; return first successful result."""
    for fn in (_quote_from_yf, _quote_from_yf_direct, _quote_from_stooq):
        try:
            data = fn(symbol)
            if data:
                if fn is not _quote_from_yf:
                    log.info(f'fetch_quote({symbol}): used fallback {data.get("_source")}')
                return data
        except Exception as e:
            log.debug(f'fetch_quote {fn.__name__} error: {e}')
    log.warning(f'fetch_quote({symbol}): all sources failed')
    return None

def _history_from_stooq(symbol: str, range_key: str) -> list:
    """Stooq fallback for price history — returns daily OHLCV rows."""
    try:
        import io, csv
        from datetime import date, timedelta
        days = {'1d': 2, '5d': 7, '1mo': 35, '3mo': 95, '1y': 370, '5y': 1830}
        n    = days.get(range_key, 35)
        end  = date.today()
        beg  = end - timedelta(days=n)
        sq   = _stooq_symbol(symbol)
        url  = (f'https://stooq.com/q/d/l/?s={sq}'
                f'&d1={beg.strftime("%Y%m%d")}&d2={end.strftime("%Y%m%d")}&i=d')
        r    = http_requests.get(url, headers=_YF_HEADERS, timeout=12)
        if r.status_code != 200 or 'No data' in r.text:
            return []
        rows = []
        for rec in csv.DictReader(io.StringIO(r.text)):
            try:
                import calendar
                dt = rec.get('Date', '')
                if not dt:
                    continue
                y, m, d2 = int(dt[:4]), int(dt[5:7]), int(dt[8:10])
                ts = int(calendar.timegm((y, m, d2, 0, 0, 0, 0, 0, 0)))
                rows.append({
                    'ts':     ts,
                    'open':   round(float(rec['Open']),   2),
                    'high':   round(float(rec['High']),   2),
                    'low':    round(float(rec['Low']),    2),
                    'close':  round(float(rec['Close']),  2),
                    'volume': int(float(rec.get('Volume') or 0)),
                })
            except Exception:
                continue
        return rows
    except Exception as e:
        log.debug(f'_history_from_stooq({symbol}): {e}')
        return []


def fetch_history(symbol: str, range_key: str) -> list:
    """Source 1: yfinance; fallback: Stooq CSV."""
    period, interval = RANGE_MAP.get(range_key, ('1mo', '1d'))
    try:
        t  = yf.Ticker(symbol)
        df = t.history(period=period, interval=interval, auto_adjust=True)
        if not df.empty:
            rows = []
            for ts, row in df.iterrows():
                try:
                    ts_int = int(ts.timestamp())
                except (ValueError, OSError):
                    continue
                rows.append({
                    'ts':     ts_int,
                    'open':   round(float(row['Open']),  2),
                    'high':   round(float(row['High']),  2),
                    'low':    round(float(row['Low']),   2),
                    'close':  round(float(row['Close']), 2),
                    'volume': int(row['Volume']) if row['Volume'] else 0,
                })
            if rows:
                return rows
    except Exception as e:
        log.warning(f'fetch_history yfinance ({symbol},{range_key}): {e}')

    # Fallback: Stooq
    rows = _history_from_stooq(symbol, range_key)
    if rows:
        log.info(f'fetch_history({symbol},{range_key}): used stooq fallback')
    return rows

def fetch_profile(symbol: str) -> dict | None:
    try:
        fi = yf.Ticker(symbol).info
        return {
            'symbol':      symbol,
            'name':        fi.get('longName') or fi.get('shortName', symbol),
            'sector':      fi.get('sector'),
            'industry':    fi.get('industry'),
            'exchange':    fi.get('exchange'),
            'currency':    fi.get('currency'),
            'website':     fi.get('website'),
            'description': fi.get('longBusinessSummary'),
            'employees':   fi.get('fullTimeEmployees'),
            'country':     fi.get('country'),
            'logo_url':    fi.get('logo_url'),
        }
    except Exception as e:
        log.warning(f'fetch_profile({symbol}): {e}')
        return None

def fetch_financials(symbol: str) -> dict | None:
    try:
        t  = yf.Ticker(symbol)
        fi = t.info
        # quarterly revenue
        rev_q = rev_q_prev = None
        try:
            qfin = t.quarterly_financials
            if not qfin.empty and 'Total Revenue' in qfin.index:
                vals = qfin.loc['Total Revenue'].dropna().values
                if len(vals) >= 1: rev_q      = float(vals[0])
                if len(vals) >= 2: rev_q_prev = float(vals[1])
        except: pass

        return {
            'symbol':         symbol,
            'market_cap':     fi.get('marketCap'),
            'revenue_ttm':    fi.get('totalRevenue'),
            'revenue_q':      rev_q,
            'revenue_q_prev': rev_q_prev,
            'net_income_ttm': fi.get('netIncomeToCommon'),
            'gross_margin':   fi.get('grossMargins'),
            'pe_ratio':       fi.get('trailingPE'),
            'eps':            fi.get('trailingEps'),
            'dividend_yield': fi.get('dividendYield'),
            'beta':           fi.get('beta'),
            'week52_high':    fi.get('fiftyTwoWeekHigh'),
            'week52_low':     fi.get('fiftyTwoWeekLow'),
            'avg_volume':     fi.get('averageVolume'),
        }
    except Exception as e:
        log.warning(f'fetch_financials({symbol}): {e}')
        return None

# ── RSS news ─────────────────────────────────────────────────────────────────
RSS_FEEDS = [
    # ── Core Indian market feeds ─────────────────────────────────────────────
    ('Economic Times',    'https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2143429.cms'),
    ('Moneycontrol',      'https://www.moneycontrol.com/rss/MCtopnews.xml'),
    ('Business Standard', 'https://www.business-standard.com/rss/markets-106.rss'),
    ('LiveMint',          'https://www.livemint.com/rss/markets'),
    ('CNBC TV18',         'https://www.cnbctv18.com/commonfeeds/v1/eng/rss/market.xml'),
    # ── Earnings & quarterly results ─────────────────────────────────────────
    ('Financial Express', 'https://www.financialexpress.com/market/feed/'),
    ('Hindu BusinessLine','https://www.thehindubusinessline.com/markets/feeder/default.rss'),
    ('ET Earnings',       'https://economictimes.indiatimes.com/markets/earnings/rssfeeds/2143522.cms'),
    # ── Contracts, orders, sector news ───────────────────────────────────────
    ('ET Industry',       'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms'),
    ('ET Technology',     'https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms'),
    ('ET Auto',           'https://economictimes.indiatimes.com/industry/auto/rssfeeds/19430249.cms'),
    ('PIB India',         'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3'),
    ('BQ Prime',          'https://www.bqprime.com/feeds/rss.xml'),
    ('Business Today',    'https://www.businesstoday.in/rss/story.xml'),
    # ── Wire services & global coverage ──────────────────────────────────────
    ('Reuters India',     'https://feeds.reuters.com/reuters/INbusinessNews'),
    ('Reuters Business',  'https://feeds.reuters.com/reuters/businessNews'),
    ('BSE Corporate',     'https://www.bseindia.com/xml-data/corpfiling/AttachLive/rss.xml'),
]

# ── Contract & quarterly-results keyword sets ────────────────────────────────
_CONTRACT_KEYWORDS = {
    'contract', 'order', 'tender', 'wins', 'win', 'awarded', 'award',
    'ministry', 'l1', 'loi', 'letter of intent', 'work order', 'mou',
    'memorandum', 'agreement worth', 'project worth', 'valued at',
    'defence contract', 'government contract', 'supply order',
    'procurement', 'bid', 'railway', 'nhai', 'nmrc', 'drdo', 'commissioned',
}
_QUARTERLY_KEYWORDS = {
    'quarterly result', 'q1', 'q2', 'q3', 'q4', 'fy25', 'fy26',
    'net income', 'ebitda', 'pat', 'consolidated results', 'standalone results',
    'results declared', 'board meeting', 'dividend declared',
    'annual report', 'margin expansion', 'beat estimates', 'missed estimates',
}

def _categorize_news(article: dict) -> str:
    """Classify article into: contract, results, acq, earn, part, gen."""
    text = (article.get('title', '') + ' ' + article.get('summary', '')).lower()
    if any(k in text for k in _CONTRACT_KEYWORDS):
        return 'contract'
    if any(k in text for k in _QUARTERLY_KEYWORDS):
        return 'results'
    if re.search(r'acqui|takeover|buyout|merger', text):
        return 'acq'
    if re.search(r'earning|revenue|profit|eps|guidance', text):
        return 'earn'
    if re.search(r'partner|deal|collaborat', text):
        return 'part'
    return 'gen'

RSS_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
}

# Words too generic to match on — would pull in unrelated companies
_GENERIC_BIZ_WORDS = {
    'ltd','limited','india','corp','inc','the','and','of','co','pvt',
    'private','public','industries','industry','technologies','technology',
    'services','service','bank','banking','enterprises','enterprise',
    'holdings','holding','group','finance','financial','pharma',
    'pharmaceutical','energy','power','infra','infrastructure',
    'solutions','systems','global','international','national',
    'capital','investment','asset','management','resources','products',
    'chemicals','metals','steel','cement','oil','gas','auto',
}

def _extract_keywords(symbol: str, name: str) -> tuple[str, list[str]]:
    """Return (ticker, meaningful_keywords) — ticker is the base NSE/BSE symbol."""
    ticker = symbol.replace('.NS','').replace('.BO','').lower()
    words  = [w for w in name.lower()
              .replace('(',' ').replace(')',' ').replace('.',' ').replace('&',' ').split()
              if len(w) >= 3 and w not in _GENERIC_BIZ_WORDS]
    return ticker, list(dict.fromkeys([ticker] + words))

def _fetch_rss(url: str) -> list:
    """Fetch RSS via requests (bypasses SSL cert issues) then parse with feedparser."""
    try:
        r = http_requests.get(url, headers=RSS_HEADERS, timeout=12)
        r.raise_for_status()
        feed = feedparser.parse(r.content)
        return feed.entries
    except Exception as e:
        log.warning(f'RSS fetch {url}: {e}')
        return []

def _article_relevance(text: str, ticker: str, keywords: list[str]) -> str | None:
    """
    Returns 'high' if ticker appears in text,
            'medium' if 2+ unique non-ticker keywords match,
            None if not relevant.
    """
    if ticker in text:
        return 'high'
    non_ticker_kws = [k for k in keywords if k != ticker]
    if sum(1 for k in non_ticker_kws if k in text) >= 2:
        return 'medium'
    return None

def fetch_news(symbol: str, name: str, max_items: int = 30) -> list:
    ticker, keywords = _extract_keywords(symbol, name)
    articles = []
    for source, url in RSS_FEEDS:
        try:
            entries = _fetch_rss(url)
            for entry in entries[:80]:
                title   = entry.get('title', '')
                summary = entry.get('summary', '') or entry.get('description', '')
                # Check headline first (stricter), then combined text
                headline_text = title.lower()
                full_text     = (title + ' ' + summary).lower()
                relevance = _article_relevance(headline_text, ticker, keywords) \
                         or _article_relevance(full_text, ticker, keywords)
                if not relevance:
                    continue
                pub = entry.get('published_parsed')
                ts  = int(time.mktime(pub)) if pub else now_ts()
                art = {
                    'source':    source,
                    'title':     title,
                    'url':       entry.get('link', ''),
                    'published': ts,
                    'summary':   summary[:400],
                    'relevance': relevance,
                }
                art['category'] = _categorize_news(art)
                articles.append(art)
        except Exception as e:
            log.warning(f'RSS parse {source}: {e}')
    articles.sort(key=lambda x: x['published'], reverse=True)
    return articles[:max_items]

def fetch_finnhub_news(symbol: str) -> list:
    """Pull from Finnhub news endpoint as bonus source."""
    try:
        api_key = os.environ.get('FINNHUB_API_KEY', '')
        if not api_key:
            return []
        base    = symbol.replace('.NS','').replace('.BO','')
        fh_sym  = f"NSE:{base}" if '.NS' in symbol else (f"BSE:{base}" if '.BO' in symbol else symbol)
        from datetime import timezone
        today   = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        from_dt = (datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%d')
        url     = f"https://finnhub.io/api/v1/company-news?symbol={fh_sym}&from={from_dt}&to={today}&token={api_key}"
        r = http_requests.get(url, timeout=10)
        r.raise_for_status()
        items = r.json()
        ticker, keywords = _extract_keywords(symbol, symbol)
        result = []
        for it in (items if isinstance(items, list) else [])[:20]:
            headline = it.get('headline', '')
            relevance = _article_relevance(headline.lower(), ticker, keywords) or 'high'
            art = {
                'source':    it.get('source', 'Finnhub'),
                'title':     headline,
                'url':       it.get('url', ''),
                'published': it.get('datetime', now_ts()),
                'summary':   it.get('summary', '')[:400],
                'relevance': relevance,
            }
            art['category'] = _categorize_news(art)
            result.append(art)
        return result
    except Exception as e:
        log.warning(f'Finnhub news ({symbol}): {e}')
        return []

def fetch_yf_news(symbol: str) -> list:
    """yfinance built-in news — no API key needed, works for US symbols."""
    try:
        items = yf.Ticker(symbol).news or []
        result = []
        for it in items[:20]:
            content = it.get('content', {})
            title   = content.get('title', '') or it.get('title', '')
            if not title:
                continue
            pub_raw  = content.get('pubDate', '') or it.get('providerPublishTime', '')
            try:
                import email.utils
                ts = int(email.utils.parsedate_to_datetime(pub_raw).timestamp()) if isinstance(pub_raw, str) else int(pub_raw)
            except Exception:
                ts = now_ts()
            summary  = content.get('summary', '') or it.get('summary', '')
            provider = content.get('provider', {}).get('displayName', '') or it.get('publisher', 'Yahoo Finance')
            url      = (content.get('canonicalUrl', {}) or {}).get('url', '') or it.get('link', '')
            art = {
                'source':    provider or 'Yahoo Finance',
                'title':     title,
                'url':       url,
                'published': ts,
                'summary':   str(summary)[:400],
                'relevance': 'high',
            }
            art['category'] = _categorize_news(art)
            result.append(art)
        return result
    except Exception as e:
        log.warning(f'yf_news ({symbol}): {e}')
        return []

# ── API Routes ───────────────────────────────────────────────────────────────

@app.route('/api/quote/<path:symbol>')
def api_quote(symbol):
    db = get_db()
    row = row_to_dict(db.execute('SELECT * FROM quotes WHERE symbol=?', (symbol,)).fetchone())
    if row and not stale(row['fetched_at'], CACHE_TTL):
        return jsonify({'ok': True, 'data': row, 'cached': True})

    data = fetch_quote(symbol)
    if not data:
        # return stale cache if we have it
        if row:
            return jsonify({'ok': True, 'data': row, 'cached': True, 'stale': True})
        return jsonify({'ok': False, 'error': 'No data'}), 404

    db.execute("""
        INSERT OR REPLACE INTO quotes
            (symbol,price,open,high,low,prev_close,change,change_pct,volume,mkt_cap,currency,fetched_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, (symbol, data['price'], data['open'], data['high'], data['low'],
          data['prev_close'], data['change'], data['change_pct'],
          data['volume'], data['mkt_cap'], data['currency'], now_ts()))
    db.commit()
    return jsonify({'ok': True, 'data': data})

@app.route('/api/history/<path:symbol>')
def api_history(symbol):
    range_key = request.args.get('range', '1mo')
    db = get_db()

    # check freshness via newest row
    newest = db.execute(
        'SELECT MAX(ts) as ts FROM history WHERE symbol=? AND range_key=?',
        (symbol, range_key)
    ).fetchone()
    newest_ts = newest['ts'] if newest and newest['ts'] else 0

    if not stale(newest_ts, HIST_TTL):
        rows = rows_to_list(db.execute(
            'SELECT ts,open,high,low,close,volume FROM history WHERE symbol=? AND range_key=? ORDER BY ts ASC',
            (symbol, range_key)
        ).fetchall())
        return jsonify({'ok': True, 'data': rows, 'cached': True})

    pts = fetch_history(symbol, range_key)
    if not pts:
        # serve stale
        rows = rows_to_list(db.execute(
            'SELECT ts,open,high,low,close,volume FROM history WHERE symbol=? AND range_key=? ORDER BY ts ASC',
            (symbol, range_key)
        ).fetchall())
        if rows:
            return jsonify({'ok': True, 'data': rows, 'stale': True})
        return jsonify({'ok': False, 'error': 'No history'}), 404

    # bulk upsert
    db.executemany("""
        INSERT OR IGNORE INTO history (symbol,range_key,ts,open,high,low,close,volume)
        VALUES (?,?,?,?,?,?,?,?)
    """, [(symbol, range_key, p['ts'], p['open'], p['high'], p['low'], p['close'], p['volume']) for p in pts])
    db.commit()
    return jsonify({'ok': True, 'data': pts})

@app.route('/api/profile/<path:symbol>')
def api_profile(symbol):
    db = get_db()
    row = row_to_dict(db.execute('SELECT * FROM profiles WHERE symbol=?', (symbol,)).fetchone())
    if row and not stale(row['fetched_at'], 3600 * 12):  # profiles stale after 12h
        return jsonify({'ok': True, 'data': row, 'cached': True})

    data = fetch_profile(symbol)
    if not data:
        if row: return jsonify({'ok': True, 'data': row, 'stale': True})
        return jsonify({'ok': False, 'error': 'No profile'}), 404

    db.execute("""
        INSERT OR REPLACE INTO profiles
            (symbol,name,sector,industry,exchange,currency,website,description,employees,country,logo_url,fetched_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, (symbol, data['name'], data['sector'], data['industry'], data['exchange'],
          data['currency'], data['website'], data['description'],
          data['employees'], data['country'], data['logo_url'], now_ts()))
    db.commit()
    if data.get('description'):
        threading.Thread(target=_embed_profile_bg, args=(symbol, data), daemon=True).start()
    return jsonify({'ok': True, 'data': data})

@app.route('/api/financials/<path:symbol>')
def api_financials(symbol):
    db = get_db()
    row = row_to_dict(db.execute('SELECT * FROM financials WHERE symbol=?', (symbol,)).fetchone())
    if row and not stale(row['fetched_at'], 3600 * 6):  # financials stale after 6h
        return jsonify({'ok': True, 'data': row, 'cached': True})

    data = fetch_financials(symbol)
    if not data:
        if row: return jsonify({'ok': True, 'data': row, 'stale': True})
        return jsonify({'ok': False, 'error': 'No financials'}), 404

    db.execute("""
        INSERT OR REPLACE INTO financials
            (symbol,market_cap,revenue_ttm,revenue_q,revenue_q_prev,
             net_income_ttm,gross_margin,pe_ratio,eps,dividend_yield,
             beta,week52_high,week52_low,avg_volume,fetched_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (symbol, data['market_cap'], data['revenue_ttm'], data['revenue_q'],
          data['revenue_q_prev'], data['net_income_ttm'], data['gross_margin'],
          data['pe_ratio'], data['eps'], data['dividend_yield'],
          data['beta'], data['week52_high'], data['week52_low'],
          data['avg_volume'], now_ts()))
    db.commit()
    threading.Thread(target=_embed_financials_bg, args=(symbol, data), daemon=True).start()
    return jsonify({'ok': True, 'data': data})

@app.route('/api/news/<path:symbol>')
def api_news(symbol):
    db    = get_db()
    name  = request.args.get('name', symbol)

    newest = db.execute(
        'SELECT MAX(fetched_at) as fa FROM news WHERE symbol=?', (symbol,)
    ).fetchone()
    newest_fa = newest['fa'] if newest and newest['fa'] else 0

    if not stale(newest_fa, NEWS_TTL):
        rows = rows_to_list(db.execute(
            'SELECT source,title,url,published,summary,relevance,category FROM news WHERE symbol=? ORDER BY published DESC LIMIT 40',
            (symbol,)
        ).fetchall())
        return jsonify({'ok': True, 'data': rows, 'cached': True})

    rss_news = fetch_news(symbol, name)
    fh_news  = fetch_finnhub_news(symbol)
    all_news = {a['url']: a for a in (rss_news + fh_news) if a['url']}.values()
    articles = sorted(all_news, key=lambda x: x['published'], reverse=True)[:40]

    if articles:
        db.executemany("""
            INSERT OR IGNORE INTO news (symbol,source,title,url,published,summary,relevance,category,fetched_at)
            VALUES (?,?,?,?,?,?,?,?,?)
        """, [(symbol, a['source'], a['title'], a['url'], a['published'],
               a['summary'], a.get('relevance','medium'), a.get('category','gen'), now_ts())
              for a in articles])
        db.commit()
        # Background: embed articles for RAG
        threading.Thread(target=_embed_articles_bg,
                         args=(symbol, list(articles)), daemon=True).start()

    return jsonify({'ok': True, 'data': list(articles)})

@app.route('/api/search')
def api_search():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'ok': False, 'error': 'Query required'}), 400

    db  = get_db()
    row = row_to_dict(db.execute('SELECT * FROM search_cache WHERE query=?', (q.lower(),)).fetchone())
    if row and not stale(row['fetched_at'], 3600):
        return jsonify({'ok': True, 'data': json.loads(row['results'])})

    # Source 1: yfinance Search API
    mapped = []
    try:
        results = yf.Search(q, max_results=10).quotes
        for r in results:
            sym = r.get('symbol', '')
            if sym:
                mapped.append({
                    'symbol':   sym,
                    'name':     r.get('longname') or r.get('shortname', sym),
                    'exchange': r.get('exchange', ''),
                    'type':     r.get('quoteType', ''),
                })
    except Exception as e:
        log.warning(f'search yfinance({q}): {e}')

    # Source 2: Yahoo Finance search API (direct HTTP fallback)
    if not mapped:
        try:
            url = 'https://query2.finance.yahoo.com/v1/finance/search'
            r2  = http_requests.get(url, params={'q': q, 'quotesCount': 10, 'newsCount': 0},
                                    headers=_YF_HEADERS, timeout=10)
            if r2.status_code == 200:
                for r in (r2.json().get('quotes') or []):
                    sym = r.get('symbol', '')
                    if sym:
                        mapped.append({
                            'symbol':   sym,
                            'name':     r.get('longname') or r.get('shortname', sym),
                            'exchange': r.get('exchange', ''),
                            'type':     r.get('quoteType', ''),
                        })
        except Exception as e:
            log.warning(f'search yf-direct({q}): {e}')

    if mapped:
        db.execute("""
            INSERT OR REPLACE INTO search_cache (query,results,fetched_at)
            VALUES (?,?,?)
        """, (q.lower(), json.dumps(mapped), now_ts()))
        db.commit()
        return jsonify({'ok': True, 'data': mapped})

    return jsonify({'ok': False, 'error': 'No results found'}), 404

# ── Auth endpoints ────────────────────────────────────────────────────────────
@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    body     = request.get_json(silent=True) or {}
    email    = (body.get('email') or '').strip().lower()
    password = body.get('password', '')
    name     = (body.get('name') or '').strip()
    if not email or not password:
        return jsonify({'ok': False, 'error': 'Email and password required'}), 400
    if len(password) < 6:
        return jsonify({'ok': False, 'error': 'Password must be at least 6 characters'}), 400
    db = get_db()
    if db.execute('SELECT id FROM users WHERE email=?', (email,)).fetchone():
        return jsonify({'ok': False, 'error': 'Email already registered'}), 409
    pw_hash = generate_password_hash(password)
    db.execute('INSERT INTO users (email,password_hash,name) VALUES (?,?,?)',
               (email, pw_hash, name or email.split('@')[0]))
    db.commit()
    user  = db.execute('SELECT id,email,name FROM users WHERE email=?', (email,)).fetchone()
    token = secrets.token_urlsafe(32)
    db.execute('INSERT INTO user_sessions (token,user_id,expires_at) VALUES (?,?,?)',
               (token, user['id'], now_ts() + SESSION_TTL))
    db.commit()
    return jsonify({'ok': True, 'token': token,
                    'user': {'id': user['id'], 'email': user['email'], 'name': user['name']}})

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    body     = request.get_json(silent=True) or {}
    email    = (body.get('email') or '').strip().lower()
    password = body.get('password', '')
    if not email or not password:
        return jsonify({'ok': False, 'error': 'Email and password required'}), 400
    db  = get_db()
    row = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
    if not row or not check_password_hash(row['password_hash'], password):
        return jsonify({'ok': False, 'error': 'Invalid email or password'}), 401
    token = secrets.token_urlsafe(32)
    db.execute('INSERT OR REPLACE INTO user_sessions (token,user_id,expires_at) VALUES (?,?,?)',
               (token, row['id'], now_ts() + SESSION_TTL))
    db.commit()
    return jsonify({'ok': True, 'token': token,
                    'user': {'id': row['id'], 'email': row['email'], 'name': row['name']}})

@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth[7:].strip()
        db = get_db()
        db.execute('DELETE FROM user_sessions WHERE token=?', (token,))
        db.commit()
    return jsonify({'ok': True})

@app.route('/api/auth/me')
def auth_me():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
    db  = get_db()
    row = db.execute('SELECT id,email,name FROM users WHERE id=?', (user_id,)).fetchone()
    if not row:
        return jsonify({'ok': False, 'error': 'User not found'}), 404
    return jsonify({'ok': True, 'user': dict(row)})

# ── Watchlist CRUD ────────────────────────────────────────────────────────────
@app.route('/api/watchlist', methods=['GET'])
def wl_get():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
    db   = get_db()
    rows = rows_to_list(db.execute(
        'SELECT symbol,name,exchange,added_at FROM watchlist WHERE user_id=? ORDER BY added_at DESC',
        (user_id,)
    ).fetchall())
    return jsonify({'ok': True, 'data': rows})

@app.route('/api/watchlist', methods=['POST'])
def wl_add():
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
    body = request.get_json(silent=True) or {}
    sym  = body.get('symbol','').strip().upper()
    name = body.get('name', sym)
    exch = body.get('exchange','')
    if not sym:
        return jsonify({'ok': False, 'error': 'symbol required'}), 400
    db = get_db()
    db.execute('INSERT OR IGNORE INTO watchlist (user_id,symbol,name,exchange) VALUES (?,?,?,?)',
               (user_id, sym, name, exch))
    db.commit()
    return jsonify({'ok': True})

@app.route('/api/watchlist/<path:symbol>', methods=['DELETE'])
def wl_del(symbol):
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
    db = get_db()
    db.execute('DELETE FROM watchlist WHERE user_id=? AND symbol=?', (user_id, symbol))
    db.commit()
    return jsonify({'ok': True})

# ── Batch quote (used by watchlist refresh) ───────────────────────────────────
@app.route('/api/quotes/batch')
def batch_quotes():
    symbols_param = request.args.get('symbols', '')
    symbols = [s.strip() for s in symbols_param.split(',') if s.strip()]
    if not symbols:
        return jsonify({'ok': False, 'error': 'symbols required'}), 400

    results = {}
    db = get_db()

    # serve from cache first
    for sym in symbols:
        row = row_to_dict(db.execute('SELECT * FROM quotes WHERE symbol=?', (sym,)).fetchone())
        if row and not stale(row['fetched_at'], CACHE_TTL):
            results[sym] = row

    # fetch stale / missing in parallel threads
    missing = [s for s in symbols if s not in results]

    def fetch_one(sym):
        data = fetch_quote(sym)
        if data:
            results[sym] = data
            with thread_connection() as db2:
                db2.execute("""
                    INSERT OR REPLACE INTO quotes
                        (symbol,price,open,high,low,prev_close,change,change_pct,volume,mkt_cap,currency,fetched_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """, (sym, data['price'], data['open'], data['high'], data['low'],
                      data['prev_close'], data['change'], data['change_pct'],
                      data['volume'], data['mkt_cap'], data['currency'], now_ts()))
                db2.commit()

    threads = [threading.Thread(target=fetch_one, args=(sym,)) for sym in missing]
    for t in threads: t.start()
    for t in threads: t.join(timeout=20)

    return jsonify({'ok': True, 'data': results})

# ── Value-picks screener ─────────────────────────────────────────────────────
@app.route('/api/screener/value-picks')
def screener_value_picks():
    db    = get_db()
    cache = row_to_dict(db.execute(
        "SELECT results, fetched_at FROM screener_cache WHERE screener_id='value-picks'"
    ).fetchone())

    if cache and not stale(cache['fetched_at'], SCREENER_TTL):
        # Fresh cache — return immediately
        return jsonify({'ok': True, 'data': json.loads(cache['results']),
                        'cached': True, 'fetched_at': cache['fetched_at'],
                        'status': 'ready'})

    # Cache missing or stale — kick off background job (non-blocking) and respond
    if not _screener_running:
        threading.Thread(target=_run_screener_bg, daemon=True).start()

    if cache:
        # Return stale data while the fresh scan runs in background
        return jsonify({'ok': True, 'data': json.loads(cache['results']),
                        'cached': True, 'fetched_at': cache['fetched_at'],
                        'status': 'refreshing'})

    # No cache at all — tell frontend to poll
    return jsonify({'ok': True, 'data': [], 'cached': False,
                    'status': 'loading',
                    'message': 'Scanning stocks — usually takes 30–90 s. Refreshing automatically.'})

@app.route('/api/screener/refresh', methods=['POST'])
def screener_refresh():
    db = get_db()
    db.execute("DELETE FROM screener_cache WHERE screener_id='value-picks'")
    db.commit()
    if not _screener_running:
        threading.Thread(target=_run_screener_bg, daemon=True).start()
    return jsonify({'ok': True, 'message': 'Screener re-running in background — check back in ~60 s'})

# ── RAG management endpoints ──────────────────────────────────────────────────

@app.route('/api/rag/status')
def rag_status():
    """Return chunk counts per symbol and total, with model info."""
    if not get_embed_model():
        return jsonify({'ok': False, 'error': 'Embedding model not available (install fastembed)'}), 503
    db = get_db()
    rows = rows_to_list(db.execute(
        'SELECT symbol, source, COUNT(*) as cnt FROM embeddings GROUP BY symbol, source ORDER BY symbol, source'
    ).fetchall())
    total = db.execute('SELECT COUNT(*) as n FROM embeddings').fetchone()['n']
    by_symbol: dict = {}
    for r in rows:
        sym = r['symbol']
        if sym not in by_symbol:
            by_symbol[sym] = {'total': 0, 'by_source': {}}
        by_symbol[sym]['by_source'][r['source']] = r['cnt']
        by_symbol[sym]['total'] += r['cnt']
    return jsonify({
        'ok': True,
        'total_chunks': total,
        'model': 'BAAI/bge-small-en-v1.5 (384-dim)',
        'score_threshold': RAG_SCORE_THRESHOLD,
        'symbols': by_symbol,
    })

@app.route('/api/rag/train', methods=['POST'])
def rag_train():
    """Bulk-ingest RAG data for given symbols (or user's watchlist).
    Body: { "symbols": ["AAPL","RELIANCE.NS"] }  — omit to use watchlist.
    """
    if not get_embed_model():
        return jsonify({'ok': False, 'error': 'Embedding model not available (install fastembed)'}), 503

    body    = request.get_json(silent=True) or {}
    symbols = body.get('symbols', [])

    if not symbols:
        user_id = get_current_user_id()
        db = get_db()
        if user_id:
            symbols = [r['symbol'] for r in db.execute(
                'SELECT symbol FROM watchlist WHERE user_id=?', (user_id,)).fetchall()]
        if not symbols:
            return jsonify({'ok': False, 'error': 'No symbols provided and no watchlist found'}), 400

    symbols = list({s.upper() if not s.endswith('.NS') and not s.endswith('.BO') else s
                    for s in symbols})[:20]  # cap at 20 to avoid abuse

    def _run():
        log.info(f'RAG training started for {len(symbols)} symbols: {symbols}')
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
            futures = {ex.submit(_rag_ingest_symbol, sym): sym for sym in symbols}
            for fut in concurrent.futures.as_completed(futures):
                sym = futures[fut]
                try:
                    fut.result()
                except Exception as e:
                    log.warning(f'RAG train error for {sym}: {e}')
        log.info(f'RAG training complete for {len(symbols)} symbols')

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({
        'ok': True,
        'message': f'RAG ingestion started for {len(symbols)} symbols. '
                   f'Check /api/rag/status in ~30s.',
        'symbols': symbols,
    })

@app.route('/api/rag/clear', methods=['POST'])
def rag_clear():
    """Clear RAG embeddings for given symbols (or all if admin).
    Body: { "symbols": ["AAPL"] }  — omit to clear everything (admin only, requires auth).
    """
    body    = request.get_json(silent=True) or {}
    symbols = body.get('symbols', [])
    db = get_db()
    if symbols:
        for sym in symbols[:20]:
            db.execute('DELETE FROM embeddings WHERE symbol=?', (sym,))
        db.commit()
        return jsonify({'ok': True, 'cleared': symbols})
    # Clear all — require auth
    user_id = get_current_user_id()
    if not user_id:
        return jsonify({'ok': False, 'error': 'Auth required to clear all embeddings'}), 401
    db.execute('DELETE FROM embeddings')
    db.commit()
    return jsonify({'ok': True, 'message': 'All embeddings cleared'})

# ── Historical performance metrics ───────────────────────────────────────────
@app.route('/api/performance/<path:symbol>')
def api_performance(symbol):
    """Year-by-year returns, CAGR, volatility, max drawdown from 5y monthly history."""
    db = get_db()

    # Pull from DB first (5y range_key uses monthly interval = ~60 pts)
    rows = rows_to_list(db.execute(
        'SELECT ts, close FROM history WHERE symbol=? AND range_key=? ORDER BY ts ASC',
        (symbol, '5y')
    ).fetchall())

    if len(rows) < 12:
        pts = fetch_history(symbol, '5y')
        if pts:
            db.executemany("""
                INSERT OR IGNORE INTO history (symbol,range_key,ts,open,high,low,close,volume)
                VALUES (?,?,?,?,?,?,?,?)
            """, [(symbol, '5y', p['ts'], p['open'], p['high'], p['low'], p['close'], p['volume'])
                  for p in pts])
            db.commit()
            rows = [{'ts': p['ts'], 'close': p['close']} for p in pts]

    if len(rows) < 12:
        return jsonify({'ok': False, 'error': 'Insufficient historical data'}), 404

    closes     = np.array([r['close'] for r in rows], dtype=np.float64)
    timestamps = [r['ts'] for r in rows]

    # ── Year-by-year returns ──────────────────────────────────────────────────
    from collections import defaultdict
    year_buckets = defaultdict(list)
    for ts, c in zip(timestamps, closes):
        year_buckets[datetime.fromtimestamp(ts).year].append((ts, float(c)))

    annual_returns = []
    for yr in sorted(year_buckets):
        pts_yr  = sorted(year_buckets[yr])
        first_p = pts_yr[0][1]
        last_p  = pts_yr[-1][1]
        ret     = (last_p - first_p) / first_p * 100
        annual_returns.append({'year': yr, 'return': round(ret, 2),
                                'first': round(first_p, 2), 'last': round(last_p, 2)})

    # ── CAGR ─────────────────────────────────────────────────────────────────
    def cagr_n(n_years):
        cutoff = timestamps[-1] - int(n_years * 365.25 * 86400)
        start  = next((c for ts, c in zip(timestamps, closes) if ts >= cutoff), None)
        if start is None or start <= 0:
            return None
        actual = (timestamps[-1] - cutoff) / (365.25 * 86400)
        if actual < 0.25:
            return None
        return round((float((closes[-1] / start) ** (1 / actual)) - 1) * 100, 2)

    # ── Annualised volatility (monthly → × √12) ───────────────────────────────
    vol = None
    if len(closes) > 2:
        log_ret = np.diff(np.log(closes[closes > 0]))
        vol     = round(float(np.std(log_ret) * np.sqrt(12) * 100), 2)

    # ── Max drawdown ──────────────────────────────────────────────────────────
    peak   = float(closes[0])
    max_dd = 0.0
    for c in closes:
        c = float(c)
        if c > peak: peak = c
        dd = (peak - c) / peak
        if dd > max_dd: max_dd = dd

    best  = max(annual_returns, key=lambda x: x['return']) if annual_returns else None
    worst = min(annual_returns, key=lambda x: x['return']) if annual_returns else None

    return jsonify({'ok': True, 'data': {
        'annual_returns': annual_returns,
        'cagr_1y':        cagr_n(1),
        'cagr_3y':        cagr_n(3),
        'cagr_5y':        cagr_n(5),
        'volatility':     vol,
        'max_drawdown':   round(max_dd * 100, 2),
        'best_year':      best,
        'worst_year':     worst,
        'data_points':    len(rows),
    }})

# ── Frontend (Angular) static serving ────────────────────────────────────────
_ROOT      = os.path.dirname(os.path.abspath(__file__))
_DIST      = os.path.join(_ROOT, 'static', 'dist', 'browser')
_DIST_ROOT = os.path.join(_ROOT, 'static', 'dist')

def _angular_index():
    """Serve Angular's index.html from the build output."""
    for candidate in (_DIST, _DIST_ROOT):
        idx = os.path.join(candidate, 'index.html')
        if os.path.exists(idx):
            return send_from_directory(candidate, 'index.html')
    # Fallback: legacy single-file HTML during development
    legacy = os.path.join(_ROOT, 'Stock-tracker.html')
    if os.path.exists(legacy):
        return send_from_directory(_ROOT, 'Stock-tracker.html')
    return jsonify({'error': 'Frontend not built yet. Run: cd client && npm run build'}), 404

@app.route('/')
def index():
    return _angular_index()

@app.route('/manifest.json')
def manifest():
    return send_from_directory(_ROOT, 'manifest.json',
                               mimetype='application/manifest+json')

@app.route('/favicon.ico')
def favicon():
    for candidate in (_DIST, _DIST_ROOT, os.path.join(_ROOT, 'static')):
        ico = os.path.join(candidate, 'favicon.ico')
        if os.path.exists(ico):
            return send_from_directory(candidate, 'favicon.ico')
    return '', 204

# Serve all Angular static assets (JS/CSS chunks, fonts, etc.)
@app.route('/<path:filename>')
def angular_static(filename):
    # Don't intercept API routes
    if filename.startswith('api/'):
        from flask import abort; abort(404)
    for candidate in (_DIST, _DIST_ROOT):
        fpath = os.path.join(candidate, filename)
        if os.path.exists(fpath) and os.path.isfile(fpath):
            return send_from_directory(candidate, filename)
    # For deep Angular routes (e.g. /screener) serve index.html (SPA fallback)
    return _angular_index()

# ── Health / keep-alive ───────────────────────────────────────────────────────
@app.route('/api/ping')
def ping():
    return jsonify({'ok': True, 'ts': now_ts(), 'version': '2.2.0'})

@app.route('/api/keepalive')
def keepalive():
    """Lightweight endpoint for UptimeRobot / Railway cron to prevent cold starts."""
    return jsonify({'ok': True, 'ts': now_ts()})

@app.route('/api/db-status')
def db_status():
    from db import DATABASE_URL, USE_PG
    try:
        from db import thread_connection
        with thread_connection() as conn:
            row = conn.execute('SELECT 1 AS ok').fetchone()
        return jsonify({'ok': True, 'backend': 'postgresql' if USE_PG else 'sqlite',
                        'url_set': bool(DATABASE_URL)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e),
                        'backend': 'postgresql' if USE_PG else 'sqlite',
                        'url_set': bool(DATABASE_URL)}), 500

# ── AI provider helpers ───────────────────────────────────────────────────────
# Priority: GROQ_API_KEY (free, open-source Llama) → ANTHROPIC_API_KEY (Claude)

SYSTEM_PROMPT = """\
You are StockPulse AI — a professional stock analyst using the Stock Analysis skill framework.

## YOUR ANALYSIS FRAMEWORK (from stock-analysis skill v1.0)

### Valuation benchmarks
- P/E: <15 undervalued · 15-25 fair · >25 expensive
- P/B: <1 potential value · 1-3 normal · >3 growth priced in
- EV/EBITDA: <10 attractive · >15 expensive
- PEG: <1 undervalued relative to growth

### Profitability benchmarks
- Gross Margin: >40% = strong pricing power
- Net Margin: >10% = healthy · >20% = excellent
- ROE: >15% = good capital efficiency · >25% = exceptional

### Financial health
- Debt/Equity: <1 safe for most industries
- Beta: <1 defensive · >1.5 high volatility

## RESPONSE RULES
1. **Always lead with a 2-line Executive Summary** — overall stance (Bullish/Neutral/Bearish) + one key reason.
2. **Key Metrics table** — only metrics available in the context, with a one-word assessment (Attractive/Fair/Expensive/Strong/Weak).
3. **Three focused sections max**: Valuation · Catalysts/Positives · Risks. Bullet points, 2-3 per section.
4. **Cite news sources** with age in days when relevant.
5. **Never fabricate numbers** — if a metric is missing, skip it.
6. **Length**: 150-250 words for single-stock queries; 250-350 for comparisons. No padding.
7. **Indian stocks**: use ₹ and Indian notation (Cr, L). US stocks: use $.
8. For general questions (macro, sector, news) answer conversationally — no forced template.
"""

# Groq free models (open-source, no credit card needed)
GROQ_MODEL     = 'llama-3.3-70b-versatile'   # best quality on free tier
GROQ_MODEL_FAST= 'llama-3.1-8b-instant'       # faster for summaries

_NO_KEY_MSG = (
    'No AI API key found.\n\n'
    '── FREE option (recommended) ──\n'
    '1. Go to https://console.groq.com\n'
    '2. Sign up free (no credit card) → API Keys → Create Key\n'
    '3. export GROQ_API_KEY=gsk_...\n\n'
    '── Paid option ──\n'
    '1. Go to https://console.anthropic.com → API Keys\n'
    '2. export ANTHROPIC_API_KEY=sk-ant-...\n\n'
    'Then restart stock-server.py.'
)

def _get_ai_provider():
    """Return ('groq', key) or ('anthropic', key) or (None, None)."""
    gk = os.environ.get('GROQ_API_KEY')
    if gk:
        return 'groq', gk
    ak = os.environ.get('ANTHROPIC_API_KEY')
    if ak:
        return 'anthropic', ak
    return None, None

def _fmt_large(v, currency=''):
    """Format large numbers: 1234567890 → ₹1,234 Cr  or  $1.23B"""
    if v is None:
        return None
    if currency in ('INR', '₹'):
        cr = v / 1e7
        if cr >= 1e5:   return f'₹{cr/1e5:.2f}L Cr'
        if cr >= 1:     return f'₹{cr:,.0f} Cr'
        return f'₹{v:,.0f}'
    b = v / 1e9
    if abs(b) >= 1:  return f'${b:.2f}B'
    m = v / 1e6
    if abs(m) >= 1:  return f'${m:.0f}M'
    return f'${v:,.0f}'

def _assess(value, thresholds):
    """Return a one-word assessment given (value, [(threshold, label), ...]) sorted asc."""
    if value is None:
        return None
    for threshold, label in thresholds:
        if value <= threshold:
            return label
    return thresholds[-1][1]

def _build_context(symbols, question):
    """Build structured context using stock-analysis skill framework."""
    parts = []

    with thread_connection() as conn:
        for sym in symbols[:6]:
            q_row  = conn.execute('SELECT * FROM quotes     WHERE symbol=?', (sym,)).fetchone()
            f_row  = conn.execute('SELECT * FROM financials WHERE symbol=?', (sym,)).fetchone()
            p_row  = conn.execute('SELECT name,sector,industry,description FROM profiles WHERE symbol=?', (sym,)).fetchone()
            n_rows = conn.execute(
                'SELECT title,source,published,category FROM news '
                'WHERE symbol=? ORDER BY published DESC LIMIT 8', (sym,)).fetchall()

            if not (q_row or f_row or n_rows):
                continue

            cur = (q_row['currency'] if q_row else None) or 'USD'
            sym_label = (p_row['name'] if p_row else None) or sym
            sector    = (p_row['sector'] if p_row else None) or ''

            parts.append(f'### {sym} — {sym_label}')
            if sector:
                ind = (p_row['industry'] if p_row else '') or ''
                parts.append(f'Sector: {sector}' + (f' | {ind}' if ind else ''))

            # ── Price snapshot ────────────────────────────────────────────────
            if q_row:
                chg  = q_row['change_pct'] or 0
                sign = '+' if chg >= 0 else ''
                mktcap = _fmt_large(q_row['mkt_cap'], cur)
                price_line = f'Price: {cur} {q_row["price"]} ({sign}{chg:.2f}%)'
                if mktcap: price_line += f' | Mkt Cap: {mktcap}'
                if q_row['volume']: price_line += f' | Volume: {q_row["volume"]:,}'
                parts.append(price_line)

            # ── Key metrics table (skill framework) ───────────────────────────
            if f_row:
                metrics = []
                pe = f_row['pe_ratio']
                if pe:
                    label = _assess(pe, [(15,'Attractive'),(25,'Fair'),(999,'Expensive')])
                    metrics.append(f'P/E {pe:.1f} [{label}]')
                pb = f_row.get('pb_ratio')
                if pb:
                    label = _assess(pb, [(1,'Attractive'),(3,'Fair'),(999,'Expensive')])
                    metrics.append(f'P/B {pb:.1f} [{label}]')
                gm = f_row['gross_margin']
                if gm:
                    label = _assess(gm*100, [(20,'Weak'),(40,'Fair'),(999,'Strong')])
                    metrics.append(f'Gross Margin {gm*100:.1f}% [{label}]')
                nm = f_row.get('net_margin') or (
                    (f_row['net_income_ttm'] / f_row['revenue_ttm'])
                    if f_row['net_income_ttm'] and f_row['revenue_ttm'] else None)
                if nm:
                    label = _assess(nm*100, [(5,'Weak'),(10,'Fair'),(20,'Good'),(999,'Excellent')])
                    metrics.append(f'Net Margin {nm*100:.1f}% [{label}]')
                roe = f_row.get('roe')
                if roe:
                    label = _assess(roe*100, [(10,'Weak'),(15,'Fair'),(25,'Good'),(999,'Exceptional')])
                    metrics.append(f'ROE {roe*100:.1f}% [{label}]')
                eps = f_row['eps']
                if eps: metrics.append(f'EPS {cur} {eps:.2f}')
                rev = f_row['revenue_ttm']
                if rev: metrics.append(f'Revenue TTM {_fmt_large(rev, cur)}')
                beta = f_row['beta']
                if beta:
                    label = _assess(abs(beta), [(0.8,'Defensive'),(1.2,'Moderate'),(1.5,'Volatile'),(999,'High Volatility')])
                    metrics.append(f'Beta {beta:.2f} [{label}]')
                w52h = f_row['week52_high']
                w52l = f_row['week52_low']
                if w52h and w52l: metrics.append(f'52W Range {w52l:.2f}–{w52h:.2f}')
                dy = f_row['dividend_yield']
                if dy: metrics.append(f'Div Yield {dy*100:.2f}%')
                if metrics:
                    parts.append('Metrics: ' + ' | '.join(metrics))

            # ── Recent news (categorised) ─────────────────────────────────────
            if n_rows:
                parts.append('Recent News:')
                for n in n_rows:
                    age_d = (now_ts() - (n['published'] or 0)) // 86400
                    cat   = n['category'] or 'gen'
                    tag   = {'contract':'[Contract]','results':'[Results]',
                             'acq':'[M&A]','earn':'[Earnings]','part':'[Deal]'}.get(cat, '')
                    parts.append(f'  {tag} [{n["source"]}] {n["title"]} ({age_d}d ago)')
            parts.append('')

    # ── RAG: top relevant chunks ───────────────────────────────────────────────
    chunks = retrieve_top_chunks(symbols, question, top_k=4)
    if chunks:
        parts.append('--- RELEVANT CONTEXT ---')
        for i, c in enumerate(chunks, 1):
            age = f' ({(now_ts()-c["ts"])//86400}d ago)' if c.get('ts') else ''
            parts.append(f'[{i}] {c["symbol"]} ({c["source"]}){age}: {c["content"][:300]}')
        parts.append('--- END ---')

    if not parts:
        return 'No data loaded yet. Add stocks to your watchlist and wait for data to fetch.'

    return '\n'.join(parts)

# ── AI Chat endpoint (streaming SSE) ─────────────────────────────────────────
@app.route('/api/chat', methods=['POST'])
def api_chat():
    provider, api_key = _get_ai_provider()
    if not provider:
        return jsonify({'ok': False, 'error': _NO_KEY_MSG}), 503

    body         = request.get_json(silent=True) or {}
    question     = (body.get('question') or '').strip()
    symbols      = body.get('symbols', [])
    chat_history = body.get('chat_history', [])

    if not question:
        return jsonify({'ok': False, 'error': 'question required'}), 400

    if not symbols:
        user_id = get_current_user_id()
        db = get_db()
        if user_id:
            symbols = [r['symbol'] for r in db.execute(
                'SELECT symbol FROM watchlist WHERE user_id=?', (user_id,)).fetchall()]

    context_block = _build_context(symbols, question)

    messages = [
        {'role': t['role'], 'content': t['content']}
        for t in chat_history[-10:]
        if t.get('role') in ('user', 'assistant') and t.get('content')
    ]
    messages.append({'role': 'user', 'content': f"{context_block}\n\nQuestion: {question}"})

    def generate_groq():
        try:
            client = groq_sdk.Groq(api_key=api_key)
            stream = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{'role': 'system', 'content': SYSTEM_PROMPT}] + messages,
                max_tokens=1024,
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ''
                if delta:
                    yield f"data: {json.dumps({'type': 'delta', 'text': delta})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            log.warning(f'Groq stream error: {e}')
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    def generate_anthropic():
        try:
            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model='claude-haiku-4-5-20251001', max_tokens=1024,
                system=SYSTEM_PROMPT, messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'delta', 'text': text})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except anthropic.AuthenticationError:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Invalid ANTHROPIC_API_KEY'})}\n\n"
        except Exception as e:
            log.warning(f'Anthropic stream error: {e}')
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    gen = generate_groq() if provider == 'groq' else generate_anthropic()
    return Response(
        stream_with_context(gen),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )

# ── AI Summary endpoint (non-streaming) ──────────────────────────────────────
@app.route('/api/ai-summary/<path:symbol>')
def api_ai_summary(symbol):
    provider, api_key = _get_ai_provider()
    if not provider:
        return jsonify({'ok': False, 'error': _NO_KEY_MSG}), 503

    db = get_db()
    news_rows = db.execute(
        'SELECT title,source FROM news WHERE symbol=? ORDER BY published DESC LIMIT 5',
        (symbol,)).fetchall()
    fin_row   = row_to_dict(db.execute('SELECT * FROM financials WHERE symbol=?', (symbol,)).fetchone())
    quote_row = row_to_dict(db.execute('SELECT * FROM quotes WHERE symbol=?',     (symbol,)).fetchone())

    news_text = '\n'.join(f"- [{r['source']}] {r['title']}" for r in news_rows) or 'No recent news.'
    cur = (quote_row or {}).get('currency', 'USD')
    fin_parts = []
    if fin_row:
        if fin_row.get('pe_ratio'):     fin_parts.append(f"P/E {fin_row['pe_ratio']:.1f}")
        if fin_row.get('gross_margin'): fin_parts.append(f"Gross Margin {fin_row['gross_margin']*100:.1f}%")
        if fin_row.get('eps'):          fin_parts.append(f"EPS {cur} {fin_row['eps']:.2f}")
        if fin_row.get('revenue_ttm'):  fin_parts.append(f"Rev TTM {_fmt_large(fin_row['revenue_ttm'], cur)}")
        if fin_row.get('beta'):         fin_parts.append(f"Beta {fin_row['beta']:.2f}")
    price_parts = []
    if quote_row:
        price_parts.append(f"Price {cur} {quote_row['price']} ({quote_row.get('change_pct',0):+.2f}%)")
        if quote_row.get('mkt_cap'): price_parts.append(f"Mkt Cap {_fmt_large(quote_row['mkt_cap'], cur)}")

    prompt = (
        f"Using the stock-analysis skill framework, write a concise summary for {symbol}.\n\n"
        f"Price: {' | '.join(price_parts) or 'N/A'}\n"
        f"Metrics: {' | '.join(fin_parts) or 'N/A'}\n"
        f"News:\n{news_text}\n\n"
        "Format: 1-line stance (Bullish/Neutral/Bearish + reason), then 2-3 bullet points "
        "covering valuation, key catalyst, and main risk. Max 100 words. No fluff."
    )
    try:
        if provider == 'groq':
            client = groq_sdk.Groq(api_key=api_key)
            resp   = client.chat.completions.create(
                model=GROQ_MODEL_FAST,
                messages=[{'role':'system','content':SYSTEM_PROMPT},
                          {'role':'user',  'content':prompt}],
                max_tokens=200,
            )
            summary = resp.choices[0].message.content
        else:
            client  = anthropic.Anthropic(api_key=api_key)
            msg     = client.messages.create(
                model='claude-haiku-4-5-20251001', max_tokens=200,
                system=SYSTEM_PROMPT,
                messages=[{'role':'user','content':prompt}])
            summary = msg.content[0].text
        return jsonify({'ok': True, 'summary': summary, 'provider': provider})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# ── AI provider status ────────────────────────────────────────────────────────
@app.route('/api/ai-status')
def api_ai_status():
    provider, _ = _get_ai_provider()
    models = {
        'groq':      f'Llama 3.3 70B (Groq) — free open-source',
        'anthropic': 'Claude Haiku (Anthropic)',
    }
    return jsonify({
        'ok':       provider is not None,
        'provider': provider,
        'model':    models.get(provider, 'none'),
        'ready':    provider is not None,
    })

# ── Startup (runs for both `python stock-server.py` and gunicorn) ─────────────
init_db()
threading.Thread(target=get_embed_model, daemon=True).start()
# Pre-warm the screener cache so the first user doesn't wait 60+ seconds
threading.Thread(target=_maybe_start_screener, daemon=True).start()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    log.info(f'StockPulse server starting on http://0.0.0.0:{port}')
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
