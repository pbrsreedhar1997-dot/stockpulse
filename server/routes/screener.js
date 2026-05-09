import { Router } from 'express';
import {
  getValuePicks, getAllStocks, refreshScreener,
  getRecentAnalysis, saveAnalysis, buildAnalysisPrompt,
  loadPicksFromDB, getScanStatus,
} from '../services/screener.js';
import { streamChat } from '../services/ai.js';
import log from '../log.js';

const router = Router();

// ── Value picks (top scored, recently scanned) ──────────────────────────────
router.get('/value-picks', async (req, res) => {
  try {
    const { status, data, scanning } = await getValuePicks();
    res.json({ ok: true, status, data, scanning });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── All stocks from DB — every symbol ever scanned ──────────────────────────
router.get('/all-stocks', async (req, res) => {
  try {
    const data = await getAllStocks();
    const scan  = getScanStatus();
    res.json({ ok: true, data, scanning: scan.running, scanStatus: scan });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Scan status ──────────────────────────────────────────────────────────────
router.get('/scan-status', (req, res) => {
  res.json({ ok: true, ...getScanStatus() });
});

// ── Manual refresh ───────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    await refreshScreener();
    // Kick off a fresh scan in the background
    getValuePicks().catch(() => {});
    res.json({ ok: true, message: 'Scan started' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI ANALYSIS — SSE streaming endpoint
// GET /api/screener/ai-analysis           → cached if fresh, else generate
// GET /api/screener/ai-analysis?refresh=1 → force regeneration
//
// Continuous-process behaviour:
//   • If cache exists AND age > 60 min → serve cache instantly, then start a
//     background regeneration (next client request will get the new version)
//   • If no cache → generate live, stream tokens, save to DB
// ─────────────────────────────────────────────────────────────────────────────
router.get('/ai-analysis', async (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };

  let aborted = false;
  req.on('close', () => { aborted = true; });

  const forceRefresh = !!req.query.refresh;

  try {
    // ── 1. Serve cached analysis if available ────────────────────────────────
    if (!forceRefresh) {
      const cached = await getRecentAnalysis();
      if (cached) {
        log.info(`Screener AI: serving cached analysis (${cached.ageMin}m old)`);
        const CHUNK = 60;
        const text  = cached.analysis;
        for (let i = 0; i < text.length; i += CHUNK) {
          if (aborted) return res.end();
          send({ text: text.slice(i, i + CHUNK) });
        }
        send({ done: true, cached: true, ageMin: cached.ageMin });

        // If analysis is > 60 min old, kick off a silent background refresh
        // so the next request gets fresher data
        if (cached.ageMin > 60) {
          triggerBackgroundAnalysis().catch(() => {});
        }
        return res.end();
      }
    }

    // ── 2. Get screener picks ────────────────────────────────────────────────
    let picks = [];
    const { data: cachePicks } = await getValuePicks();
    if (cachePicks?.length) {
      picks = cachePicks;
    } else {
      picks = await loadPicksFromDB();
    }

    if (!picks.length) {
      // Check full DB — maybe there are stale stocks we can still use
      const allStocks = await getAllStocks();
      if (allStocks.length) {
        picks = allStocks;
      } else {
        send({ error: 'No screener data yet. Please wait for the screener to finish scanning.' });
        return res.end();
      }
    }

    log.info(`Screener AI: generating fresh analysis for ${picks.length} stocks`);
    let fullText = '';

    await streamChat({
      question: buildAnalysisPrompt(picks),
      symbols:  [],
      history:  [],
      skipRag:  true,
      onDelta: (chunk) => {
        if (aborted) return;
        fullText += chunk;
        send({ text: chunk });
      },
      onDone: async () => {
        if (fullText) {
          await saveAnalysis(fullText, picks.length);
          log.info(`Screener AI: analysis saved (${fullText.length} chars)`);
        }
        send({ done: true, cached: false, stocksAnalyzed: picks.length });
        res.end();
      },
      onError: (err) => {
        log.error('Screener AI error:', err);
        send({ error: String(err) });
        res.end();
      },
    });
  } catch (e) {
    log.error('Screener AI route:', e.message);
    send({ error: e.message });
    res.end();
  }
});

// Background analysis refresh (does not send to any client — just updates DB)
async function triggerBackgroundAnalysis() {
  let picks = [];
  const { data: cachePicks } = await getValuePicks();
  picks = cachePicks?.length ? cachePicks : await loadPicksFromDB();
  if (!picks.length) return;

  log.info(`Screener AI background: refreshing for ${picks.length} stocks`);
  let fullText = '';
  await streamChat({
    question: buildAnalysisPrompt(picks),
    symbols: [], history: [], skipRag: true,
    onDelta:  chunk => { fullText += chunk; },
    onDone:   async () => { if (fullText) await saveAnalysis(fullText, picks.length); },
    onError:  err => log.warn('Background AI refresh failed:', err),
  });
}

export default router;
