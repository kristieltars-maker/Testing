# План реализации подсистемы «Корректор аудио-файлов» (`audio-correction`)

## 1. Цель

Добавить в экосистему «Тестирование ботов» эфемерную подсистему коррекции аудио-файлов, привязанную к проекту. Пользователь загружает эталонную запись и одну или несколько целевых записей, настраивает параметры акустического выравнивания, запускает фоновую обработку через Python-sidecar, получает скорректированные файлы с метриками и отчётами, скачивает результаты и закрывает подсистему — после чего все файлы и состояние безвозвратно удаляются. Никакие данные модуля не сохраняются в SQLite; состояние живёт только в server-side сессии и на диске в сессионной директории.

---

## 2. Файлы: создание и изменение

### 2.1. Backend — новые файлы

| Путь | Назначение |
|------|------------|
| `backend/src/routes/audio-correction.js` | Express-роутер: все публичные REST-эндпоинты модуля |
| `backend/src/services/audioCorrectionSessionStore.js` | In-memory хранилище workspace-сессий + фоновый GC (TTL 1 час) |
| `backend/src/services/audioCorrection.js` | Клиент к Python-sidecar: HTTP-вызовы, оркестрация обработки, управление runs |

### 2.2. Backend — изменяемые файлы

| Путь | Изменение |
|------|-----------|
| `backend/src/server.js` | Подключить `audio-correction.js` роутер по префиксу `/api/projects/:projectId/audio-correction` |
| `backend/src/middleware/auth.js` | Экспортировать `req.sessionId` (значение cookie `session_id`) для использования в session store |

### 2.3. Frontend — новые файлы

| Путь | Назначение |
|------|------------|
| `frontend/src/pages/AudioCorrection/AudioCorrectionPage.jsx` | Единый рабочий стол модуля (все секции: эталон, цели, настройки, прогресс, результаты) |
| `frontend/src/pages/AudioCorrection/components/ProjectTabs.jsx` | Компонент проектных вкладок: «Замечания · Корректор аудио-файлов · Управление» |
| `frontend/src/pages/AudioCorrection/components/ReferenceUpload.jsx` | Зона drag-and-drop загрузки эталонной записи (один файл) |
| `frontend/src/pages/AudioCorrection/components/TargetsUpload.jsx` | Зона drag-and-drop загрузки целевых записей (множественная) + список файлов |
| `frontend/src/pages/AudioCorrection/components/SettingsPanel.jsx` | Макро-ручки + свертываемые группы продвинутых параметров + рекомендации |
| `frontend/src/pages/AudioCorrection/components/ProcessingStatus.jsx` | Прогресс-бар, кнопка отмены, статусы отдельных целей |
| `frontend/src/pages/AudioCorrection/components/ResultsPanel.jsx` | Карточки результатов: плееры, метрики, кнопки скачивания |
| `frontend/src/pages/AudioCorrection/components/CloseConfirmModal.jsx` | Модальное подтверждение «Закрыть / Забыть» |
| `frontend/src/api/audioCorrection.js` | Методы API-клиента для модуля (все эндпоинты audio-correction) |

### 2.4. Frontend — изменяемые файлы

| Путь | Изменение |
|------|-----------|
| `frontend/src/App.jsx` | Добавить маршрут `/projects/:projectId/audio-correction` → `AudioCorrectionPage` |
| `frontend/src/pages/IssuesPage.jsx` | Добавить компонент `ProjectTabs` в шапку страницы проекта |
| `frontend/src/pages/ProjectManagePage.jsx` | Добавить компонент `ProjectTabs` в шапку страницы управления |
| `frontend/src/index.css` | Стили для зон drag-and-drop, waveform-placeholder, прогресс-бара, вкладок проекта |

### 2.5. Python sidecar — новые файлы

| Путь | Назначение |
|------|------------|
| `subsystems/audio-correction/service/Dockerfile` | Docker-образ sidecar (Python 3.12-slim + FFmpeg) |
| `subsystems/audio-correction/service/requirements.txt` | `numpy>=2.0,<3`, `scipy>=1.13,<2`, `flask>=3.0,<4` (или `fastapi`) |
| `subsystems/audio-correction/service/src/acoustic_matcher.py` | Копия `acoustic_matcher.py` из MVP без изменений |
| `subsystems/audio-correction/service/src/web_service.py` | Stateless HTTP-обёртка: эндпоинты `/internal/analyze`, `/internal/process`, `/internal/recommend` |
| `subsystems/audio-correction/service/src/__init__.py` | Пустой init-файл |
| `subsystems/audio-correction/README.md` | Инструкция по сборке и запуску sidecar |

### 2.6. Docker Compose — изменяемые файлы

| Путь | Изменение |
|------|-----------|
| `docker-compose.yml` (корневой, если существует) или новый `docker-compose.yml` в корне проекта | Добавить сервис `audio-correction-sidecar` без публикации порта наружу, с общим volume для файлов |

---

## 3. Контракт API

Базовый префикс: `/api/projects/:projectId/audio-correction`

Все эндпоинты требуют авторизации (`authMiddleware`) и членства в проекте (`checkProjectAccess`).

### 3.1. Сессия / workspace

| Метод | Путь | Вход | Выход | Описание |
|-------|------|------|-------|----------|
| GET | `/session` | — | `{ workspace: AudioCorrectionWorkspace }` или `204 No Content` если нет активной сессии | Получить текущее состояние сессии |
| DELETE | `/session` | — | `{ ok: true }` | Закрыть подсистему: отменить текущий run, удалить файлы, очистить workspace |

### 3.2. Эталонная запись

| Метод | Путь | Вход | Выход | Описание |
|-------|------|------|-------|----------|
| POST | `/session/reference` | `multipart/form-data`, поле `reference` (1 файл) | `{ reference: AudioFile }` | Загрузить/заменить эталон. Предыдущий эталон удаляется. Целевые записи сохраняются. |
| DELETE | `/session/reference` | — | `{ ok: true }` | Удалить текущий эталон |
| POST | `/session/reference/analyze` | — | `{ profile: object, recommendations: object }` | Получить акустический профиль эталона и рекомендации настроек |

### 3.3. Целевые записи

| Метод | Путь | Вход | Выход | Описание |
|-------|------|------|-------|----------|
| POST | `/session/targets` | `multipart/form-data`, поле `targets` (1+ файлов) | `{ targets: AudioFile[] }` | Добавить целевые записи. Возвращает обновлённый список всех целей. |
| DELETE | `/session/targets/:targetIndex` | — | `{ ok: true }` | Удалить конкретную целевую запись по индексу |

### 3.4. Настройки

| Метод | Путь | Вход | Выход | Описание |
|-------|------|------|-------|----------|
| GET | `/session/settings` | — | `{ settings: ProcessingSettings }` | Текущие настройки обработки |
| PATCH | `/session/settings` | `{ macros?: {...}, advanced?: {...} }` | `{ settings: ProcessingSettings }` | Обновить макро-ручки и/или продвинутые параметры |

### 3.5. Обработка и результаты

| Метод | Путь | Вход | Выход | Описание |
|-------|------|------|-------|----------|
| POST | `/session/process` | — | `{ run_id: string, status: 'running' }` | Запустить обработку. Создаёт run, асинхронно вызывает sidecar. |
| POST | `/session/runs/:runId/cancel` | — | `{ ok: true }` | Отменить текущий run (помечает как `cancelled`) |
| GET | `/session/runs/:runId` | — | `{ run: AudioCorrectionRun }` | Статус и результаты run (polling каждые 2 сек) |
| GET | `/session/runs/:runId/download/:targetIndex` | — | Бинарный поток (audio/*) | Скачать скорректированный файл для цели |
| GET | `/session/runs/:runId/download/report` | — | `application/json` | Скачать отчёт (JSON) |
| GET | `/session/runs/:runId/download/all` | — | `application/zip` | Скачать ZIP со всеми выходными файлами и отчётами |

### 3.6. Sidecar internal API (не публичный)

| Метод | Путь | Вход | Выход | Описание |
|-------|------|------|-------|----------|
| POST | `/internal/analyze` | `{ reference_path: string }` | `{ profile: object, metrics: object }` | Анализ эталонного файла |
| POST | `/internal/recommend` | `{ reference_profile: object, target_metrics: object }` | `{ recommendations: object }` | Рекомендации настроек |
| POST | `/internal/process` | `{ reference_path, target_paths: string[], output_dir, options: ProcessingOptions }` | `{ results: RunOutput[], report: object }` | Обработка batch: все цели за один вызов |

---

## 4. Изменения схемы БД

**Никаких изменений схемы БД не требуется.** Модуль `audio-correction` не создаёт собственных таблиц. Используются только существующие таблицы каркаса: `users`, `sessions`, `projects`, `bots`, `project_members`.

---

## 5. Backend-задачи (по порядку выполнения)

### 5.1. Экспорт `sessionId` из auth middleware

- В `middleware/auth.js` добавить `req.sessionId = sessionId` после валидации сессии.
- Это позволяет роутерам получать `session_id` из cookie без повторного парсинга.

### 5.2. Session Store (`audioCorrectionSessionStore.js`)

- In-memory `Map<session_id, AudioCorrectionWorkspace>`.
- Методы: `getOrCreate(sessionId, projectId)`, `get(sessionId)`, `delete(sessionId)`, `updateActivity(sessionId)`.
- Фоновый GC: `setInterval` каждые 5 минут, удаляет workspace с `last_activity_at` старше 1 часа.
- При удалении workspace: рекурсивно удалить сессионную директорию `backend/src/uploads/{project_id}/audio/sessions/{session_id}/`.
- При старте сервера: удалить все директории `backend/src/uploads/*/audio/sessions/` (очистка после перезапуска).
- Хук на уничтожение сессии `sessions`: при logout / истечении cookie — вызвать `sessionStore.delete(sessionId)`.

### 5.3. Sidecar client (`audioCorrection.js`)

- HTTP-клиент к sidecar по адресу из переменной окружения `AUDIO_SIDECAR_URL` (дефолт `http://127.0.0.1:8080`).
- Методы: `analyzeReference(path)`, `getRecommendations(profile, metrics)`, `processBatch(referencePath, targetPaths, outputDir, options)`.
- Обработка ошибок: таймаут 5 минут, retry 0 раз, понятные сообщения об ошибках.
- При `processBatch`: вызывать sidecar асинхронно (не блокируя Event Loop), обновлять run в session store по завершении.

### 5.4. Роутер (`audio-correction.js`)

- Middleware `checkProjectAccess`: переиспользовать паттерн из `issues.js` (проверка `project_members` + `admin` + `manager_id`). Вынести в общую утилиту `backend/src/utils/projectAccess.js` для переиспользования.
- Multer-конфигурация для аудио: `diskStorage` с destination `uploads/{project_id}/audio/sessions/{session_id}/{reference|targets}/`, filename `{timestamp}-{random}{ext}`, fileFilter по расширениям `.wav .flac .mp3 .m4a .aac .ogg .opus`, limit 50 MB.
- Декодирование имён файлов (UTF-8 из latin1) — переиспользовать `decodeFileName` из `issues.js` (вынести в утилиту).
- Реализация всех эндпоинтов из §3.
- Для `POST /session/process`: создать run с `status: 'running'`, вызвать sidecar асинхронно, вернуть `run_id` немедленно. По завершении sidecar-вызова обновить run до `success`/`partial`/`failed`.
- Для `GET /session/runs/:runId/download/*`: стримить файл через `res.download()` или `res.sendFile()` с проверкой принадлежности к сессии.
- Для ZIP: формировать архив на лету через `archiver` или встроенный `zlib`.

### 5.5. Регистрация роутера в `server.js`

```
import audioCorrectionRoutes from './routes/audio-correction.js';
app.use('/api/projects/:projectId/audio-correction', authMiddleware, audioCorrectionRoutes);
```

### 5.6. Очистка и гарантии

- `DELETE /session`: отменить текущий run (если `running`), удалить сессионную директорию рекурсивно, удалить workspace из store.
- Фоновый GC: каждые 5 минут обходить store, удалять workspace с `last_activity_at` старше 1 часа.
- При старте сервера: `rm -rf backend/src/uploads/*/audio/sessions/`.
- При `beforeunload` (Beacon, опционально): `navigator.sendBeacon` на `DELETE /session`.

---

## 6. Sidecar-задачи

### 6.1. Копирование и адаптация MVP

- Скопировать `acoustic_matcher.py` из `acoustic_matcher_open_source_mvp-2/` в `subsystems/audio-correction/service/src/acoustic_matcher.py` **без изменений**.
- Создать `web_service.py` — stateless HTTP-обёртку на Flask (или FastAPI):
  - **Убрать**: `SESSIONS`, `session_for()`, cookie-логику, `static/index.html`, публичные эндпоинты `/api/state`, `/api/reference`, `/api/targets`, `/audio`, `/api/export`.
  - **Добавить**: три внутренних эндпоинта `/internal/analyze`, `/internal/recommend`, `/internal/process`.
  - **Принцип**: sidecar получает абсолютные пути к файлам на общем volume, выполняет обработку, возвращает JSON-результат. Не хранит состояние, не управляет файлами.
  - Слушать `0.0.0.0:8080` внутри контейнера.

### 6.2. Эндпоинты sidecar

- `POST /internal/analyze`: принимает `{ reference_path }`, вызывает `analyze_file()`, возвращает `{ profile, metrics }`.
- `POST /internal/recommend`: принимает `{ reference_profile, target_metrics }`, вызывает `recommend_settings()`, возвращает `{ recommendations }`.
- `POST /internal/process`: принимает `{ reference_path, target_paths[], output_dir, options }`, вызывает `process_one()` для каждого target, собирает результаты, пишет `report.json` и `report.csv` в `output_dir`, возвращает `{ results[], report }`.

### 6.3. Dockerfile

- Базовый образ: `python:3.12-slim`.
- Установить `ffmpeg` через `apt-get`.
- `pip install` из `requirements.txt`: `numpy>=2.0,<3`, `scipy>=1.13,<2`, `flask>=3.0,<4`.
- Скопировать `src/` в `/app/src/`.
- CMD: `python -m src.web_service` или `python src/web_service.py --host 0.0.0.0 --port 8080`.

### 6.4. Docker Compose

- Сервис `audio-correction-sidecar`:
  - `build: ./subsystems/audio-correction/service`
  - **Без** маппинга портов на хост (или `127.0.0.1:8080:8080`).
  - Volume: `./backend/src/uploads:/app/uploads` (общий volume для файлов).
  - `restart: unless-stopped`.

---

## 7. Frontend-задачи

### 7.1. API-клиент (`frontend/src/api/audioCorrection.js`)

Методы:
- `getSession(projectId)` → GET
- `closeSession(projectId)` → DELETE
- `uploadReference(projectId, file)` → POST multipart
- `deleteReference(projectId)` → DELETE
- `analyzeReference(projectId)` → POST
- `uploadTargets(projectId, files)` → POST multipart
- `deleteTarget(projectId, targetIndex)` → DELETE
- `getSettings(projectId)` → GET
- `updateSettings(projectId, settings)` → PATCH
- `startProcessing(projectId)` → POST
- `cancelRun(projectId, runId)` → POST
- `getRunStatus(projectId, runId)` → GET
- `downloadFile(projectId, runId, targetIndex)` → GET (binary, через blob)
- `downloadReport(projectId, runId)` → GET (binary)
- `downloadAll(projectId, runId)` → GET (binary, ZIP)

Для multipart-загрузок использовать `fetch` напрямую (без `Content-Type: application/json`), как в существующем `createIssue`.

### 7.2. Маршрут в `App.jsx`

Добавить:
```jsx
<Route path="/projects/:projectId/audio-correction"
  element={<ProtectedRoute><Layout><AudioCorrectionPage /></Layout></ProtectedRoute>} />
```

### 7.3. Компонент `ProjectTabs` (вкладки проекта)

- Горизонтальные вкладки: «Замечания», «Корректор аудио-файлов», «Управление».
- Активная вкладка определяется по текущему маршруту.
- Вкладка «Управление» видна только admin/manager.
- Используется на `IssuesPage`, `AudioCorrectionPage`, `ProjectManagePage`.
- При переключении вкладки с audio-correction на другую —触发 navigation guard (см. §7.6).

### 7.4. `AudioCorrectionPage.jsx` — единый рабочий стол

Структура страницы (сверху вниз):
1. **Шапка**: `← Проекты`, название проекта, кнопка «Закрыть / Забыть».
2. **ProjectTabs**: активна «Корректор аудио-файлов».
3. **ReferenceUpload**: зона загрузки эталона.
4. **TargetsUpload**: зона загрузки целей + список файлов.
5. **SettingsPanel**: макро-ручки + продвинутые параметры + рекомендации.
6. **Кнопка «Запустить обработку»** + ProcessingStatus.
7. **ResultsPanel**: карточки результатов.

Логика:
- При монтировании: `GET /session`. Если 204 — пустое состояние. Если workspace — восстановить UI из данных сессии.
- Если текущий run в статусе `running` — запустить polling.
- При размонтировании (навигация): не очищать сессию (только при явном закрытии).

### 7.5. Компоненты

- **ReferenceUpload**: drag-and-drop зона, клиентская валидация (формат, 50 MB), нативный `<audio>` плеер после загрузки, кнопка удаления.
- **TargetsUpload**: drag-and-drop зона с `multiple`, список файлов с индикаторами, кнопка удаления у каждого.
- **SettingsPanel**: два макро-ползунка (дистанция, реверберация), кнопка «Сбросить макро», карточка рекомендаций, 6 свертываемых групп параметров (18 параметров из `ProcessingOptions`).
- **ProcessingStatus**: линейный прогресс-бар (% = обработано целей / всего целей), спиннер, кнопка «Отменить».
- **ResultsPanel**: карточка на каждую цель с:
  - Waveform-placeholder (декоративные вертикальные полоски).
  - Два `<audio>` плеера: исходник и результат.
  - Строка метрик: LUFS, True Peak, LRA, SNR, Spectral Distance (до/после).
  - Бейдж статуса цели.
  - Кнопки «Скачать исправленный» и «Скачать отчёт».
  - Общие кнопки: «Скачать все (ZIP)» и «Скачать полный отчёт».
- **CloseConfirmModal**: модальное окно с подтверждением, красная кнопка «Закрыть / Забыть». Если идёт обработка — текст кнопки «Остановить и забыть».

### 7.6. Navigation guards и защита от ухода

- `beforeunload`: показать стандартное браузерное предупреждение при наличии активных данных в сессии.
- React Router `useBlocker` (или `usePrompt`): при попытке навигации внутри SPA показать кастомное подтверждение. При подтверждении — `DELETE /session`, затем навигация. При отмене — остаться.
- Beacon (опционально): `navigator.sendBeacon` на `DELETE /session` при `visibilitychange` → `hidden`.

### 7.7. Обработка второй вкладки

- При монтировании `AudioCorrectionPage`: `GET /session`.
- Если сервер возвращает workspace с другим `created_at` (сессия уже существует) — показать предупреждение «Корректор уже открыт в другой вкладке».
- При согласии: продолжить работу с текущей сессией (сервер отдаёт актуальный workspace).
- Альтернатива: сервер при `GET /session` возвращает флаг `conflict: true`, если сессия была обновлена из другого источника.

### 7.8. Состояния UI

| Состояние | Поведение |
|-----------|-----------|
| Пустое (нет файлов) | Зоны drag-and-drop с иконками, кнопка «Запустить» disabled, результаты скрыты |
| Загрузка файлов | Спиннер в строке файла, зона disabled |
| Файлы загружены | Кнопка «Запустить» enabled, удаление доступно |
| Обработка | Прогресс-бар, кнопка «Запуск…» disabled, настройки read-only, удаление disabled |
| Результаты | Карточки результатов, плееры, метрики, кнопки скачивания |
| Частичный успех | Успешные цели с результатами, failed-цели с красным бейджем |
| Ошибка обработки | Красная плашка, кнопка «Повторить запуск» |
| Сессия утеряна | Пустое состояние `.empty` с текстом и кнопкой «Обновить страницу» |
| Polling-ошибка | Неблокирующий тост «Не удалось обновить статус» |

---

## 8. Безопасность и валидация

### 8.1. Аутентификация и авторизация

- Все эндпоинты модуля защищены `authMiddleware` (проверка cookie `session_id`).
- Каждый эндпоинт проверяет членство пользователя в проекте через `checkProjectAccess(projectId, userId, role)`.
- `projectId` извлекается из URL-параметра `:projectId` и резолвится через `resolveProjectId` (поддержка slug и ID).

### 8.2. Валидация файлов

- **Расширения**: `.wav`, `.flac`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.opus` (case-insensitive).
- **Размер**: максимум 50 MB на один файл (multer `limits.fileSize`).
- **Клиентская валидация**: проверка `file.type` и `file.size` до отправки.
- **Серверная валидация**: multer `fileFilter` + проверка размера.
- **MIME-type**: не полагаться на `Content-Type` клиента; проверять расширение.

### 8.3. Изоляция сессий

- Сессионная директория привязана к `session_id` из cookie.
- Пользователь не может получить доступ к чужой сессии: все эндпоинты проверяют, что workspace принадлежит текущему `session_id`.
- Скачивание файлов идёт через авторизованные эндпоинты Node, а не через открытый `/uploads/`.

### 8.4. Очистка

- `DELETE /session`: синхронное удаление директории + очистка in-memory workspace.
- Фоновый GC: каждые 5 минут, TTL 1 час.
- При старте сервера: удаление всех `audio/sessions/` директорий.
- Sidecar не хранит состояние и не отвечает за очистку.

### 8.5. Sidecar-безопасность

- Sidecar слушает только внутри Docker-сети, порт не публикуется на хост.
- Node передаёт sidecar только пути внутри общего volume, никогда — абсолютные пути хоста.
- Sidecar не имеет доступа к БД, cookie, пользовательским данным.

---

## 9. Edge cases для явной обработки

1. **Загрузка файла > 50 MB**: multer отклоняет, фронтенд показывает «Превышен максимальный размер 50 МБ».
2. **Загрузка неподдерживаемого формата**: multer `fileFilter` отклоняет, фронтенд показывает «Формат не поддерживается».
3. **Запуск обработки без эталона**: сервер возвращает 400 «Эталонная запись не загружена».
4. **Запуск обработки без целей**: сервер возвращает 400 «Нет целевых записей».
5. **Запуск обработки во время предыдущего run**: сервер отменяет предыдущий run, создаёт новый.
6. **Sidecar недоступен**: сервер возвращает 503 «Сервис обработки временно недоступен», run помечается как `failed`.
7. **Sidecar-таймаут (>5 мин)**: run помечается как `failed`, сообщение «Превышено время обработки».
8. **Частичный успех sidecar**: часть целей обработана, часть failed. Run = `partial`. UI показывает результаты для успешных.
9. **Удаление эталона при наличии целей**: сервер удаляет эталон, цели сохраняются, но кнопка «Запустить» disabled до загрузки нового эталона.
10. **Сессия истекла (TTL)**: `GET /session` возвращает 204. UI показывает пустое состояние «Сессия устарела».
11. **Потеря сессии при перезапуске сервера**: все `audio/sessions/` удаляются при старте. UI показывает «Сессия устарела».
12. **Две вкладки одновременно**: сервер отдаёт один workspace на `session_id`. Вторая вкладка видит те же данные. Предупреждение на фронтенде.
13. **Отмена run во время обработки**: Node помечает run как `cancelled`, игнорирует результаты sidecar по завершении. Файлы, уже записанные sidecar, удаляются.
14. **Попытка скачать файл из чужой сессии**: сервер проверяет `session_id` и `project_id`, возвращает 403.
15. **Повторный запуск обработки**: предыдущие выходные файлы (`outputs/{old_run_id}/`) удаляются при старте нового run.

---

## 10. Критерии готовности

### 10.1. Backend

- [ ] `GET /api/projects/:projectId/audio-correction/session` возвращает 204 для новой сессии и workspace для активной.
- [ ] `POST /session/reference` с валидным WAV-файлом ≤50MB возвращает 200 с метаданными эталона.
- [ ] `POST /session/reference` с файлом >50MB возвращает 413.
- [ ] `POST /session/reference` с `.exe` файлом возвращает 400.
- [ ] `POST /session/targets` с 3 файлами возвращает список из 3 целей.
- [ ] `DELETE /session/targets/1` удаляет вторую цель, список сокращается.
- [ ] `POST /session/process` без эталона возвращает 400.
- [ ] `POST /session/process` без целей возвращает 400.
- [ ] `POST /session/process` с эталоном и целями возвращает `run_id` и `status: 'running'`.
- [ ] `GET /session/runs/:runId` через N секунд возвращает `status: 'success'` с метриками.
- [ ] `GET /session/runs/:runId/download/0` возвращает аудиофайл.
- [ ] `GET /session/runs/:runId/download/all` возвращает ZIP.
- [ ] `DELETE /session` удаляет сессионную директорию и возвращает `{ ok: true }`.
- [ ] После `DELETE /session` повторный `GET /session` возвращает 204.
- [ ] Фоновый GC удаляет workspace с `last_activity_at` старше 1 часа.
- [ ] При старте сервера все `audio/sessions/` директории очищены.
- [ ] Запрос без cookie `session_id` возвращает 401.
- [ ] Запрос от не-участника проекта возвращает 403.

### 10.2. Sidecar

- [ ] `docker build` проходит без ошибок.
- [ ] `POST /internal/analyze` с путём к WAV возвращает профиль и метрики.
- [ ] `POST /internal/process` с эталоном и 2 целями возвращает 2 результата и отчёт.
- [ ] Sidecar не хранит состояние между запросами.
- [ ] Sidecar не доступен снаружи Docker-сети.

### 10.3. Frontend

- [ ] Маршрут `/projects/:projectId/audio-correction` рендерит рабочий стол.
- [ ] Вкладки проекта отображаются и переключаются.
- [ ] Drag-and-drop эталона загружает файл и отображает карточку.
- [ ] Drag-and-drop целей загружает несколько файлов и отображает список.
- [ ] Кнопка «Запустить обработку» disabled без эталона или целей.
- [ ] После запуска отображается прогресс-бар с polling каждые 2 сек.
- [ ] По завершении обработки отображаются карточки результатов с плеерами и метриками.
- [ ] Скачивание отдельных файлов, ZIP и отчёта работает.
- [ ] Кнопка «Закрыть / Забыть» показывает модальное подтверждение.
- [ ] После подтверждения сессия удаляется, пользователь перенаправляется на `/projects/:projectId`.
- [ ] `beforeunload` показывает предупреждение при наличии данных в сессии.
- [ ] Navigation guard блокирует переход на другую вкладку без подтверждения.
- [ ] Состояние «Сессия утеряна» отображается при 204 от сервера.
- [ ] Ошибки загрузки файлов отображаются inline.
- [ ] Ошибки обработки отображаются с кнопкой «Повторить».

### 10.4. Сборка

- [ ] `npm run build` (frontend) проходит без ошибок.
- [ ] `docker compose build` (sidecar) проходит без ошибок.
- [ ] Backend запускается без ошибок при недоступном sidecar (graceful degradation).

---

## 11. Что НЕ входит в скоуп

1. **Связь с замечаниями (issues)**: интеграция с модулем testing не реализуется.
2. **Отдельные роли для модуля**: используются существующие роли `project_members`.
3. **История обработок**: сохраняется только последний run; предыдущие результаты удаляются при новом запуске.
4. **Real-time прогресс (WebSocket)**: используется polling каждые 2 секунды.
5. **ML-рекомендации и автоматический выбор эталона**: используются готовые рекомендации из MVP.
6. **Видео и другие медиа**: только аудио.
7. **Проектные квоты хранилища**: только лимит 50 MB на файл.
8. **Совместный доступ к результатам**: результаты видны только в рамках текущей сессии.
9. **Восстановление сессии после перезапуска сервера**: все сессии удаляются при старте.
10. **PDF/HTML отчёты**: только JSON + CSV (как в MVP).
11. **Waveform-визуализация на основе реальных данных**: используется декоративный placeholder.
12. **Полноценная job-очередь (bull, faktory)**: асинхронный вызов sidecar через Promise/async.
13. **Масштабирование sidecar (несколько инстансов)**: один sidecar-контейнер.
14. **Мобильное приложение**: только адаптивная вёрстка.

---

## 12. Порядок выполнения (рекомендуемый)

1. **Python sidecar**: скопировать MVP, создать `web_service.py`, Dockerfile, проверить локально.
2. **Session Store**: реализовать `audioCorrectionSessionStore.js` с GC и очисткой при старте.
3. **Sidecar client**: реализовать `audioCorrection.js` с HTTP-вызовами к sidecar.
4. **Backend роутер**: реализовать `audio-correction.js` со всеми эндпоинтами.
5. **Регистрация в server.js**: подключить роутер.
6. **API-клиент frontend**: реализовать `audioCorrection.js`.
7. **ProjectTabs**: создать компонент вкладок, интегрировать в IssuesPage и ProjectManagePage.
8. **AudioCorrectionPage**: реализовать страницу с компонентами (ReferenceUpload, TargetsUpload, SettingsPanel, ProcessingStatus, ResultsPanel, CloseConfirmModal).
9. **Navigation guards**: beforeunload, useBlocker, Beacon.
10. **Docker Compose**: добавить sidecar в compose-файл.
11. **Тестирование**: проверить все критерии готовности из §10.

---

## 13. Риски и открытые вопросы

| Риск | Влияние | Митигация |
|------|---------|-----------|
| Sidecar недоступен при старте backend | Backend не может обрабатывать аудио | Graceful degradation: 503 на `/process`, остальные эндпоинты работают |
| Большие файлы (50MB × N) заполняют диск | Нехватка места | Мониторинг диска; GC каждые 5 мин; TTL 1 час |
| Потеря in-memory state при перезапуске Node | Пользователь теряет данные | Очистка всех `audio/sessions/` при старте; UI показывает «Сессия устарела» |
| Sidecar-обработка >5 минут | Таймаут | Увеличить таймаут или разбить batch на отдельные вызовы |
| Две вкладки с одной сессией | Конфликт состояния | Один workspace на session_id; предупреждение на фронтенде |
| `archiver` для ZIP не установлен | Скачивание ZIP не работает | Добавить `archiver` в `package.json` backend |
| Flask vs FastAPI для sidecar | Выбор фреймворка | Flask — проще, меньше зависимостей; FastAPI — async, автодокументация. Рекомендуется Flask для минимализма |
