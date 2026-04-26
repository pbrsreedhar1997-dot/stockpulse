"""
db.py — StockPulse database abstraction.

Primary:  PostgreSQL 17 + pgvector  (set DATABASE_URL env var)
Fallback: SQLite WAL                (stockpulse.db, default)

The PG connection wrapper translates SQLite dialect on the fly:
  ?              → %s  placeholders
  INSERT OR IGNORE  → INSERT … ON CONFLICT DO NOTHING
  INSERT OR REPLACE → INSERT … ON CONFLICT (pk) DO UPDATE SET …

All callers can use the same API regardless of backend.
"""

import os
import re
import sqlite3
import threading
import time
import logging
import numpy as np
from contextlib import contextmanager

log = logging.getLogger('stockpulse.db')

# ── Backend selection ─────────────────────────────────────────────────────────
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
# Normalize scheme: postgres:// → postgresql://, bare host → add postgresql://
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = 'postgresql://' + DATABASE_URL[len('postgres://'):]
elif DATABASE_URL and not DATABASE_URL.startswith('postgresql://'):
    DATABASE_URL = 'postgresql://' + DATABASE_URL
USE_PG = bool(DATABASE_URL)
DB_PATH      = os.path.join(os.path.dirname(__file__), 'stockpulse.db')

# ── Table primary keys — needed to generate ON CONFLICT upsert clauses ────────
_TABLE_PK = {
    'quotes':         'symbol',
    'profiles':       'symbol',
    'financials':     'symbol',
    'search_cache':   'query',
    'user_sessions':  'token',
    # watchlist has composite PK (user_id, symbol) — ON CONFLICT DO NOTHING is used
}

# ── SQL dialect adapter ───────────────────────────────────────────────────────
def _pg_sql(sql: str) -> str:
    """Translate SQLite-dialect SQL to PostgreSQL."""
    sql = sql.replace('?', '%s')

    # INSERT OR IGNORE → INSERT … ON CONFLICT DO NOTHING
    if re.search(r'INSERT\s+OR\s+IGNORE', sql, re.IGNORECASE):
        sql = re.sub(r'INSERT\s+OR\s+IGNORE', 'INSERT', sql, flags=re.IGNORECASE)
        return sql.rstrip().rstrip(';') + ' ON CONFLICT DO NOTHING'

    # INSERT OR REPLACE → INSERT … ON CONFLICT (pk) DO UPDATE SET …
    if re.search(r'INSERT\s+OR\s+REPLACE', sql, re.IGNORECASE):
        sql = re.sub(r'INSERT\s+OR\s+REPLACE', 'INSERT', sql, flags=re.IGNORECASE)
        m = re.search(r'INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)', sql, re.IGNORECASE)
        if m:
            table = m.group(1).lower()
            cols  = [c.strip() for c in m.group(2).split(',')]
            pk    = _TABLE_PK.get(table, cols[0])
            upd   = [c for c in cols if c != pk]
            sql   = sql.rstrip().rstrip(';')
            sql  += f' ON CONFLICT ({pk}) DO UPDATE SET '
            sql  += ', '.join(f'{c}=EXCLUDED.{c}' for c in upd)
        return sql

    return sql


# ── PostgreSQL connection wrapper ─────────────────────────────────────────────
class _PGCursor:
    """Wraps psycopg2 RealDictCursor to match the sqlite3.Cursor interface."""
    def __init__(self, cur):
        self._cur = cur

    def fetchone(self):
        row = self._cur.fetchone()
        return dict(row) if row else None

    def fetchall(self):
        return [dict(r) for r in self._cur.fetchall()]

    def __iter__(self):
        return self

    def __next__(self):
        row = self._cur.fetchone()
        if row is None:
            raise StopIteration
        return dict(row)


class _PGConn:
    """
    Wraps a psycopg2 connection to mimic SQLite's dict-row interface so
    stock-server.py needs minimal changes.
    """
    def __init__(self, conn):
        self._conn = conn
        self.row_factory = None  # compatibility shim — ignored for PG

    def execute(self, sql: str, params=None):
        import psycopg2.extras
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(_pg_sql(sql), params or ())
        return _PGCursor(cur)

    def executemany(self, sql: str, params_list):
        import psycopg2.extras
        cur = self._conn.cursor()
        psycopg2.extras.execute_batch(cur, _pg_sql(sql), list(params_list), page_size=200)
        return cur

    def commit(self):
        self._conn.commit()

    def close(self):
        try:
            self._conn.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


# ── PostgreSQL connection pool ────────────────────────────────────────────────
_pg_pool      = None
_pg_pool_lock = threading.Lock()


def _get_pg_pool():
    global _pg_pool
    if _pg_pool is None:
        with _pg_pool_lock:
            if _pg_pool is None:
                import psycopg2.pool
                dsn = DATABASE_URL
                # Supabase (and any remote host) requires SSL
                is_remote = 'localhost' not in dsn and '127.0.0.1' not in dsn
                if is_remote and 'sslmode' not in dsn:
                    dsn += ('&' if '?' in dsn else '?') + 'sslmode=require'
                if 'connect_timeout' not in dsn:
                    dsn += '&connect_timeout=10'
                _pg_pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=1, maxconn=10, dsn=dsn
                )
                log.info('PostgreSQL pool ready')
    return _pg_pool


def _get_pg_conn() -> _PGConn:
    raw = _get_pg_pool().getconn()
    # autocommit=False is the psycopg2 default; setting it here triggers
    # set_session() which raises ProgrammingError when a transaction is open
    # on a recycled pool connection — so we just leave it alone.
    return _PGConn(raw), raw


def _put_pg_conn(raw):
    try:
        _get_pg_pool().putconn(raw)
    except Exception:
        pass


# ── Flask request-context helpers ─────────────────────────────────────────────
def get_db():
    """Return the current request's database connection (Flask g)."""
    from flask import g
    if USE_PG:
        if 'db' not in g:
            wrapped, raw = _get_pg_conn()
            g.db      = wrapped
            g._db_raw = raw
        return g.db
    else:
        if 'db' not in g:
            g.db = sqlite3.connect(DB_PATH)
            g.db.row_factory = sqlite3.Row
            g.db.execute('PRAGMA foreign_keys = ON')
        return g.db


def close_db(_=None):
    """Release the request's connection back to the pool (PG) or close (SQLite)."""
    from flask import g
    if USE_PG:
        raw = g.pop('_db_raw', None)
        g.pop('db', None)
        if raw:
            try:
                raw.rollback()  # discard any uncommitted transaction before recycling
            except Exception:
                pass
            _put_pg_conn(raw)
    else:
        db = g.pop('db', None)
        if db:
            db.close()


# ── Background-thread connection context manager ──────────────────────────────
@contextmanager
def thread_connection():
    """
    Use in background threads / one-off scripts:

        with thread_connection() as conn:
            conn.execute(...)
            conn.commit()
    """
    if USE_PG:
        wrapped, raw = _get_pg_conn()
        try:
            yield wrapped
        finally:
            _put_pg_conn(raw)
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()


# ── Schema ────────────────────────────────────────────────────────────────────
_SQLITE_SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    created_at    INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS watchlist (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL,
    name        TEXT,
    exchange    TEXT,
    added_at    INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, symbol)
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
    category    TEXT DEFAULT 'gen',
    fetched_at  INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(symbol, url)
);
CREATE INDEX IF NOT EXISTS idx_news ON news(symbol, published DESC);

CREATE TABLE IF NOT EXISTS search_cache (
    query       TEXT PRIMARY KEY,
    results     TEXT,
    fetched_at  INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS screener_cache (
    screener_id TEXT PRIMARY KEY,
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

_PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    created_at    INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS watchlist (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL,
    name        TEXT,
    exchange    TEXT,
    added_at    INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
    PRIMARY KEY (user_id, symbol)
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
    volume      BIGINT,
    mkt_cap     REAL,
    currency    TEXT,
    fetched_at  INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

CREATE TABLE IF NOT EXISTS history (
    id          SERIAL PRIMARY KEY,
    symbol      TEXT NOT NULL,
    range_key   TEXT NOT NULL,
    ts          INTEGER NOT NULL,
    open        REAL,
    high        REAL,
    low         REAL,
    close       REAL,
    volume      BIGINT,
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
    fetched_at  INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
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
    avg_volume      BIGINT,
    fetched_at      INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

CREATE TABLE IF NOT EXISTS news (
    id          SERIAL PRIMARY KEY,
    symbol      TEXT NOT NULL,
    source      TEXT,
    title       TEXT NOT NULL,
    url         TEXT,
    published   INTEGER,
    summary     TEXT,
    relevance   TEXT DEFAULT 'medium',
    category    TEXT DEFAULT 'gen',
    fetched_at  INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
    UNIQUE(symbol, url)
);
CREATE INDEX IF NOT EXISTS idx_news ON news(symbol, published DESC);

CREATE TABLE IF NOT EXISTS search_cache (
    query       TEXT PRIMARY KEY,
    results     TEXT,
    fetched_at  INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

CREATE TABLE IF NOT EXISTS screener_cache (
    screener_id TEXT PRIMARY KEY,
    results     TEXT,
    fetched_at  INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

CREATE TABLE IF NOT EXISTS embeddings (
    chunk_id    SERIAL PRIMARY KEY,
    symbol      TEXT NOT NULL,
    content     TEXT NOT NULL,
    vector      vector(384) NOT NULL,
    source      TEXT,
    article_url TEXT,
    ts          INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);
CREATE INDEX IF NOT EXISTS idx_embed_symbol ON embeddings(symbol, ts DESC);
CREATE INDEX IF NOT EXISTS idx_embed_hnsw   ON embeddings USING hnsw (vector vector_cosine_ops);
"""


def init_db():
    """Create tables and indexes. Safe to call on every startup (IF NOT EXISTS)."""
    if USE_PG:
        for attempt in range(3):
            try:
                with thread_connection() as conn:
                    # Enable pgvector — non-fatal if not available
                    try:
                        conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
                        conn.commit()
                    except Exception as e:
                        log.warning(f'pgvector unavailable ({e}); vector search will use numpy')

                    for stmt in _PG_SCHEMA.split(';'):
                        stmt = stmt.strip()
                        if not stmt:
                            continue
                        try:
                            conn.execute(stmt)
                        except Exception as e:
                            if 'hnsw' in stmt.lower() or 'vector' in stmt.lower():
                                log.warning(f'Schema stmt skipped (pgvector?): {e}')
                            else:
                                raise
                    conn.commit()

                    # Migrate watchlist to user-specific schema if needed
                    # Must run inside the same with-block — conn is closed after exit
                    cols = conn.execute("""
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name='watchlist' AND table_schema='public'
                    """).fetchall()
                    col_names = [c['column_name'] for c in cols]
                    if col_names and 'user_id' not in col_names:
                        log.info('Migrating watchlist to user-specific schema…')
                        conn.execute('DROP TABLE IF EXISTS watchlist CASCADE')
                        conn.execute("""
                            CREATE TABLE watchlist (
                                user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                symbol   TEXT NOT NULL,
                                name     TEXT,
                                exchange TEXT,
                                added_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
                                PRIMARY KEY (user_id, symbol)
                            )
                        """)
                        conn.commit()

                log.info('PostgreSQL schema ready')
                return
            except Exception as e:
                log.warning(f'DB init attempt {attempt + 1}/3 failed: {e}')
                if attempt < 2:
                    time.sleep(3)
                else:
                    log.error('PostgreSQL unreachable after 3 attempts — falling back to SQLite')
                    _init_sqlite()
    else:
        _init_sqlite()


def _init_sqlite():
    raw = sqlite3.connect(DB_PATH)
    raw.executescript(_SQLITE_SCHEMA)
    raw.commit()
    try:
        raw.execute("ALTER TABLE news ADD COLUMN category TEXT DEFAULT 'gen'")
        raw.commit()
    except sqlite3.OperationalError:
        pass
    raw.close()
    log.info(f'SQLite schema ready at {DB_PATH}')


# ── Vector storage helpers ────────────────────────────────────────────────────
def _vec_to_pg_str(vec: np.ndarray) -> str:
    """Convert float32 numpy array to pgvector literal '[x,y,…]'."""
    return '[' + ','.join(f'{v:.8f}' for v in vec.tolist()) + ']'


def store_embedding_vec(conn, symbol: str, content: str, vec: np.ndarray,
                        source: str, article_url: str = '', ts: int = None):
    """
    Persist a pre-computed embedding vector.
    `vec` must be a float32 numpy array of shape (384,).
    """
    if not content or len(content.strip()) < 40:
        return
    if article_url and conn.execute(
            'SELECT 1 FROM embeddings WHERE symbol=? AND article_url=?',
            (symbol, article_url)).fetchone():
        return  # already stored

    if USE_PG:
        vec_str = _vec_to_pg_str(vec)
        conn.execute(
            "INSERT INTO embeddings (symbol,content,vector,source,article_url,ts) "
            "VALUES (%s,%s,%s::vector,%s,%s,%s) ON CONFLICT DO NOTHING",
            (symbol, content[:2000], vec_str, source, article_url or '', ts or int(time.time()))
        )
    else:
        conn.execute(
            'INSERT INTO embeddings (symbol,content,vector,source,article_url,ts) VALUES (?,?,?,?,?,?)',
            (symbol, content[:2000], vec.astype(np.float32).tobytes(),
             source, article_url or '', ts or int(time.time()))
        )
    conn.commit()


def retrieve_top_chunks(symbols: list, query_vec: np.ndarray, top_k: int = 5) -> list:
    """
    Return top-k most similar embeddings for the given symbols.
    `query_vec` is a float32 numpy array of shape (384,).

    PG path: uses pgvector HNSW index (cosine distance <=>).
    SQLite path: numpy linear scan.
    """
    if not symbols:
        return []

    if USE_PG:
        with thread_connection() as conn:
            placeholders = ','.join(['%s'] * len(symbols))
            vec_str      = _vec_to_pg_str(query_vec)
            rows = conn.execute(
                f"""
                SELECT symbol, content, source, article_url, ts,
                       (1 - (vector <=> '{vec_str}'::vector)) AS score
                FROM   embeddings
                WHERE  symbol IN ({placeholders})
                ORDER  BY vector <=> '{vec_str}'::vector
                LIMIT  %s
                """,
                symbols + [top_k]
            ).fetchall()
        return [dict(r) for r in rows]

    else:
        with thread_connection() as conn:
            placeholders = ','.join('?' * len(symbols))
            rows = conn.execute(
                f'SELECT symbol,content,vector,source,article_url,ts '
                f'FROM embeddings WHERE symbol IN ({placeholders})',
                symbols
            ).fetchall()

        scored = []
        for r in rows:
            try:
                r = dict(r)
                vec  = np.frombuffer(r['vector'], dtype=np.float32)
                denom = np.linalg.norm(query_vec) * np.linalg.norm(vec)
                score = float(np.dot(query_vec, vec) / denom) if denom else 0.0
                r['score'] = score
                del r['vector']  # don't ship raw bytes to callers
                scored.append(r)
            except Exception:
                continue
        scored.sort(key=lambda x: x['score'], reverse=True)
        return scored[:top_k]
