# План: вынос `audio-correction` в standalone-приложение

> **Статус:** готов к ревью.
> **Связанные документы:**
> `.opencode/architecture/audio-correction.md`,
> `.opencode/architecture/audio-correction-standalone.md`,
> `.opencode/design/audio-correction-standalone-ui.md`.

---

## 1. Цель

Вынести подсистему «Корректор аудио-файлов» из монолита `testing` в
самостоятельное приложение на поддомене `correction-audio.bot-atelier.ru`
с отдельным backend, frontend, собственной БД (только локальные SSO-сессии)
и Python sidecar в Docker Compose; настроить единый вход (SSO) через общую
cookie `Domain=.bot-atelier.ru` и внутренний loopback-endpoint `testing`;
полностью удалить встроенную копию из `testing` (маршруты, сервисы,
frontend, CSS, `archiver`, root `docker-compose.yml`); попутно исправить
SQL-инъекцию в `testing` `backend/src/middleware/auth.js:17`.

### Критерии приёмки

| # | Условие | Проверка |
|---|---------|----------|
| AC-1 | `https://correction-audio.bot-atelier.ru` отдаёт SPA по HTTPS с валидным сертификатом | `curl -I https://correction-audio.bot-atelier.ru` → 200, сертификат Let's Encrypt |
| AC-2 | SSO-вход: пользователь, залогиненный в `testing`, открывает standalone и автоматически получает локальную сессию | Открыть standalone после входа в testing → `/api/me` возвращает `{ user }`, cookie `ac_session_id` установлена |
| AC-3 | Нет общей cookie → standalone редиректит на `/login` с кнопкой «Войти через экосистему» | Incognito-окно → `/login` landing |
| AC-4 | Кнопка «Войти через экосистему» ведёт на `testing.bot-atelier.ru/login?next=…` и после входа возвращает обратно | Клик → вход → редирект на standalone → workspace |
| AC-5 | `testing` работает без изменений для issues/projects/users после удаления встроенной аудио-интеграции | `npm test` в `testing` зелёный; CRUD issues/projects работает |
| AC-6 | Встроенная аудио-интеграция полностью удалена из `testing` | Нет файлов `audio-correction*`, `audioCorrection*` в `testing`; нет импортов в `server.js`; `archiver` убран из `package.json` |
| AC-7 | Workspace эфемерен: закрытие сессии / TTL 1 ч / рестарт сервера удаляют файлы и workspace | `DELETE /api/session` → директория удалена; через 1 ч без активности GC убирает workspace |
| AC-8 | SQL-инъекция в `testing` `middleware/auth.js` исправлена | Параметризованный запрос; `sessionId` с кавычками не ломает запрос |
| AC-9 | Внутренний endpoint `testing` недоступен снаружи | `curl https://testing.bot-atelier.ru/api/internal/session` → 403 от nginx |
| AC-10 | Sidecar отвечает на loopback | `curl http://127.0.0.1:8080/health` → `{"status":"ok"}` |
| AC-11 | Нет проектной модели в standalone | Нет `projectId` в API, нет `ProjectTabs`, нет `useParams` |
| AC-12 | `testing` `POST /logout` очищает cookie с `Domain=.bot-atelier.ru` | После logout cookie `session_id` удалена и в standalone |

---

## 2. Целевая структура репозитория

```text
Тестирование ботов/                     # корень монорепозитория
├── backend/                            # testing backend (без аудио)
├── frontend/                           # testing frontend (без аудио)
├── audio-correction/                   # НОВОЕ: standalone-приложение
│   ├── backend/
│   │   ├── src/
│   │   │   ├── server.js
│   │   │   ├── middleware/
│   │   │   │   └── auth.js             # проверка локальной сессии
│   │   │   ├── routes/
│   │   │   │   ├── auth.js             # bootstrap SSO, logout, /me
│   │   │   │   └── session.js          # workspace API
│   │   │   ├── services/
│   │   │   │   ├── ecosystemAuth.js    # клиент к testing /api/internal/session
│   │   │   │   ├── audioCorrection.js  # клиент к sidecar
│   │   │   │   └── audioCorrectionSessionStore.js  # workspace + GC
│   │   │   ├── db/
│   │   │   │   ├── database.js         # sql.js wrapper
│   │   │   │   └── migrate.js          # local_sessions + users_cache
│   │   │   └── utils/
│   │   │       └── decodeFileName.js   # локальная копия
│   │   ├── data/                       # .gitkeep; app.db создаётся runtime
│   │   ├── package.json
│   │   ├── ecosystem.config.cjs
│   │   └── .env.example
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── main.jsx
│   │   │   ├── App.jsx
│   │   │   ├── index.css
│   │   │   ├── contexts/
│   │   │   │   └── AuthContext.jsx     # SSO-only (без формы логина)
│   │   │   ├── pages/
│   │   │   │   ├── LoginPage.jsx       # landing «Войти через экосистему»
│   │   │   │   └── AudioCorrectionPage.jsx  # основной workspace
│   │   │   ├── components/
│   │   │   │   ├── ReferenceUpload.jsx
│   │   │   │   ├── TargetsUpload.jsx
│   │   │   │   ├── SettingsPanel.jsx
│   │   │   │   ├── ProcessingStatus.jsx
│   │   │   │   ├── ResultsPanel.jsx
│   │   │   │   ├── CloseConfirmModal.jsx
│   │   │   │   └── TrashIcon.jsx
│   │   │   ├── api/
│   │   │   │   ├── client.js
│   │   │   │   └── audioCorrection.js  # база /session, без projectId
│   │   │   ├── constants/
│   │   │   │   ├── audioCorrection.js
│   │   │   │   └── roles.js
│   │   │   └── hooks/
│   │   │       └── useNavigationGuard.js
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   └── package.json
│   └── deploy/
│       ├── nginx.conf                  # server-блок для certbot
│       ├── docker-compose.yml          # sidecar
│       └── deploy.sh                   # скрипт развёртывания
├── subsystems/
│   └── audio-correction/service/       # Python sidecar (без изменений)
├── nginx.conf                          # testing nginx (добавить deny internal)
├── docker-compose.yml                  # УДАЛИТЬ (переносится в audio-correction/deploy/)
└── .opencode/
```

---

## 3. Пошаговая реализация

### Фаза A: SSO-изменения в `testing`

> **Приоритет:** эти изменения нужны до развёртывания standalone.
> **Риск:** затрагивают production-приложение `testing`.

#### A1. Исправить SQL-инъекцию в `middleware/auth.js`

**Файл:** `backend/src/middleware/auth.js`

Заменить строковую конкатенацию (строка 17) на параметризованный запрос:

- Было: `` WHERE s.session_id = '${sessionId}' AND s.expires_at > datetime('now') ``
- Стало: `WHERE s.session_id = ? AND s.expires_at > datetime('now')` с передачей `[sessionId]` вторым аргументом `db.exec()`.

Убедиться, что `db.exec(sql, params)` поддерживает параметризацию в `sql.js` (поддерживает).

#### A2. Cookie `session_id` с `Domain=.bot-atelier.ru`

**Файл:** `backend/src/routes/auth.js`

- В `POST /login` (строка 53): добавить `domain: process.env.COOKIE_DOMAIN` в опции `res.cookie`.
- В `POST /logout` (строка 73): добавить `domain: process.env.COOKIE_DOMAIN` в `res.clearCookie`.
- Значение `COOKIE_DOMAIN` в production: `.bot-atelier.ru`. В dev — не задано (host-only).

**Файл:** `backend/.env.production`

Добавить строку: `COOKIE_DOMAIN=.bot-atelier.ru`

**Файл:** `backend/ecosystem.config.cjs`

Добавить `COOKIE_DOMAIN: '.bot-atelier.ru'` в `env_production`.

#### A3. Внутренний endpoint `GET /api/internal/session`

**Новый файл:** `backend/src/routes/internal.js`

- Маршрут `GET /session`.
- Проверяет заголовок `X-Internal-Auth` на совпадение с `process.env.INTERNAL_AUTH_TOKEN`.
  - Не совпадает / не задан → `403 { error: 'Forbidden' }`.
- Читает cookie `session_id` из запроса.
- Выполняет параметризованный запрос к `sessions JOIN users` (без продления `expires_at`).
- Ответы: `200 { user: { id, name, email, role }, expires_at }`, `401`, `403`.
- **Не** подключать через `authMiddleware` — собственная проверка.

**Файл:** `backend/src/server.js`

- Импортировать `internalRoutes`.
- Монтировать **до** `authMiddleware`: `app.use('/api/internal', internalRoutes)`.

#### A4. Nginx `testing`: запрет `/api/internal/`

**Файл:** `nginx.conf` (в корне репозитория — шаблон для сервера)

Добавить в server-блок `testing.bot-atelier.ru` **перед** `location /api/`:

```nginx
location ^~ /api/internal/ {
    deny all;
    return 403;
}
```

#### A5. Whitelisted `next` в login `testing`

**Файл:** `frontend/src/pages/LoginPage.jsx`

- После успешного `login()` проверить `URLSearchParams(window.location.search).get('next')`.
- Если значение проходит whitelist-проверку (hostname.endsWith('.bot-atelier.ru')), редиректить на него через `window.location.href`.
- Иначе — `navigate('/')` как сейчас.

**Файл:** `frontend/src/App.jsx`

- В route `/login` передать query-параметр `next` (не требует изменений, т.к. `LoginPage` читает из URL).

---

### Фаза B: Standalone backend

#### B1. Инициализация `audio-correction/backend/`

**Новый файл:** `audio-correction/backend/package.json`

Зависимости: `express`, `cookie-parser`, `cors`, `multer`, `sql.js`, `uuid`, `archiver`.
Скрипты: `start`, `dev`, `migrate`, `test`.

**Новый файл:** `audio-correction/backend/.env.example`

Все env-переменные (см. раздел 5).

**Новый файл:** `audio-correction/backend/ecosystem.config.cjs`

PM2-конфиг: `name: 'audio-correction'`, `script: 'src/server.js'`, `PORT: 3002`.

#### B2. База данных

**Новый файл:** `audio-correction/backend/src/db/database.js`

- `sql.js` wrapper: `initDatabase()`, `getDb()`, `saveDatabase()`.
- Путь: `process.env.DB_PATH || './data/app.db'`.

**Новый файл:** `audio-correction/backend/src/db/migrate.js`

- Создаёт таблицы `local_sessions` и `users_cache` (DDL из архитектуры §4.1).

**Новый файл:** `audio-correction/backend/data/.gitkeep`

#### B3. Middleware аутентификации

**Новый файл:** `audio-correction/backend/src/middleware/auth.js`

- Читает cookie `ac_session_id`.
- Параметризованный запрос к `local_sessions` (проверка `expires_at > datetime('now')`).
- При успехе: `req.user = { id, name, email, role }`, `req.sessionId = ac_session_id`.
- Обновляет `last_seen_at`.
- При отсутствии/истечении → `401`.

#### B4. SSO-сервис (клиент к `testing`)

**Новый файл:** `audio-correction/backend/src/services/ecosystemAuth.js`

- `verifyEcosystemSession(cookieSessionId)` — HTTP GET к
  `${ECOSYSTEM_AUTH_URL}/api/internal/session` с заголовками
  `Cookie: session_id=…` и `X-Internal-Auth: ${INTERNAL_AUTH_TOKEN}`.
- Таймаут: 5 секунд.
- Возвращает `{ user, expires_at }` или бросает ошибку с кодом (401/403/503).

#### B5. Маршруты аутентификации

**Новый файл:** `audio-correction/backend/src/routes/auth.js`

- `GET /api/me` — если есть валидная локальная сессия → `{ user }`.
  Если нет, но есть cookie `session_id` → попытка bootstrap (как `POST /auth/session`).
  Если ни того, ни другого → `401`.
- `POST /api/auth/session` (bootstrap):
  1. Читает cookie `session_id` (Domain=.bot-atelier.ru).
  2. Вызывает `ecosystemAuth.verifyEcosystemSession(session_id)`.
  3. Upsert `users_cache`.
  4. `INSERT INTO local_sessions` с `session_id = uuidv4()`,
     `expires_at = min(now + 7d, ecosystem expires_at)`.
  5. `Set-Cookie: ac_session_id=<uuid>; Path=/; HttpOnly; Secure (prod); SameSite=Lax; Max-Age=…`.
  6. Возвращает `{ user }`.
  - Ошибки: нет cookie → `401`; `testing` недоступен → `503`; деактивирован → `403`.
- `POST /api/auth/logout`:
  1. Удаляет workspace (`remove(sessionId)`).
  2. `DELETE FROM local_sessions WHERE session_id = ?`.
  3. `clearCookie('ac_session_id')`.
  4. `{ ok: true }`.
- `GET /api/health` — `{ status: 'ok' }` без авторизации.

#### B6. Session store (workspace)

**Новый файл:** `audio-correction/backend/src/services/audioCorrectionSessionStore.js`

Адаптация из `testing` `backend/src/services/audioCorrectionSessionStore.js`:

- `getSessionDir(sessionId)` → `join(UPLOADS_DIR, 'sessions', sessionId)` (без `projectId`).
- `getOrCreate(sessionId, userId)` → ключ `sessionId`, поле `userId` вместо `projectId`.
- `findWorkspaceByRun(runId)` → без фильтра по `projectId`, ищет по всем workspace.
- `remove(sessionId)` → удаляет директорию `sessions/{sessionId}`.
- `cleanupOnStartup()` → удаляет всё в `uploads/sessions/`.
- `deleteOnSessionDestroyed(localSessionId)` → вызывает `remove(localSessionId)`.
- GC каждые 5 минут, TTL 1 час (из `SESSION_TTL_MS`).
- `UPLOADS_DIR` = `join(__dirname, '..', 'uploads')`.

#### B7. Сервис sidecar-клиента

**Новый файл:** `audio-correction/backend/src/services/audioCorrection.js`

Копия `testing` `backend/src/services/audioCorrection.js` без изменений.
Использует `AUDIO_SIDECAR_URL` и `AUDIO_SIDECAR_UPLOADS_ROOT`.

#### B8. Утилита `decodeFileName`

**Новый файл:** `audio-correction/backend/src/utils/decodeFileName.js`

Локальная копия функции из `testing` `backend/src/utils/projectAccess.js`
(только `decodeFileName`, без `checkProjectAccess` и `resolveProjectId`).

#### B9. Маршруты workspace (session)

**Новый файл:** `audio-correction/backend/src/routes/session.js`

Адаптация из `testing` `backend/src/routes/audio-correction.js`:

- Убрать `Router({ mergeParams: true })` → `Router()`.
- Убрать `checkProjectAccess`, `resolveProjectId`, `req.projectId`.
- Все обращения к `getSessionDir(req.projectId, req.sessionId)` →
  `getSessionDir(req.sessionId)`.
- Все обращения к `getOrCreate(req.sessionId, req.projectId)` →
  `getOrCreate(req.sessionId, req.user.id)`.
- `findWorkspaceByRun(req.projectId, runId)` → `findWorkspaceByRun(runId)`.
- Пути: без префикса `/projects/:projectId/audio-correction`.
  Базовые пути: `/reference`, `/targets`, `/settings`, `/process`, `/runs/:runId`,
  `/runs/:runId/download/...`, `/runs/:runId/cancel`.
- `audio_url` в ответах: `/api/session/reference/audio`,
  `/api/session/targets/:index/audio`, `/api/session/runs/:runId/download/...`.
- Лимиты, multer-конфиг, обработка ошибок sidecar, ZIP — без изменений.

#### B10. Главный сервер

**Новый файл:** `audio-correction/backend/src/server.js`

- Express, порт `process.env.PORT || 3002`.
- `cors` (в dev: `origin: 'http://localhost:5174'`; в prod: не нужен, один origin).
- `cookieParser`, `express.json`.
- Монтирование:
  - `app.use('/api/auth', authRoutes)` (включая `/me`).
  - `app.get('/api/health', ...)`.
  - `app.use('/api', authMiddleware, sessionRoutes)` (все workspace-маршруты).
- **Нет** `/uploads` static — файлы только через авторизованные endpoint'ы.
- `cleanupOnStartup()` при старте.
- CSRF: проверка `Origin`/`Host` на POST/PATCH/DELETE (defense-in-depth).

---

### Фаза C: Standalone frontend

#### C1. Инициализация `audio-correction/frontend/`

**Новый файл:** `audio-correction/frontend/package.json`

Зависимости: `react`, `react-dom`, `react-router-dom`, `vite`, `@vitejs/plugin-react`.

**Новый файл:** `audio-correction/frontend/vite.config.js`

- Dev proxy: `/api` → `http://localhost:3002`.
- Dev port: 5174 (чтобы не конфликтовать с `testing` 5173).

**Новый файл:** `audio-correction/frontend/index.html`

Минимальный HTML с `<div id="root">` и `<script type="module" src="/src/main.jsx">`.

#### C2. API-клиент

**Новый файл:** `audio-correction/frontend/src/api/client.js`

Адаптация из `testing` `frontend/src/api/client.js`:

- `API_URL` = `import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3002/api')`.
- Функция `request(path, options)` — та же логика.
- Убрать `api.getProject`, `api.getProjects`, `api.getIssues` и т.д.
- Оставить: `api.getMe`, `api.logout`.

**Новый файл:** `audio-correction/frontend/src/api/audioCorrection.js`

Адаптация из `testing` `frontend/src/api/audioCorrection.js`:

- Убрать `base(projectId)` → базовый путь `/session`.
- Убрать аргумент `projectId` из всех функций.
- Примеры: `getSession()` → `GET /session`; `uploadReference(formData)` → `POST /session/reference`; и т.д.

#### C3. AuthContext (SSO-only)

**Новый файл:** `audio-correction/frontend/src/contexts/AuthContext.jsx`

- `useEffect` при монтировании: `GET /api/me`.
  - 200 → `setUser(data.user)`.
  - 401 → `setUser(null)` (redirect на `/login`).
  - 503 → `setAuthError('unavailable')`.
  - 403 → `setAuthError('deactivated')`.
- `logout()`: `POST /api/auth/logout` → `setUser(null)` → navigate `/login`.
- **Нет** формы логина/пароля. **Нет** `login(email, password)`.
- Refresh on focus — как в `testing`.

#### C4. Страницы

**Новый файл:** `audio-correction/frontend/src/pages/LoginPage.jsx`

Landing-страница (дизайн §3.1):
- Заголовок «Корректор аудио-файлов».
- Описание эфемерности.
- Кнопка `<a href="https://testing.bot-atelier.ru/login?next=https://correction-audio.bot-atelier.ru/">Войти через экосистему</a>`.
- В dev: URL формируется из env `VITE_ECOSYSTEM_LOGIN_URL`.

**Новый файл:** `audio-correction/frontend/src/pages/AudioCorrectionPage.jsx`

Адаптация из `testing` `frontend/src/pages/AudioCorrection/AudioCorrectionPage.jsx`:

- Убрать `useParams()`, `projectId`, `api.getProject()`.
- Убрать `<ProjectTabs>`, заголовок проекта (`client_name`, `manager_name`).
- Убрать `Link` на `/projects`.
- `tabStorageKey()` / `workspaceMarkerKey()` / `detectTabConflict()` —
  использовать константный ключ (origin) вместо `projectId`.
- App shell top bar: название, `{user.name} · {role}`, «Выйти», «Закрыть / Забыть».
- Строка-подсказка: «Рабочий стол · данные удаляются через 1 час без активности».
- Кнопка «Закрыть / Забыть» disabled, если workspace пуст.
- При `DELETE /session` → остаёмся на `/` с пустым workspace.
- При logout → `DELETE /session` (если есть данные) → `POST /api/auth/logout` → `/login`.

#### C5. Компоненты (копирование)

Переносятся из `testing` `frontend/src/pages/AudioCorrection/components/`
в `audio-correction/frontend/src/components/`:

| Компонент | Изменения |
|-----------|-----------|
| `ReferenceUpload.jsx` | Импорт `TrashIcon` из `../components/TrashIcon.jsx` (новый путь). |
| `TargetsUpload.jsx` | То же. |
| `SettingsPanel.jsx` | Без изменений. |
| `ProcessingStatus.jsx` | Без изменений. |
| `ResultsPanel.jsx` | Без изменений. |
| `CloseConfirmModal.jsx` | Без изменений. |
| **`ProjectTabs.jsx`** | **НЕ переносится.** |

**Новый файл:** `audio-correction/frontend/src/components/TrashIcon.jsx`

Копия `testing` `frontend/src/components/TrashIcon.jsx` без изменений.

#### C6. Утилиты, хуки, константы

**Новый файл:** `audio-correction/frontend/src/hooks/useNavigationGuard.js`

Копия `testing` `frontend/src/pages/AudioCorrection/useNavigationGuard.js`.

**Новый файл:** `audio-correction/frontend/src/constants/audioCorrection.js`

Копия `testing` `frontend/src/constants/audioCorrection.js` без изменений.

**Новый файл:** `audio-correction/frontend/src/constants/roles.js`

Копия `testing` `frontend/src/constants/roles.js` (если существует) или
минимальный `ROLE_LABELS` маппинг.

#### C7. Утилиты workspace

**Новый файл:** `audio-correction/frontend/src/utils.js`

Копия `testing` `frontend/src/pages/AudioCorrection/utils.js` без изменений.

#### C8. Стили

**Новый файл:** `audio-correction/frontend/src/index.css`

Копия релевантных блоков из `testing` `frontend/src/index.css`:

- Generic: `*`, `body`, `.page`, `.page-header`, `.title`, `.muted`, `.card`,
  `.badge`, `.empty`, `.btn-*`, `.modal-*`.
- Audio: `.audio-section`, `.audio-dropzone`, `.audio-file-*`, `.audio-player*`,
  `.audio-error`, `.audio-warning`, `.start-row`, `.macro-*`, `.param-*`.
- **Без** `.project-tabs`, `.project-tab` (не нужны).
- Медиа-правила: адаптивность (§8 UI-дизайна) без `.project-tabs`.

#### C9. App.jsx и main.jsx

**Новый файл:** `audio-correction/frontend/src/App.jsx`

- Маршруты:
  - `/login` → `<LoginPage />`.
  - `/` → `<ProtectedRoute><AudioCorrectionPage /></ProtectedRoute>`.
  - `*` → `<Navigate to="/" />`.
- `ProtectedRoute`: при `loading` → «Загрузка…»; при `!user` → `<Navigate to="/login" />`.

**Новый файл:** `audio-correction/frontend/src/main.jsx`

Стандартный React entry point: `createRoot`, `<App />`.

---

### Фаза D: Sidecar + Docker Compose

#### D1. Docker Compose

**Новый файл:** `audio-correction/deploy/docker-compose.yml`

```yaml
services:
  audio-correction-sidecar:
    build: ../../subsystems/audio-correction/service
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - /opt/audio-correction/backend/src/uploads:/app/uploads
    restart: unless-stopped
```

#### D2. Nginx-блок standalone

**Новый файл:** `audio-correction/deploy/nginx.conf`

Server-блок из архитектуры §2.1 (correction-audio.bot-atelier.ru,
proxy на 127.0.0.1:3002, `client_max_body_size 60M`, статика из
`/opt/audio-correction/frontend/dist/`, без публичного `/uploads/`).

#### D3. Deploy-скрипт

**Новый файл:** `audio-correction/deploy/deploy.sh`

Скрипт-ориентир: `npm install`, `npm run migrate`, `npm run build` (frontend),
`pm2 start/reload`, `docker compose up -d`, `certbot`.

---

### Фаза E: Удаление встроенной интеграции из `testing`

> **Порядок:** выполнять ТОЛЬКО после успешного развёртывания и проверки
> standalone (фазы A–D).

#### E1. Backend — удалить файлы

| Файл | Действие |
|------|----------|
| `backend/src/routes/audio-correction.js` | **Удалить** |
| `backend/src/routes/audio-correction.integration.test.js` | **Удалить** |
| `backend/src/routes/audio-correction.bugfix.test.js` | **Удалить** |
| `backend/src/services/audioCorrection.js` | **Удалить** |
| `backend/src/services/audioCorrection.test.js` | **Удалить** |
| `backend/src/services/audioCorrectionSessionStore.js` | **Удалить** |
| `backend/src/services/audioCorrectionSessionStore.test.js` | **Удалить** |

#### E2. Backend — точечные правки

**Файл:** `backend/src/server.js`

Удалить:
- Строка 12: `import audioCorrectionRoutes from './routes/audio-correction.js';`
- Строка 14: `import { cleanupOnStartup } from './services/audioCorrectionSessionStore.js';`
- Строка 43–46: Guard `/uploads` для `/audio/sessions` (блок `if (/\/audio\/sessions(\/|$)/i.test(path))`).
- Строка 54: `app.use('/api/projects/:projectId/audio-correction', authMiddleware, audioCorrectionRoutes);`
- Строка 72: `cleanupOnStartup();`

**Файл:** `backend/src/middleware/auth.js`

Удалить:
- Строка 2: `import { deleteOnSessionDestroyed } from '../services/audioCorrectionSessionStore.js';`
- Строка 21: `deleteOnSessionDestroyed(sessionId);`

**Файл:** `backend/src/routes/auth.js`

Удалить:
- Строка 6: `import { deleteOnSessionDestroyed } from '../services/audioCorrectionSessionStore.js';`
- Строка 71: `deleteOnSessionDestroyed(sessionId);`

**Файл:** `backend/package.json`

Удалить зависимость `"archiver": "^7.0.1"`.

#### E3. Frontend — удалить файлы

| Файл | Действие |
|------|----------|
| `frontend/src/pages/AudioCorrection/AudioCorrectionPage.jsx` | **Удалить** |
| `frontend/src/pages/AudioCorrection/utils.js` | **Удалить** |
| `frontend/src/pages/AudioCorrection/useNavigationGuard.js` | **Удалить** |
| `frontend/src/pages/AudioCorrection/components/ReferenceUpload.jsx` | **Удалить** |
| `frontend/src/pages/AudioCorrection/components/TargetsUpload.jsx` | **Удалить** |
| `frontend/src/pages/AudioCorrection/components/SettingsPanel.jsx` | **Удалить** |
| `frontend/src/pages/AudioCorrection/components/ProcessingStatus.jsx` | **Удалить** |
| `frontend/src/pages/AudioCorrection/components/ResultsPanel.jsx` | **Удалить** |
| `frontend/src/pages/AudioCorrection/components/CloseConfirmModal.jsx` | **Удалить** |
| `frontend/src/pages/AudioCorrection/components/ProjectTabs.jsx` | **Удалить** |
| `frontend/src/api/audioCorrection.js` | **Удалить** |
| `frontend/src/constants/audioCorrection.js` | **Удалить** |

После удаления — удалить пустые директории:
- `frontend/src/pages/AudioCorrection/components/`
- `frontend/src/pages/AudioCorrection/`

#### E4. Frontend — точечные правки

**Файл:** `frontend/src/App.jsx`

Удалить:
- Строка 12: `import AudioCorrectionPage from './pages/AudioCorrection/AudioCorrectionPage.jsx';`
- Строка 107: `<Route path="/projects/:projectId/audio-correction" ... />`

**Файл:** `frontend/src/pages/IssuesPage.jsx`

Удалить:
- Строка 8: `import ProjectTabs from './AudioCorrection/components/ProjectTabs.jsx';`
- Строка 129: `<ProjectTabs project={project} />`

> **Важно:** `ProjectTabs` используется в `IssuesPage` и `ProjectManagePage`
> для навигации между «Замечания» / «Корректор аудио» / «Управление».
> После удаления вкладки «Корректор аудио» вкладки «Замечания» и «Управление»
> остаются. Нужно **заменить** `ProjectTabs` на упрощённую версию без
> аудио-вкладки, либо перенести `ProjectTabs` в общее место и убрать
> аудио-ссылку.
>
> **Решение:** перенести `ProjectTabs.jsx` из `AudioCorrection/components/`
> в `frontend/src/components/ProjectTabs.jsx`, убрать ссылку
> `/projects/${id}/audio-correction` и вкладку «Корректор аудио-файлов».
> Обновить импорты в `IssuesPage.jsx` и `ProjectManagePage.jsx`.

**Файл:** `frontend/src/pages/ProjectManagePage.jsx`

Удалить:
- Строка 5: `import ProjectTabs from './AudioCorrection/components/ProjectTabs.jsx';`
- Строка 129: `<ProjectTabs project={project} />`
- Заменить на новый импорт из `../components/ProjectTabs.jsx`.

**Новый файл:** `frontend/src/components/ProjectTabs.jsx`

Копия `ProjectTabs.jsx` без вкладки «Корректор аудио-файлов» (только
«Замечания» и «Управление»).

**Файл:** `frontend/src/index.css`

Удалить CSS-блоки (номера строк из grep):
- `.project-tabs` (311–317)
- `.project-tab` (319–327)
- `.project-tab:hover` (329–332)
- `.project-tab.active` (334–…)
- `.audio-section` (354–…)
- `.audio-section-title` (358–…)
- `.audio-file-name` (363–…)
- `.audio-dropzone` (372–380)
- `.audio-dropzone:hover` (382–385)
- `.audio-dropzone.dragging` (387–390)
- `.audio-dropzone.disabled` (392–396)
- `.audio-dropzone-icon` (398–403)
- `.audio-dropzone-hint` (405–…)
- `.audio-error` (433–441)
- `.audio-error-dismissible` (443–449)
- `.audio-warning` (451–…)
- `.audio-file-card` (466–476)
- `.audio-file-main` (478–481)
- `.audio-file-list` (483–487)
- `.audio-file-row` (489–499)
- `.audio-file-index` (501–…)
- `.audio-player` (515–519)
- `.audio-player-sm` (521–…)
- `.start-row` (666–…)
- Медиа-правило `.project-tabs` (856–…)

> **Примечание:** CSS-блоки `.project-tabs` / `.project-tab` **сохранить**,
> если `ProjectTabs` (упрощённый, без аудио) продолжает их использовать.
> Проверить после создания `components/ProjectTabs.jsx`.

#### E5. Удалить root `docker-compose.yml`

**Файл:** `docker-compose.yml` (в корне репозитория)

**Удалить** — sidecar перенесён в `audio-correction/deploy/docker-compose.yml`.

#### E6. Очистка env

**Файл:** `backend/.env.production`

Удалить переменные `AUDIO_SIDECAR_*`, если присутствуют (в текущем файле
их нет, но проверить на сервере `/opt/testing-bots/backend/.env.production`).

**Файл:** `backend/ecosystem.config.cjs`

Удалить `AUDIO_SIDECAR_*` из `env_production`, если присутствуют.

---

### Фаза F: Локальная верификация

#### F1. Тесты standalone backend

```bash
cd audio-correction/backend
npm test
```

- Тесты `ecosystemAuth.js` с mock HTTP (200, 401, 403, timeout).
- Тесты `auth.js` middleware (валидная/истёкшая сессия).
- Тесты `session.js` routes (загрузка, обработка, скачивание, owner-check).
- Тесты `audioCorrectionSessionStore.js` (GC, cleanup, TTL).

#### F2. Тесты standalone frontend

```bash
cd audio-correction/frontend
npm run lint   # если настроен
npm run build  # Vite build без ошибок
```

#### F3. Тесты `testing` после удаления

```bash
cd backend
npm test       # все тесты issues/projects/users зелёные
cd ../frontend
npm run build  # Vite build без ошибок
```

#### F4. End-to-end (локально)

1. Запустить `testing` backend (порт 3001) + standalone backend (порт 3002) +
   mock sidecar (порт 8080).
2. Залогиниться в `testing` → получить cookie `session_id`.
3. Открыть standalone → bootstrap проходит → workspace доступен.
4. Загрузить эталон + цели → запустить обработку → получить результаты.
5. Logout из standalone → локальная сессия удалена.
6. Проверить `testing` без аудио: issues CRUD работает.

---

## 4. Таблица файлов: создать / изменить / удалить

### Создать (standalone)

| # | Путь | Описание |
|---|------|----------|
| 1 | `audio-correction/backend/package.json` | Зависимости standalone backend |
| 2 | `audio-correction/backend/.env.example` | Шаблон env-переменных |
| 3 | `audio-correction/backend/ecosystem.config.cjs` | PM2-конфиг |
| 4 | `audio-correction/backend/src/server.js` | Express-сервер, порт 3002 |
| 5 | `audio-correction/backend/src/middleware/auth.js` | Проверка `ac_session_id` |
| 6 | `audio-correction/backend/src/routes/auth.js` | SSO bootstrap, logout, /me, health |
| 7 | `audio-correction/backend/src/routes/session.js` | Workspace API (адаптация из testing) |
| 8 | `audio-correction/backend/src/services/ecosystemAuth.js` | HTTP-клиент к testing internal |
| 9 | `audio-correction/backend/src/services/audioCorrection.js` | Копия sidecar-клиента |
| 10 | `audio-correction/backend/src/services/audioCorrectionSessionStore.js` | Workspace store (адаптация) |
| 11 | `audio-correction/backend/src/db/database.js` | sql.js wrapper |
| 12 | `audio-correction/backend/src/db/migrate.js` | DDL local_sessions + users_cache |
| 13 | `audio-correction/backend/src/utils/decodeFileName.js` | Локальная копия утилиты |
| 14 | `audio-correction/backend/data/.gitkeep` | Директория для app.db |
| 15 | `audio-correction/frontend/package.json` | Зависимости standalone frontend |
| 16 | `audio-correction/frontend/vite.config.js` | Vite + proxy |
| 17 | `audio-correction/frontend/index.html` | HTML entry point |
| 18 | `audio-correction/frontend/src/main.jsx` | React entry point |
| 19 | `audio-correction/frontend/src/App.jsx` | Маршруты: /login, / |
| 20 | `audio-correction/frontend/src/index.css` | Стили (аудио + generic, без project-tabs) |
| 21 | `audio-correction/frontend/src/contexts/AuthContext.jsx` | SSO-only auth |
| 22 | `audio-correction/frontend/src/pages/LoginPage.jsx` | Landing + SSO-кнопка |
| 23 | `audio-correction/frontend/src/pages/AudioCorrectionPage.jsx` | Workspace (адаптация) |
| 24 | `audio-correction/frontend/src/components/ReferenceUpload.jsx` | Копия |
| 25 | `audio-correction/frontend/src/components/TargetsUpload.jsx` | Копия |
| 26 | `audio-correction/frontend/src/components/SettingsPanel.jsx` | Копия |
| 27 | `audio-correction/frontend/src/components/ProcessingStatus.jsx` | Копия |
| 28 | `audio-correction/frontend/src/components/ResultsPanel.jsx` | Копия |
| 29 | `audio-correction/frontend/src/components/CloseConfirmModal.jsx` | Копия |
| 30 | `audio-correction/frontend/src/components/TrashIcon.jsx` | Копия |
| 31 | `audio-correction/frontend/src/api/client.js` | API-клиент (адаптация) |
| 32 | `audio-correction/frontend/src/api/audioCorrection.js` | Аудио-API (без projectId) |
| 33 | `audio-correction/frontend/src/constants/audioCorrection.js` | Копия констант |
| 34 | `audio-correction/frontend/src/constants/roles.js` | Копия ROLE_LABELS |
| 35 | `audio-correction/frontend/src/hooks/useNavigationGuard.js` | Копия хука |
| 36 | `audio-correction/frontend/src/utils.js` | Копия утилит workspace |
| 37 | `audio-correction/deploy/nginx.conf` | Nginx server-блок |
| 38 | `audio-correction/deploy/docker-compose.yml` | Sidecar compose |
| 39 | `audio-correction/deploy/deploy.sh` | Скрипт развёртывания |

### Изменить (testing)

| # | Путь | Изменение |
|---|------|-----------|
| 40 | `backend/src/middleware/auth.js` | Параметризованный запрос (A1); убрать `deleteOnSessionDestroyed` (E2) |
| 41 | `backend/src/routes/auth.js` | `COOKIE_DOMAIN` в cookie/clearCookie (A2); убрать `deleteOnSessionDestroyed` (E2) |
| 42 | `backend/src/server.js` | Добавить `internalRoutes` (A3); убрать аудио-импорты, mount, cleanup, /uploads guard (E2) |
| 43 | `backend/package.json` | Удалить `archiver` (E2) |
| 44 | `backend/.env.production` | Добавить `COOKIE_DOMAIN` (A2) |
| 45 | `backend/ecosystem.config.cjs` | Добавить `COOKIE_DOMAIN`, `INTERNAL_AUTH_TOKEN` (A2) |
| 46 | `nginx.conf` | Добавить `deny /api/internal/` (A4) |
| 47 | `frontend/src/pages/LoginPage.jsx` | Whitelisted `next` redirect (A5) |
| 48 | `frontend/src/App.jsx` | Убрать аудио-route и импорт (E4) |
| 49 | `frontend/src/pages/IssuesPage.jsx` | Заменить импорт `ProjectTabs` (E4) |
| 50 | `frontend/src/pages/ProjectManagePage.jsx` | Заменить импорт `ProjectTabs` (E4) |
| 51 | `frontend/src/index.css` | Удалить `.audio-*`, `.start-row` CSS (E4) |

### Создать (testing — перенос ProjectTabs)

| # | Путь | Описание |
|---|------|----------|
| 52 | `frontend/src/components/ProjectTabs.jsx` | Упрощённый: только «Замечания» + «Управление» |

### Удалить (testing)

| # | Путь |
|---|------|
| 53 | `backend/src/routes/audio-correction.js` |
| 54 | `backend/src/routes/audio-correction.integration.test.js` |
| 55 | `backend/src/routes/audio-correction.bugfix.test.js` |
| 56 | `backend/src/services/audioCorrection.js` |
| 57 | `backend/src/services/audioCorrection.test.js` |
| 58 | `backend/src/services/audioCorrectionSessionStore.js` |
| 59 | `backend/src/services/audioCorrectionSessionStore.test.js` |
| 60 | `frontend/src/pages/AudioCorrection/AudioCorrectionPage.jsx` |
| 61 | `frontend/src/pages/AudioCorrection/utils.js` |
| 62 | `frontend/src/pages/AudioCorrection/useNavigationGuard.js` |
| 63 | `frontend/src/pages/AudioCorrection/components/ReferenceUpload.jsx` |
| 64 | `frontend/src/pages/AudioCorrection/components/TargetsUpload.jsx` |
| 65 | `frontend/src/pages/AudioCorrection/components/SettingsPanel.jsx` |
| 66 | `frontend/src/pages/AudioCorrection/components/ProcessingStatus.jsx` |
| 67 | `frontend/src/pages/AudioCorrection/components/ResultsPanel.jsx` |
| 68 | `frontend/src/pages/AudioCorrection/components/CloseConfirmModal.jsx` |
| 69 | `frontend/src/pages/AudioCorrection/components/ProjectTabs.jsx` |
| 70 | `frontend/src/api/audioCorrection.js` |
| 71 | `frontend/src/constants/audioCorrection.js` |
| 72 | `docker-compose.yml` (root) |

---

## 5. Переменные окружения и секреты

### Standalone backend (`audio-correction/backend/.env.production`)

| Переменная | Значение | Обязательна |
|------------|----------|-------------|
| `NODE_ENV` | `production` | да |
| `PORT` | `3002` | да |
| `APP_URL` | `https://correction-audio.bot-atelier.ru` | да |
| `DB_PATH` | `./data/app.db` | да |
| `ECOSYSTEM_AUTH_URL` | `http://127.0.0.1:3000` | да |
| `INTERNAL_AUTH_TOKEN` | `<генерируется: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">` | да |
| `AUDIO_SIDECAR_URL` | `http://127.0.0.1:8080` | да |
| `AUDIO_SIDECAR_UPLOADS_ROOT` | `/app/uploads` (Docker) / не задан (host) | нет |
| `SESSION_TTL_MS` | `3600000` (1 час) | нет |
| `LOCAL_SESSION_MAX_TTL_MS` | `604800000` (7 дней) | нет |

### Testing backend (добавить/изменить)

| Переменная | Значение | Назначение |
|------------|----------|------------|
| `COOKIE_DOMAIN` | `.bot-atelier.ru` (prod) / не задан (dev) | Domain для `session_id` cookie |
| `INTERNAL_AUTH_TOKEN` | тот же секрет, что в standalone | Проверка `X-Internal-Auth` |

### Standalone frontend (build-time)

| Переменная | Значение | Назначение |
|------------|----------|------------|
| `VITE_API_URL` | `/api` (prod) / `http://localhost:3002/api` (dev) | Базовый URL API |
| `VITE_ECOSYSTEM_LOGIN_URL` | `https://testing.bot-atelier.ru/login` | URL входа экосистемы |

### Генерация и распространение `INTERNAL_AUTH_TOKEN`

1. Сгенерировать: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Записать в `/opt/testing-bots/backend/.env.production` как `INTERNAL_AUTH_TOKEN=…`
3. Записать в `/opt/audio-correction/backend/.env.production` как `INTERNAL_AUTH_TOKEN=…`
4. Перезапустить оба PM2-процесса.
5. **Не коммитить** в репозиторий.

---

## 6. Deployment runbook

### 6.1. Подготовка сервера

```bash
# Проверить существующее окружение
node --version          # ожидается 20.x
pm2 --version           # ожидается 7.x
nginx -v                # ожидается 1.24
docker --version        # ожидается 29.x
docker compose version  # ожидается v5.x
python3 --version       # ожидается 3.12

# Создать директорию
mkdir -p /opt/audio-correction
```

### 6.2. DNS

> **Предположение:** wildcard-запись `*.bot-atelier.ru` уже существует
> (по условию задачи). Если нет — добавить A-запись `correction-audio`
> → `2.26.112.123` в DNS-панели.

```bash
nslookup correction-audio.bot-atelier.ru
# Ожидается: 2.26.112.123
```

### 6.3. Загрузка кода

```bash
# На dev-машине: собрать и упаковать
cd audio-correction/backend && npm install --production
cd ../frontend && npm install && npm run build
cd ../..

# Загрузить на сервер (rsync / scp)
rsync -avz --delete audio-correction/ user@2.26.112.123:/opt/audio-correction/
rsync -avz subsystems/ user@2.26.112.123:/opt/audio-correction/subsystems/
```

### 6.4. Backend

```bash
ssh user@2.26.112.123

cd /opt/audio-correction/backend

# Создать .env.production (если ещё нет)
cat > .env.production << 'EOF'
NODE_ENV=production
PORT=3002
APP_URL=https://correction-audio.bot-atelier.ru
DB_PATH=./data/app.db
ECOSYSTEM_AUTH_URL=http://127.0.0.1:3000
INTERNAL_AUTH_TOKEN=<вставить_тот_же_секрет>
AUDIO_SIDECAR_URL=http://127.0.0.1:8080
AUDIO_SIDECAR_UPLOADS_ROOT=/app/uploads
SESSION_TTL_MS=3600000
LOCAL_SESSION_MAX_TTL_MS=604800000
EOF

# Миграция
npm run migrate

# Запуск
pm2 start ecosystem.config.cjs --env production
pm2 save
```

### 6.5. Sidecar (Docker Compose)

```bash
cd /opt/audio-correction/deploy
docker compose up -d --build
curl http://127.0.0.1:8080/health
# Ожидается: {"status":"ok"}
ss -ltnp | grep 8080
# Ожидается: 127.0.0.1:8080
```

### 6.6. Nginx

```bash
# Скопировать server-блок
cp /opt/audio-correction/deploy/nginx.conf \
   /etc/nginx/sites-available/correction-audio.bot-atelier.ru

ln -sf /etc/nginx/sites-available/correction-audio.bot-atelier.ru \
       /etc/nginx/sites-enabled/correction-audio.bot-atelier.ru

nginx -t && systemctl reload nginx
```

### 6.7. TLS-сертификат

```bash
certbot --nginx -d correction-audio.bot-atelier.ru \
  --non-interactive --agree-tos --email admin@bot-atelier.ru
```

### 6.8. SSO-изменения в `testing`

```bash
# Обновить testing на сервере
cd /opt/testing-bots

# Добавить в backend/.env.production:
# COOKIE_DOMAIN=.bot-atelier.ru
# INTERNAL_AUTH_TOKEN=<тот_же_секрет>

# Обновить nginx.conf — добавить location ^~ /api/internal/ { deny all; return 403; }
# Перезапустить:
pm2 reload testing-bots
nginx -t && systemctl reload nginx
```

### 6.9. Верификация на сервере

```bash
# 1. Health checks
curl -s http://127.0.0.1:3002/api/health
# {"status":"ok"}

curl -s http://127.0.0.1:8080/health
# {"status":"ok"}

# 2. HTTPS
curl -I https://correction-audio.bot-atelier.ru
# 200, сертификат валиден

# 3. Nginx deny internal
curl -s https://testing.bot-atelier.ru/api/internal/session
# 403

# 4. SSO bootstrap (вручную через браузер):
#    a. Залогиниться на testing.bot-atelier.ru
#    b. Открыть correction-audio.bot-atelier.ru
#    c. Проверить: автоматический вход, workspace доступен

# 5. Testing без аудио
curl -s https://testing.bot-atelier.ru/api/projects -H "Cookie: session_id=..."
# 200, список проектов
```

### 6.10. Удаление встроенной интеграции из `testing`

```bash
# После успешной верификации standalone:
cd /opt/testing-bots

# Обновить код (git pull / загрузка релиза с удалёнными файлами)
# npm install (убрать archiver)
pm2 reload testing-bots

# Проверить:
curl -s https://testing.bot-atelier.ru/api/projects -H "Cookie: session_id=..."
# 200, проекты работают
```

### 6.11. Rollback

**До удаления интеграции из testing (фазы A–D):**

```bash
pm2 stop audio-correction
rm /etc/nginx/sites-enabled/correction-audio.bot-atelier.ru
systemctl reload nginx
cd /opt/audio-correction/deploy && docker compose down
# testing продолжает работать как прежде
```

**SSO-изменения в testing (откат cookie Domain):**

```bash
# Убрать COOKIE_DOMAIN из .env.production
# Убрать INTERNAL_AUTH_TOKEN из .env.production
# Убрать /api/internal/ deny из nginx.conf
# Убрать internal.js route из server.js
pm2 reload testing-bots
systemctl reload nginx
# Пользователи testing перезайдут (cookie без Domain станет host-only)
```

**После удаления интеграции (фаза E):**

```bash
# Только через git revert соответствующих коммитов
cd /opt/testing-bots
git revert <commit-hash-removal>
npm install
pm2 reload testing-bots
```

---

## 7. Тест-план

### 7.1. Backend unit-тесты (`audio-correction/backend`)

| Тест | Описание |
|------|----------|
| `ecosystemAuth.test.js` | Mock HTTP: 200 → `{ user, expires_at }`; 401 → throw; 403 → throw; timeout → throw 503; неверный токен → throw 403 |
| `middleware/auth.test.js` | Валидная `ac_session_id` → `req.user` заполнен; истёкшая → 401; отсутствует → 401 |
| `routes/auth.test.js` | Bootstrap: нет cookie → 401; testing 200 → 200 + Set-Cookie; testing 503 → 503; testing 403 → 403. Logout: сессия удалена, cookie очищена |
| `routes/session.test.js` | Upload reference → 200; upload targets → 200; process → run_id; download → файл; owner check → 403 на чужой run; 404 на несуществующий |
| `services/audioCorrectionSessionStore.test.js` | GC убирает workspace по TTL; cleanupOnStartup удаляет всё; remove удаляет директорию |
| `services/audioCorrection.test.js` | Mock sidecar: analyze → 200; process → 200; timeout → 504; unavailable → 503 |

### 7.2. Frontend build/lint

```bash
cd audio-correction/frontend
npm run build    # Vite production build без ошибок
```

### 7.3. SSO integration (mock)

- Mock `testing` internal endpoint (nock/http-mock).
- Сценарий 1: cookie валидна → bootstrap → локальная сессия создана.
- Сценарий 2: cookie истекла → 401 → redirect /login.
- Сценарий 3: testing недоступен → 503 → экран «Вход временно недоступен».

### 7.4. End-to-end (локально с mock sidecar)

1. Запустить testing backend + standalone backend + mock sidecar.
2. Login в testing → получить cookie.
3. Открыть standalone → workspace.
4. Upload reference + targets → process → results.
5. Download ZIP → содержит corrected-файлы + report.
6. Close session → файлы удалены.
7. Logout → локальная сессия удалена.

### 7.5. Testing regression

```bash
cd backend && npm test     # все тесты зелёные
cd ../frontend && npm run build  # build без ошибок
```

### 7.6. Smoke-тесты на production

| # | Проверка | Команда / действие |
|---|----------|-------------------|
| 1 | HTTPS | `curl -I https://correction-audio.bot-atelier.ru` → 200 |
| 2 | Health | `curl http://127.0.0.1:3002/api/health` → ok |
| 3 | Sidecar | `curl http://127.0.0.1:8080/health` → ok |
| 4 | Internal deny | `curl https://testing.bot-atelier.ru/api/internal/session` → 403 |
| 5 | SSO login | Открыть standalone в браузере после testing login → workspace |
| 6 | Upload + process | Загрузить WAV + запустить → результаты |
| 7 | Logout | Кнопка «Выйти» → /login |
| 8 | Testing issues | CRUD замечаний в testing работает |
| 9 | Testing projects | CRUD проектов в testing работает |
| 10 | Cookie domain | `document.cookie` в DevTools → `session_id` видна на обоих поддоменах |

---

## 8. Риски и rollback

| # | Риск | Вероятность | Влияние | Митигация |
|---|------|-------------|---------|-----------|
| R1 | **Production `testing` ломается** при SSO-изменениях (cookie Domain, internal endpoint) | Средняя | Высокое — все пользователи testing | SSO-изменения минимальны и additive; internal endpoint вне authMiddleware; cookie Domain — одна строка. Rollback: убрать COOKIE_DOMAIN, перезапустить PM2. |
| R2 | **Cookie migration / re-login.** При добавлении `Domain=.bot-atelier.ru` существующие cookie без Domain перестанут совпадать с новыми | Высокая | Среднее — разовый re-login | Новые cookie заменят старые при следующем login. Пользователи testing перезайдут один раз. |
| R3 | **Docker sidecar не запускается** (ресурсы, права, образ) | Низкая | Среднее | Альтернатива: systemd + venv (архитектура §3.1). Docker уже установлен на сервере. |
| R4 | **Certbot не выпускает сертификат** (DNS не propagation, rate limit) | Низкая | Высокое — HTTPS недоступен | Wildcard DNS уже настроен. Проверить propagation до запуска certbot. |
| R5 | **`INTERNAL_AUTH_TOKEN` рассинхрон** между testing и standalone | Низкая | Высокое — SSO не работает | Генерировать один раз, записать в оба .env.production, перезапустить оба PM2. |
| R6 | **Port conflict** (3002 занят) | Низкая | Среднее | Проверить `ss -ltnp \| grep 3002` до запуска. |
| R7 | **`ProjectTabs` в testing** — после удаления аудио-вкладки вкладки «Замечания» / «Управление» должны работать | Средняя | Среднее | Перенести `ProjectTabs` в `components/`, убрать аудио-ссылку. Протестировать IssuesPage + ProjectManagePage. |
| R8 | **Nginx `testing` proxy_pass на порт 3000**, но `ecosystem.config.cjs` указывает `PORT: 3001` | Средняя | Среднее — internal endpoint может быть на другом порту | **Проверить на сервере:** `pm2 show testing-bots` → фактический порт. Скорректировать `ECOSYSTEM_AUTH_URL` в standalone. |
| R9 | **`archiver` используется не только в аудио** | Низкая | Высокое — testing сломается | Проверено: `archiver` импортируется только в `audio-correction.js`. Удаление безопасно. |

---

## 9. Вне скоупа

1. **Общие доменные абстракции** между `testing` и `audio-correction` (связь замечаний с аудио).
2. **Периодическая ре-валидация** локальной сессии (runtime-зависимость от testing).
3. **WebSocket / real-time прогресс** обработки. Только polling.
4. **История запусков** (`runs[]`). Ровно один run на workspace.
5. **ML-рекомендации** и автоматический выбор эталона.
6. **Видео и иные медиа**. Только аудио.
7. **Квоты хранилища** на пользователя. Только лимит 50 МБ на файл.
8. **Отдельная роль** для доступа к корректору. Любой активный пользователь экосистемы.
9. **Пункт меню** в `testing` для перехода в standalone. Подсистема — отдельный сайт.
10. **Миграция данных** — доменных таблиц нет, переносить нечего.
11. **Мониторинг диска** и алерты на `uploads/sessions/`.
12. **Дев-окружение с cross-subdomain cookie** (hosts/`*.localhost`). Достаточно stub-режима `ecosystemAuth`.
13. **PDF/HTML отчёты** из sidecar. Только JSON + CSV.
14. **Живой обратный отсчёт TTL** на рабочем столе. Достаточно статичной строки.
