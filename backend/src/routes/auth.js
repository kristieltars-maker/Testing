import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { getDb, saveDatabase } from '../db/database.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body.email || req.ip
});

router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;

  console.log('[login debug] body:', req.body, 'email:', email, 'password length:', password?.length);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const db = getDb();
  const result = db.exec('SELECT * FROM users WHERE email = ?', [email]);

  if (result.length === 0 || result[0].values.length === 0) {
    console.log('[login debug] user not found');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const columns = result[0].columns;
  const row = result[0].values[0];
  const user = {};
  columns.forEach((col, i) => { user[col] = row[i]; });

  console.log('[login debug] stored hash:', user.password_hash, 'compare:', bcrypt.compareSync(password, user.password_hash));

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'Account deactivated' });
  }

  const sessionId = uuidv4();
  db.run(
    "INSERT INTO sessions (session_id, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))",
    [sessionId, user.id]
  );
  saveDatabase();

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
  if (process.env.COOKIE_DOMAIN) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  }

  res.cookie('session_id', sessionId, cookieOptions);

  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

router.post('/logout', (req, res) => {
  const sessionId = req.cookies?.session_id;
  if (sessionId) {
    const db = getDb();
    db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
    saveDatabase();
  }
  const clearOptions = {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  };
  if (process.env.COOKIE_DOMAIN) {
    clearOptions.domain = process.env.COOKIE_DOMAIN;
  }

  res.clearCookie('session_id', clearOptions);
  res.json({ ok: true });
});

export default router;
