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

  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  const result = db.exec('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?', [lastId]);
  saveDatabase();

  const user = rowsToObjects(result)[0];
  res.status(201).json({ user });
});

router.patch('/:id', (req, res) => {
  const { name, email, role, is_active } = req.body;
  const userId = req.params.id;

  if (String(userId) === String(req.user.id)) {
    if (role !== undefined && role !== 'admin') {
      return res.status(400).json({ error: 'Нельзя снять с себя права администратора' });
    }
    if (is_active !== undefined && !is_active) {
      return res.status(400).json({ error: 'Нельзя деактивировать свою учётную запись' });
    }
  }

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

router.get('/:id/memberships', (req, res) => {
  const db = getDb();
  const result = db.exec(`
    SELECT pm.project_id, pm.role_in_project, p.name as project_name
    FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
    WHERE pm.user_id = ?
    ORDER BY p.name
  `, [req.params.id]);
  res.json({ memberships: rowsToObjects(result) });
});

router.put('/:id/memberships', (req, res) => {
  const { memberships } = req.body;

  if (!Array.isArray(memberships)) {
    return res.status(400).json({ error: 'memberships must be an array' });
  }

  const db = getDb();
  const existing = db.exec('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (existing.length === 0 || existing[0].values.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.run('DELETE FROM project_members WHERE user_id = ?', [req.params.id]);

  for (const m of memberships) {
    if (!m.project_id || !['tester', 'developer'].includes(m.role_in_project)) continue;
    db.run(
      'INSERT OR REPLACE INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)',
      [m.project_id, req.params.id, m.role_in_project]
    );
  }

  saveDatabase();
  res.json({ ok: true });
});

export default router;
