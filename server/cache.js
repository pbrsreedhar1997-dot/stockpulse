import log from './log.js';

let redis = null;
const mem = new Map();

export async function initCache(redisUrl) {
  if (!redisUrl) { log.info('No REDIS_URL — in-memory cache'); return; }
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, connectTimeout: 5000, lazyConnect: true });
    await redis.connect();
    log.info('Redis connected');
  } catch (e) {
    log.warn('Redis unavailable, using in-memory cache:', e.message);
    redis = null;
  }
}

export async function get(key) {
  try {
    if (redis) { const v = await redis.get(key); return v ? JSON.parse(v) : null; }
    const entry = mem.get(key);
    if (!entry) return null;
    if (entry.exp && entry.exp < Date.now()) { mem.delete(key); return null; }
    return entry.val;
  } catch { return null; }
}

export async function set(key, val, ttl = 60) {
  try {
    if (redis) { await redis.set(key, JSON.stringify(val), 'EX', ttl); return; }
    mem.set(key, { val, exp: Date.now() + ttl * 1000 });
    if (mem.size > 5000) {
      const now = Date.now();
      for (const [k, v] of mem) { if (v.exp < now) mem.delete(k); }
    }
  } catch {}
}

export async function del(key) {
  if (redis) { await redis.del(key).catch(() => {}); return; }
  mem.delete(key);
}
