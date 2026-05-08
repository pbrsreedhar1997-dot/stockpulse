import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  VAPID_PUBLIC_KEY, pushEnabled,
  saveSubscription, removeSubscription, sendPushToUser,
} from '../services/push.js';

const router = Router();

/* Public — client needs the VAPID public key to create a subscription */
router.get('/vapid-key', (_req, res) => {
  res.json({ ok: true, key: VAPID_PUBLIC_KEY || null, enabled: pushEnabled() });
});

/* Register a push subscription for the logged-in user */
router.post('/subscribe', verifyToken, async (req, res) => {
  try {
    await saveSubscription(req.user.id, req.body.subscription);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* Remove a push subscription */
router.post('/unsubscribe', verifyToken, async (req, res) => {
  try {
    await removeSubscription(req.body.endpoint);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* Client calls this when an alert fires to push to ALL user devices */
router.post('/send-alert', verifyToken, async (req, res) => {
  try {
    const { title, body, tag } = req.body;
    const sent = await sendPushToUser(req.user.id, { title, body, tag });
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
