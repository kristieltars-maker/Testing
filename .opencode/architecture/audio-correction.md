# Архитектура подсистемы `audio-correction` (Acoustic Matcher MVP + SSO-шлюз)

> **Статус:** актуальная поставка. Подсистема развёрнута на поддомене
> `correction-audio.bot-atelier.ru` как **исходный Acoustic Matcher MVP**
> (`web_app.py` + `static/index.html`, Python, обработка in-process).
> Доступ закрыт **SSO-шлюзом на nginx** (`auth_request` к `testing:
> GET /api/internal/session`). Кастомная реализация (Node-бэкенд,
> React-фронтенд, Python-sidecar, порты 3002/8080, PM2-процесс
> `audio-correction`) **выведена из эксплуатации** (см. §8).
>
> **Язык документа:** русский.
> **Назначение:** границы, SSO-шлюз, эфемерная модель, UI/API MVP,
> безопасность и риски.
> **Связанный документ:**
> `.opencode/architecture/audio-correction-standalone.md` (DNS, nginx/TLS,
> MVP-контейнер, порты, env/секрет, выкат, вывод Node/React/sidecar,
> rollback).

---

## 1. Резюме решений

| Вопрос | Решение |
|--------|---------|
| **Форма поставки** | Исходный Acoustic Matcher MVP (`web_app.py`, Python) в контейнере `acoustic-matcher-mvp` на loopback `127.0.0.1:8081`; доступ — через nginx-шлюз поддомена `correction-audio.bot-atelier.ru`. |
| **Название** | Slug `audio-correction`, название — «Корректор аудио-файлов». |
| **Роли и права** | Отдельная роль не нужна. Любой активный пользователь экосистемы, прошедший SSO, получает полный доступ. Проектной модели доступа нет. |
| **Связь с `testing`** | **Только SSO-шлюз:** `GET /api/internal/session` (loopback + `X-Internal-Auth`). Не используются `projects`, `bots`, `project_members`, `issues`, БД и сервисы `testing`. |
| **Связь с `issues`** | Не реализуется. |
| **SSO** | nginx `auth_request` на каждый запрос; локальной сессии подсистемы нет. |
| **Persistence** | Домена нет. Сессии MVP — in-memory, файлы — во временных каталогах ОС; собственной БД нет. |
| **Формат и обработка** | WAV, FLAC, MP3, M4A, AAC, OGG, Opus. Результат — WAV PCM 16-bit, mono, sample rate образца. Обработка синхронная, in-process. Лимит загрузки MVP — `MAX_UPLOAD_BYTES` = 500 МБ. |
| **Очистка** | Естественная: рестарт контейнера/ОС; отдельного TTL/GC нет. |

---

## 2. Границы, топология, структура

### 2.1. Что переиспользуется из экосистемы

Только вход:

- Таблицы `users` и `sessions` (в БД `testing`) как **единственный
  источник истины об идентичности и статусе аккаунта**.
- Общая cookie `session_id` (`Domain=.bot-atelier.ru`).
- Внутренний endpoint `testing` `GET /api/internal/session` (см. §3).

Ничего больше не импортируется: маршруты, сервисы, страницы и схемы
`testing` не используются.

### 2.2. Структура репозитория

```text
audio-correction/
  mvp/                          # исходный Acoustic Matcher MVP (вендорская копия)
    web_app.py                  # ThreadingHTTPServer: UI, in-memory сессии, API
    static/index.html           # исходный интерфейс + анкер «На главную»
    acoustic_matcher.py         # анализ, рекомендации, DSP (in-process)
    requirements.txt
    Dockerfile                  # python:3.12-slim + ffmpeg
    docker-compose.yml          # контейнер acoustic-matcher-mvp
    tests/
  deploy/                       # артефакты выката
    nginx.conf                  # server-блок поддомена: SSO-шлюз + proxy к MVP
    docker-compose.yml          # запуск MVP на 127.0.0.1:8081
    deploy.sh                   # сборка/запуск контейнера, nginx, certbot
    DEPLOY.md
```

> **Правило границ.** MVP не содержит кода аутентификации и не импортирует
> `testing`: вход целиком обеспечивается nginx-шлюзом. Единственная правка
> UI относительно апстрима MVP — анкер «На главную» (§6).

### 2.3. Топология

```text
Браузер
  │  https://correction-audio.bot-atelier.ru
  ▼
nginx (TLS, SSO-шлюз)
  │ 1) auth_request ──▶ GET http://127.0.0.1:3000/api/internal/session
  │                     Cookie: session_id=…  +  X-Internal-Auth: <секрет>
  │ 2) 200 → proxy_pass
  ▼
acoustic-matcher-mvp (127.0.0.1:8081)
  web_app.py ──▶ acoustic_matcher.py (in-process, без sidecar)
```

---

## 3. Единый вход (SSO-шлюз nginx)

### 3.1. Механизм

- Общая cookie `session_id` (`HttpOnly`, `Secure`, `SameSite=Lax`,
  `Domain=.bot-atelier.ru`) ставит `testing`.
- nginx поддомена на **каждый** запрос выполняет `auth_request` к
  `testing` и пропускает запрос к MVP только при `200`.
- Аутентификационного кода в MVP нет; собственной сессии/локальной сессии
  подсистемы тоже нет. Cookie MVP `acoustic_session` — сугубо рабочая
  (не аутентификация, §4.1).

### 3.2. Поток запроса

```text
Браузер                      nginx (correction-audio)         testing (loopback)
   │ GET /                            │                              │
   │─────────────────────────────────▶│                              │
   │                                  │ auth_request:                │
   │                                  │ GET /api/internal/session ──▶│
   │                                  │ Cookie: session_id=…         │
   │                                  │ X-Internal-Auth: …           │
   │                                  │◀── 200/401/403/503 ──────────│
   │ 200 → proxy_pass 127.0.0.1:8081  │                              │
   │ 401 → 302 на вход экосистемы     │                              │
   │ 403 → 403 Forbidden              │                              │
   │ ошибка/недоступен testing → 503  │                              │
   ▼
acoustic-matcher-mvp (127.0.0.1:8081)
```

Redirect при `401`:

```text
https://bot-atelier.ru/login?next=https%3A%2F%2Fcorrection-audio.bot-atelier.ru%2F
```

После успешного входа `testing` ставит общую cookie и возвращает
пользователя по `next` (whitelisted `*.bot-atelier.ru`).

### 3.3. Контракт внутреннего endpoint `testing`

```
GET /api/internal/session
Cookie: session_id=<opaque>
X-Internal-Auth: <INTERNAL_AUTH_TOKEN>
```

| Код | Тело | Условие |
|-----|------|---------|
| `200` | `{ "user": { "id", "name", "email", "role" }, "expires_at": "ISO-8601" }` | Сессия валидна, аккаунт активен. |
| `401` | `{ "error": "Session expired" }` | Cookie отсутствует, сессия не найдена/истекла. |
| `403` | `{ "error": "Forbidden" }` | Неверный/отсутствующий `X-Internal-Auth`. |
| `403` | `{ "error": "Account deactivated" }` | `is_active = 0`. |
| `503` | `{ "error": "Internal auth unavailable" }` | Секрет не задан в `testing`. |

- Только чтение, сессию **не продлевать**.
- Слушает только loopback (`127.0.0.1:3000`); снаружи закрыт nginx
  `testing` (`location ^~ /api/internal/ { deny all; }`).

### 3.4. Режимы отказа

| Ситуация | Поведение |
|----------|-----------|
| `testing` недоступен | `auth_request` не проходит → `503`. Недоступны и новые, и уже открытые вкладки (проверка на каждый запрос, а не однократно при входе). |
| Общая cookie истекла/отозвана | `401` → redirect на вход экосистемы. |
| `is_active = 0` | `403` → вход/запрос отклоняется. |
| Неверный `INTERNAL_AUTH_TOKEN` | `403` (неверный секрет) или `503` (секрет не задан в `testing`); ошибка конфигурации шлюза. |
| Рестарт MVP-контейнера | Все workspace теряются (in-memory + временные файлы). |
| Рестарт `testing` | Вход восстанавливается после подъёма `testing`; на состояние MVP рестарт не влияет. |

### 3.5. Cookie

| Cookie | Кто ставит | Назначение | Атрибуты |
|--------|-----------|------------|----------|
| `session_id` | `testing` | аутентификация в экосистеме | `Domain=.bot-atelier.ru`, `HttpOnly`, `Secure`, `SameSite=Lax` |
| `acoustic_session` | MVP | рабочая сессия MVP (не аутентификация) | host-only, `HttpOnly`, `SameSite=Lax`, 32 hex |

`acoustic_session` и `session_id` независимы: шлюз не создаёт и не удаляет
рабочую сессию MVP.

---

## 4. Модель данных (без проектов и БД)

### 4.1. In-memory сессии MVP

- `web_app.py`: `SESSIONS: dict[str, dict]` под `SESSIONS_LOCK`.
- Ключ — `acoustic_session` (или новый `uuid4().hex`); значение хранит
  `root`, `reference`, `reference_profile`, `reference_metrics`, `targets{}`.
- **Никаких SQL-таблиц:** `local_sessions`/`users_cache` прежней
  реализации не существуют. Собственной БД у подсистемы нет.

### 4.2. Файлы

- Каталог на сессию: `tempfile.mkdtemp(prefix="acoustic_manager_")`.
- Внутри: `reference/`, `targets/`, `processed/`.
- Имена целей: `{item_id}_{filename}`; результат: `{item_id}_v{version}.wav`.

### 4.3. Изоляция и очистка

- Изоляция — по случайному `acoustic_session` (32 hex) и временному
  каталогу; без cookie доступ к чужому `id` невозможен.
- Отдельного TTL/GC нет: состояние живёт в памяти процесса, файлы — до
  рестарта/перезагрузки. Это сознательный эфемерный режим.

---

## 5. UI и API MVP

UI — исходный `static/index.html` без функциональных правок, кроме одного
добавленного анкера «На главную» (§6). Публичной статики/`/uploads/` нет:
всё отдаёт сам MVP через nginx-шлюз.

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/` | Интерфейс MVP |
| GET | `/api/state` | Состояние: эталон, цели, метрики, рекомендации |
| GET | `/audio?kind=reference\|original\|processed&id=…&v=…` | Аудио/превью |
| GET | `/api/export?ids=…` | ZIP со скорректированными WAV (`acoustic-matched.zip`) |
| POST | `/api/reference` | Загрузка эталона (multipart, поле `reference`) |
| POST | `/api/targets` | Загрузка целей (multipart, поле `targets`) |
| POST | `/api/process` | Обработка выбранных (`{ ids, settings }`) — синхронно |

Обработка: `analyze_file`, `process_one`, `recommend_settings` из
`acoustic_matcher.py` вызываются in-process внутри `web_app.py`. Sidecar,
очереди и polling статуса не используются.

---

## 6. «На главную»

- Единственная правка UI: plain-анкер `<a href="https://bot-atelier.ru/">← На главную</a>`
  в шапке `audio-correction/mvp/static/index.html`.
- Переход кросс-доменный; cookie `session_id` и рабочая сессия
  `acoustic_session` не сбрасываются, logout не вызывается.
- Workspace MVP при уходе не удаляется (живёт до рестарта/очистки).

---

## 7. Безопасность

- Аутентификация целиком на nginx: MVP не публикуется напрямую и слушает
  только loopback `127.0.0.1:8081`.
- Внутренний endpoint `testing` loopback-only и закрыт снаружи
  (`deny all`); защищён shared secret `INTERNAL_AUTH_TOKEN`.
- Общая cookie — `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Domain=.bot-atelier.ru`.
- Секрет хранится только в серверном конфиге деплоя/nginx, не в git.
- Кросс-доменный переход на портал сессию не завершает.

---

## 8. Выведенная из эксплуатации реализация

Node/Express-бэкенд (порт 3002), React + Vite-фронтенд, Python-sidecar
(порт 8080), PM2-процесс `audio-correction`, compose-сервис sidecar и
собственная БД (`local_sessions`, `users_cache`) — **выведены из
эксплуатации**. Соответствующие элементы прежней архитектуры не описывают
текущую поставку и не должны восстанавливаться:

- локальная SSO-сессия `ac_session_id`, `POST /api/auth/session`,
  `GET /api/me`, `/api/session/*`, `runs`, polling, отчёты
  `report.json`/`report.csv`;
- сервисы `ecosystemAuth.js`, `audioCorrection.js`,
  `audioCorrectionSessionStore.js` и файлы `audio-correction/backend/**`,
  `audio-correction/frontend/**`, `audio-correction/sidecar/**`;
- порты 3002/8080 и PM2-имя `audio-correction`.

---

## 9. Риски и ограничения

1. **Жёсткая runtime-зависимость от `testing`.** Проверка на каждый
   запрос: при недоступности `testing` подсистема недоступна полностью
   (`503`), включая уже открытые вкладки.
2. **Потеря состояния при рестарте.** In-memory сессии и временные файлы —
   осознанный эфемерный режим.
3. **Функциональный регресс относительно прежней реализации.** Нет
   асинхронных `run`-статусов, отчётов `report.json/csv` и
   ZIP-отчёта — MVP отдаёт ZIP только со скорректированными WAV.
4. **Синхронная обработка.** Длительные пакеты держат HTTP-запрос; статуса
   и polling нет.
5. **Объём временного хранилища.** Лимит MVP 500 МБ на загрузку; нужен
   контроль tmp-каталога и диска.
6. **Секрет в конфиге шлюза.** Требует аккуратного деплоя и синхронизации
   с `testing`; секрет защищает loopback-only endpoint.
7. **Дрейф от апстрима MVP.** Единственная правка — анкер «На главную»;
   при обновлении MVP её нужно переносить.

---

## 10. Не в рамках текущей архитектуры

- Общие доменные абстракции между `testing` и `audio-correction`
  (например, «замечание к аудио»). Связь — только SSO-шлюз.
- Очередь/пул заданий, WebSocket-прогресс, серверный TTL/GC.
- Автоматический выбор эталона и ML-рекомендации.
- Видео и иные медиа. Только аудио.
- Показ идентичности пользователя на портале.
