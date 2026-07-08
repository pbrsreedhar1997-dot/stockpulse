/**
 * refresh-fundamentals.mjs — one-shot screener scan for the scheduled local job.
 *
 * Runs on a machine with a NON-datacenter IP (e.g. your Mac) where Yahoo serves
 * full fundamentals, and writes them to the shared Postgres DB. The deployed app
 * on Render (where Yahoo blocks fundamentals) then reads this fresh data for the
 * Financials / Company / Insights tabs.
 *
 * Scheduled via launchd — see scripts/com.stockpulse.fundamentals.plist.
 * Run manually with:  node server/scripts/refresh-fundamentals.mjs
 */
import { initDb } from '../db.js';
import { initCache } from '../cache.js';
import { runScreener } from '../services/screener.js';
import log from '../log.js';

const started = Date.now();

try {
  await initDb();               // ensure tables/columns exist
  await initCache('');          // in-memory cache (no Redis needed)
  log.info('Fundamentals refresh: scan starting…');

  const results = await runScreener();

  const secs = Math.round((Date.now() - started) / 1000);
  log.info(`Fundamentals refresh: done — ${results.length} stocks updated in ${secs}s`);
  process.exit(0);
} catch (err) {
  log.error('Fundamentals refresh failed:', err?.message || err);
  process.exit(1);
}
