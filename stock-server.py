#!/usr/bin/env python3
"""
StockPulse Backend — Flask + SQLite + yfinance
Serves Indian (NSE/BSE) and US stock data without CORS issues.
"""

import os, json, time, threading, logging, re
from datetime import datetime, timedelta
import sqlite3
import requests as http_requests
import feedparser
import yfinance as yf
import numpy as np
import anthropic
from flask import Flask, jsonify, request, g, Response, stream_with_context
from flask_cors import CORS

# ── Config ──────────────────────────────────────────────────────────────────
DB_PATH   = os.path.join(os.path.dirname(__file__), 'stockpulse.db')
CACHE_TTL = 60          # seconds — quote cache lifetime
HIST_TTL  = 300         # seconds — history cache lifetime
NEWS_TTL  = 600         # seconds — news cache lifetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('stockpulse')

app = Flask(__name__)
CORS(app, origins='*')

# ── Embedding model (lazy-loaded) ────────────────────────────────────────────
_embed_model      = None
_embed_model_lock = threading.Lock()

def get_embed_model():
    """Lazily load sentence-transformer model — thread-safe, ~90MB download once."""
    global _embed_model
    if _embed_model is None:
        with _embed_model_lock:
            if _embed_model is None:
                try:
                    from sentence_transformers import SentenceTransformer
                    log.info('Loading embedding model all-MiniLM-L6-v2 …')
                    _embed_model = SentenceTransformer('all-MiniLM-L6-v2')
                    log.info('Embedding model ready.')
                except Exception as e:
                    log.error(f'Embedding model load failed: {e}')
    return _embed_model

# ── Database ─────────────────────────────────────────────────────────────────
SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS watchlist (
    symbol      TEXT PRIMARY KEY,
    name        TEXT,
    exchange    TEXT,
    added_at    INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS quotes (
    symbol      TEXT PRIMARY KEY,
    price       REAL,
    open        REAL,
    high        REAL,
    low         REAL,
    prev_close  REAL,
    change      REAL,
    change_pct  REAL,
    volume      INTEGER,
    mkt_cap     REAL,
    currency    TEXT,
    fetched_at  INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    range_key   TEXT NOT NULL,
    ts          INTEGER NOT NULL,
    open        REAL,
    high        REAL,
    low         REAL,
    close       REAL,
    volume      INTEGER,
    UNIQUE(symbol, range_key, ts)
);
CREATE INDEX IF NOT EXISTS idx_history ON history(symbol, range_key, ts DESC);

CREATE TABLE IF NOT EXISTS profiles (
    symbol      TEXT PRIMARY KEY,
    name        TEXT,
    sector      TEXT,
    industry    TEXT,
    exchange    TEXT,
    currency    TEXT,
    website     TEXT,
    description TEXT,
    employees   INTEGER,
    country     TEXT,
    logo_url    TEXT,
    fetched_at  INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS financials (
    symbol          TEXT PRIMARY KEY,
    market_cap      REAL,
    revenue_ttm     REAL,
    revenue_q       REAL,
    revenue_q_prev  REAL,
    net_income_ttm  REAL,
    gross_margin    REAL,
    pe_ratio        REAL,
    eps             REAL,
    dividend_yield  REAL,
    beta            REAL,
    week52_high     REAL,
    week52_low      REAL,
    avg_volume      INTEGER,
    fetched_at      INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS news (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    source      TEXT,
    title       TEXT NOT NULL,
    url         TEXT,
    published   INTEGER,
    summary     TEXT,
    relevance   TEXT DEFAULT 'medium',
    fetched_at  INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(symbol, url)
);
CREATE INDEX IF NOT EXISTS idx_news ON news(symbol, published DESC);

CREATE TABLE IF NOT EXISTS search_cache (
    query       TEXT PRIMARY KEY,
    results     TEXT,
    fetched_at  INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS embeddings (
    chunk_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol      TEXT NOT NULL,
    content     TEXT NOT NULL,
    vector      BLOB NOT NULL,
    source      TEXT,
    article_url TEXT,
    ts          INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_embed_symbol ON embeddings(symbol, ts DESC);
"""

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    db = g.pop('db', None)
    if db: db.close()

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    # Migrate: add category column to news if not present
    try:
        conn.execute("ALTER TABLE news ADD COLUMN category TEXT DEFAULT 'gen'")
        conn.commit()
        log.info('Migrated news table: added category column')
    except sqlite3.OperationalError:
        pass  # column already exists
    conn.close()
    log.info(f'Database ready at {DB_PATH}')

# ── Helpers ──────────────────────────────────────────────────────────────────
def now_ts():
    return int(time.time())

def stale(fetched_at, ttl):
    return (now_ts() - (fetched_at or 0)) > ttl

def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

# ── Embedding helpers ────────────────────────────────────────────────────────

def _embed_text(text: str):
    """Encode text to float32 bytes for SQLite BLOB storage."""
    model = get_embed_model()
    if not model:
        return None
    try:
        return model.encode(text, convert_to_numpy=True).astype(np.float32).tobytes()
    except Exception as e:
        log.warning(f'_embed_text: {e}')
        return None

def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    d = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / d) if d else 0.0

def store_embedding(conn, symbol: str, content: str, source: str,
                    article_url: str = '', ts: int = None):
    """Generate and store an embedding; skips duplicates by (symbol, article_url)."""
    if not content or len(content.strip()) < 40:
        return
    if article_url and conn.execute(
            'SELECT 1 FROM embeddings WHERE symbol=? AND article_url=?',
            (symbol, article_url)).fetchone():
        return  # already embedded
    vec = _embed_text(content)
    if vec is None:
        return
    conn.execute(
        'INSERT INTO embeddings (symbol,content,vector,source,article_url,ts) VALUES (?,?,?,?,?,?)',
        (symbol, content[:2000], vec, source, article_url or '', ts or now_ts()))
    conn.commit()

def retrieve_top_chunks(symbols: list, query: str, top_k: int = 5) -> list:
    """Embed query and return top-k most similar chunks for the given symbols."""
    model = get_embed_model()
    if not model or not symbols:
        return []
    q_vec = model.encode(query, convert_to_numpy=True).astype(np.float32)
    conn  = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    placeholders = ','.join('?' * len(symbols))
    rows = conn.execute(
        f'SELECT symbol,content,vector,source,article_url,ts FROM embeddings WHERE symbol IN ({placeholders})',
        symbols).fetchall()
    conn.close()
    scored = []
    for r in rows:
        try:
            vec = np.frombuffer(r['vector'], dtype=np.float32)
            scored.append({**dict(r), 'score': _cosine_sim(q_vec, vec)})
        except Exception:
            continue
    scored.sort(key=lambda x: x['score'], reverse=True)
    return scored[:top_k]

# ── Background embedding workers ─────────────────────────────────────────────

def _embed_articles_bg(symbol: str, articles: list):
    conn = sqlite3.connect(DB_PATH)
    try:
        for a in articles:
            store_embedding(conn, symbol,
                f"{a['title']}\n\n{a.get('summary', '')}",
                source=a.get('source', 'news'),
                article_url=a.get('url', ''),
                ts=a.get('published'))
    except Exception as e:
        log.warning(f'_embed_articles_bg({symbol}): {e}')
    finally:
        conn.close()

def _embed_profile_bg(symbol: str, profile: dict):
    conn = sqlite3.connect(DB_PATH)
    try:
        store_embedding(conn, symbol,
            f"{profile.get('name','')} — {profile.get('sector','')} / {profile.get('industry','')}\n"
            f"{profile.get('description','')}",
            source='profile', article_url=f'profile:{symbol}')
    except Exception as e:
        log.warning(f'_embed_profile_bg({symbol}): {e}')
    finally:
        conn.close()

def _embed_financials_bg(symbol: str, data: dict):
    conn = sqlite3.connect(DB_PATH)
    try:
        store_embedding(conn, symbol,
            f"Financials for {symbol}: P/E {data.get('pe_ratio')}, "
            f"Revenue TTM {data.get('revenue_ttm')}, Net Income TTM {data.get('net_income_ttm')}, "
            f"Gross Margin {data.get('gross_margin')}, EPS {data.get('eps')}, "
            f"52W High {data.get('week52_high')}, 52W Low {data.get('week52_low')}",
            source='financials', article_url=f'financials:{symbol}')
    except Exception as e:
        log.warning(f'_embed_financials_bg({symbol}): {e}')
    finally:
        conn.close()

# ── yfinance wrappers ────────────────────────────────────────────────────────
RANGE_MAP = {
    '1d':  ('1d',  '5m'),
    '5d':  ('5d',  '60m'),
    '1mo': ('1mo', '1d'),
    '3mo': ('3mo', '1d'),
    '1y':  ('1y',  '1wk'),
    '5y':  ('5y',  '1mo'),
}

def fetch_quote(symbol: str) -> dict | None:
    try:
        t = yf.Ticker(symbol)
        info = t.fast_info
        fi   = t.info  # full info — slower but needed for mkt cap etc.

        price      = getattr(info, 'last_price', None) or fi.get('currentPrice') or fi.get('regularMarketPrice')
        prev_close = getattr(info, 'previous_close', None) or fi.get('previousClose')
        opn        = getattr(info, 'open', None) or fi.get('open') or fi.get('regularMarketOpen')
        high       = getattr(info, 'day_high', None) or fi.get('dayHigh') or fi.get('regularMarketDayHigh')
        low        = getattr(info, 'day_low', None)  or fi.get('dayLow')  or fi.get('regularMarketDayLow')
        volume     = getattr(info, 'three_month_average_volume', None) or fi.get('volume') or fi.get('regularMarketVolume')
        mkt_cap    = getattr(info, 'market_cap', None) or fi.get('marketCap')
        currency   = fi.get('currency', 'INR' if '.NS' in symbol or '.BO' in symbol else 'USD')

        if price is None:
            return None

        change     = round(price - prev_close, 2) if prev_close else 0
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0

        return {
            'symbol':     symbol,
            'price':      round(float(price), 2),
            'open':       round(float(opn), 2) if opn else None,
            'high':       round(float(high), 2) if high else None,
            'low':        round(float(low), 2)  if low  else None,
            'prev_close': round(float(prev_close), 2) if prev_close else None,
            'change':     change,
            'change_pct': change_pct,
            'volume':     int(volume) if volume else None,
            'mkt_cap':    float(mkt_cap) if mkt_cap else None,
            'currency':   currency,
        }
    except Exception as e:
        log.warning(f'fetch_quote({symbol}): {e}')
        return None

def fetch_history(symbol: str, range_key: str) -> list:
    period, interval = RANGE_MAP.get(range_key, ('1mo', '1d'))
    try:
        t  = yf.Ticker(symbol)
        df = t.history(period=period, interval=interval, auto_adjust=True)
        if df.empty:
            return []
        rows = []
        for ts, row in df.iterrows():
            rows.append({
                'ts':     int(ts.timestamp()),
                'open':   round(float(row['Open']),  2),
                'high':   round(float(row['High']),  2),
                'low':    round(float(row['Low']),   2),
                'close':  round(float(row['Close']), 2),
                'volume': int(row['Volume']) if row['Volume'] else 0,
            })
        return rows
    except Exception as e:
        log.warning(f'fetch_history({symbol},{range_key}): {e}')
        return []

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
    # ── Existing market feeds ────────────────────────────────────────────────
    ('Economic Times',   'https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2143429.cms'),
    ('Moneycontrol',     'https://www.moneycontrol.com/rss/MCtopnews.xml'),
    ('Business Standard','https://www.business-standard.com/rss/markets-106.rss'),
    ('LiveMint',         'https://www.livemint.com/rss/markets'),
    ('CNBC TV18',        'https://www.cnbctv18.com/commonfeeds/v1/eng/rss/market.xml'),
    # ── Quarterly results & earnings ─────────────────────────────────────────
    ('Financial Express','https://www.financialexpress.com/market/feed/'),
    ('Hindu BusinessLine','https://www.thehindubusinessline.com/markets/feeder/default.rss'),
    ('ET Earnings',      'https://economictimes.indiatimes.com/markets/earnings/rssfeeds/2143522.cms'),
    # ── Contracts, orders, government news ───────────────────────────────────
    ('ET Industry',      'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms'),
    ('PIB India',        'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3'),
    ('BQ Prime',         'https://www.bqprime.com/feeds/rss.xml'),
    ('Reuters India',    'https://feeds.reuters.com/reuters/INbusinessNews'),
    ('BSE Corporate',    'https://www.bseindia.com/xml-data/corpfiling/AttachLive/rss.xml'),
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
        api_key = 'vd7l5h51r01qm7o0aj74gd7l5h51r01qm7o0aj750'
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

    try:
        results = yf.Search(q, max_results=10).quotes
        mapped  = []
        for r in results:
            sym = r.get('symbol','')
            mapped.append({
                'symbol':   sym,
                'name':     r.get('longname') or r.get('shortname', sym),
                'exchange': r.get('exchange',''),
                'type':     r.get('quoteType',''),
            })

        db.execute("""
            INSERT OR REPLACE INTO search_cache (query,results,fetched_at)
            VALUES (?,?,?)
        """, (q.lower(), json.dumps(mapped), now_ts()))
        db.commit()
        return jsonify({'ok': True, 'data': mapped})
    except Exception as e:
        log.warning(f'search({q}): {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500

# ── Watchlist CRUD ────────────────────────────────────────────────────────────
@app.route('/api/watchlist', methods=['GET'])
def wl_get():
    db   = get_db()
    rows = rows_to_list(db.execute('SELECT * FROM watchlist ORDER BY added_at DESC').fetchall())
    return jsonify({'ok': True, 'data': rows})

@app.route('/api/watchlist', methods=['POST'])
def wl_add():
    body = request.get_json(silent=True) or {}
    sym  = body.get('symbol','').strip().upper()
    name = body.get('name', sym)
    exch = body.get('exchange','')
    if not sym:
        return jsonify({'ok': False, 'error': 'symbol required'}), 400
    db = get_db()
    db.execute('INSERT OR IGNORE INTO watchlist (symbol,name,exchange) VALUES (?,?,?)', (sym,name,exch))
    db.commit()
    return jsonify({'ok': True})

@app.route('/api/watchlist/<path:symbol>', methods=['DELETE'])
def wl_del(symbol):
    db = get_db()
    db.execute('DELETE FROM watchlist WHERE symbol=?', (symbol,))
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
            db2 = sqlite3.connect(DB_PATH)
            db2.execute("""
                INSERT OR REPLACE INTO quotes
                    (symbol,price,open,high,low,prev_close,change,change_pct,volume,mkt_cap,currency,fetched_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """, (sym, data['price'], data['open'], data['high'], data['low'],
                  data['prev_close'], data['change'], data['change_pct'],
                  data['volume'], data['mkt_cap'], data['currency'], now_ts()))
            db2.commit()
            db2.close()

    threads = [threading.Thread(target=fetch_one, args=(sym,)) for sym in missing]
    for t in threads: t.start()
    for t in threads: t.join(timeout=20)

    return jsonify({'ok': True, 'data': results})

# ── Health check ──────────────────────────────────────────────────────────────
@app.route('/api/ping')
def ping():
    return jsonify({'ok': True, 'ts': now_ts(), 'version': '2.0.0'})

# ── AI Chat (RAG + Claude streaming) ─────────────────────────────────────────
SYSTEM_PROMPT = (
    "You are a stock analysis assistant for StockPulse, an Indian market tracker. "
    "You have access to recent news, financial data, and price info for the user's watchlist. "
    "Answer questions concisely and accurately based ONLY on the provided context. "
    "If the context is insufficient to answer, say so clearly — do not fabricate data. "
    "Format Indian currency as ₹ with Indian number notation (e.g. ₹1,23,456 Cr). "
    "Keep responses under 300 words unless a longer analysis is explicitly requested."
)

@app.route('/api/chat', methods=['POST'])
def api_chat():
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        return jsonify({'ok': False, 'error':
            'ANTHROPIC_API_KEY is not set.\n\n'
            'To get a free key:\n'
            '1. Go to https://console.anthropic.com\n'
            '2. Sign up / Log in → API Keys → Create Key\n'
            '3. Run: export ANTHROPIC_API_KEY=sk-ant-...\n'
            '   Or add it to start-stockpulse.command before the python3 line.'}), 503

    body         = request.get_json(silent=True) or {}
    question     = (body.get('question') or '').strip()
    symbols      = body.get('symbols', [])
    chat_history = body.get('chat_history', [])

    if not question:
        return jsonify({'ok': False, 'error': 'question required'}), 400

    # Default to full watchlist if no symbols given
    if not symbols:
        db = get_db()
        symbols = [r['symbol'] for r in db.execute('SELECT symbol FROM watchlist').fetchall()]

    # RAG retrieval
    chunks = retrieve_top_chunks(symbols, question, top_k=5)
    if chunks:
        ctx_parts = []
        for i, c in enumerate(chunks, 1):
            age = ''
            if c.get('ts'):
                days = (now_ts() - c['ts']) // 86400
                if days < 30:
                    age = f' ({days}d ago)'
            ctx_parts.append(f"[{i}] {c['symbol']} — {c['source']}{age}\n{c['content']}")
        context_block = "--- RELEVANT CONTEXT ---\n" + "\n\n".join(ctx_parts) + "\n--- END CONTEXT ---"
    else:
        context_block = "No specific context found in the database for this query yet. " \
                        "Try adding stocks to your watchlist first so data can be indexed."

    # Build messages (last 5 conversation turns + new question)
    messages = [
        {'role': t['role'], 'content': t['content']}
        for t in chat_history[-10:]
        if t.get('role') in ('user', 'assistant') and t.get('content')
    ]
    messages.append({'role': 'user', 'content': f"{context_block}\n\nQuestion: {question}"})

    def generate():
        try:
            client = anthropic.Anthropic(api_key=api_key)
            with client.messages.stream(
                model='claude-haiku-4-5-20251001',
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'type': 'delta', 'text': text})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except anthropic.AuthenticationError:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Invalid ANTHROPIC_API_KEY — check your key at console.anthropic.com'})}\n\n"
        except Exception as e:
            log.warning(f'api_chat stream error: {e}')
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )

@app.route('/api/ai-summary/<path:symbol>')
def api_ai_summary(symbol):
    """Pre-generated one-paragraph AI summary for a stock."""
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        return jsonify({'ok': False, 'error': 'ANTHROPIC_API_KEY not set'}), 503

    db = get_db()
    news_rows = db.execute(
        'SELECT title,source FROM news WHERE symbol=? ORDER BY published DESC LIMIT 5',
        (symbol,)).fetchall()
    fin_row   = row_to_dict(db.execute('SELECT * FROM financials WHERE symbol=?', (symbol,)).fetchone())
    quote_row = row_to_dict(db.execute('SELECT * FROM quotes WHERE symbol=?',     (symbol,)).fetchone())

    news_text  = '\n'.join(f"- [{r['source']}] {r['title']}" for r in news_rows) or 'No recent news.'
    fin_text   = (f"P/E: {fin_row.get('pe_ratio')}, Revenue TTM: {fin_row.get('revenue_ttm')}, "
                  f"Gross Margin: {fin_row.get('gross_margin')}, EPS: {fin_row.get('eps')}"
                 ) if fin_row else 'No financials available.'
    price_text = (f"Current: {quote_row.get('price')}, Change: {quote_row.get('change_pct')}%, "
                  f"Mkt Cap: {quote_row.get('mkt_cap')}"
                 ) if quote_row else ''

    prompt = (
        f"Write a one-paragraph stock analysis summary for {symbol} based on the following data.\n\n"
        f"Recent news:\n{news_text}\n\nFinancials: {fin_text}\nPrice: {price_text}\n\n"
        "Be factual, highlight key positives/risks, keep it under 120 words."
    )
    try:
        client = anthropic.Anthropic(api_key=api_key)
        msg    = client.messages.create(
            model='claude-haiku-4-5-20251001', max_tokens=200,
            system=SYSTEM_PROMPT,
            messages=[{'role': 'user', 'content': prompt}])
        return jsonify({'ok': True, 'summary': msg.content[0].text})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    # Preload embedding model in background so first chat isn't slow
    threading.Thread(target=get_embed_model, daemon=True).start()
    log.info('StockPulse server starting on http://localhost:5001')
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
