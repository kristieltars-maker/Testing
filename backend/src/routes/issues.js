import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, saveDatabase } from '../db/database.js';
import { requireRole } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let pid = req.body.project_id;
    try {
      const db = getDb();
      if (!pid && req.params && req.params.id) {
        const r = db.exec('SELECT project_id FROM issues WHERE id = ?', [req.params.id]);
        if (r.length > 0 && r[0].values.length > 0) pid = r[0].values[0][0];
      }
      if (pid && !/^\d+$/.test(String(pid))) {
        const r = db.exec('SELECT id FROM projects WHERE slug = ?', [pid]);
        if (r.length > 0 && r[0].values.length > 0) pid = r[0].values[0][0];
      }
    } catch (e) {
      // ignore
    }
    const dir = join(__dirname, '..', 'uploads', String(pid || 'temp'));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

// Multer/busboy отдаёт имя файла в latin1; перекодируем в UTF-8,
// чтобы русские названия не превращались в «кракозябры».
function decodeFileName(name) {
  try {
    const decoded = Buffer.from(String(name), 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? String(name) : decoded;
  } catch (e) {
    return String(name);
  }
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error('Only PNG, JPG, GIF, WebP allowed'));
    }
    cb(null, true);
  }
});

const STATUS_LABELS = {
  new: 'Новое',
  waiting: 'В ожидании',
  done: 'Выполнено',
  cancelled: 'Отменено',
  rejected: 'Не принято',
  reopened: 'Вернули в работу'
};

const TESTER_TRANSITIONS = { cancelled: true, reopened: true };
const DEVELOPER_TRANSITIONS = { waiting: true, done: true, rejected: true };

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

function checkProjectAccess(projectId, userId, role) {
  if (role === 'admin') return true;
  const db = getDb();
  const result = db.exec('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  return result.length > 0 && result[0].values.length > 0;
}

function getProjectRole(projectId, userId) {
  const db = getDb();
  const result = db.exec('SELECT role_in_project FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0];
}

function deleteUploadedFiles(filePaths) {
  for (const fp of filePaths) {
    try {
      const absolute = join(__dirname, '..', fp);
      if (existsSync(absolute)) unlinkSync(absolute);
    } catch (e) {
      console.error('Failed to delete file', fp, e.message);
    }
  }
}

function resolveProjectId(identifier) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const db = getDb();
  if (/^\d+$/.test(String(identifier))) return Number(identifier);
  const result = db.exec('SELECT id FROM projects WHERE slug = ?', [identifier]);
  return result.length > 0 && result[0].values.length > 0 ? result[0].values[0][0] : null;
}

router.get('/', (req, res) => {
  const { project_id, status, created_by, assigned_to, bot_id, sort_by, sort_order } = req.query;

  if (!project_id) {
    return res.status(400).json({ error: 'project_id required' });
  }

  const resolvedProjectId = resolveProjectId(project_id);
  if (!resolvedProjectId) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (!checkProjectAccess(resolvedProjectId, req.user.id, req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  let query = `
    SELECT i.*, 
      creator.name as creator_name,
      assignee.name as assignee_name,
      b.name as bot_name,
      (SELECT im.text FROM issue_messages im WHERE im.issue_id = i.id ORDER BY im.created_at ASC LIMIT 1) as first_message,
      (SELECT ia.file_path FROM issue_messages im JOIN issue_attachments ia ON ia.message_id = im.id WHERE im.issue_id = i.id ORDER BY im.created_at ASC LIMIT 1) as first_attachment
    FROM issues i
    LEFT JOIN users creator ON creator.id = i.created_by
    LEFT JOIN users assignee ON assignee.id = i.assigned_to
    LEFT JOIN bots b ON b.id = i.bot_id
    WHERE i.project_id = ?
  `;
  const params = [resolvedProjectId];

  if (status) {
    const statuses = status.split(',');
    query += ` AND i.status IN (${statuses.map(() => '?').join(',')})`;
    params.push(...statuses);
  }

  if (created_by) {
    query += ' AND i.created_by = ?';
    params.push(created_by);
  }

  if (assigned_to) {
    query += ' AND i.assigned_to = ?';
    params.push(assigned_to);
  }

  if (bot_id) {
    query += ' AND i.bot_id = ?';
    params.push(bot_id);
  }

  const sortField = sort_by === 'local_number' ? 'i.local_number' : 'i.updated_at';
  const order = sort_order === 'asc' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${sortField} ${order}`;

  const db = getDb();
  const result = db.exec(query, params);
  res.json({ issues: rowsToObjects(result) });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const issueResult = db.exec(`
    SELECT i.*, 
      creator.name as creator_name,
      assignee.name as assignee_name,
      b.name as bot_name,
      p.name as project_name,
      p.slug as project_slug
    FROM issues i
    LEFT JOIN users creator ON creator.id = i.created_by
    LEFT JOIN users assignee ON assignee.id = i.assigned_to
    LEFT JOIN bots b ON b.id = i.bot_id
    LEFT JOIN projects p ON p.id = i.project_id
    WHERE i.id = ?
  `, [req.params.id]);

  const issue = getOne(issueResult);
  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  if (!checkProjectAccess(issue.project_id, req.user.id, req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messagesResult = db.exec(`
    SELECT m.*, u.name as author_name, u.role as author_role
    FROM issue_messages m
    JOIN users u ON u.id = m.author_id
    WHERE m.issue_id = ?
    ORDER BY m.created_at ASC
  `, [issue.id]);

  const attachmentsResult = db.exec(`
    SELECT a.*, a.message_id
    FROM issue_attachments a
    JOIN issue_messages m ON m.id = a.message_id
    WHERE m.issue_id = ?
    ORDER BY a.uploaded_at ASC
  `, [issue.id]);

  const messages = rowsToObjects(messagesResult);
  const attachments = rowsToObjects(attachmentsResult);

  const attachmentsMap = {};
  for (const att of attachments) {
    if (!attachmentsMap[att.message_id]) attachmentsMap[att.message_id] = [];
    attachmentsMap[att.message_id].push(att);
  }

  const messagesWithAttachments = messages.map(m => ({
    ...m,
    attachments: attachmentsMap[m.id] || []
  }));

  let availableTransitions = [];
  if (req.user.role === 'admin') {
    availableTransitions = [...new Set([...Object.keys(TESTER_TRANSITIONS), ...Object.keys(DEVELOPER_TRANSITIONS)])];
  } else {
    const projectRole = getProjectRole(issue.project_id, req.user.id);
    if (projectRole === 'tester') {
      availableTransitions = Object.keys(TESTER_TRANSITIONS);
    } else if (projectRole === 'developer') {
      availableTransitions = Object.keys(DEVELOPER_TRANSITIONS);
    }
  }

  res.json({
    issue,
    messages: messagesWithAttachments,
    available_transitions: availableTransitions
  });
});

router.post('/', upload.array('attachments', 10), (req, res) => {
  const { project_id, bot_id, text, assigned_to } = req.body;

  if (!project_id || !text) {
    return res.status(400).json({ error: 'project_id and text required' });
  }

  const resolvedProjectId = resolveProjectId(project_id);
  if (!resolvedProjectId) {
    return res.status(404).json({ error: 'Project not found' });
  }

  if (req.user.role !== 'admin') {
    const projectRole = getProjectRole(resolvedProjectId, req.user.id);
    if (projectRole !== 'tester') {
      return res.status(403).json({ error: 'Only testers can create issues' });
    }
  }

  const db = getDb();

  if (assigned_to) {
    const devResult = db.exec(`
      SELECT u.id FROM users u
      JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = ?
      WHERE u.id = ? AND pm.role_in_project = 'developer'
    `, [resolvedProjectId, assigned_to]);

    if (devResult.length === 0 || devResult[0].values.length === 0) {
      return res.status(400).json({ error: 'assigned_to must be a developer in this project' });
    }
  }

  const maxNumResult = db.exec('SELECT MAX(local_number) as max_num FROM issues WHERE project_id = ?', [resolvedProjectId]);
  const maxNum = (maxNumResult.length > 0 && maxNumResult[0].values.length > 0 && maxNumResult[0].values[0][0]) || 0;
  const local_number = maxNum + 1;

  db.run(
    "INSERT INTO issues (project_id, bot_id, local_number, status, created_by, assigned_to) VALUES (?, ?, ?, 'new', ?, ?)",
    [resolvedProjectId, bot_id || null, local_number, req.user.id, assigned_to || null]
  );

  const issueId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];

  db.run(
    'INSERT INTO issue_messages (issue_id, author_id, text) VALUES (?, ?, ?)',
    [issueId, req.user.id, text]
  );

  const messageId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];

  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const relativePath = `uploads/${resolvedProjectId}/${file.filename}`;
      db.run(
        'INSERT INTO issue_attachments (message_id, file_path, file_name) VALUES (?, ?, ?)',
        [messageId, relativePath, decodeFileName(file.originalname)]
      );
    }
  }

  saveDatabase();

  const issueResult = db.exec('SELECT * FROM issues WHERE id = ?', [issueId]);
  res.status(201).json({ issue: getOne(issueResult) });
});

router.post('/:id/messages', upload.array('attachments', 10), (req, res) => {
  const { text, status_change } = req.body;
  const issueId = req.params.id;

  const db = getDb();
  const issueResult = db.exec('SELECT * FROM issues WHERE id = ?', [issueId]);
  const issue = getOne(issueResult);

  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  if (!checkProjectAccess(issue.project_id, req.user.id, req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!text && (!req.files || req.files.length === 0) && !status_change) {
    return res.status(400).json({ error: 'Message text or attachment required' });
  }

  const projectRole = getProjectRole(issue.project_id, req.user.id);

  if (text || (req.files && req.files.length > 0)) {
    db.run(
      'INSERT INTO issue_messages (issue_id, author_id, text) VALUES (?, ?, ?)',
      [issueId, req.user.id, text || '']
    );

    const messageId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const relativePath = `uploads/${issue.project_id}/${file.filename}`;
        db.run(
          'INSERT INTO issue_attachments (message_id, file_path, file_name) VALUES (?, ?, ?)',
          [messageId, relativePath, decodeFileName(file.originalname)]
        );
      }
    }
  }

  if (status_change) {
    let allowed;
    if (req.user.role === 'admin') {
      allowed = { ...TESTER_TRANSITIONS, ...DEVELOPER_TRANSITIONS };
    } else if (projectRole === 'tester') {
      allowed = TESTER_TRANSITIONS;
    } else if (projectRole === 'developer') {
      allowed = DEVELOPER_TRANSITIONS;
    }

    if (!allowed || !allowed[status_change]) {
      return res.status(400).json({ error: 'Status transition not allowed for your role' });
    }

    db.run(
      "UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?",
      [status_change, issueId]
    );

    const statusLabel = STATUS_LABELS[status_change] || status_change;
    db.run(
      'INSERT INTO issue_messages (issue_id, author_id, text, is_system) VALUES (?, ?, ?, 1)',
      [issueId, req.user.id, `Статус изменён на "${statusLabel}" пользователем ${req.user.name}`]
    );
  } else {
    db.run(
      "UPDATE issues SET updated_at = datetime('now') WHERE id = ?",
      [issueId]
    );
  }

  saveDatabase();

  const updatedResult = db.exec('SELECT * FROM issues WHERE id = ?', [issueId]);
  res.json({ issue: getOne(updatedResult) });
});

router.patch('/:id/assign', (req, res) => {
  const { assigned_to } = req.body;
  const issueId = req.params.id;

  const db = getDb();
  const issueResult = db.exec('SELECT * FROM issues WHERE id = ?', [issueId]);
  const issue = getOne(issueResult);

  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  if (!checkProjectAccess(issue.project_id, req.user.id, req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (assigned_to) {
    const devResult = db.exec(`
      SELECT u.id FROM users u
      JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = ?
      WHERE u.id = ? AND pm.role_in_project = 'developer'
    `, [issue.project_id, assigned_to]);

    if (devResult.length === 0 || devResult[0].values.length === 0) {
      return res.status(400).json({ error: 'User is not a developer in this project' });
    }
  }

  db.run(
    "UPDATE issues SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?",
    [assigned_to || null, issueId]
  );
  saveDatabase();

  const updatedResult = db.exec('SELECT * FROM issues WHERE id = ?', [issueId]);
  res.json({ issue: getOne(updatedResult) });
});

router.patch('/:id', requireRole('admin'), (req, res) => {
  const { bot_id, text } = req.body;
  const issueId = req.params.id;

  const db = getDb();
  const issue = getOne(db.exec('SELECT * FROM issues WHERE id = ?', [issueId]));

  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  if (bot_id !== undefined) {
    if (bot_id) {
      const botResult = db.exec('SELECT id FROM bots WHERE id = ? AND project_id = ?', [bot_id, issue.project_id]);
      if (botResult.length === 0 || botResult[0].values.length === 0) {
        return res.status(400).json({ error: 'Bot not found in this project' });
      }
    }
    db.run('UPDATE issues SET bot_id = ? WHERE id = ?', [bot_id || null, issueId]);
  }

  if (text !== undefined && text !== null && String(text).trim() !== '') {
    const firstMsg = getOne(db.exec(
      'SELECT id FROM issue_messages WHERE issue_id = ? AND is_system = 0 ORDER BY created_at ASC LIMIT 1',
      [issueId]
    ));
    if (firstMsg) {
      db.run('UPDATE issue_messages SET text = ? WHERE id = ?', [text, firstMsg.id]);
    }
  }

  db.run("UPDATE issues SET updated_at = datetime('now') WHERE id = ?", [issueId]);
  saveDatabase();

  const updatedResult = db.exec('SELECT * FROM issues WHERE id = ?', [issueId]);
  res.json({ issue: getOne(updatedResult) });
});

router.delete('/:id', (req, res) => {
  const issueId = req.params.id;

  const db = getDb();
  const issue = getOne(db.exec('SELECT * FROM issues WHERE id = ?', [issueId]));

  if (!issue) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  if (req.user.role !== 'admin' && issue.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Удалить замечание может только его автор или администратор' });
  }

  const files = db.exec(`
    SELECT a.file_path FROM issue_attachments a
    JOIN issue_messages m ON m.id = a.message_id
    WHERE m.issue_id = ?
  `, [issueId]);

  const filePaths = files.length > 0 ? files[0].values.map(r => r[0]) : [];

  db.run('DELETE FROM issue_attachments WHERE message_id IN (SELECT id FROM issue_messages WHERE issue_id = ?)', [issueId]);
  db.run('DELETE FROM issue_messages WHERE issue_id = ?', [issueId]);
  db.run('DELETE FROM issues WHERE id = ?', [issueId]);
  saveDatabase();

  deleteUploadedFiles(filePaths);

  res.json({ ok: true });
});

export default router;
