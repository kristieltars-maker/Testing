import { Router } from 'express';
import { existsSync, rmSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, saveDatabase } from '../db/database.js';
import { requireRole } from '../middleware/auth.js';
import { slugify, makeUniqueSlug } from '../utils/slug.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

function resolveProject(identifier) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const db = getDb();
  const isNumeric = /^\d+$/.test(String(identifier));
  const result = isNumeric
    ? db.exec('SELECT * FROM projects WHERE id = ?', [identifier])
    : db.exec('SELECT * FROM projects WHERE slug = ?', [identifier]);
  return getOne(result);
}

// Права управления проектом: админ, назначенный руководитель
// (projects.manager_id) или участник с ролью 'manager'.
function canManageProject(project, user) {
  if (user.role === 'admin') return true;
  if (project.manager_id === user.id) return true;
  const db = getDb();
  const result = db.exec(
    "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? AND role_in_project = 'manager'",
    [project.id, user.id]
  );
  return result.length > 0 && result[0].values.length > 0;
}

router.get('/', (req, res) => {
  const db = getDb();
  let result;

  if (req.user.role === 'admin') {
    result = db.exec(`
      SELECT p.*, u.name as creator_name, m.name as manager_name,
        (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status NOT IN ('done', 'cancelled', 'rejected')) as open_issues_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN users m ON m.id = p.manager_id
      ORDER BY p.created_at DESC
    `);
  } else {
    result = db.exec(`
      SELECT p.*, u.name as creator_name, m.name as manager_name,
        (SELECT COUNT(*) FROM issues i WHERE i.project_id = p.id AND i.status NOT IN ('done', 'cancelled', 'rejected')) as open_issues_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN users m ON m.id = p.manager_id
      WHERE p.manager_id = ? OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
      ORDER BY p.created_at DESC
    `, [req.user.id, req.user.id]);
  }

  res.json({ projects: rowsToObjects(result) });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const resolved = resolveProject(req.params.id);

  if (!resolved) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const projectResult = db.exec(`
    SELECT p.*, u.name as creator_name, m.name as manager_name
    FROM projects p
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN users m ON m.id = p.manager_id
    WHERE p.id = ?
  `, [resolved.id]);

  const project = getOne(projectResult);

  if (req.user.role !== 'admin' && project.manager_id !== req.user.id) {
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

router.post('/', requireRole('admin', 'manager'), (req, res) => {
  const { name, client_name, platform, manager_id } = req.body;

  if (!name || !client_name) {
    return res.status(400).json({ error: 'Name and client_name required' });
  }

  const db = getDb();
  const slug = makeUniqueSlug(db, slugify(name));
  // Руководитель проекта создаёт проект — становится его руководителем
  const manager = req.user.role === 'manager' ? req.user.id : (manager_id || null);

  db.run(
    'INSERT INTO projects (name, client_name, platform, created_by, slug, manager_id) VALUES (?, ?, ?, ?, ?, ?)',
    [name, client_name, platform || 'ТВИН', req.user.id, slug, manager]
  );

  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  const result = db.exec('SELECT * FROM projects WHERE id = ?', [lastId]);
  saveDatabase();

  res.status(201).json({ project: getOne(result) });
});

router.patch('/:id', (req, res) => {
  const { name, client_name, platform, manager_id } = req.body;

  const db = getDb();
  const project = resolveProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (!canManageProject(project, req.user)) {
    return res.status(403).json({ error: 'Доступно только администратору или руководителю проекта' });
  }

  const updates = [];
  const values = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
    updates.push('slug = ?');
    values.push(makeUniqueSlug(db, slugify(name), project.id));
  }
  if (client_name !== undefined) { updates.push('client_name = ?'); values.push(client_name); }
  if (platform !== undefined) { updates.push('platform = ?'); values.push(platform); }
  // Менять руководителя проекта может только администратор
  if (manager_id !== undefined && req.user.role === 'admin') {
    updates.push('manager_id = ?');
    values.push(manager_id || null);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(project.id);
  db.run(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, values);
  saveDatabase();

  const result = db.exec('SELECT * FROM projects WHERE id = ?', [project.id]);
  res.json({ project: getOne(result) });
});

router.post('/:id/bots', requireRole('admin'), (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Bot name required' });
  }

  const db = getDb();
  const project = resolveProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  db.run(
    'INSERT INTO bots (project_id, name, description) VALUES (?, ?, ?)',
    [project.id, name, description || null]
  );

  const lastId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];
  const result = db.exec('SELECT * FROM bots WHERE id = ?', [lastId]);
  saveDatabase();

  res.status(201).json({ bot: getOne(result) });
});

router.patch('/:projectId/bots/:botId', requireRole('admin'), (req, res) => {
  const { name, description } = req.body;
  const { botId } = req.params;

  const db = getDb();
  const project = resolveProject(req.params.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const existing = db.exec('SELECT * FROM bots WHERE id = ? AND project_id = ?', [botId, project.id]);
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
  const project = resolveProject(req.params.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const existing = db.exec('SELECT * FROM bots WHERE id = ? AND project_id = ?', [botId, project.id]);
  if (existing.length === 0 || existing[0].values.length === 0) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  db.run('DELETE FROM bots WHERE id = ?', [botId]);
  saveDatabase();
  res.json({ ok: true });
});

router.get('/:id/users', (req, res) => {
  const db = getDb();
  const project = resolveProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!canManageProject(project, req.user)) {
    return res.status(403).json({ error: 'Доступно только администратору или руководителю проекта' });
  }
  const result = db.exec(`
    SELECT u.id, u.name, u.email FROM users u WHERE u.is_active = 1 ORDER BY u.name
  `);
  res.json({ users: rowsToObjects(result) });
});

router.post('/:id/members', (req, res) => {
  const { user_id, role_in_project } = req.body;

  if (!user_id || !role_in_project) {
    return res.status(400).json({ error: 'user_id and role_in_project required' });
  }

  if (!['tester', 'developer', 'manager'].includes(role_in_project)) {
    return res.status(400).json({ error: 'Invalid role_in_project' });
  }

  const db = getDb();
  const project = resolveProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (!canManageProject(project, req.user)) {
    return res.status(403).json({ error: 'Доступно только администратору или руководителю проекта' });
  }

  const userResult = db.exec('SELECT id FROM users WHERE id = ? AND is_active = 1', [user_id]);
  if (userResult.length === 0 || userResult[0].values.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (role_in_project === 'manager') {
    // Руководитель проекта один: убираем предыдущего
    db.run("DELETE FROM project_members WHERE project_id = ? AND role_in_project = 'manager' AND user_id != ?", [project.id, user_id]);
    db.run('UPDATE projects SET manager_id = ? WHERE id = ?', [user_id, project.id]);
  }

  db.run(
    'INSERT OR REPLACE INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)',
    [project.id, user_id, role_in_project]
  );
  saveDatabase();

  res.status(201).json({ ok: true });
});

router.delete('/:id/members/:userId', (req, res) => {
  const db = getDb();
  const project = resolveProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!canManageProject(project, req.user)) {
    return res.status(403).json({ error: 'Доступно только администратору или руководителю проекта' });
  }

  db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [project.id, req.params.userId]);
  db.run('UPDATE projects SET manager_id = NULL WHERE id = ? AND manager_id = ?', [project.id, req.params.userId]);
  saveDatabase();
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const project = resolveProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (req.user.role !== 'admin') {
    // Удалять проект может только администратор
    return res.status(403).json({ error: 'Доступно только администратору' });
  }
  const projectId = project.id;

  const files = db.exec(`
    SELECT a.file_path FROM issue_attachments a
    JOIN issue_messages m ON m.id = a.message_id
    JOIN issues i ON i.id = m.issue_id
    WHERE i.project_id = ?
  `, [projectId]);
  const filePaths = files.length > 0 ? files[0].values.map(r => r[0]) : [];

  db.run('DELETE FROM issue_attachments WHERE message_id IN (SELECT id FROM issue_messages WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ?))', [projectId]);
  db.run('DELETE FROM issue_messages WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ?)', [projectId]);
  db.run('DELETE FROM issues WHERE project_id = ?', [projectId]);
  db.run('DELETE FROM bots WHERE project_id = ?', [projectId]);
  db.run('DELETE FROM project_members WHERE project_id = ?', [projectId]);
  db.run('DELETE FROM projects WHERE id = ?', [projectId]);
  saveDatabase();

  for (const fp of filePaths) {
    try {
      const absolute = join(__dirname, '..', fp);
      if (existsSync(absolute)) unlinkSync(absolute);
    } catch (e) {
      console.error('Failed to delete file', fp, e.message);
    }
  }

  try {
    const uploadDir = join(__dirname, '..', 'uploads', String(projectId));
    if (existsSync(uploadDir)) rmSync(uploadDir, { recursive: true, force: true });
  } catch (e) {
    console.error('Failed to delete upload dir', e.message);
  }

  res.json({ ok: true });
});

export default router;
