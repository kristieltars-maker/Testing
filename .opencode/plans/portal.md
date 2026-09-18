# План реализации: Портал экосистемы `bot-atelier.ru` и навигация «На главную»

> **Статус:** готов к реализации.
> **Автор:** архитектор-планировщик.
> **Дата:** 2026-09-14.
> **Связанные документы:** `AGENTS.md` §4, `.opencode/architecture/portal.md`,
> `deploy.sh`, `nginx.conf`, `DEPLOY.md`, `audio-correction/deploy/*`.

---

## 1. Цель

Создать статический публичный портал на apex-домене `bot-atelier.ru` с
каталогом подсистем экосистемы (`testing` и `correction-audio`), обеспечить
навигацию «← На главную» из обеих подсистем без завершения сессии, и
развернуть портал на сервере `2.26.112.123` с TLS через Let's Encrypt.

---

## 2. Файлы: создание и изменение

### 2.1. Создаются (портал)

| # | Путь | Назначение |
|---|------|------------|
| 1 | `portal/index.html` | Публичная посадочная страница: заголовок, кнопка «Войти», контейнер карточек, `<noscript>`-фолбэк, подключение `subsystems.js` |
| 2 | `portal/styles.css` | Локальные стили: карточки подсистем, адаптив, без внешних CDN/шрифтов |
| 3 | `portal/subsystems.js` | ES-module: массив каталога подсистем (`slug`, `title`, `description`, `url`). Рендер карточек в `#subsystems` |
| 4 | `portal/assets/favicon.ico` | Иконка сайта (минимальный placeholder) |
| 5 | `portal/nginx.conf` | Референсный nginx server-блок для `bot-atelier.ru` + `www.bot-atelier.ru` (копия на сервере) |
| 6 | `portal/DEPLOY.md` | Пошаговый деплой-ориентир: DNS, nginx, certbot, обновление |

### 2.2. Создаются (константы в подсистемах)

| # | Путь | Назначение |
|---|------|------------|
| 7 | `frontend/src/constants/ecosystem.js` | `export const PORTAL_URL = 'https://bot-atelier.ru/';` — для `testing` |
| 8 | `audio-correction/frontend/src/constants/ecosystem.js` | `export const PORTAL_URL = 'https://bot-atelier.ru/';` — для `correction-audio` |

### 2.3. Изменяются (навигация «На главную»)

| # | Путь | Что меняется |
|---|------|-------------|
| 9 | `frontend/src/App.jsx` | В `Layout` → `<nav>` добавить `<a href={PORTAL_URL}>← На главную</a>` между брендом и блоком пользователя. Импортировать `PORTAL_URL` из `constants/ecosystem.js` |
| 10 | `audio-correction/frontend/src/pages/AudioCorrection/AudioCorrectionPage.jsx` | В `<header className="app-topbar">` добавить `<a href={PORTAL_URL}>← На главную</a>` после `<span className="app-brand">`. Импортировать `PORTAL_URL` из `../../constants/ecosystem.js` |

### 2.4. НЕ изменяются

- `nginx.conf` (testing) — не затрагивается.
- `deploy.sh` (testing) — не затрагивается.
- `audio-correction/deploy/*` — не затрагиваются.
- Backend'ы обеих подсистем — не затрагиваются.
- `LoginPage.jsx` — whitelist `next` уже допускает `bot-atelier.ru` (подтверждено: `url.hostname === 'bot-atelier.ru'`).

---

## 3. Контракт данных: каталог подсистем

`portal/subsystems.js` экспортирует массив. Контракт одной записи:

```
{
  slug:        string,   // стабильный идентификатор ('testing', 'correction-audio')
  title:       string,   // отображаемое имя ('Тестирование ботов')
  description: string,   // короткое описание (1–2 предложения)
  url:         string    // абсолютный URL ('https://testing.bot-atelier.ru/')
}
```

Текущие записи (порядок = порядок карточек):

| slug | title | description | url |
|------|-------|-------------|-----|
| `testing` | Тестирование ботов | Трекинг замечаний тестировщика → скриптолога | `https://testing.bot-atelier.ru/` |
| `correction-audio` | Корректор аудио-файлов | Acoustic matching и коррекция аудиозаписей | `https://correction-audio.bot-atelier.ru/` |

Добавление подсистемы = одна новая запись в массиве.

---

## 4. API-контракты

**Портал не имеет API.** Нет backend, нет endpoint'ов, нет запросов к
серверу. Статика отдаётся nginx напрямую.

Единственная «интеграция» — ссылка «Войти»:

```
GET https://testing.bot-atelier.ru/login?next=https%3A%2F%2Fbot-atelier.ru%2F
```

Это существующий маршрут `testing`; `isAllowedNext` уже разрешает
`bot-atelier.ru`. Изменений не требуется.

---

## 5. Изменения схемы БД

**Отсутствуют.** Портал не использует базу данных.

---

## 6. Пошаговая реализация

### Шаг 1. Константы экосистемы (файлы 7, 8)

Создать `frontend/src/constants/ecosystem.js` и
`audio-correction/frontend/src/constants/ecosystem.js` с единственной
экспортируемой константой `PORTAL_URL = 'https://bot-atelier.ru/'`.

### Шаг 2. Навигация «На главную» в `testing` (файл 9)

В `frontend/src/App.jsx`:
- Добавить `import { PORTAL_URL } from './constants/ecosystem.js';`
- В компоненте `Layout`, внутри `<nav>`, между `<Link>` бренда и
  `<div>` с пользовательским блоком, добавить:
  `<a href={PORTAL_URL} style={...}>← На главную</a>`
- Стиль ссылки — неброский (серый текст, без подчёркивания), согласованный
  с существующим inline-стилем `<nav>`.

### Шаг 3. Навигация «На главную» в `correction-audio` (файл 10)

В `audio-correction/frontend/src/pages/AudioCorrection/AudioCorrectionPage.jsx`:
- Добавить `import { PORTAL_URL } from '../../constants/ecosystem.js';`
- В `<header className="app-topbar">`, после `<span className="app-brand">`,
  добавить: `<a href={PORTAL_URL} className="home-link">← На главную</a>`
- Стилизовать через CSS-класс `.home-link` (или inline, в зависимости от
  существующего подхода topbar).

### Шаг 4. Статические файлы портала (файлы 1–4)

Создать директорию `portal/` и файлы:

- **`index.html`**: семантическая разметка (header с заголовком
  «Бот Ателье», кнопка «Войти» → `testing/login?next=…`, `<ul id="subsystems">`,
  `<noscript>` со ссылками на обе подсистемы, `<link rel="canonical">`,
  `<script type="module" src="subsystems.js">`).
- **`styles.css`**: сброс, типографика, grid/flex для карточек, адаптив
  (mobile-first), без внешних зависимостей.
- **`subsystems.js`**: `import`-массив, рендер карточек в `#subsystems`
  через DOM API (createElement, appendChild).
- **`assets/favicon.ico`**: минимальный placeholder (16×16 ICO или SVG).

### Шаг 5. Референсный nginx-блок и DEPLOY.md (файлы 5, 6)

- **`portal/nginx.conf`**: server-блок из `.opencode/architecture/portal.md` §4.2
  (listen 80, `server_name bot-atelier.ru www.bot-atelier.ru`, root `/opt/portal`,
  cache-control для `index.html` и `subsystems.js`, кэш 30d для `/assets/`).
- **`portal/DEPLOY.md`**: пошаговое руководство (DNS → загрузка файлов →
  nginx → certbot → проверка), по аналогии с корневым `DEPLOY.md`.

### Шаг 6. Загрузка портала на сервер

```
scp -r portal/index.html portal/styles.css portal/subsystems.js portal/assets/ \
     root@2.26.112.123:/opt/portal/
```

### Шаг 7. Установка nginx-блока на сервере

```
cp portal/nginx.conf /etc/nginx/sites-available/bot-atelier.ru
ln -sf /etc/nginx/sites-available/bot-atelier.ru /etc/nginx/sites-enabled/bot-atelier.ru
nginx -t && systemctl reload nginx
```

### Шаг 8. Выпуск TLS-сертификата

**Предварительное условие:** DNS apex `bot-atelier.ru` и `www.bot-atelier.ru`
указывают на `2.26.112.123` (пользователь перенаправляет вручную в reg.ru).

```
certbot --nginx -d bot-atelier.ru -d www.bot-atelier.ru \
  --non-interactive --agree-tos --email admin@bot-atelier.ru
```

Если certbot не проходит — повторить после DNS-propagation (до 24 ч).

### Шаг 9. Пересборка и редеплой фронтендов

**testing:**
```powershell
scp -r .\frontend root@2.26.112.123:/opt/testing-bots/
```
На сервере:
```bash
cd /opt/testing-bots/frontend && npm install && npm run build
```

**correction-audio:**
```powershell
scp -r .\audio-correction\frontend root@2.26.112.123:/opt/audio-correction/
```
На сервере:
```bash
cd /opt/audio-correction/frontend && npm install && npm run build
```

PM2-процессы перезапускать не нужно — меняется только статика.

---

## 7. Deployment Runbook

### Предварительные условия

1. DNS: apex `bot-atelier.ru` → A `2.26.112.123` (сейчас `95.163.244.138`).
2. DNS: `www.bot-atelier.ru` → A `2.26.112.123`.
3. Дождаться propagation: `nslookup bot-atelier.ru` возвращает `2.26.112.123`.

### Порядок выполнения

| # | Действие | Команда / описание | Ожидаемый результат |
|---|----------|-------------------|---------------------|
| 1 | Проверить DNS | `nslookup bot-atelier.ru` | `2.26.112.123` |
| 2 | Создать директорию портала | `ssh root@2.26.112.123 'mkdir -p /opt/portal/assets'` | Директория существует |
| 3 | Загрузить статику | `scp portal/* root@2.26.112.123:/opt/portal/` | Файлы на сервере |
| 4 | Установить nginx-блок | `cp /opt/portal/nginx.conf /etc/nginx/sites-available/bot-atelier.ru` + symlink + `nginx -t && systemctl reload nginx` | `nginx -t` = OK |
| 5 | Проверить HTTP | `curl -I http://bot-atelier.ru` | 200, HTML |
| 6 | Выпустить сертификат | `certbot --nginx -d bot-atelier.ru -d www.bot-atelier.ru --non-interactive --agree-tos --email admin@bot-atelier.ru` | `Congratulations!` |
| 7 | Проверить HTTPS | `curl -I https://bot-atelier.ru` | 200, TLS |
| 8 | Загрузить и собрать testing frontend | `scp` + `npm install && npm run build` | `dist/` обновлён |
| 9 | Загрузить и собрать correction-audio frontend | `scp` + `npm install && npm run build` | `dist/` обновлён |
| 10 | Финальная проверка | См. §8 | Все критерии выполнены |

### Безопасный повтор certbot

Если certbot завершился ошибкой (DNS не propagation):

```bash
# Подождать и повторить (без дублирования блоков nginx):
certbot --nginx -d bot-atelier.ru -d www.bot-atelier.ru \
  --non-interactive --agree-tos --email admin@bot-atelier.ru
```

Certbot идемпотентен: при повторном запуске он обновляет существующий
сертификат или выпускает новый.

---

## 8. Критерии готовности (Acceptance Criteria)

### Портал

| # | Критерий | Как проверить |
|---|----------|---------------|
| AC-1 | `https://bot-atelier.ru` отдаёт 200 по HTTPS | `curl -I https://bot-atelier.ru` → `HTTP/2 200` |
| AC-2 | `https://www.bot-atelier.ru` отдаёт 200 по HTTPS | `curl -I https://www.bot-atelier.ru` → `HTTP/2 200` |
| AC-3 | HTTP → HTTPS редирект | `curl -I http://bot-atelier.ru` → `301` на `https://` |
| AC-4 | Отображаются 2 карточки подсистем | Открыть в браузере — видны «Тестирование ботов» и «Корректор аудио-файлов» |
| AC-5 | Карточка `testing` ведёт на `https://testing.bot-atelier.ru/` | Клик → переход на testing |
| AC-6 | Карточка `correction-audio` ведёт на `https://correction-audio.bot-atelier.ru/` | Клик → переход на correction-audio |
| AC-7 | Кнопка «Войти» ведёт на `testing/login?next=…` | Клик → страница логина testing; после входа — возврат на портал |
| AC-8 | `<noscript>`-фолбэк содержит ссылки на обе подсистемы | Отключить JS → ссылки видны |
| AC-9 | TLS-сертификат валиден | `openssl s_client -connect bot-atelier.ru:443 -servername bot-atelier.ru` → `Verify return code: 0` |
| AC-10 | TLS покрывает оба имени | Сертификат содержит SAN: `bot-atelier.ru`, `www.bot-atelier.ru` |

### Навигация «На главную»

| # | Критерий | Как проверить |
|---|----------|---------------|
| AC-11 | В `testing` видна ссылка «← На главную» в навбаре | Залогиниться → ссылка присутствует в шапке |
| AC-12 | Клик «← На главную» в `testing` → переход на `https://bot-atelier.ru/` | Клик → портал открывается |
| AC-13 | В `correction-audio` видна ссылка «← На главную» в topbar | Залогиниться → ссылка присутствует |
| AC-14 | Клик «← На главную» в `correction-audio` → переход на `https://bot-atelier.ru/` | Клик → портал открывается |
| AC-15 | `useNavigationGuard` НЕ блокирует переход на портал | При наличии данных в workspace — кросс-доменный переход без модалки (сработает только `beforeunload` браузера) |

### Сохранение сессии

| # | Критерий | Как проверить |
|---|----------|---------------|
| AC-16 | Переход testing → портал → testing: сессия сохранена | Залогиниться в testing → «На главную» → клик на карточку testing → пользователь остаётся залогинен (без повторного ввода пароля) |
| AC-17 | Переход correction-audio → портал → correction-audio: сессия сохранена | Аналогично: SSO подхватывает общую cookie |
| AC-18 | Портал НЕ выполняет logout | Ни один элемент портала не вызывает `POST /auth/logout`, `DELETE /session` или очистку cookie |
| AC-19 | Кнопка «Войти» на портале → логин → возврат на портал | Клик «Войти» → форма логина testing → вход → редирект на `https://bot-atelier.ru/` |

---

## 9. Edge cases

| # | Сценарий | Ожидаемое поведение |
|---|----------|---------------------|
| EC-1 | DNS apex ещё не перенаправлен | Портал недоступен; certbot не проходит. Решение: ждать propagation. |
| EC-2 | Пользователь заходит на портал уже залогиненным | Портал выглядит так же (имя не показывается). Клик на карточку подсистемы → SSO подхватывает → рабочий интерфейс. |
| EC-3 | Пользователь кликает «Войти» уже залогиненным | Попадает на `LoginPage` testing. Текущий `LoginPage` не редиректит залогиненного — видит форму. После повторного входа — возврат на портал. (Улучшение авт-редиректа — вне скоупа.) |
| EC-4 | `beforeunload` в `correction-audio` при уходе на портал | Браузер показывает стандартный confirm. Данные workspace не удаляются (TTL/GC работают штатно). При возврате — workspace на месте. |
| EC-5 | Кэширование старых фронтендов | `index.html` отдаётся с `Cache-Control: no-cache` (существующая конфигурация nginx обеих подсистем). `useAutoUpdate` в testing и автообновление в correction-audio подхватят новый бандл. |
| EC-6 | `www.bot-atelier.ru` вместо apex | Оба имени обслуживаются одним server-блоком; контент идентичен. `<link rel="canonical">` указывает на apex. |
| EC-7 | Добавление третьей подсистемы | Правка только `portal/subsystems.js` (одна запись) + обновление `AGENTS.md`. Ни nginx, ни TLS, ни подсистемы не меняются. |
| EC-8 | Портал недоступен (nginx упал) | Подсистемы работают независимо. Ссылка «← На главную» ведёт на недоступный домен — браузер показывает ошибку. |
| EC-9 | Сертификат истекает | Автопродление certbot (штатный systemd-таймер). Портал — статика, перезапуск не нужен. |
| EC-10 | Пользователь открывает `http://bot-atelier.ru` (без `s`) | Certbot добавляет 301 → `https://bot-atelier.ru`. |

---

## 10. Риски и откат

### Риски

| # | Риск | Вероятность | Влияние | Митигация |
|---|------|-------------|---------|-----------|
| R-1 | DNS apex не перенаправлен вовремя | Средняя | Блокирует certbot и доступ к порталу | Пользователь уведомлён; certbot повторяется после propagation |
| R-2 | Certbot HTTP-01 не проходит до propagation | Средняя | TLS недоступен; портал работает только по HTTP | Не запускать certbot до подтверждения DNS; повтор безопасен |
| R-3 | Кэширование старых бандлов фронтендов | Низкая | Пользователи не видят ссылку «На главную» | `Cache-Control: no-cache` на `index.html`; `useAutoUpdate` в testing; жёсткое обновление (Ctrl+Shift+R) |
| R-4 | Дрейф каталога подсистем | Низкая | `subsystems.js` и `AGENTS.md` рассинхронизированы | Ручная синхронизация при добавлении подсистемы |
| R-5 |Wildcard DNS `*` не покрывает apex | Определённость | Apex не резолвится без явной A-записи | Явная A-запись для `@` и `www` (не wildcard) |

### Откат

| Компонент | Откат |
|-----------|-------|
| **Портал** | Удалить nginx-блок: `rm /etc/nginx/sites-enabled/bot-atelier.ru && systemctl reload nginx`. Удалить `/opt/portal/`. DNS apex вернуть на `95.163.244.138`. |
| **Ссылка «На главную» в testing** | Откатить `App.jsx` (убрать `<a>` и импорт). Пересобрать frontend. |
| **Ссылка «На главную» в correction-audio** | Откатить `AudioCorrectionPage.jsx`. Пересобрать frontend. |
| **TLS-сертификат** | `certbot delete --cert-name bot-atelier.ru`. Nginx-блок вернётся к HTTP-only (или будет удалён). |

Откат портала не влияет на подсистемы (они не зависят от портала).
Откат ссылок «На главную» не влияет на портал.

---

## 11. Вне скоупа

1. **Backend портала.** Показ имени пользователя, API, БД — не реализуются.
2. **Редирект `www → apex`.** Оба имени отдают контент; редирект может быть добавлен позже.
3. **Авт-редирект залогиненного на `LoginPage`.** Если пользователь с активной сессией кликает «Войти» на портале, он видит форму логина. Улучшение — отдельная задача для `testing`.
4. **Аналитика и мониторинг портала.** Не встраиваются.
5. **Единый React-компонент навигационной шапки.** Каждая подсистема реализует свою ссылку «На главную» независимо.
6. **Модификация `LoginPage.jsx`** — whitelist `next` уже работает корректно.
7. **Изменение cookie, nginx-прокси или API подсистем.** Ссылка «На главную» —纯 клиентский plain-анкер.
8. **Собственный `deploy.sh` для портала.** Портал — статика; деплой описан в `portal/DEPLOY.md` и в §7 данного плана. Отдельный автоматизированный скрипт не создаётся.
9. **Docker/контейнеризация портала.** nginx + статика на хосте.
10. **Миграция DNS с reg.ru.** Пользователь управляет DNS самостоятельно.

---

## 12. Зависимости от внешних действий

| # | Действие | Кто выполняет | Блокирует |
|---|----------|---------------|-----------|
| D-1 | Перенаправление DNS apex `bot-atelier.ru` → `2.26.112.123` | Пользователь (reg.ru) | Шаги 5–7 (HTTP-доступ, certbot) |
| D-2 | Добавление A-записи `www.bot-atelier.ru` → `2.26.112.123` | Пользователь (reg.ru) | Шаг 7 (certbot для www) |
| D-3 | Подтверждение DNS-propagation | Пользователь (`nslookup`) | Шаг 8 (certbot) |

---

## 13. Итого: сводка изменений

```
Создаётся:
  portal/index.html
  portal/styles.css
  portal/subsystems.js
  portal/assets/favicon.ico
  portal/nginx.conf
  portal/DEPLOY.md
  frontend/src/constants/ecosystem.js
  audio-correction/frontend/src/constants/ecosystem.js

Изменяется:
  frontend/src/App.jsx                                    (+3 строки: import, <a>)
  audio-correction/frontend/src/pages/AudioCorrection/
    AudioCorrectionPage.jsx                               (+3 строки: import, <a>)

Пересобирается и редеплоится:
  testing frontend        → /opt/testing-bots/frontend/dist/
  correction-audio frontend → /opt/audio-correction/frontend/dist/

На сервере:
  /opt/portal/              (новая директория со статикой)
  /etc/nginx/sites-available/bot-atelier.ru  (новый server-блок)
  /etc/nginx/sites-enabled/bot-atelier.ru    (symlink)
  Let's Encrypt сертификат для bot-atelier.ru + www.bot-atelier.ru
```
