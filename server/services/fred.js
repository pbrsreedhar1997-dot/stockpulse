/**
 * fred.js — FRED (Federal Reserve Economic Data) yield-curve signal
 *
 * Single-purpose: fetch the US 10Y (DGS10) and 2Y (DGS2) treasury yields and
 * compute the 10Y-2Y spread — the standard recession/yield-curve-inversion
 * indicator. The confidence engine (ai.js computeConfidenceScore) already has
 * a `yieldCurveInverted` risk flag; this is the real data source for it.
 */

import { get as cacheGet, set as cacheSet } from '../cache.js';
import { FRED_API_KEY } from '../config.js';
import log from '../log.js';

const BASE = 'https://api.stlouisfed.org/fred/series/observations';

async function latestObservation(seriesId) {
  const url = `${BASE}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`FRED HTTP ${r.status}`);
  const json = await r.json();
  const obs = json?.observations?.[0];
  const value = obs?.value != null && obs.value !== '.' ? Number(obs.value) : null;
  return value != null && isFinite(value) ? value : null;
}

export async function getYieldCurve() {
  if (!FRED_API_KEY) return null;

  const ckey = 'fred:yieldcurve';
  const cached = await cacheGet(ckey);
  if (cached) return cached;

  try {
    const [y10, y2] = await Promise.all([
      latestObservation('DGS10'),
      latestObservation('DGS2'),
    ]);
    if (y10 == null || y2 == null) return null;

    const spread   = +(y10 - y2).toFixed(2);
    const inverted = spread < 0;
    const result = { y10, y2, spread, inverted };

    await cacheSet(ckey, result, 6 * 3600); // FRED updates daily at most — 6h cache is plenty
    return result;
  } catch (e) {
    log.warn(`FRED yield curve fetch failed: ${e.message}`);
    return null;
  }
}
