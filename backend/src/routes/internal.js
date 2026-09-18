import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/session', (req, res) => {
  const expectedToken = process.env.INTERNAL_AUTH_TOKEN;

  if (!expectedToken) {
    return res.status(503).json({ error: 'Internal auth unavailable' });
  }

  if (req.headers['x-internal-auth'] !== expectedToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let sessionId = req.cookies?.session_id;
  if (!sessionId) {
    const authorization = req.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      sessionId = authorization.slice('Bearer '.length).trim();
    }
  }

  if (!sessionId) {
    return res.status(401).json({ error: 'Session expired' });
  }

  const db = getDb();
  const result = db.exec(`
    SELECT s.session_id, s.expires_at,
           u.id, u.name, u.email, u.role, u.is_active,
           (s.expires_at > datetime('now')) AS is_valid
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_id = ?
  `, [sessionId]);

  if (result.length === 0 || result[0].values.length === 0) {
    return res.status(401).json({ error: 'Session expired' });
  }

  const row = result[0].values[0];
  const columns = result[0].columns;
  const session = {};
  columns.forEach((col, i) => { session[col] = row[i]; });

  if (!session.is_valid) {
    return res.status(401).json({ error: 'Session expired' });
  }

  if (!session.is_active) {
    return res.status(403).json({ error: 'Account deactivated' });
  }

  res.json({
    user: {
      id: session.id,
      name: session.name,
      email: session.email,
      role: session.role
    },
    expires_at: session.expires_at
  });
});

export default router;
