import { Router } from 'express';
import {
  getValuePicks, refreshScreener,
  getRecentAnalysis, saveAnalysis, buildAnalysisPrompt, loadPicksFromDB,
} from '../services/screener.js';
import { streamChat } from '../services/ai.js';
import log from '../log.js';

const router = Router();

router.get('/value-picks', async (req, res) => {
  try {
    const { status, data } = await getValuePicks();
    res.json({ ok: true, status, data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/refresh', async (req, res) => {
  try {
    await refreshScreener();
    res.json({ ok: true, message: 'Cache cleared, refresh started' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI ANALYSIS  — SSE streaming endpoint
// GET  /api/screener/ai-analysis          → serve cached (if fresh) or generate new
// GET  /api/screener/ai-analysis?refresh=1 → force regeneration
// ─────────────────────────────────────────────────────────────────────────────
router.get('/ai-analysis', async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const send = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
  };

  // Abort helper — client can disconnect
  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    // 1. Try serving from DB cache (skip if ?refresh=1)
    if (!req.query.refresh) {
      const cached = await getRecentAnalysis();
      if (cached) {
        log.info(`Screener AI: serving cached analysis (${cached.ageMin}m old)`);
        // Stream in chunks for a natural feel
        const text  = cached.analysis;
        const CHUNK = 60;
        for (let i = 0; i < text.length; i += CHUNK) {
          if (aborted) return res.end();
          send({ text: text.slice(i, i + CHUNK) });
        }
        send({ done: true, cached: true, ageMin: cached.ageMin });
        return res.end();
      }
    }

    // 2. Get screener picks (from cache/DB)
    let picks = [];
    const { data: cachePicks } = await getValuePicks();
    if (cachePicks?.length) {
      picks = cachePicks;
    } else {
      picks = await loadPicksFromDB();
    }

    if (!picks.length) {
      send({ error: 'No screener data yet. Please wait for the screener to finish scanning.' });
      return res.end();
    }

    log.info(`Screener AI: generating fresh analysis for ${picks.length} picks`);
    let fullText = '';

    await streamChat({
      question: buildAnalysisPrompt(picks),
      symbols:  [],
      history:  [],
      skipRag:  true,
      onDelta: (text) => {
        if (aborted) return;
        fullText += text;
        send({ text });
      },
      onDone: async () => {
        if (fullText) {
          await saveAnalysis(fullText, picks.length);
          log.info(`Screener AI: analysis saved to DB (${fullText.length} chars)`);
        }
        send({ done: true, cached: false });
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

export default router;
