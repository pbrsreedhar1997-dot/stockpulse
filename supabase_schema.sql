-- StockPulse — Supabase schema
-- Run this in Supabase → SQL Editor → New Query → Run
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.

-- Enable pgvector extension (needed for AI embeddings; skip if not using RAG)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    created_at    INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- ── User sessions (login tokens) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

-- ── Watchlist (per-user) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol      TEXT NOT NULL,
    name        TEXT,
    exchange    TEXT,
    added_at    INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
    PRIMARY KEY (user_id, symbol)
);

-- ── Quote cache ────────────────────────────────────────────────────────────────
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

-- ── Price history cache ────────────────────────────────────────────────────────
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

-- ── Company profiles ───────────────────────────────────────────────────────────
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

-- ── Financials cache ───────────────────────────────────────────────────────────
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

-- ── News cache ────────────────────────────────────────────────────────────────
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

-- ── Search cache ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_cache (
    query       TEXT PRIMARY KEY,
    results     TEXT,
    fetched_at  INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- ── Value Picks screener cache ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS screener_cache (
    screener_id TEXT PRIMARY KEY,
    results     TEXT,
    fetched_at  INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);

-- ── AI embeddings (RAG) ───────────────────────────────────────────────────────
-- Only needed if you enable the fastembed RAG feature.
-- If pgvector is not available the app still works (falls back to numpy).
CREATE TABLE IF NOT EXISTS embeddings (
    chunk_id    SERIAL PRIMARY KEY,
    symbol      TEXT NOT NULL,
    content     TEXT NOT NULL,
    vector      vector(384),
    source      TEXT,
    article_url TEXT,
    ts          INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
);
CREATE INDEX IF NOT EXISTS idx_embed_symbol ON embeddings(symbol, ts DESC);
-- HNSW index for fast cosine similarity search (requires pgvector >= 0.5)
CREATE INDEX IF NOT EXISTS idx_embed_hnsw ON embeddings USING hnsw (vector vector_cosine_ops);
