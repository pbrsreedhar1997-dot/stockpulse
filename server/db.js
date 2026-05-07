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
        notes TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
        UNIQUE(user_id, symbol)
      )`);
    log.info('PostgreSQL schema ready');
  } catch (err) {
    log.error('DB init failed:', err.message);
  }
}
