import { query } from '../db.js';

export async function verifyToken(req, res, next) {
  req.userId = null;
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return next();
  const token = auth.slice(7).trim();
  if (!token) return next();
  try {
    const now = Math.floor(Date.now() / 1000);
    const r = await query(
      'SELECT user_id FROM user_sessions WHERE token=$1 AND expires_at>$2',
      [token, now]
    );
    req.userId = r.rows[0]?.user_id ?? null;
  } catch { /* no DB = unauthenticated */ }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ ok: false, error: 'Authentication required' });
  next();
}
