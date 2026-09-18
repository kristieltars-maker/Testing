// QA regression smoke после удаления встроенной audio-интеграции и выноса
// helpers в utils/projectAccess.js: projects/bots/issues CRUD остаются
// рабочими (AC-5).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', '..');
const PORT = String(30000 + Math.floor(Math.random() * 1000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];

function makeDb(dbPath) {
  const env = { ...process.env, DB_PATH: dbPath };
  for (const script of ['src/db/migrate.js', 'src/db/seed.js']) {
    const res = spawnSync(process.execPath, [script], { cwd: backendRoot, env, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`${script} failed: ${res.stdout} ${res.stderr}`);
  }
}

async function startBackend(dbPath) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    env: { ...process.env, NODE_ENV: 'test', PORT, DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  children.push(child);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/internal/session`).catch(() => null);
      if (r) return;
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`backend exited early: ${log}`);
    await sleep(150);
  }
  throw new Error(`backend not ready on ${PORT}: ${log}`);
}

function api(path, { method = 'GET', cookie, body, form } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers, body: payload });
}

function findSetCookie(res, name) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return list.find((c) => c.startsWith(`${name}=`)) || null;
}

describe('testing regression: projects/bots/issues CRUD', () => {
  let cookie;
  let tmpRoot;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'testing-reg-'));
    const dbPath = join(tmpRoot, 'app.db');
    makeDb(dbPath);
    await startBackend(dbPath);

    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.com', password: 'admin123' }
    });
    assert.equal(login.status, 200);
    cookie = `session_id=${findSetCookie(login, 'session_id').split(';')[0].split('=')[1]}`;
  });

  after(async () => {
    for (const c of children) { try { c.kill(); } catch { /* ignore */ } }
    await sleep(200);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('create/list/update project + bot', async () => {
    const create = await api('/api/projects', {
      method: 'POST',
      cookie,
      body: { name: 'QA Project', client_name: 'QA Client' }
    });
    assert.equal(create.status, 201);
    const project = (await create.json()).project;
    assert.ok(project.id);
    assert.ok(project.slug);

    const list = await api('/api/projects', { cookie });
    assert.equal(list.status, 200);
    assert.ok((await list.json()).projects.some((p) => p.id === project.id));

    const patch = await api(`/api/projects/${project.id}`, {
      method: 'PATCH',
      cookie,
      body: { client_name: 'QA Client 2' }
    });
    assert.equal(patch.status, 200);
    assert.equal((await patch.json()).project.client_name, 'QA Client 2');

    const bot = await api(`/api/projects/${project.id}/bots`, {
      method: 'POST',
      cookie,
      body: { name: 'QA Bot' }
    });
    assert.equal(bot.status, 201);
    assert.ok((await bot.json()).bot.id);
  });

  test('create issue and list by project', async () => {
    const create = await api('/api/projects', {
      method: 'POST', cookie, body: { name: 'QA Issues', client_name: 'QA' }
    });
    const project = (await create.json()).project;

    const form = new FormData();
    form.append('project_id', String(project.id));
    form.append('text', 'Проверка после удаления аудио');
    const issue = await api('/api/issues', { method: 'POST', cookie, form });
    assert.equal(issue.status, 201);
    const created = (await issue.json()).issue;
    assert.equal(created.project_id, project.id);
    assert.equal(created.local_number, 1);

    const list = await api(`/api/issues?project_id=${project.id}`, { cookie });
    assert.equal(list.status, 200);
    const issues = (await list.json()).issues;
    assert.equal(issues.length, 1);
    assert.equal(issues[0].id, created.id);

    const detail = await api(`/api/issues/${created.id}`, { cookie });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).issue.id, created.id);
  });
});
