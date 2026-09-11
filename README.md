# Тестирование ботов

Веб-приложение для коммуникации тестировщика и скриптолога в процессе тестирования ботов, настроенных на платформе ТВИН. Заменяет Google Таблицы и мессенджеры структурированным трекингом замечаний со скриншотами и статусами.

## Возможности

- **Аутентификация** — вход по email/паролю, серверные сессии в httpOnly cookie, bcrypt-хеширование паролей, rate limiting (5 попыток за 15 минут).
- **Роли** — admin, tester, developer с разными правами.
- **Проекты и боты** — один проект = один заказчик, внутри проекта несколько ботов.
- **Замечания (issues)** — нумерация в рамках проекта, статусная модель, назначение ответственного скриптолога.
- **Чат внутри замечания** — лента сообщений от обеих сторон, вложения-скриншоты, системные сообщения о смене статуса.
- **Фильтры** — по статусу, тестировщику, скриптологу, боту; сортировка по номеру и дате.

## Роли и права

| Действие | admin | tester | developer |
|---|---|---|---|
| Управление пользователями | ✅ | — | — |
| Управление проектами и ботами | ✅ | — | — |
| Привязка участников к проекту | ✅ | — | — |
| Создание замечаний | ✅ | ✅ | — |
| Статусы «Отменено», «Вернули в работу» | — | ✅ | — |
| Статусы «В ожидании», «Выполнено», «Не принято» | — | — | ✅ |
| Сообщения и скриншоты в замечании | ✅ | ✅ | ✅ |

## Статусная модель

| Статус | Код | Кто выставляет |
|---|---|---|
| Новое | `new` | Система (автоматически) |
| В ожидании | `waiting` | Скриптолог |
| Выполнено | `done` | Скриптолог |
| Отменено | `cancelled` | Тестировщик |
| Не принято | `rejected` | Скриптолог |
| Вернули в работу | `reopened` | Тестировщик |

## Стек

- **Backend:** Node.js 20 + Express 4 + SQLite (sql.js)
- **Frontend:** React 19 + Vite + React Router
- **Файлы:** локальная файловая система (`backend/src/uploads/{project_id}/`)
- **Прод:** nginx (reverse proxy + статика) + PM2 + Let's Encrypt

## Структура проекта

```
backend/
  src/
    db/            # подключение, миграции, seed
    middleware/    # auth, роли
    routes/        # auth, users, projects, issues
    uploads/       # загруженные скриншоты
    server.js
frontend/
  src/
    api/           # HTTP-клиент
    contexts/      # AuthContext
    pages/         # экраны приложения
    components/
nginx.conf         # конфиг для прод-сервера
deploy.sh          # скрипт первичного деплоя
```

## Локальный запуск

### Backend

```bash
cd backend
npm install
npm run migrate
npm run seed
npm run dev
```

Сервер: http://localhost:3000

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Приложение: http://localhost:5173

### Учётные данные по умолчанию

```
Email:  admin@example.com
Пароль: admin123
```

> Смените пароль администратора после первого входа через раздел «Пользователи».

## Переменные окружения

`backend/.env`:

```
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://testing.bot-atelier.ru
```

## API

### Аутентификация
- `POST /api/auth/login` — вход
- `POST /api/auth/logout` — выход
- `GET /api/me` — текущий пользователь

### Пользователи (admin)
- `GET /api/users` — список
- `POST /api/users` — создать
- `PATCH /api/users/:id` — обновить (имя, email, роль, is_active)
- `POST /api/users/:id/password` — сменить пароль

### Проекты
- `GET /api/projects` — список доступных проектов
- `GET /api/projects/:id` — детали (боты, участники)
- `POST /api/projects` — создать (admin)
- `PATCH /api/projects/:id` — обновить (admin)
- `POST /api/projects/:id/bots` — добавить бота (admin)
- `PATCH /api/projects/:id/bots/:botId` — изменить бота (admin)
- `DELETE /api/projects/:id/bots/:botId` — удалить бота (admin)
- `POST /api/projects/:id/members` — добавить участника (admin)
- `DELETE /api/projects/:id/members/:userId` — убрать участника (admin)

### Замечания
- `GET /api/issues?project_id=X&status=&created_by=&assigned_to=&bot_id=&sort_by=&sort_order=` — список с фильтрами
- `GET /api/issues/:id` — замечание с лентой сообщений
- `POST /api/issues` — создать замечание (tester/admin), multipart/form-data
- `POST /api/issues/:id/messages` — добавить сообщение / сменить статус
- `PATCH /api/issues/:id/assign` — назначить ответственного

## Деплой

Подробная инструкция — в [DEPLOY.md](./DEPLOY.md).

Кратко:

```bash
ssh root@<server>
cd /opt/testing-bots
./deploy.sh
```

## Лицензия

Внутренний проект. Все права защищены.
