// QA integration tests for the `testing` SSO additions:
//   - GET /api/internal/session (loopback + shared secret, read-only)
//   - cookie Domain on login/logout
//   - removed audio-correction routes + /uploads static
//   - SQL-injection fix in middleware/auth.js
//
// Продуктовый код не изменяется. Сервер поднимается отдельным процессом с
// временной БД (migrate + seed admin), как в реальном деплое.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', '..');
const uploadsRoot = join(backendRoot, 'src', 'uploads');
const TOKEN = 'qa-internal-secret';
const DOMAIN = '.bot-atelier.ru';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function runNodeScript(script, env) {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    throw new Error(`node script failed: ${res.stdout}\n${res.stderr}`);
  }
  return res.stdout.trim();
}

function makeDb(dbPath) {
  const env = { ...process.env, DB_PATH: dbPath };
  for (const script of ['src/db/migrate.js', 'src/db/seed.js']) {
    const res = spawnSync(process.execPath, [script], { cwd: backendRoot, env, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`${script} failed: ${res.stdout} ${res.stderr}`);
  }
}

const READ_SQL = `
import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';
const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(process.env.DB_PATH));
const res = db.exec(process.env.QA_SQL);
const rows = res.length ? res[0].values.map((v) => {
  const o = {};
  res[0].columns.forEach((c, i) => { o[c] = v[i]; });
  return o;
}) : [];
process.stdout.write(JSON.stringify(rows));
`;

function queryDb(dbPath, sql) {
  return JSON.parse(runNodeScript(READ_SQL, { DB_PATH: dbPath, QA_SQL: sql }));
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

async function startBackend(env) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    env: { ...process.env, NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  children.push(child);

  const port = Number(env.PORT);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      // В `testing` нет /api/health — считаем сервер поднятым при любом HTTP-ответе.
      const r = await fetch(`http://127.0.0.1:${port}/api/internal/session`).catch(() => null);
      if (r) return { child, port };
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`backend exited early: ${log}`);
    await sleep(150);
  }
  throw new Error(`backend not ready on ${port}: ${log}`);
}

function api(port, path, { method = 'GET', cookie, body, headers } = {}) {
  const h = { ...(headers || {}) };
  if (cookie) h.Cookie = cookie;
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`http://127.0.0.1:${port}${path}`, { method, headers: h, body: payload });
}

function findSetCookie(res, name) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return list.find((c) => c.startsWith(`${name}=`)) || null;
}

let portCounter = 25100;
function nextPort() {
  return String(portCounter++);
}

function freshDb() {
  const root = mkdtempSync(join(tmpdir(), 'testing-qa-'));
  const dbPath = join(root, 'app.db');
  makeDb(dbPath);
  return { root, dbPath };
}

// ---------------------------------------------------------------------------
// Suite A: token + COOKIE_DOMAIN set
// ---------------------------------------------------------------------------

describe('testing SSO — internal session + cookie domain', () => {
  let port;
  let tmpRoot;
  let dbPath;
  let adminCookie;
  let loginSetCookie;

  before(async () => {
    const db = freshDb();
    tmpRoot = db.root;
    dbPath = db.dbPath;
    const srv = await startBackend({
      PORT: nextPort(),
      DB_PATH: dbPath,
      INTERNAL_AUTH_TOKEN: TOKEN,
      COOKIE_DOMAIN: DOMAIN
    });
    port = srv.port;

    const login = await api(port, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.com', password: 'admin123' }
    });
    assert.equal(login.status, 200);
    loginSetCookie = findSetCookie(login, 'session_id');
    const value = loginSetCookie.split(';')[0].split('=')[1];
    adminCookie = `session_id=${value}`;
  });

  after(async () => {
    for (const c of children) { try { c.kill(); } catch { /* ignore */ } }
    await sleep(200);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('login sets session_id with Domain from COOKIE_DOMAIN', () => {
    assert.ok(loginSetCookie, 'session_id Set-Cookie expected');
    assert.match(loginSetCookie, new RegExp(`Domain=${DOMAIN.replace('.', '\\.')}`, 'i'));
    assert.match(loginSetCookie, /HttpOnly/i);
    assert.match(loginSetCookie, /SameSite=Lax/i);
  });

  test('internal session: valid cookie + token -> 200 user/expires_at', async () => {
    const r = await api(port, '/api/internal/session', {
      cookie: adminCookie,
      headers: { 'X-Internal-Auth': TOKEN }
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(j.user, 'user expected');
    assert.equal(j.user.email, 'admin@example.com');
    assert.equal(j.user.role, 'admin');
    assert.equal(typeof j.user.id, 'number');
    assert.equal(typeof j.user.name, 'string');
    assert.ok(j.expires_at, 'expires_at expected');
  });

  test('internal session: wrong token -> 403', async () => {
    const r = await api(port, '/api/internal/session', {
      cookie: adminCookie,
      headers: { 'X-Internal-Auth': 'wrong-token' }
    });
    assert.equal(r.status, 403);
  });

  test('internal session: missing token header -> 403', async () => {
    const r = await api(port, '/api/internal/session', { cookie: adminCookie });
    assert.equal(r.status, 403);
  });

  test('internal session: no cookie -> 401', async () => {
    const r = await api(port, '/api/internal/session', {
      headers: { 'X-Internal-Auth': TOKEN }
    });
    assert.equal(r.status, 401);
  });

  test('internal session is read-only: expiry not extended', async () => {
    const sid = adminCookie.split('=')[1];
    const q = `SELECT expires_at FROM sessions WHERE session_id = '${sid}'`;

    const t0 = queryDb(dbPath, q)[0].expires_at;
    // Даём секунде "перевалить", чтобы продление authMiddleware было заметно.
    await sleep(1100);

    const r1 = await api(port, '/api/internal/session', {
      cookie: adminCookie,
      headers: { 'X-Internal-Auth': TOKEN }
    });
    assert.equal(r1.status, 200);
    const t1 = queryDb(dbPath, q)[0].expires_at;
    assert.equal(t1, t0, 'internal endpoint must not extend expiry');

    // Контроль: обычный authMiddleware (/api/me) продлевает сессию на 7 дней.
    const me = await api(port, '/api/me', { cookie: adminCookie });
    assert.equal(me.status, 200);
    const t2 = queryDb(dbPath, q)[0].expires_at;
    assert.ok(t2 > t0, `authMiddleware should extend expiry (${t0} -> ${t2})`);
  });

  test('SQL injection through session_id cookie is neutralised', async () => {
    const r = await api(port, '/api/me', {
      cookie: `session_id=${encodeURIComponent("' OR '1'='1")}`
    });
    assert.equal(r.status, 401);

    const r2 = await api(port, '/api/me', {
      cookie: `session_id=${encodeURIComponent("abc'def")}`
    });
    assert.equal(r2.status, 401);
  });

  test('removed audio-correction routes -> 404', async () => {
    const r = await api(port, '/api/projects/1/audio-correction', { cookie: adminCookie });
    assert.equal(r.status, 404);
    const r2 = await api(port, '/api/projects/1/audio-correction/process', {
      method: 'POST', cookie: adminCookie
    });
    assert.equal(r2.status, 404);
  });

  test('/uploads static still served', async () => {
    const probeDir = join(uploadsRoot, '__qa_probe__');
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'probe.txt'), 'qa-static-ok');
    try {
      const r = await api(port, '/uploads/__qa_probe__/probe.txt');
      assert.equal(r.status, 200);
      assert.equal(await r.text(), 'qa-static-ok');
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });

  test('logout clears session_id with the same Domain attribute', async () => {
    const r = await api(port, '/api/auth/logout', { method: 'POST', cookie: adminCookie });
    assert.equal(r.status, 200);
    const clear = findSetCookie(r, 'session_id');
    assert.ok(clear, 'clear Set-Cookie expected');
    assert.match(clear, new RegExp(`Domain=${DOMAIN.replace('.', '\\.')}`, 'i'));
    assert.match(clear, /Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });
});

// ---------------------------------------------------------------------------
// Suite B: COOKIE_DOMAIN unset -> host-only cookie
// ---------------------------------------------------------------------------

describe('testing SSO — COOKIE_DOMAIN unset', () => {
  let port;
  let tmpRoot;

  before(async () => {
    const db = freshDb();
    tmpRoot = db.root;
    const srv = await startBackend({
      PORT: nextPort(),
      DB_PATH: db.dbPath,
      INTERNAL_AUTH_TOKEN: TOKEN
    });
    port = srv.port;
  });

  after(async () => {
    for (const c of children) { try { c.kill(); } catch { /* ignore */ } }
    await sleep(200);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('login without COOKIE_DOMAIN -> host-only cookie (no Domain)', async () => {
    const login = await api(port, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.com', password: 'admin123' }
    });
    assert.equal(login.status, 200);
    const setCookie = findSetCookie(login, 'session_id');
    assert.ok(setCookie);
    assert.doesNotMatch(setCookie, /Domain=/i);
  });
});

// ---------------------------------------------------------------------------
// Suite C: INTERNAL_AUTH_TOKEN unset -> 503
// ---------------------------------------------------------------------------

describe('testing SSO — INTERNAL_AUTH_TOKEN unset', () => {
  let port;
  let tmpRoot;
  let cookie;

  before(async () => {
    const db = freshDb();
    tmpRoot = db.root;
    const srv = await startBackend({
      PORT: nextPort(),
      DB_PATH: db.dbPath,
      INTERNAL_AUTH_TOKEN: ''
    });
    port = srv.port;

    const login = await api(port, '/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@example.com', password: 'admin123' }
    });
    const setCookie = findSetCookie(login, 'session_id');
    cookie = setCookie ? `session_id=${setCookie.split(';')[0].split('=')[1]}` : null;
  });

  after(async () => {
    for (const c of children) { try { c.kill(); } catch { /* ignore */ } }
    await sleep(200);
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('internal session with unset token env -> 503', async () => {
    const r = await api(port, '/api/internal/session', {
      cookie,
      headers: { 'X-Internal-Auth': TOKEN }
    });
    assert.equal(r.status, 503);
  });

  test('internal session with unset token + no cookie -> 503', async () => {
    const r = await api(port, '/api/internal/session');
    assert.equal(r.status, 503);
  });
});
