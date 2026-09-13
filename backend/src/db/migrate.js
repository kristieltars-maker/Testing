import { initDatabase, getDb, saveDatabase } from './database.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { slugify } from '../utils/slug.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = join(__dirname, '..', '..', 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const uploadsDir = join(__dirname, '..', 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

async function migrate() {
  await initDatabase();
  const db = getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'tester', 'developer', 'manager')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client_name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'ТВИН',
      slug TEXT,
      manager_id INTEGER,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      role_in_project TEXT NOT NULL CHECK(role_in_project IN ('tester', 'developer', 'manager')),
      PRIMARY KEY (project_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      bot_id INTEGER REFERENCES bots(id) ON DELETE SET NULL,
      local_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'in_progress', 'clarification', 'waiting', 'done', 'cancelled', 'rejected', 'reopened')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      assigned_to INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, local_number)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS issue_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS issue_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES issue_messages(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_issues_created_by ON issues(created_by)');
  db.run('CREATE INDEX IF NOT EXISTS idx_issues_assigned_to ON issues(assigned_to)');
  db.run('CREATE INDEX IF NOT EXISTS idx_issue_messages_issue_id ON issue_messages(issue_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_issue_attachments_message_id ON issue_attachments(message_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_bots_project_id ON bots(project_id)');

  // Миграция: добавляем slug для существующих БД
  const projectCols = db.exec("PRAGMA table_info('projects')");
  const hasSlug = projectCols.length > 0 && projectCols[0].values.some(r => r[1] === 'slug');
  if (!hasSlug) {
    db.run('ALTER TABLE projects ADD COLUMN slug TEXT');
  }

  // Бэкфилл slug для проектов, где он ещё не задан
  const missing = db.exec("SELECT id, name FROM projects WHERE slug IS NULL OR slug = ''");
  const missingRows = missing.length > 0 ? missing[0].values : [];
  for (const [id, name] of missingRows) {
    const base = slugify(name);
    let slug = base;
    let counter = 2;
    while (true) {
      const dup = db.exec('SELECT id FROM projects WHERE slug = ? AND id != ?', [slug, id]);
      if (dup.length === 0 || dup[0].values.length === 0) break;
      slug = `${base}-${counter++}`;
    }
    db.run('UPDATE projects SET slug = ? WHERE id = ?', [slug, id]);
  }

  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)');

  // Миграция: разрешаем роль 'manager' (руководитель проекта).
  // SQLite не умеет менять CHECK — пересоздаём таблицу users.
  const usersSqlRes = db.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  const usersSql = usersSqlRes.length > 0 ? String(usersSqlRes[0].values[0][0]) : '';
  if (usersSql && !usersSql.includes("'manager'")) {
    db.run('PRAGMA foreign_keys = OFF');
    db.run(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'tester', 'developer', 'manager')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.run(`INSERT INTO users_new (id, name, email, password_hash, role, is_active, created_at)
            SELECT id, name, email, password_hash, role, is_active, created_at FROM users`);
    db.run('DROP TABLE users');
    db.run('ALTER TABLE users_new RENAME TO users');
    db.run('PRAGMA foreign_keys = ON');
  }

  // Миграция: поле "руководитель проекта"
  const projectCols2 = db.exec("PRAGMA table_info('projects')");
  const hasManager = projectCols2.length > 0 && projectCols2[0].values.some(r => r[1] === 'manager_id');
  if (!hasManager) {
    db.run('ALTER TABLE projects ADD COLUMN manager_id INTEGER');
  }

  // Миграция: роль 'manager' для участника проекта (руководитель проекта).
  const pmSqlRes = db.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'project_members'");
  const pmSql = pmSqlRes.length > 0 ? String(pmSqlRes[0].values[0][0]) : '';
  if (pmSql && !pmSql.includes("'manager'")) {
    db.run('PRAGMA foreign_keys = OFF');
    db.run(`
      CREATE TABLE project_members_new (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        role_in_project TEXT NOT NULL CHECK(role_in_project IN ('tester', 'developer', 'manager')),
        PRIMARY KEY (project_id, user_id)
      )
    `);
    db.run('INSERT INTO project_members_new (project_id, user_id, role_in_project) SELECT project_id, user_id, role_in_project FROM project_members');
    db.run('DROP TABLE project_members');
    db.run('ALTER TABLE project_members_new RENAME TO project_members');
    db.run('PRAGMA foreign_keys = ON');
    db.run('CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id)');
  }

  // Миграция: новые статусы замечаний ('in_progress', 'clarification').
  const issuesSqlRes = db.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'issues'");
  const issuesSql = issuesSqlRes.length > 0 ? String(issuesSqlRes[0].values[0][0]) : '';
  if (issuesSql && !issuesSql.includes("'in_progress'")) {
    db.run('PRAGMA foreign_keys = OFF');
    db.run(`
      CREATE TABLE issues_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        bot_id INTEGER REFERENCES bots(id) ON DELETE SET NULL,
        local_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'in_progress', 'clarification', 'waiting', 'done', 'cancelled', 'rejected', 'reopened')),
        created_by INTEGER NOT NULL REFERENCES users(id),
        assigned_to INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, local_number)
      )
    `);
    db.run(`INSERT INTO issues_new (id, project_id, bot_id, local_number, status, created_by, assigned_to, created_at, updated_at)
            SELECT id, project_id, bot_id, local_number, status, created_by, assigned_to, created_at, updated_at FROM issues`);
    db.run('DROP TABLE issues');
    db.run('ALTER TABLE issues_new RENAME TO issues');
    db.run('PRAGMA foreign_keys = ON');
    db.run('CREATE INDEX IF NOT EXISTS idx_issues_project_id ON issues(project_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_issues_created_by ON issues(created_by)');
    db.run('CREATE INDEX IF NOT EXISTS idx_issues_assigned_to ON issues(assigned_to)');
  }

  saveDatabase();
  console.log('Database migrated successfully');
}

migrate().catch(console.error);
