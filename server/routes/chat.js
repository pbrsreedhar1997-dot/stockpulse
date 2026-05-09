import { Router } from 'express';
import { query } from '../db.js';

const router = Router();
const now = () => Math.floor(Date.now() / 1000);

function wrap(fn) {
  return (req, res) => fn(req, res).catch(err => {
    res.status(500).json({ ok: false, error: err.message });
  });
}

/* List sessions for the logged-in user */
router.get('/sessions', wrap(async (req, res) => {
  if (!req.userId) return res.status(401).json({ ok: false, error: 'Login required' });
  const r = await query(
    'SELECT id, title, created_at, updated_at FROM chat_sessions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50',
    [req.userId]
  );
  res.json({ ok: true, sessions: r.rows });
}));

/* Get a single session with all its messages */
router.get('/sessions/:id', wrap(async (req, res) => {
  if (!req.userId) return res.status(401).json({ ok: false, error: 'Login required' });
  const s = await query('SELECT * FROM chat_sessions WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  if (!s.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
  const m = await query('SELECT role, content FROM chat_messages WHERE session_id=$1 ORDER BY created_at', [req.params.id]);
  res.json({ ok: true, session: s.rows[0], messages: m.rows });
}));

/* Save / upsert a session (create or overwrite all messages) */
router.post('/sessions', wrap(async (req, res) => {
  if (!req.userId) return res.status(401).json({ ok: false, error: 'Login required' });
  const { sessionId, title, messages } = req.body;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ ok: false, error: 'messages required' });

  let id = sessionId;
  const ts = now();

  if (id) {
    /* Update title + timestamp on existing session */
    await query('UPDATE chat_sessions SET title=$1, updated_at=$2 WHERE id=$3 AND user_id=$4', [title || 'Chat', ts, id, req.userId]);
    /* Delete old messages and re-insert (simplest idempotent approach) */
    await query('DELETE FROM chat_messages WHERE session_id=$1', [id]);
  } else {
    /* Create new session */
    const r = await query(
      'INSERT INTO chat_sessions(user_id,title,created_at,updated_at) VALUES($1,$2,$3,$3) RETURNING id',
      [req.userId, title || 'Chat', ts]
    );
    id = r.rows[0].id;
  }

  /* Bulk-insert messages */
  for (const m of messages) {
    await query('INSERT INTO chat_messages(session_id,role,content,created_at) VALUES($1,$2,$3,$4)', [id, m.role, m.content, ts]);
  }

  res.json({ ok: true, sessionId: id });
}));

/* Delete a session */
router.delete('/sessions/:id', wrap(async (req, res) => {
  if (!req.userId) return res.status(401).json({ ok: false, error: 'Login required' });
  await query('DELETE FROM chat_sessions WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  res.json({ ok: true });
}));

export default router;
