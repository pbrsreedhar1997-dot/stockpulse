import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const r = await query('SELECT symbol,name,exchange,added_at FROM watchlist WHERE user_id=$1 ORDER BY added_at DESC', [req.userId]);
    res.json({ ok: true, data: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { symbol, name, exchange = 'NSE' } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: 'Symbol required' });
    await query(
      'INSERT INTO watchlist (user_id,symbol,name,exchange) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [req.userId, symbol.toUpperCase(), name || symbol, exchange]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/:symbol', async (req, res) => {
  try {
    await query('DELETE FROM watchlist WHERE user_id=$1 AND symbol=$2', [req.userId, req.params.symbol.toUpperCase()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

export default router;
