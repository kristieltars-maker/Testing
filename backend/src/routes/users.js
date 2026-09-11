import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb, saveDatabase } from '../db/database.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.use(requireRole('admin'));

function rowsToObjects(result) {
  if (result.length === 0) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

router.get('/', (req, res) => {
  const db = getDb();
  const result = db.exec(`
    SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
      GROUP_CONCAT(p.name || ' (' || pm.role_in_project || ')', ', ') as projects
    FROM users u
    LEFT JOIN project_members pm ON pm.user_id = u.id
    LEFT JOIN projects p ON p.id = pm.project_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  res.json({ users: rowsToObjects(result) });
});

router.post('/', (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields required' });
  }

  if (!['admin', 'tester', 'developer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const db = getDb();
  const existing = db.exec('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    return res.status(409).json({ error: 'Email already exists' });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  db.run(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, password_hash, role]
  );
  saveDatabase();

  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  const result = db.exec('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?', [lastId]);
  const user = rowsToObjects(result)[0];
  res.status(201).json({ user });
});

router.patch('/:id', (req, res) => {
  const { name, email, role, is_active } = req.body;
  const userId = req.params.id;

  const db = getDb();
  const existing = db.exec('SELECT * FROM users WHERE id = ?', [userId]);
  if (existing.length === 0 || existing[0].values.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const updates = [];
  const values = [];

  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (email !== undefined) { updates.push('email = ?'); values.push(email); }
  if (role !== undefined) {
    if (!['admin', 'tester', 'developer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    updates.push('role = ?');
    values.push(role);
  }
  if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active ? 1 : 0); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(userId);
  db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  saveDatabase();

  const result = db.exec('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?', [userId]);
  res.json({ user: rowsToObjects(result)[0] });
});

router.post('/:id/password', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = getDb();
  const password_hash = bcrypt.hashSync(password, 10);
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, req.params.id]);
  saveDatabase();
  res.json({ ok: true });
});

export default router;
