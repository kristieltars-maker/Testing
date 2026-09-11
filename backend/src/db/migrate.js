import { initDatabase, getDb, saveDatabase } from './database.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

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
      role TEXT NOT NULL CHECK(role IN ('admin', 'tester', 'developer')),
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
      role_in_project TEXT NOT NULL CHECK(role_in_project IN ('tester', 'developer')),
      PRIMARY KEY (project_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      bot_id INTEGER REFERENCES bots(id) ON DELETE SET NULL,
      local_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'waiting', 'done', 'cancelled', 'rejected', 'reopened')),
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

  saveDatabase();
  console.log('Database migrated successfully');
}

migrate().catch(console.error);
