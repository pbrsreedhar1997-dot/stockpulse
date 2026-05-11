import pg from 'pg';
import { DATABASE_URL } from './config.js';
import log from './log.js';

const { Pool } = pg;
let pool = null;

function getPool() {
  if (pool) return pool;
  if (!DATABASE_URL) return null;
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: !DATABASE_URL.includes('localhost') ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', err => log.error('PG pool error:', err.message));
  log.info('PostgreSQL pool created');
  return pool;
}

export async function query(sql, params = []) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL not configured');
  const client = await p.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function initDb() {
  if (!DATABASE_URL) {
    log.warn('No DATABASE_URL — auth/watchlist features disabled');
    return;
  }
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, name TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    await query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)`);
    await query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL, name TEXT, exchange TEXT,
        added_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        PRIMARY KEY (user_id, symbol)
      )`);
    await query(`
      CREATE TABLE IF NOT EXISTS portfolio (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        name TEXT,
        shares NUMERIC(15,4) NOT NULL CHECK (shares > 0),
        avg_price NUMERIC(15,4) NOT NULL CHECK (avg_price > 0),
        stop_loss NUMERIC(15,4),
        purchase_date BIGINT,
        notes TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        UNIQUE(user_id, symbol)
      )`);
    // Add new columns to existing table if upgrading
    await query(`ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(15,4)`).catch(() => {});
    await query(`ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS purchase_date BIGINT`).catch(() => {});
    // Web Push subscriptions
    await query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        p256dh   TEXT NOT NULL,
        auth     TEXT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)`);
    // AI Chat history
    await query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL DEFAULT 'New Chat',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id)`);
    await query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id         SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content    TEXT NOT NULL,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)`);
    // ── Screener picks cache (persists across server restarts) ──────────────
    await query(`
      CREATE TABLE IF NOT EXISTS screener_picks (
        symbol          VARCHAR(20) PRIMARY KEY,
        name            VARCHAR(200),
        sector          VARCHAR(100),
        industry        VARCHAR(100),
        theme           VARCHAR(100),
        price           NUMERIC(14,4),
        week52_high     NUMERIC(14,4),
        week52_low      NUMERIC(14,4),
        decline_pct     NUMERIC(6,2),
        mkt_cap_cr      INTEGER,
        change_pct      NUMERIC(6,2),
        pe_ratio        NUMERIC(10,2),
        eps             NUMERIC(14,4),
        net_margin      NUMERIC(8,2),
        roe             NUMERIC(8,2),
        gross_margin    NUMERIC(8,2),
        revenue_cr      INTEGER,
        composite_score INTEGER,
        category        VARCHAR(20),
        scanned_at      BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    // ── AI analysis cache ────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS screener_ai_analysis (
        id           SERIAL PRIMARY KEY,
        analysis     TEXT NOT NULL,
        picks_count  INTEGER,
        created_at   BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_screener_ai_ts ON screener_ai_analysis(created_at DESC)`);
    // ── Prediction accuracy tracking (Layer 8) ───────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS predictions_tracking (
        id                SERIAL PRIMARY KEY,
        ticker            VARCHAR(20) NOT NULL,
        confidence_score  INTEGER NOT NULL,
        alignment_score   INTEGER,
        quality_score     INTEGER,
        bonus_points      INTEGER,
        risk_deductions   INTEGER,
        predicted_at      BIGINT NOT NULL,
        price_at_signal   NUMERIC(15,4),
        bear_target       NUMERIC(15,4),
        base_target       NUMERIC(15,4),
        bull_target       NUMERIC(15,4),
        horizon_days      INTEGER DEFAULT 90,
        technical_score   INTEGER,
        fundamental_score INTEGER,
        sentiment_score   INTEGER,
        macro_score       INTEGER,
        ensemble_score    INTEGER,
        ensemble_signal   VARCHAR(20),
        actual_price      NUMERIC(15,4),
        was_correct       BOOLEAN,
        deviation_pct     NUMERIC(8,2),
        resolved_at       BIGINT
      )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pred_ticker ON predictions_tracking(ticker)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_pred_at    ON predictions_tracking(predicted_at DESC)`);
    // ── User corrections store (Module 8 — RAG vector store proxy) ──────────
    await query(`
      CREATE TABLE IF NOT EXISTS user_corrections (
        id             SERIAL PRIMARY KEY,
        ticker         VARCHAR(20),
        question_text  TEXT,
        corrected_at   BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_corrections_ticker ON user_corrections(ticker)`);
    // ── Response accuracy logging (Fix Layer 7) ──────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS response_logs (
        id             SERIAL PRIMARY KEY,
        ticker         VARCHAR(20),
        query_type     VARCHAR(30),
        confidence_score INTEGER,
        gate_issues    TEXT,
        gate_penalty   INTEGER,
        logged_at      BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
      )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_response_logs_at ON response_logs(logged_at DESC)`);
    log.info('PostgreSQL schema ready');
  } catch (err) {
    log.error('DB init failed:', err.message);
  }
}
