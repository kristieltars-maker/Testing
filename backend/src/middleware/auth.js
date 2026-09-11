import { getDb, saveDatabase } from '../db/database.js';

export function authMiddleware(req, res, next) {
  const sessionId = req.cookies?.session_id;

  if (!sessionId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getDb();
  const result = db.exec(`
    SELECT s.session_id, s.user_id, s.expires_at, s.created_at,
           u.id, u.name, u.email, u.role, u.is_active
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_id = '${sessionId}' AND s.expires_at > datetime('now')
  `);

  if (result.length === 0 || result[0].values.length === 0) {
    res.clearCookie('session_id');
    return res.status(401).json({ error: 'Session expired' });
  }

  const row = result[0].values[0];
  const columns = result[0].columns;
  const session = {};
  columns.forEach((col, i) => { session[col] = row[i]; });

  if (!session.is_active) {
    return res.status(403).json({ error: 'Account deactivated' });
  }

  req.user = {
    id: session.id,
    name: session.name,
    email: session.email,
    role: session.role
  };

  db.run(
    "UPDATE sessions SET expires_at = datetime('now', '+7 days') WHERE session_id = ?",
    [sessionId]
  );
  saveDatabase();

  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
