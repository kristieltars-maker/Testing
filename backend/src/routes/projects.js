import { Router } from 'express';
import { getDb, saveDatabase } from '../db/database.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

function rowsToObjects(result) {
  if (result.length === 0) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function getOne(result) {
  const rows = rowsToObjects(result);
  return rows.length > 0 ? rows[0] : null;
}

router.get('/', (req, res) => {
  const db = getDb();
  let result;

  if (req.user.role === 'admin') {
    result = db.exec(`
      SELECT p.*, u.name as creator_name,
        (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status NOT IN ('done', 'cancelled', 'rejected')) as open_issues_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.created_by
      ORDER BY p.created_at DESC
    `);
  } else {
    result = db.exec(`
      SELECT p.*, u.name as creator_name,
        (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status NOT IN ('done', 'cancelled', 'rejected')) as open_issues_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.created_by
      JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
      ORDER BY p.created_at DESC
    `, [req.user.id]);
  }

  res.json({ projects: rowsToObjects(result) });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const projectResult = db.exec(`
    SELECT p.*, u.name as creator_name
    FROM projects p
    LEFT JOIN users u ON u.id = p.created_by
    WHERE p.id = ?
  `, [req.params.id]);

  const project = getOne(projectResult);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (req.user.role !== 'admin') {
    const memberResult = db.exec('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, req.user.id]);
    if (memberResult.length === 0 || memberResult[0].values.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  const botsResult = db.exec('SELECT * FROM bots WHERE project_id = ? ORDER BY name', [project.id]);
  const membersResult = db.exec(`
    SELECT u.id, u.name, u.email, pm.role_in_project
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ? AND u.is_active = 1
    ORDER BY u.name
  `, [project.id]);

  res.json({
    project,
    bots: rowsToObjects(botsResult),
    members: rowsToObjects(membersResult)
  });
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, client_name, platform } = req.body;

  if (!name || !client_name) {
    return res.status(400).json({ error: 'Name and client_name required' });
  }

  const db = getDb();
  db.run(
    'INSERT INTO projects (name, client_name, platform, created_by) VALUES (?, ?, ?, ?)',
    [name, client_name, platform || 'ТВИН', req.user.id]
  );
  saveDatabase();

  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  const result = db.exec('SELECT * FROM projects WHERE id = ?', [lastId]);
  res.status(201).json({ project: getOne(result) });
});

router.patch('/:id', requireRole('admin'), (req, res) => {
  const { name, client_name, platform } = req.body;
  const projectId = req.params.id;

  const db = getDb();
  const existing = db.exec('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (existing.length === 0 || existing[0].values.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const updates = [];
  const values = [];

  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (client_name !== undefined) { updates.push('client_name = ?'); values.push(client_name); }
  if (platform !== undefined) { updates.push('platform = ?'); values.push(platform); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(projectId);
  db.run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, values);
  saveDatabase();

  const result = db.exec('SELECT * FROM projects WHERE id = ?', [projectId]);
  res.json({ project: getOne(result) });
});

router.post('/:id/bots', requireRole('admin'), (req, res) => {
  const { name, description } = req.body;
  const projectId = req.params.id;

  if (!name) {
    return res.status(400).json({ error: 'Bot name required' });
  }

  const db = getDb();
  const projectResult = db.exec('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (projectResult.length === 0 || projectResult[0].values.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }

  db.run(
    'INSERT INTO bots (project_id, name, description) VALUES (?, ?, ?)',
    [projectId, name, description || null]
  );
  saveDatabase();

  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  const result = db.exec('SELECT * FROM bots WHERE id = ?', [lastId]);
  res.status(201).json({ bot: getOne(result) });
});

router.patch('/:projectId/bots/:botId', requireRole('admin'), (req, res) => {
  const { name, description } = req.body;
  const { botId } = req.params;

  const db = getDb();
  const existing = db.exec('SELECT * FROM bots WHERE id = ? AND project_id = ?', [botId, req.params.projectId]);
  if (existing.length === 0 || existing[0].values.length === 0) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  const updates = [];
  const values = [];

  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(botId);
  db.run(`UPDATE bots SET ${updates.join(', ')} WHERE id = ?`, values);
  saveDatabase();

  const result = db.exec('SELECT * FROM bots WHERE id = ?', [botId]);
  res.json({ bot: getOne(result) });
});

router.delete('/:projectId/bots/:botId', requireRole('admin'), (req, res) => {
  const { botId } = req.params;
  const db = getDb();
  const existing = db.exec('SELECT * FROM bots WHERE id = ? AND project_id = ?', [botId, req.params.projectId]);
  if (existing.length === 0 || existing[0].values.length === 0) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  db.run('DELETE FROM bots WHERE id = ?', [botId]);
  saveDatabase();
  res.json({ ok: true });
});

router.post('/:id/members', requireRole('admin'), (req, res) => {
  const { user_id, role_in_project } = req.body;
  const projectId = req.params.id;

  if (!user_id || !role_in_project) {
    return res.status(400).json({ error: 'user_id and role_in_project required' });
  }

  if (!['tester', 'developer'].includes(role_in_project)) {
    return res.status(400).json({ error: 'Invalid role_in_project' });
  }

  const db = getDb();
  const projectResult = db.exec('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (projectResult.length === 0 || projectResult[0].values.length === 0) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const userResult = db.exec('SELECT id FROM users WHERE id = ? AND is_active = 1', [user_id]);
  if (userResult.length === 0 || userResult[0].values.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.run(
    'INSERT OR REPLACE INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)',
    [projectId, user_id, role_in_project]
  );
  saveDatabase();

  res.status(201).json({ ok: true });
});

router.delete('/:id/members/:userId', requireRole('admin'), (req, res) => {
  const db = getDb();
  db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
  saveDatabase();
  res.json({ ok: true });
});

export default router;
