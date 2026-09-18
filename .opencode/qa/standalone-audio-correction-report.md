# QA-отчёт: standalone `audio-correction` + SSO-интеграция с `testing`

**Дата:** 2026-09-14
**Область:** `audio-correction/` (standalone), `backend/` и `frontend/` (`testing` после SSO-правок и удаления встроенной интеграции)
**План:** `.opencode/plans/standalone-audio-correction.md`
**Архитектура:** `.opencode/architecture/audio-correction-standalone.md`
**Предыдущие отчёты:** `.opencode/qa/implement-audio-correction-report.md`, `.opencode/qa/implement-audio-correction-bugfix-report.md`

> Продуктовый код не изменялся. Добавлены только тестовые файлы (`*.test.js`) и настоящий отчёт.

---

## 0. Итоговый вердикт

**⚠️ НЕ готово к выкату в текущем виде** — функциональное ядро исправно, но найдены:

- **BUG-1 (High, deployment/config):** SSO-переменные (`INTERNAL_AUTH_TOKEN`, `COOKIE_DOMAIN`) и порт `testing` не применяются выбранным путём деплоя; `.env.production` нигде не загружается (нет `dotenv`). SSO на проде не заработает без ручного вмешательства.
- **BUG-2 (Medium):** `expires_at` из `testing /api/internal/session` (формат SQLite UTC без `Z`) парсится как локальное время → локальная сессия standalone истекает на величину TZ-смещения раньше экосистемной (на машине QA — 180 мин). Один автотест падает именно из-за этого.

Остальное (границы модуля, ownership isolation, очистка, эфемерность, регресс `testing`, strict-sidecar-контракт) — работает и подтверждено автотестами.

| Метрика | Значение |
|---|---|
| `testing` backend `npm test` | ✅ **15 / 15** (до QA было 0 тестов) |
| `testing` frontend `npm run lint` | ✅ 0 errors, 17 warnings (pre-existing) |
| `testing` frontend `npm run build` | ✅ 41 модуль |
| standalone backend `npm test` | ⚠️ **50 / 51** (1 падение = демонстрация BUG-2) |
| standalone frontend `npm run build` | ✅ 39 модулей |
| standalone frontend `npm run lint` | ✅ 0 errors, 2 warnings |
| Python sidecar `py_compile` | ✅ `web_service.py`, `acoustic_matcher.py` |
| Написано QA-тестов | **5 файлов, 24 новых теста** |
| Блокировано | реальный sidecar/Docker, HTTPS/DNS, PM2/nginx, браузерный UI |

---

## 1. Окружение

| Параметр | Значение |
|---|---|
| Node / npm | v26.1.0 / 11.13.0 |
| Python | 3.13.13; `flask`, `numpy`, `scipy` **отсутствуют** |
| Docker / PM2 | **не установлены** |
| Таймзона | UTC+3 (`getTimezoneOffset() = -180`) |
| ОС | Windows 10 (win32), PowerShell 5.1 |

---

## 2. Добавленные QA-тесты

| Файл | Тестов | Назначение |
|---|---:|---|
| `backend/src/routes/internal.test.js` | 13 | `GET /api/internal/session` (200/401/403/503, read-only), `COOKIE_DOMAIN` login/logout, удалённые аудио-роуты → 404, `/uploads`, SQL-инъекция |
| `backend/src/routes/regression.test.js` | 2 | CRUD projects/bots/issues после выноса helpers в `utils/projectAccess.js` (AC-5) |
| `audio-correction/backend/src/crossAppSso.test.js` | 3 | Реальный `testing` + реальный standalone: bootstrap по общей cookie; `testing` упал → 503, локальная сессия живёт |
| `audio-correction/backend/src/localSessionTtl.test.js` | 5 | TTL = `min(7d, expires_at)`, истёкшая/чужая локальная сессия; **1 тест падает = BUG-2** |
| `audio-correction/backend/src/sidecarContract.test.js` | 1 | Strict mock sidecar: `options` — плоский, без `macros`/`advanced` (регресс BUG-1 прошлого раунда) |

Все новые тесты самодостаточны: поднимают процессы на случайных портах, используют временные БД (`%TEMP%`), не пишут в продуктовые данные. `sidecarContract.test.js` удаляет свой workspace через `DELETE /api/session`.

---

## 3. Pass/fail по проверкам задания

### 3.1. `testing` после SSO-правок и удаления интеграции

| # | Проверка | Команда / воспроизведение | Ожидание | Результат |
|---|---|---|---|---|
| T1 | `npm test` | `cd backend; npm test` | зелёный | ✅ 15/15 |
| T2 | `npm run lint` | `cd frontend; npm run lint` | 0 errors | ✅ 0 errors, 17 warnings |
| T3 | `npm run build` | `cd frontend; npm run build` | OK | ✅ 41 модуль |
| T4 | internal + валидная cookie + верный токен | `GET /api/internal/session` c `Cookie: session_id=…`, `X-Internal-Auth` | 200 `{user:{id,name,email,role}, expires_at}` | ✅ |
| T5 | internal, неверный токен | `X-Internal-Auth: wrong` | 403 | ✅ |
| T6 | internal, токен отсутствует | без заголовка | 403 | ✅ |
| T7 | internal, нет cookie | верный токен, без cookie | 401 | ✅ |
| T8 | internal, token env не задан | сервер с `INTERNAL_AUTH_TOKEN=''` | 503 | ✅ |
| T9 | internal read-only (expiry не продлевается) | `expires_at` из БД до/после internal; контроль — `/api/me` продлевает | не меняется | ✅ (`internal` не пишет; `/api/me` продлевает) |
| T10 | login ставит `Domain=<COOKIE_DOMAIN>` | сервер с `COOKIE_DOMAIN=.bot-atelier.ru` | `Domain=.bot-atelier.ru` | ✅ |
| T11 | logout очищает с теми же атрибутами | `POST /api/auth/logout` | `Domain=…; Expires=1970/Max-Age=0` | ✅ |
| T12 | без `COOKIE_DOMAIN` cookie host-only | сервер без env | нет `Domain=` | ✅ |
| T13 | аудио-роуты удалены | `GET/POST /api/projects/1/audio-correction…` (с валидной cookie) | 404 | ✅ |
| T14 | `/uploads` static работает | положить файл в `backend/src/uploads/__qa_probe__/` → `GET /uploads/...` | 200 + контент | ✅ |
| T15 | SQL-инъекция в `auth.js` закрыта | `Cookie: session_id=' OR '1'='1` | 401 (не аутентифицирует) | ✅ |
| T16 | нет ссылок на audio-correction/ProjectTabs/archiver | grep по `backend/src`, `frontend/src` | 0 | ✅ |
| T17 | `archiver` убран из `backend/package.json`/lock | — | отсутствует | ✅ |
| T18 | root `docker-compose.yml` удалён | — | отсутствует | ✅ |

### 3.2. Standalone-приложение

| # | Проверка | Команда / воспроизведение | Ожидание | Результат |
|---|---|---|---|---|
| S1 | `npm test` | `cd audio-correction/backend; npm test` | — | ⚠️ 50/51 (BUG-2) |
| S2 | `npm run build` | `cd audio-correction/frontend; npm run build` | OK | ✅ 39 модулей |
| S3 | Нет проектной связи | grep `projectId/project_id/projects/project_members/issues/useParams` по `audio-correction/{backend,frontend}/src` | только комментарии/тест | ✅ |
| S4 | Bootstrap из общей cookie | `POST /api/auth/session` c `Cookie: session_id=…` | 200 + `ac_session_id` | ✅ |
| S5 | Полный flow | bootstrap → reference → analyze → targets → settings → process → poll → download file/report/ZIP → `DELETE /api/session` → `GET` 204 | success + чистка | ✅ (существующий integration + strict sidecar) |
| S6 | Strict mock sidecar: плоский `options` | mock отвергает unknown-поля | run `success`, `options={eq_strength,room_strength}` | ✅ |
| S7 | Ownership isolation | вторая локальная сессия на `download/0`, `download/report` чужого run | 403 | ✅ |
| S8 | Чужой preview | вторая сессия `GET /session/reference/audio` | 404 | ✅ |
| S9 | Чужой локальный cookie | `Cookie: ac_session_id=foreign` | 401 + cookie очищена | ✅ |
| S10 | TTL = `min(7d, eco)`: eco +2 дня | мок `expires_at` +2d | локальная ≈ +2d; `Max-Age≈172800` | ✅ |
| S11 | TTL cap при eco +30 дней | мок `expires_at` +30d | локальная ≈ +7d; `Max-Age≈604800` | ✅ |
| S12 | TTL при формате SQLite (реальный `testing`) | мок отдаёт `YYYY-MM-DD HH:MM:SS` UTC | локальная = UTC-инстант | ❌ **BUG-2** |
| S13 | Истёкшая локальная сессия | `LOCAL_SESSION_MAX_TTL_MS=0` | 401 + cookie очищена | ✅ |
| S14 | `/uploads` не публикуется | `GET /uploads/...` | 404 | ✅ (code inspect: static не смонтирован) |
| S15 | Очистка при старте/закрытии | `cleanupOnStartup`, `DELETE /session` | директория удалена | ✅ (sessionStore-тесты) |

### 3.3. Кросс-приложение SSO-контракт

| # | Проверка | Воспроизведение | Ожидание | Результат |
|---|---|---|---|---|
| X1 | `testing /api/internal/session` распознаёт cookie после login | login `admin@example.com/admin123` → cookie → internal c токеном | 200 + user | ✅ |
| X2 | standalone bootstrap по реальной cookie | `POST /api/auth/session` c cookie → standalone | 200 + `ac_session_id`, `/api/me` 200 | ✅ |
| X3 | `testing` недоступен: новый bootstrap | убить testing → `POST /api/auth/session` | 503 | ✅ |
| X4 | `testing` недоступен: живёт локальная сессия | `GET /api/me` со старым `ac_session_id` | 200 | ✅ |
| X5 | Диагностика формата `expires_at` | лог cross-app теста | `"2026-09-21 16:37:37"` (SQLite, без `Z`) | ℹ️ источник BUG-2 |

---

## 4. Найденные баги

### 🔴 BUG-1 (High, deployment/config) — SSO-переменные и порт `testing` не применяются выбранным путём деплоя

**Файлы/строки:**
- `backend/deploy.sh:72` — `pm2 start src/server.js --name testing-bots --env production` (без `ecosystem.config.cjs` → `env_production` не применяется; `--env` у PM2 действует только для ecosystem-файла).
- `backend/ecosystem.config.cjs:13-20` и `backend/.env.production:1-9` — содержат `PORT=3001`, `COOKIE_DOMAIN`, `INTERNAL_AUTH_TOKEN`.
- Ни `backend/server.js`, ни `backend/src/routes/internal.js` не загружают `.env.production`; зависимости `dotenv` нет.
- `audio-correction/deploy/ecosystem.config.cjs:26` — литерал `INTERNAL_AUTH_TOKEN: '<INTERNAL_AUTH_TOKEN>'`; `audio-correction/backend/ecosystem.config.cjs:15-24` — токен вообще отсутствует.
- Порт рассогласован: `nginx.conf:30` → `127.0.0.1:3000`; `deploy.sh:99` → `127.0.0.1:3001`; `backend/.env.production:1` → `PORT=3001`; `audio-correction/backend/src/services/ecosystemAuth.js:4` (дефолт) → `3001`; все конфиги/env standalone → `3000` (`audio-correction/backend/.env.production:4`, `.env.example:17`, `backend/ecosystem.config.cjs:15,23`, `deploy/ecosystem.config.cjs:25`).

**Следствие:**
1. `COOKIE_DOMAIN` может оказаться не задан → `session_id` host-only → cookie не уйдёт на `correction-audio.bot-atelier.ru`, SSO-редиректа не будет.
2. `INTERNAL_AUTH_TOKEN` может оказаться не задан (тестинг → 503) или равен литеральному плейсхолдеру (не совпадёт с standalone → `403` из `ecosystemAuth` → пользователь увидит «Доступ отключён»).
3. `ECOSYSTEM_AUTH_URL=http://127.0.0.1:3000` при фактическом `PORT=3001` → `ECONNREFUSED` → 503 на bootstrap.

**Минимальный фикс:**
- Задать единый порт (архитектура §4.2 — `3001`) во всех местах и привести `ECOSYSTEM_AUTH_URL` к нему.
- Запускать `testing` через `pm2 start ecosystem.config.cjs --env production`, а секрет передавать в `env_production` из некоммитимого источника (shell/`--update-env`), либо добавить `dotenv` и загружать `.env.production`.
- В `audio-correction/deploy/ecosystem.config.cjs` заменить литерал `'<INTERNAL_AUTH_TOKEN>'` на чтение из окружения/файла, который заполняется деплоем, а не хранится в git.

**Статус:** runtime-верификация заблокирована (PM2/сервер недоступны), но несоответствие видно статически и воспроизводится логикой PM2/Node.

---

### 🟠 BUG-2 (Medium) — `expires_at` экосистемы парсится как локальное время (TZ-сдвиг TTL)

**Файлы/строки:**
- `audio-correction/backend/src/routes/auth.js:98` — `const ecosystemExpiryMs = verified.expires_at ? Date.parse(verified.expires_at) : NaN;`
- `audio-correction/backend/src/services/ecosystemAuth.js:70` — `expires_at: data.expires_at || null` (сырое значение).
- `backend/src/routes/internal.js:63` — `expires_at: session.expires_at` (сырой `datetime('now','+7 days')` = `YYYY-MM-DD HH:MM:SS`, UTC без `Z`).

**Причина:** `Date.parse("2026-09-21 16:37:37")` в V8 трактуется как **локальное** время (проверено: на UTC+3 даёт `2026-09-21T13:37:37Z`). `testing` хранит/отдаёт UTC. Итог: `min(now+7d, eco)` берёт заведомо на 3 ч меньше.

**Воспроизведение (автотест):**
`node --test src/localSessionTtl.test.js` → тест `BUG: SQLite-format expires_at must be parsed as UTC, not local`:
```
AssertionError: expires_at "2026-09-15 13:35:57" parsed as local: local session is 180 min
earlier than ecosystem expiry (TZ offset -180 min)
```
Прямое подтверждение кросс-приложением: `crossAppSso.test.js` логирует `testing internal expires_at = "2026-09-21 16:37:37"`.

**Влияние:** локальная сессия истекает на TZ-смещение раньше экосистемной. Если до конца сессии `testing` остаётся меньше |TZ offset| (типичный сценарий — сессия почти истекла), вычисленный `expires_at` уходит в прошлое → `Max-Age=0`, и пользователь упирается в 401 на каждом запросе (цикл bootstrap). На сервере с TZ=UTC дефект не проявляется.

**Минимальный фикс (любой из):**
1. В `routes/auth.js` парсить SQLite-формат как UTC:
   ```js
   const s = String(verified.expires_at).trim();
   const ecosystemExpiryMs = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)
     ? Date.parse(s.replace(' ', 'T') + 'Z')
     : Date.parse(s);
   ```
2. Либо в `backend/src/routes/internal.js` отдавать ISO-UTC (`new Date(session.expires_at.replace(' ', 'T') + 'Z').toISOString()`), единообразно с остальным API.

---

### 🟡 BUG-3 (Low) — `remove()` не удаляет директорию без in-memory workspace

**Файл/строки:** `audio-correction/backend/src/services/audioCorrectionSessionStore.js:84-90`
```js
export function remove(sessionId) {
  const workspace = workspaces.get(sessionId);
  if (!workspace) return false;      // <-- выход до removeSessionDir
  workspaces.delete(sessionId);
  removeSessionDir(sessionId);
  return true;
}
```
`deleteOnSessionDestroyed()` вызывается из `middleware/auth.js:22` для истёкших/невалидных сессий. Если workspace не в памяти, orphan-директория `uploads/sessions/{sessionId}` не удаляется. На практике orphan'ы предотвращает `cleanupOnStartup()` при рестарте, поэтому impact низкий.

**Фикс:** вызывать `removeSessionDir(sessionId)` безусловно (до/после проверки Map).

---

### 🟡 Наблюдение (Low, безопасность/UX, вне скоупа плана §9.2) — устаревшая локальная сессия «побеждает» другого пользователя

`audio-correction/backend/src/routes/auth.js:69-73`: при наличии валидной локальной cookie `ac_session_id` она возвращается без сверки с текущей экосистемной cookie. Сценарий на общем браузере: A вошёл в standalone, вышел только из `testing`; B вошёл в `testing` и открыл standalone — увидит данные A (до 7 дней или до выхода из standalone). План §9.2 явно исключает периодическую ре-валидацию, поэтому фиксирую как осознанное ограничение. Митигация: при bootstrap, если `findLocalSession` относится к другому `user_id`, чем пользователь из свежей `session_id`, заменять локальную сессию.

---

### 🟢 Отклонения от плана / замечания

| # | Наблюдение | Файл |
|---|---|---|
| D1 | AC-3 / план C4: нет `/login`-лендинга с кнопкой «Войти через экосистему» — `AuthContext` сразу редиректит на экосистемный логин. Функционально приемлемо, но критерий приёмки формально не выполнен. | `audio-correction/frontend/src/contexts/AuthContext.jsx:42-53`; `audio-correction/frontend/src/App.jsx:14-21` |
| D2 | План E4/G4 предполагал перенос упрощённого `frontend/src/components/ProjectTabs.jsx`; по факту вкладки удалены, навигация «Управление» сделана inline-ссылкой. Требование задания «нет ссылок на ProjectTabs» выполнено. | `frontend/src/pages/IssuesPage.jsx:106-110` |
| D3 | Мёртвые пустые каталоги от удалённой интеграции. | `backend/src/uploads/1/audio`, `backend/src/uploads/77/audio` |
| D4 | `LOCAL_SESSION_TTL_MS` (архитектура §4.2) vs `LOCAL_SESSION_MAX_TTL_MS` (код/`.env.example`) — расхождение в имени переменной в документации. | `.env.example:28`, `audio-correction/backend/src/routes/auth.js:16` |
| D5 | `frontend/src/api/client.js:92` — неиспользуемый параметр `projectId` (lint-warning, pre-existing). | — |

---

## 5. Заблокированные проверки

| Область | Причина | Что нужно |
|---|---|---|
| Реальная обработка аудио (`analyze`/`process` на алгоритме) | нет Docker; `flask`, `numpy`, `scipy` не установлены | Docker/venv с `ffmpeg`, `numpy`, `scipy`, `flask` |
| `docker compose build/up` | Docker CLI отсутствует | Docker-окружение |
| HTTPS, DNS, certbot (AC-1, AC-4) | нет доступа к серверу/DNS | production-сервер |
| nginx deny `/api/internal/` снаружи (AC-9) | нет сервера | nginx + реальный домен |
| PM2/`.env.production`-путь (BUG-1) | PM2 не установлен, сервера нет | production-стенд |
| Кросс-доменная cookie в браузере (AC-2, AC-12) | нужен реальный браузер + `*.bot-atelier.ru` | e2e-стенд |
| Frontend UI/UX (пустой список, drag-and-drop, плееры, модалка, navigation guard, две вкладки) | нет браузерного раннера (Playwright и т.п.) | e2e-стек |

Мок-объекты использованы для: `testing /api/internal/session` (в unit-тестах standalone), sidecar (strict mock, контракт из `web_service.py`), экосистемный auth для TTL-тестов.

---

## 6. Рекомендации по приоритету

1. **BUG-1 (High)** — до выката определить фактический порт `testing` (`pm2 show`), синхронизировать `nginx.conf`/`deploy.sh`/`ECOSYSTEM_AUTH_URL`, обеспечить применение `INTERNAL_AUTH_TOKEN` и `COOKIE_DOMAIN` (через ecosystem env или `dotenv`). Иначе SSO на проде не работает.
2. **BUG-2 (Medium)** — парсить SQLite `expires_at` как UTC (или отдавать ISO из `internal.js`); после фикса тест `localSessionTtl.test.js` позеленеет.
3. **BUG-3 (Low)** — безусловно удалять директорию в `remove()`.
4. **D1–D5** — по вкусу: либо привести к плану, либо зафиксировать как принятое упрощение.

---

## 7. Команды для воспроизведения

```powershell
# testing
cd backend
npm test                     # 15/15 ✅
cd ../frontend
npm run lint                 # 0 errors
npm run build                # OK

# standalone
cd ../../audio-correction/backend
npm test                     # 50/51 ⚠️ (BUG-2)
cd ../frontend
npm run lint                 # 0 errors
npm run build                # OK
```

Запущенные QA-процессы завершаются в `after()`-хуках; слушателей на тестовых портах и временных артефактов не осталось. Отладочный файл `backend/src/uploads/__qa_probe__/` и тестовые session-каталоги удаляются тестами.
