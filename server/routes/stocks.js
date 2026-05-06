import { Router } from 'express';
import { getQuote, getProfile, getFinancials, getHistory, getNews, search, getPerformance } from '../services/yahoo.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(500).json({ ok: false, error: e.message }));

router.get('/quote/:symbol',      wrap(async (req, res) => {
  const d = await getQuote(req.params.symbol.toUpperCase());
  d ? res.json({ ok: true, data: d }) : res.json({ ok: false, error: 'No data' });
}));
router.get('/profile/:symbol',    wrap(async (req, res) => {
  const d = await getProfile(req.params.symbol.toUpperCase());
  d ? res.json({ ok: true, data: d }) : res.json({ ok: false, error: 'No profile' });
}));
router.get('/financials/:symbol', wrap(async (req, res) => {
  const d = await getFinancials(req.params.symbol.toUpperCase());
  d ? res.json({ ok: true, data: d }) : res.json({ ok: false, error: 'No financials' });
}));
router.get('/history/:symbol',    wrap(async (req, res) => {
  const d = await getHistory(req.params.symbol.toUpperCase(), req.query.range || '1mo');
  d ? res.json({ ok: true, data: d }) : res.json({ ok: false, error: 'No history' });
}));
router.get('/news/:symbol',       wrap(async (req, res) => {
  const d = await getNews(req.params.symbol.toUpperCase());
  res.json({ ok: true, data: d || [] });
}));
router.get('/search',             wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ ok: true, data: [] });
  res.json({ ok: true, data: await search(q) });
}));
router.get('/performance/:symbol', wrap(async (req, res) => {
  const d = await getPerformance(req.params.symbol.toUpperCase());
  d ? res.json({ ok: true, data: d }) : res.json({ ok: false, error: 'Insufficient history' });
}));

export default router;
