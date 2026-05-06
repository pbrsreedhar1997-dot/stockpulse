import { Router } from 'express';
const router = Router();
router.get('/ping', (_, res) => res.json({ ok: true, ts: Math.floor(Date.now() / 1000), version: '3.0.0' }));
export default router;
