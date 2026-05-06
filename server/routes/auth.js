import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const SESSION_DAYS = 30;

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be ≥ 6 characters' });

    const hash = await bcrypt.hash(password, 12);
    const r = await query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id,email,name',
      [email.toLowerCase().trim(), hash, name?.trim() || null]
    );
    const user = r.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
    await query('INSERT INTO user_sessions (token,user_id,expires_at) VALUES ($1,$2,$3)', [token, user.id, exp]);
    res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Email already registered' });
    res.status(500).json({ ok: false, error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password required' });
    const r = await query('SELECT id,email,name,password_hash FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    const token = crypto.randomBytes(32).toString('hex');
    const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
    await query('INSERT INTO user_sessions (token,user_id,expires_at) VALUES ($1,$2,$3)', [token, user.id, exp]);
    res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name } });
  } catch { res.status(500).json({ ok: false, error: 'Login failed' }); }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = (req.headers.authorization || '').slice(7).trim();
    if (token) await query('DELETE FROM user_sessions WHERE token=$1', [token]);
  } catch {}
  res.json({ ok: true });
});

export default router;
