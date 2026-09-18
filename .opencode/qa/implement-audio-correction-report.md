# QA-отчёт: подсистема `audio-correction`

**Дата:** 2026-09-14
**Область:** sidecar `subsystems/audio-correction/`, backend Express-роутер/сервисы, frontend рабочий стол
**План:** `.opencode/plans/implement-audio-correction.md` (§9 edge cases, §10 критерии готовности)
**Архитектура:** `.opencode/architecture/audio-correction.md`

---

## 0. Итоги

| Показатель | Значение |
|---|---|
| Статические проверки | ✅ `node --check` × 8, `py_compile` × 2, frontend `lint` 0 errors, `build` OK |
| Написано тестов | 3 файла, **43 теста** (2 unit + 1 интеграционный с mock sidecar) |
| Пройдено | **43 / 43** ✅ |
| Найдено багов | **1 High, 1 Medium, 4 Low** (см. §5) |
| Несоответствий контрактов | 2 критичных (options, health) + 1 UI (metrics) |
| Заблокировано | Реальный sidecar/Docker, UI-тесты (см. §7) |

> Docker в окружении отсутствует; `flask`, `numpy`, `scipy` не установлены (`ModuleNotFoundError: No module named 'flask'`). Реальный sidecar не запускался. Все backend-тесты выполнены с **mock sidecar**, реализующим контракт из `web_service.py` (включая строгую валидацию `options`).

---

## 1. Статическая верификация

| Проверка | Команда | Результат |
|---|---|---|
| Backend syntax | `node --check` для `routes/audio-correction.js`, `services/audioCorrection.js`, `services/audioCorrectionSessionStore.js`, `utils/projectAccess.js`, `server.js`, `middleware/auth.js`, `routes/auth.js`, `routes/issues.js` | ✅ OK × 8 |
| Frontend lint | `npm run lint` (oxlint) | ✅ 0 errors, 17 warnings (все — pre-existing, новых от `AudioCorrection/**` нет) |
| Frontend build | `npm run build` (vite) | ✅ built in 197ms, 53 modules |
| Python syntax | `python -m py_compile web_service.py acoustic_matcher.py` | ✅ OK |
| `npm test` | backend / frontend | ❌ `Missing script: "test"` — в проекте нет test-скрипта и раннера (см. §6, заметка 1) |

---

## 2. Контракт backend ↔ sidecar (`web_service.py`)

Сверка построчно, плюс проверка mock-сервером.

| Эндпоинт | Что шлёт backend | Что ждёт sidecar | Статус |
|---|---|---|---|
| `POST /internal/analyze` | `{ reference_path }` (`audioCorrection.js:102`) | `reference_path` (`web_service.py:125`) | ✅ совпадает |
| `POST /internal/recommend` | `{ reference_profile, target_metrics }` (`:112`) | те же поля (`:135`) | ✅ совпадает |
| `POST /internal/process` | `{ reference_path, target_paths[], output_dir, options }` (`:122`) | те же поля (`:147-162`) | ⚠️ **`options` несовместим** |
| `GET /health` | backend вызывает `GET /` (`:92`) | sidecar публикует `/health` (`:117`) | ⚠️ **путь не совпадает** |
| `{ profile, metrics }` (analyze) | читает `data.profile`, `data.metrics` | отдаёт `profile`, `metrics` | ✅ |
| `{ recommendations }` | читает `data.recommendations` | отдаёт `recommendations` | ✅ |
| `{ results[], report }` (process) | `normalizeResult` понимает `metrics_json\|metrics`, `output_path\|output_file`, `status` | отдаёт `metrics` (row), `output_path`, `status` | ✅ |
| Коды ошибок | 504 timeout / 503 unavailable / 502 прочее (`audio-correction.js:143-151`) | 400 bad input / 500 error | ✅ по смыслу |

### 2.1. 🔴 `options` — несовместимая форма (High)

- Backend формирует настройки как `{ macros: {...}, advanced: {...} }`:
  - `audioCorrectionSessionStore.js:14-22` (`createDefaultSettings`),
  - `routes/audio-correction.js:330-348` (PATCH пишет `settings.macros` / `settings.advanced`),
  - `routes/audio-correction.js:381` (`settings_snapshot`), `:412` (`processBatch(..., run.settings_snapshot)`),
  - `services/audioCorrection.js:121-127` кладёт объект как есть в поле `options`.
- Sidecar `web_service.py:82-89` отвергает **любые** неизвестные поля: `set(raw) - _OPTION_FIELDS` → `macros` и `advanced` не входят в `ProcessingOptions` → `400 Unknown option(s): advanced, macros`.
- Следствие: **с реальным sidecar любой запуск обработки завершается 400 → backend отдаёт 502 и помечает run как `failed`.**

Интеграционный тест `strict sidecar rejects {macros, advanced} options -> run failed` воспроизводит это поведение и проходит (т.е. баг подтверждён на уровне контракта). Текущий успешный прогон возможен только потому, что mock принимает вложенный объект.

**Минимальный фикс (описание, продукт не менялся):** в `services/audioCorrection.js` (или перед вызовом `processBatch`) разворачивать `options.advanced` в плоский объект полей `ProcessingOptions` и отбрасывать `macros` (макро-ручки уже материализованы фронтендом в `advanced` через `MACRO_ADVANCED`), либо научить sidecar принимать `{macros, advanced}` и применять `distance_macro_settings`/`reverb_macro_settings`. Предпочтительно — первый вариант, т.к. `README.md:37` прямо описывает `options` как произвольное подмножество полей `ProcessingOptions`.

### 2.2. 🟡 `checkHealth` стучится в `/` вместо `/health` (Low)

`services/audioCorrection.js:92` делает `GET ${SIDECAR_URL}/`. Sidecar отдаёт `404` на `/`. `fetch` не считает 404 ошибкой, поэтому `checkHealth()` возвращает `true` для любого отвечающего процесса, даже если health-эндпоинт сломан. Функционально превращается в «TCP reachable»-проверку. Тест `checkHealth returns true for reachable service, even on wrong route (/)` фиксирует это. **Фикс:** `fetch(`${SIDECAR_URL}/health`)` и проверять `response.ok`.

### 2.3. 🟡 Метрики результата: sidecar не отдаёт True Peak / LRA / SNR (Medium, UI)

Frontend `AudioCorrection/utils.js:89-106` (`extractMetrics`) ждёт ключи `before_true_peak_dbfs`, `before_lra_lu`, `before_snr_db` (и `after_*`), а также `before/after_spectral_distance_db` и LUFS. Реальный `process_one` (`acoustic_matcher.py:746-772`) возвращает только:
`input`, `output`, `status`, `before_lufs`, `after_lufs`, `target_lufs`, `before_spectral_distance_db`, `after_spectral_distance_db`, `eq_mean_correction_db`, `applied_*`, `added_noise_dbfs`, `manual_*`.

Для True Peak / LRA / SNR соответствующих ключей нет → в карточках результатов они всегда будут отображаться как `—` (план §7.5 и architecture §7.1 требуют их наличие). Backend (`finalizeRun`) просто сохраняет `match.metrics` без обогащения. **Фикс:** добавить в `process_one` вычисление `before/after_true_peak_dbfs`, `before/after_lra_lu`, `before/after_snr_db` (данные есть в `measure_loudness` и `frame_analysis`), либо изменить фронтенд `extractMetrics` под фактическую схему.

---

## 3. Интеграционные тесты backend (mock sidecar)

Файл: `backend/src/routes/audio-correction.integration.test.js`.
Инфраструктура: отдельная временная БД (`DB_PATH`), spawn `node src/server.js`, mock HTTP sidecar на случайном порту, вход admin/`admin123` из `seed.js`, создание второго пользователя и проекта через API.

### 3.1. Сессия, доступ, загрузки

| # | Проверка | Ожидание | Результат |
|---|---|---|---|
| 1 | `GET /session` без cookie `session_id` | 401 | ✅ |
| 2 | `GET /session` не-участником проекта | 403 | ✅ |
| 3 | `GET /session` новая сессия | 204 | ✅ |
| 4 | `POST /session/reference` валидный WAV | 200 + метаданные, файл на диске | ✅ |
| 5 | `POST /session/reference` `.exe` | 400 «Формат не поддерживается» | ✅ |
| 6 | `POST /session/reference` файл 51 МБ | 413 | ✅ |
| 7 | `POST /session/targets` 2 файла | 200, список из 2 | ✅ |
| 8 | `DELETE /session/targets/0` | 200, первый удалён, остался второй | ✅ |
| 9 | `DELETE /session/reference` при наличии целей | 200, эталон null, цели сохранены, файл удалён; повторная загрузка эталона | ✅ |
| 10 | `GET/PATCH /session/settings` | валидные макросы применяются, невалидные игнорируются, `advanced` мёржится | ✅ |
| 11 | `POST /session/process` без эталона | 400 | ✅ |
| 12 | `POST /session/process` без целей | 400 | ✅ |

### 3.2. Обработка и результаты

| # | Проверка | Ожидание | Результат |
|---|---|---|---|
| 13 | `POST /process` | 200 `{run_id, status:'running'}` | ✅ |
| 14 | polling `GET /runs/:runId` (success) | `status:'success'`, метрики, отчёт | ✅ |
| 15 | `download/0` | 200 + корректный audio-контент | ✅ |
| 16 | `download/report` | 200 `application/json` | ✅ |
| 17 | `download/all` | 200 `application/zip`, магия `PK`, внутри `report.json` и `corrected/target-2.wav` | ✅ |
| 18 | partial mock | `status:'partial'`, успешная + failed цель с ошибкой | ✅ |
| 19 | all-failure mock | `status:'failed'`, `error_message`, `download/0` → 404 | ✅ |
| 20 | отмена во время run (slow mock) | `status:'cancelled'`, не перетирается завершением sidecar | ✅ |
| 21 | повторный запуск (§9.15) | в `outputs/` остаётся только текущий `run_id` | ✅ |

### 3.3. Гарантии очистки / окружения

| # | Проверка | Ожидание | Результат |
|---|---|---|---|
| 22 | Очистка при старте | пре-созданная `uploads/__qa_cleanup_proj__/audio/sessions/` удалена | ✅ |
| 23 | `DELETE /session` | 200, сессионная директория удалена, повторный `GET` → 204 | ✅ |
| 24 | Sidecar недоступен (`AUDIO_SIDECAR_URL` в закрытый порт) | `POST /process` → 503, run `failed`, цели `failed` | ✅ |
| 25 | `AUDIO_SIDECAR_UPLOADS_ROOT` | исходящие `reference_path`/`output_dir`/`target_paths` переписаны в mount | ✅ |

**О наблюдении #25:** обратного пересчёта путей нет. `finalizeRun` (`audio-correction.js:194-199`) берёт `output_path` из ответа sidecar (`/mnt/...`). В тесте `run.targets[0].output_path` содержит `..` (путь «выпадает» из сессионной директории), но `path.join` на том же диске нормализует его, поэтому скачивание работает. На разных дисках/в контейнере с другим root это сломает скачивание. См. §5, Low.

---

## 4. Unit-тесты

### 4.1. `backend/src/services/audioCorrection.test.js` (10 тестов, ✅)

- `analyzeReference` — тело запроса и маппинг ответа.
- `getRecommendations` — `{reference_profile, target_metrics}`.
- `processBatch` — перезапись путей, нормализация `metrics_json`/`metrics`, `output_path`/`output_file`, failed-статус, `reportPath`.
- Ошибки: HTTP 400 → `SidecarError SIDECAR_ERROR`; невалидный JSON → `SIDECAR_ERROR`; недоступность → `SIDECAR_UNAVAILABLE`.
- `checkHealth` — `/` (документирует несоответствие §2.2).
- `toSidecarPath` — нормализация слэшей и перезапись при `AUDIO_SIDECAR_UPLOADS_ROOT`.

### 4.2. `backend/src/services/audioCorrectionSessionStore.test.js` (9 тестов, ✅)

- `createDefaultSettings`, `getOrCreate` (создание/повтор/смена проекта), `updateActivity`, `remove` (удаление директории), `deleteOnSessionDestroyed`, `getSessionDir`, `cleanupOnStartup` (удаляет только `audio/sessions`, не трогает прочие uploads).

### 4.3. Как запускать

```powershell
# в backend/ (в package.json скрипта test нет — используется встроенный раннер Node)
node --test src/services/audioCorrectionSessionStore.test.js `
           src/services/audioCorrection.test.js `
           src/routes/audio-correction.integration.test.js
```

---

## 5. Найденные баги

### BUG-1 (High) — `options` для sidecar имеет неверную форму

- **Файлы/строки:** `backend/src/routes/audio-correction.js:381,412`; `backend/src/services/audioCorrection.js:121-127`; `backend/src/services/audioCorrectionSessionStore.js:14-22`; `subsystems/audio-correction/service/src/web_service.py:82-93`.
- **Причина:** настройки хранятся как `{macros, advanced}`, а `ProcessingOptions` ожидает плоский набор полей.
- **Воспроизведение:** `POST /session/process` с валидным эталоном/целями против реального sidecar → sidecar 400 `Unknown option(s): advanced, macros` → backend 502 → run `failed`. Интеграционный тест «strict sidecar...» проходит.
- **Минимальный фикс:** передавать `{...settings.advanced}` (развёрнутый плоско), не включая `macros`.

### BUG-2 (Medium) — фронтенд не получает `session_id`

- **Файлы/строки:** `backend/src/routes/audio-correction.js:99-109` (`serializeWorkspace` не отдаёт id сессии); `frontend/src/pages/AudioCorrection/AudioCorrectionPage.jsx:421,432,481` (`session.session_id`); `frontend/src/api/audioCorrection.js:146-157` (`sessionFileUrl`).
- **Следствие:** после перезагрузки страницы (object URL не восстанавливаются) плееры исходника эталона/целей не получают URL, т.к. `sessionId` = `undefined`, а backend отдаёт `stored_path` без префикса `/uploads/...`. Плеер обработанного файла работает (идёт через `runDownloadUrl`).
- **Воспроизведение:** тест `GET /session returns active workspace` подтверждает `workspace.sessionId === undefined` (и `session_id` в ответе отсутствует).
- **Минимальный фикс:** добавить `session_id: workspace.sessionId` в `serializeWorkspace` (фронтенд уже читает snake_case).

### BUG-3 (Medium) — метрики True Peak / LRA / SNR всегда `—`

- **Файлы/строки:** `subsystems/audio-correction/service/src/acoustic_matcher.py:746-772`; `frontend/src/pages/AudioCorrection/utils.js:89-106`; `backend/src/routes/audio-correction.js:193`.
- См. §2.3.

### BUG-4 (Low) — `checkHealth` проверяет не тот путь

- `backend/src/services/audioCorrection.js:92`. См. §2.2.

### BUG-5 (Low) — `advanced` не валидируется сервером

- `backend/src/routes/audio-correction.js:342-344` безусловно мёржит любые ключи `advanced`. С реальным sidecar неизвестный ключ уронит процесс (§2.1). Стоит ограничить набор 18 параметрами `ProcessingOptions`.

### BUG-6 (Low) — ZIP-имена и состав архива

- `backend/src/routes/audio-correction.js:490,493-495`: имя entry строится из `original_name` без индекса → две цели с одинаковым именем затрут друг друга в ZIP. Также в ZIP не попадают `report.csv` и `acoustic_profile.json`, которые sidecar пишет в `output_dir` (план §3.5 говорит «всеми выходными файлами и отчётами»).

### Наблюдение (не баг модуля) — SQL-инъекция через cookie

- `backend/src/middleware/auth.js:11-17` подставляет `session_id` из cookie в SQL через интерполяцию. Проблема pre-existing, вне scope `audio-correction`, но стоит зафиксировать.

---

## 6. Прочие заметки

1. **Нет `npm test`.** Ни в `backend/package.json`, ни в `frontend/package.json` нет скрипта `test` и раннера. Тесты написаны на встроенном `node:test` и запускаются `node --test`. Рекомендуется добавить `"test": "node --test"` в backend.
2. **Метаданные файлов** (`duration_ms`, `sample_rate`, `channels`, `bit_depth`) в `buildFileMeta` всегда `null`; sidecar их не возвращает при analyze, а Node не заполняет. UI просто скрывает эти поля. Не критично.
3. **`download/report` per-target** в UI (`ResultsPanel.jsx:179-186`) фактически скачивает общий отчёт запуска, а не отчёт по конкретной цели. UX-неточность.
4. **`GET /session/settings` и `PATCH`** вызывают `getOrCreate`, т.е. создают пустой workspace без файлов. Безвредно.
5. **`CORS` не экспонирует `Content-Disposition`**, поэтому имя скачиваемого файла на клиенте берётся из fallback (`api/audioCorrection.js:41-49`). Не баг.

---

## 7. Edge cases из плана §9 — покрытие

| # | Edge case | Статус |
|---|---|---|
| 1 | Файл > 50 МБ → 413 + сообщение | ✅ автотест |
| 2 | Неподдерживаемый формат → 400 | ✅ автотест |
| 3 | Запуск без эталона → 400 | ✅ автотест |
| 4 | Запуск без целей → 400 | ✅ автотест |
| 5 | Запуск во время предыдущего run (авто-отмена) | ⚠️ не проверено напрямую: старый run становится недоступен через API (workspace.run заменяется). Отмена покрыта edge #13 |
| 6 | Sidecar недоступен → 503, run failed | ✅ автотест |
| 7 | Sidecar-таймаут > 5 мин | ⛔ blocked: `REQUEST_TIMEOUT_MS` = 5 мин, ждать нецелесообразно; нужна инъекция таймаута |
| 8 | Частичный успех → partial | ✅ автотест |
| 9 | Удаление эталона при целях | ✅ автотест |
| 10 | TTL сессии (1 час) → 204 | ⛔ blocked: GC-интервал 5 мин/TTL 1 ч, не тестируется быстро; функция `remove` покрыта unit-тестом |
| 11 | Потеря сессии при перезапуске | ✅ частично: очистка `audio/sessions` при старте проверена; повторный `GET` после отключения in-memory store не проверялся |
| 12 | Две вкладки | ⛔ blocked: требует реального браузера/Storage events |
| 13 | Отмена run | ✅ автотест |
| 14 | Скачивание из чужой сессии | ✅ частично: не-участник → 403; подмена `run_id` → 404 (логика `currentWorkspace`) |
| 15 | Повторный запуск удаляет старые outputs | ✅ автотест |

---

## 8. Заблокированные проверки

| Область | Причина | Что нужно |
|---|---|---|
| Реальный sidecar | Нет Docker; `flask`, `numpy`, `scipy` не установлены | `docker compose up --build audio-correction-sidecar` или pip-окружение с FFmpeg |
| `docker build` / `docker compose build` (§10.2, §10.4) | Docker CLI отсутствует | Docker-окружение |
| `/internal/analyze`, `/internal/process` на реальном алгоритме (§10.2) | см. выше | sidecar |
| Frontend UI/UX (§10.3): drag-and-drop, плееры, прогресс-бар, модалка, navigation guard, beforeunload, конфликт вкладок, отображение сессии-утерянной | Нет браузерного/e2e раннера (Playwright и т.п.) | e2e-стек |
| Edge cases §9.5, 9.7, 9.10, 9.12 | См. §7 | Инъекция таймера/TTL, браузер |
| `acoustic_matcher_open_source_mvp-2/tests/smoke_test.py` (pre-existing MVP smoke test) | Нет `numpy`/`scipy`/`ffmpeg` и файла `demo_reference.wav` | Python-окружение MVP. К новому sidecar напрямую не относится (sidecar использует свою копию `acoustic_matcher.py`) |

---

## 9. Изменённые/добавленные файлы QA

- `backend/src/services/audioCorrectionSessionStore.test.js` — новый.
- `backend/src/services/audioCorrection.test.js` — новый.
- `backend/src/routes/audio-correction.integration.test.js` — новый.
- `.opencode/qa/implement-audio-correction-report.md` — этот отчёт.

> Продуктовый код не изменялся. Временные БД и файлы создавались во временных директориях (`%TEMP%\ac-qa-*`); тестовые upload-директории удалены. Запущенные в тестах backend-процессы завершаются в `after()`; слушателей на тестовых портах не осталось.

---

## 10. Рекомендации по приоритету

1. **BUG-1** — иначе подсистема не работает с реальным sidecar (High).
2. **BUG-2** — восстановление UI после перезагрузки (Medium).
3. **BUG-3** — дополнить метрики (Medium, продуктовая полнота).
4. **BUG-4/5/6** — устойчивость и корректность (Low).
5. Добавить `"test": "node --test"` в `backend/package.json`, чтобы `npm test` из плана работал.
