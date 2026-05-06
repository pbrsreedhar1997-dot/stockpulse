import { Router } from 'express';
import { getValuePicks, refreshScreener } from '../services/screener.js';

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

export default router;
