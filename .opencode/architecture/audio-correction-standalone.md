# Развёртывание подсистемы `audio-correction` (Acoustic Matcher MVP + SSO-шлюз)

> **Статус:** актуальная поставка. Подсистема на
> `correction-audio.bot-atelier.ru` — это **исходный Acoustic Matcher MVP**
> (`web_app.py` + `static/index.html`) в контейнере `acoustic-matcher-mvp`,
> доступ к которому закрыт **SSO-шлюзом на nginx**. Кастомная
> Node/React/sidecar-реализация (порты 3002/8080, PM2 `audio-correction`)
> **выведена из эксплуатации** (см. §6).
>
> **Язык документа:** русский.
> **Связанный документ:** `.opencode/architecture/audio-correction.md`
> (границы, SSO-шлюз, модель, UI/API MVP, безопасность).
>
> **Только архитектура.** Здесь нет кода; команды и конфиги приведены как
> ориентир для выката.

---

## 1. Поддомен и DNS

| Параметр | Значение |
|----------|----------|
| Домен | `correction-audio.bot-atelier.ru` |
| Тип записи | `A` |
| Значение | `2.26.112.123` |
| TTL | 3600 |

Проверка после добавления:

```bash
nslookup correction-audio.bot-atelier.ru
```

> Если запись не резолвится на сервер, `certbot` не выпустит сертификат
> (HTTP-01). Управление — в DNS-панели зоны `bot-atelier.ru`.

---

## 2. Nginx: SSO-шлюз + TLS

### 2.1. Server-блок шлюза

Файл: `/etc/nginx/sites-available/correction-audio.bot-atelier.ru`.
nginx проверяет **каждый** запрос через `auth_request` к `testing` и лишь
при `200` пропускает его к MVP на loopback.

```nginx
server {
    listen 80;
    server_name correction-audio.bot-atelier.ru;

    # Лимит не меньше MAX_UPLOAD_BYTES MVP (500 МБ) + запас на multipart.
    client_max_body_size 520M;

    # Внутренний subrequest: проверка общей cookie в `testing`.
    location = /sso-auth {
        internal;
        proxy_pass http://127.0.0.1:3000/api/internal/session;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Internal-Auth "<INTERNAL_AUTH_TOKEN>";
    }

    location / {
        auth_request /sso-auth;

        # 401 → общий вход; недоступность testing/прочие ошибки → 503.
        error_page 401 = @sso_login;
        error_page 500 502 504 = @sso_unavailable;

        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }

    location @sso_login {
        return 302 https://bot-atelier.ru/login?next=https%3A%2F%2Fcorrection-audio.bot-atelier.ru%2F;
    }

    location @sso_unavailable {
        return 503;
    }
}
```

Примечания:

- `auth_request` по умолчанию пересылает исходные заголовки (включая
  `Cookie: session_id=…`); `X-Internal-Auth` подставляется секретом шлюза.
- `401` от `testing` → `302` на вход экосистемы; `403` (деактивированный
  аккаунт / неверный секрет) → `403 Forbidden`; `503` или недоступность
  `testing` → `503`.
- Публичного `/uploads/` нет: MVP отдаёт аудио только через свои
  endpoint'ы.

### 2.2. Внутренний endpoint `testing`

`testing` должен:

- отдавать `GET /api/internal/session` (loopback + `X-Internal-Auth`,
  только чтение, без продления сессии, коды `200/401/403/503`);
- ставить общую cookie `session_id` с `Domain=.bot-atelier.ru`;
- поддерживать whitelisted `next` (`*.bot-atelier.ru`) на странице входа.

Endpoint слушает только loopback (`127.0.0.1:3000`) и **закрыт снаружи**
nginx `testing`:

```nginx
location ^~ /api/internal/ {
    deny all;
    return 403;
}
```

### 2.3. Сертификат

```bash
certbot --nginx -d correction-audio.bot-atelier.ru \
  --non-interactive --agree-tos --email admin@bot-atelier.ru
```

Certbot добавит `listen 443 ssl`, ссылки на сертификат и редирект с `80`.
Автопродление — штатный таймер certbot. Сертификаты других поддоменов не
затрагиваются.

---

## 3. MVP-контейнер

- Источник: `audio-correction/mvp/` (вендорская копия Acoustic Matcher MVP,
  Dockerfile `python:3.12-slim` + `ffmpeg`).
- Контейнер слушает `8080` внутри; наружу публикуется **только на
  loopback** как `127.0.0.1:8081`.
- Собственной БД, томов и внешних сервисов нет: состояние — in-memory,
  файлы — в tmp-каталогах контейнера (при рестарте теряются).

`docker-compose.yml` (`audio-correction/deploy/`):

```yaml
services:
  acoustic-matcher-mvp:
    build: ../mvp
    container_name: acoustic-matcher-mvp
    ports:
      - "127.0.0.1:8081:8080"
    restart: unless-stopped
```

Проверка:

```bash
docker compose up -d --build
curl -fsS http://127.0.0.1:8081/api/state >/dev/null && echo ok
ss -ltnp | grep 8081     # ожидаем 127.0.0.1:8081, не 0.0.0.0
```

Опционально tmp-каталоги MVP можно вынести на `tmpfs` — это не меняет
эфемерную семантику.

---

## 4. Порты, env/секрет, сосуществование

### 4.1. Порты

| Компонент | Тип | Порт | Домен | БД |
|-----------|-----|------|-------|----|
| `testing` | PM2 `testing-bots` | `3000` | `testing.bot-atelier.ru` | `testing/backend/data/app.db` |
| `acoustic-matcher-mvp` | Docker | `8081` (loopback) | `correction-audio.bot-atelier.ru` | нет |
| nginx-шлюз | nginx | `443` | `correction-audio.bot-atelier.ru` | — |
| Портал `bot-atelier.ru` | nginx (статика) | `443` | apex | нет |

Порты `3002`/`8080` и PM2-процесс `audio-correction` больше не
используются.

### 4.2. Env и секрет

| Имя | Где | Назначение |
|-----|-----|------------|
| `INTERNAL_AUTH_TOKEN` | `.env.production` `testing` **и** nginx-блок шлюза | Shared secret к `/api/internal/session`; значения должны совпадать. В git не коммитить. |
| `MAX_UPLOAD_BYTES` | MVP (константа, 500 МБ) | Серверный лимит загрузки; `client_max_body_size` должен быть не меньше. |
| `COOKIE_DOMAIN=.bot-atelier.ru` | `.env.production` `testing` | Общая cookie экосистемы. |

Отдельных `PORT`, `DB_PATH`, `ECOSYSTEM_AUTH_URL`, `AUDIO_SIDECAR_URL`,
`AUDIO_SIDECAR_UPLOADS_ROOT`, `SESSION_TTL_MS` у подсистемы **нет**.

---

## 5. Артефакты деплоя

```text
audio-correction/
  mvp/                          # исходники MVP (web_app.py, static/index.html,
                                #   acoustic_matcher.py, requirements.txt,
                                #   Dockerfile, docker-compose.yml, tests/)
  deploy/
    nginx.conf                  # server-блок §2.1 (SSO-шлюз + proxy 8081)
    docker-compose.yml          # контейнер acoustic-matcher-mvp (§3)
    deploy.sh                   # сборка/запуск контейнера, nginx -t, certbot
    DEPLOY.md                   # пошаговая инструкция
```

Прежнее содержимое `audio-correction/deploy/` (`nginx.conf` с proxy на
`3002`, `ecosystem.config.cjs`, `deploy.sh` на PM2) заменяется.

> **Текущее состояние.** Исходники MVP в репозитории пока лежат в
> `acoustic_matcher_open_source_mvp-2/`; канонический путь —
> `audio-correction/mvp/` (перенос/вендоринг выполняется при выкате и не
> является правкой архитектуры).

---

## 6. Вывод из эксплуатации Node/React/sidecar

Выполняется один раз, после успешной проверки шлюза и MVP:

1. Остановить и удалить PM2-процесс: `pm2 delete audio-correction`,
   `pm2 save`.
2. Остановить прежний sidecar: `docker compose down` в старом
   `audio-correction/` (порт `8080`).
3. Заменить nginx-блок поддомена на шлюз (§2.1) и перезагрузить nginx.
4. Удалить/заархивировать прежние каталоги `audio-correction/backend/`,
   `audio-correction/frontend/`, `audio-correction/sidecar/`,
   `audio-correction/docker-compose.yml`.
5. Оставить без изменений: `testing` `GET /api/internal/session`, cookie
   `Domain=.bot-atelier.ru`, whitelist `next`, `deny all` на
   `/api/internal/` — они нужны шлюзу.

Собственная БД и `local_sessions`/`users_cache` прежней реализации не
переносятся и не нужны.

---

## 7. Порядок выката и rollback

**Выкат.**

1. Собрать и поднять `acoustic-matcher-mvp` на `127.0.0.1:8081`; проверить
   `/api/state` по loopback.
2. Установить nginx-блок шлюза, `nginx -t`, `systemctl reload nginx`.
3. Выпустить/обновить TLS (`certbot`).
4. Проверить сценарии входа:
   - без cookie → редирект на `testing/login?next=…`;
   - с общей cookie → интерфейс MVP открывается;
   - `is_active = 0` → `403`;
   - остановить `testing` → запросы к подсистеме дают `503` (и новые, и уже
     открытые вкладки); после подъёма `testing` вход восстанавливается.
5. Убедиться, что ссылка `← На главную` ведёт на `https://bot-atelier.ru/`
   и не завершает сессию.

**Rollback.**

- Полный возврат прежней Node/React/sidecar-поставки возможен только через
  `git revert` соответствующих коммитов и повторный выкат — поэтому
  удаление (§6) выполняется только после успешной проверки MVP и шлюза.
- До удаления: остановить MVP-контейнер, вернуть прежний nginx-блок и
  PM2-процесс.
- Состояние MVP привязано к контейнеру (in-memory) и откат данных не
  требует.

---

## 8. Открытые вопросы

1. **Вендоринг MVP.** Хранить апстрим как `audio-correction/mvp/` (копия)
   или как git-submodule/патч? От этого зависит обновление и перенос
   правки «На главную».
2. **Хранение секрета.** Значение `INTERNAL_AUTH_TOKEN` попадает в
   nginx-конфиг; согласовать способ (конфиг на сервере vs env-файл,
   подставляемый деплоем) и исключить утечку в git.
3. **Tmpfs для MVP.** Выносить ли временные каталоги на `tmpfs` и какой
   лимит диска считать нормальным при `MAX_UPLOAD_BYTES = 500 МБ`.
4. **client_max_body_size.** Подтвердить `520M` как достаточный запас над
   500 МБ.
5. **Обновление апстрима MVP.** Как переносить единственную правку
   (анкер «На главную») при обновлении кода MVP.
