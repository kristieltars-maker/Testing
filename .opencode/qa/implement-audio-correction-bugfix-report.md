# QA-отчёт (round 2): подсистема `audio-correction` после багфиксов

**Дата:** 2026-09-14
**Область:** `subsystems/audio-correction/`, backend Express-роутер/сервисы, frontend рабочий стол
**План:** `.opencode/plans/implement-audio-correction.md`
**Архитектура:** `.opencode/architecture/audio-correction.md`
**Предыдущий отчёт:** `.opencode/qa/implement-audio-correction-report.md` (BUG-1..BUG-6)

> Продуктовый код не изменялся. Добавлен только один тестовый файл:
> `backend/src/routes/audio-correction.bugfix.test.js` (9 тестов).
> Временный security-probe запускался и удалён.

---

## 0. Итоговый вердикт

| Проверка | Результат |
|---|---|
| Backend `npm test` | ✅ **62 / 62** (было 53, +9 новых) |
| Frontend `npm run lint` | ✅ 0 errors, 17 warnings (все pre-existing, не из `AudioCorrection/**`) |
| Frontend `npm run build` | ✅ built in 187ms, 53 modules |
| `py_compile` sidecar | ✅ `web_service.py`, `acoustic_matcher.py` |
| `acoustic_matcher.py` byte-identical MVP | ✅ SHA256 совпадает |
| BUG-1 flat options | ✅ подтверждено (unit + integration) |
| BUG-2 `session_id` не утекает, preview endpoints | ✅ подтверждено (+ новый фокусный тест) |
| BUG-3 обогащённые метрики | ✅ подтверждено (новый фокусный тест) |
| BUG-4 `checkHealth` → `/health` + `response.ok` | ✅ подтверждено (+ интеграционный 503) |
| BUG-5 unknown `advanced` key → 400 | ✅ подтверждено |
| BUG-6 ZIP indexed + `report.csv`/`acoustic_profile.json` | ✅ подтверждено |
| Reverse path mapping | ✅ подтверждено (Suite 3) |
| compose `127.0.0.1:8080:8080` | ✅ |
| frontend без `/uploads/...` и `session.session_id` | ✅ (grep: 0 совпадений) |
| **Общий вердикт** | ⚠️ **Условно принято:** все 6 багов закрыты, но найден **новый High** — обход guard `/uploads` через percent-encoded слэши (см. BUG-7). |

---

## 1. Автотесты

### 1.1. Запуск существующего набора

```
backend> npm test
ℹ tests 62   ℹ pass 62   ℹ fail 0
```

Пройдены 3 исходных файла + новый:
- `src/routes/audio-correction.integration.test.js` — 31
- `src/services/audioCorrection.test.js` — 13
- `src/services/audioCorrectionSessionStore.test.js` — 9
- `src/routes/audio-correction.bugfix.test.js` — **9 (новый)**

### 1.2. Новый файл `audio-correction.bugfix.test.js`

| # | Тест | Результат |
|---|---|---|
| 1 | BUG-2: workspace JSON не содержит `sessionId`/`session_id`, содержит `audio_url` | ✅ |
| 2 | BUG-2: preview endpoints отдают файлы владельцу (`reference`, `targets/0`) | ✅ |
| 3 | BUG-2: preview endpoints → **403** для не-участника проекта | ✅ |
| 4 | BUG-2: preview endpoints → **404** для участника с пустой/чужой сессией | ✅ |
| 5 | BUG-4: sidecar без `/`, но с живым `/health` — доступен, `process` → `success` | ✅ |
| 6 | BUG-1: тело запроса к sidecar — только плоские `ProcessingOptions` (нет `macros`/`advanced`) | ✅ |
| 7 | BUG-3: `before/after_true_peak_dbfs`, `before/after_lra_lu`, `before/after_snr_db` и вложенные `before`/`after` доходят до run-ответа | ✅ |
| 8 | BUG-4: не-2xx `/health` → `POST /process` = **503**, run `failed` | ✅ |
| 9 | BUG-6: ZIP содержит индексированный corrected-файл + `report.json`/`report.csv`/`acoustic_profile.json` | ✅ |

---

## 2. Детальная верификация исправлений (по одному)

### BUG-1 (High) — форма `options` для sidecar — ЗАКРЫТ ✅

- `audioCorrection.js:71-78` — `settingsToOptions()` возвращает плоский `{...advanced}`, `macros` игнорируется.
- `audioCorrection.js:174` — `options: settingsToOptions(options)`.
- Проверено: unit-тест `processBatch flattens stored {macros, advanced} settings to options`; интеграционный тест `strict sidecar accepts flat options`; новый тест #6 (`deepEqual` ровно `{eq_strength, room_strength}`).
- Дополнительно проверено, что фронтенд действительно материализует макро-ручки в `advanced`:
  `SettingsPanel.applyMacros` (`SettingsPanel.jsx:53-61`) и `recommendationsToSettings` (`utils.js:120-136`, берёт числовые поля из `recommend_settings`, которые уже включают `distance`/`reverb`-производные). Потери макро-настроек при фиксе нет.

### BUG-2 (Medium) — `session_id` и воспроизведение исходников — ЗАКРЫТ ✅

- `audio-correction.js:111-127` — `serializeWorkspace` не отдаёт id сессии, добавляет `audio_url` для reference и каждой цели.
- `audio-correction.js:308-319, 371-384` — авторизованные preview endpoints через `currentWorkspace(req)` (owner-only).
- `server.js:43` — `req.sessionId` из `middleware/auth.js:42`.
- Frontend: grep по `frontend/src` — **0** упоминаний `/uploads` и `session.session_id`; `resolveAudioUrl` (`api/audioCorrection.js:7-17`) читает `audio_url`; `ReferenceUpload`/`TargetsUpload`/`ResultsPanel` используют его.
- Новые тесты #1-#4 подтверждают: владелец 200, не-участник 403, чужая/пустая сессия 404.

### BUG-3 (Medium) — True Peak / LRA / SNR — ЗАКРЫТ ✅

- `web_service.py:118-140` — `_enrich_row` добавляет `before/after_true_peak_dbfs`, `before/after_lra_lu`, `before/after_snr_db` и вложенные `before`/`after`; best-effort (ошибка обогащения не валит цель).
- `frontend/src/pages/AudioCorrection/utils.js:89-106` — `extractMetrics` терпимо читает и плоские, и вложенные ключи.
- Новый тест #7: mock sidecar возвращает обогащённые метрики → `run.targets[0].metrics` содержит все 6 новых плоских ключей и вложенные объекты.

### BUG-4 (Low) — health-проба — ЗАКРЫТ ✅

- `audioCorrection.js:136-147` — `fetch(`${SIDECAR_URL}/health`)`, возвращает `response.ok`.
- Unit-тест: `/health` 200 → `true`, `/health` 503 → `false`, путь ровно `/health`; корень `/` (404) больше не используется.
- Новый тест #8: `/health` = 503 → `POST /session/process` = 503, run `failed`.
- Новый тест #5: sidecar без `/` работает.

### BUG-5 (Low) — валидация `advanced` — ЗАКРЫТ ✅

- `audio-correction.js:391-403` — неизвестные ключи `advanced` → 400 со списком.
- Интеграционный тест `PATCH settings with unknown advanced key -> 400`; единый источник — `PROCESSING_OPTION_FIELDS` (18 ключей, `audioCorrection.js:17-36`).

### BUG-6 (Low) — состав/имена ZIP — ЗАКРЫТ ✅

- `audio-correction.js:557-573` — entry `corrected/{index+1}-{base}{ext}` (индекс исключает коллизии), плюс `report.json`, `report.csv`, `acoustic_profile.json` при наличии.
- Интеграционный тест + новый тест #9.

### Reverse path mapping — ЗАКРЫТ ✅

- `audioCorrection.js:58-66` (`fromSidecarPath`) + `audio-correction.js:225-229` (`finalizeRun`).
- Suite 3: при `AUDIO_SIDECAR_UPLOADS_ROOT=/app/uploads` исходящие пути переписаны, `output_path` обратно — `outputs/{runId}/matched_001.wav` без `..`, скачивание 200.

---

## 3. P0/P1 интеграционные проверки

| Проверка | Результат |
|---|---|
| compose: `ports: 127.0.0.1:8080:8080`, volume `./backend/src/uploads:/app/uploads` | ✅ `docker-compose.yml:4-7` |
| Sidecar host-run backend reachable (`AUDIO_SIDECAR_URL` default `http://127.0.0.1:8080`) | ✅ README:50-55, 101; порт на loopback |
| `AUDIO_SIDECAR_UPLOADS_ROOT=/app/uploads` задокументирован для compose-варианта | ✅ README:102, 104-113 |
| frontend не ссылается на `/uploads/...` | ✅ grep 0 совпадений |
| frontend не использует `session.session_id` | ✅ grep 0 совпадений |
| End-to-end flow (empty → ref → analyze → targets → settings → process → poll → downloads → close → 204) | ✅ Suite 1 проходит целиком |

---

## 4. Новые / оставшиеся баги

### 🟠 BUG-7 (High, NEW) — обход guard `/uploads` через percent-encoded слэши

- **Файлы/строки:** `backend/src/server.js:28-35` (regex — строка 30).
- **Суть:** guard проверяет `req.path`, который **не декодируется** Express, а `express.static` (`serve-static`/`send`) декодирует `%2F` перед поиском файла. Поэтому литеральный `/audio/sessions/` блокируется, а `%2F` — нет.
- **Влияние:** сессионные аудиофайлы (эталон, цели, исправленные) доступны **без аутентификации** по публичному `/uploads`, что нарушает план §3.2/§8.3 («скачивание только через авторизованные эндпоинты Node, а не через открытый `/uploads/`»). Также это подрывает всю защиту, ради которой вводились preview-эндпоинты BUG-2.
- **Воспроизведение (проверено на минимальной копии middleware + express.static):**
  ```
  403  /uploads/p/audio/sessions/s1/reference/secret.wav          # guard работает
  200  /uploads/p/audio%2Fsessions/s1/reference/secret.wav        # обход -> TOP-SECRET
  200  /uploads/p/audio%2fsessions/s1/reference/secret.wav        # обход (case)
  200  /uploads/p/audio/sessions%2Fs1%2Freference%2Fsecret.wav   # обход (хвост)
  ```
- **Минимальный фикс (описание, продукт не менялся):** нормализовать/декодировать путь перед regex:
  `const path = decodeURIComponent(req.path).replace(/\\/g, '/');` с обработкой `URIError`, либо запретить статику для сессионных каталогов иначе (например, отдавать `uploads` через явный allow-list только для `issues`). Один `decodeURIComponent` закрывает все три варианта.
- **Severity обоснование:** утечка пользовательских файлов без авторизации; проект/сессию можно получить из URL/логов, а `session_id` теперь не публикуется, но остаётся в cookie и в путях.

### 🟡 BUG-8 (Low, NEW/observation) — дефолт `duplicate_passthrough` не совпадает с UI

- **Файлы/строки:** `frontend/src/constants/audioCorrection.js:125` (`default: 0` → чекбокс снят) против `subsystems/audio-correction/service/src/acoustic_matcher.py:52` (`duplicate_passthrough: bool = True`).
- **Суть:** если пользователь не трогает параметр, backend отправляет `advanced = {}`, sidecar применяет `True` (пропускать идентичные эталону цели), а UI показывает «Пропускать файлы, идентичные эталону» снятым.
- **Влияние:** поведение обработки не соответствует отображаемому UI-состоянию. Не критично (цели редко байт-в-байт равны эталону).
- **Фикс:** привести дефолт UI к `1` (checked) или явно передавать `duplicate_passthrough: 0` по умолчанию.

### 🟡 Наблюдение (вне scope модуля, pre-existing) — SQL-инъекция через cookie

- `backend/src/middleware/auth.js:11-17` — `session_id` подставляется в SQL интерполяцией. Переносится из предыдущего отчёта, к `audio-correction` не относится, но устранение желательно.

### ℹ️ Незначительное (информационно)

- `GET /session` (`audio-correction.js:265-272`) считает workspace пустым, даже если в нём есть только `settings` (без файлов/run) → 204. После перезагрузки UI покажет дефолтные настройки, хотя PATCH-значения сохранены на сервере. Не влияет на обработку (при загрузке файлов workspace возвращается). Осознанный компромисс в рамках фикса «empty-workspace 204».
- `ResultsPanel` кнопка «Скачать отчёт» у цели скачивает общий `report.json` запуска, а не отчёт по конкретной цели (перенесённая UX-неточность, не баг).
- `ProcessingStatus.jsx:19` — `indeterminate` всегда `true`, т.к. компонент рендерится только при `run.status === 'running'`; ветка точного процента недостижима. Соответствует заявленному «honest indeterminate progress».

---

## 5. Изменённые/добавленные файлы QA

- `backend/src/routes/audio-correction.bugfix.test.js` — **новый** (9 тестов).
- `.opencode/qa/implement-audio-correction-bugfix-report.md` — этот отчёт.

> Продуктовый код не изменялся. Временный probe-файл `backend/__probe_uploads_guard.test.js` удалён.

---

## 6. Рекомендации по приоритету

1. **BUG-7 (High)** — закрыть обход guard `/uploads` (`decodeURIComponent(req.path)` перед проверкой). До фикса считать изоляцию сессионных файлов нарушенной.
2. **BUG-8 (Low)** — синхронизировать дефолт `duplicate_passthrough` UI/sidecar.
3. SQL-инъекция в `auth.js` (pre-existing) — вне scope, но стоит исправить параметризацией.
