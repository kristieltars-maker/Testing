# Деплой на сервер

## Шаг 1: Настроить DNS

Добавьте A-запись в DNS для домена `bot-atelier.ru`:

```
Тип: A
Имя: testing
Значение: 2.26.112.123
TTL: 3600
```

Дождитесь обновления DNS (обычно 5-30 минут).

Проверить можно командой:
```bash
nslookup testing.bot-atelier.ru
```

## Шаг 2: Загрузить файлы на сервер

Откройте PowerShell в папке проекта и выполните:

```powershell
# Загрузка файлов на сервер
scp -r .\backend root@2.26.112.123:/opt/testing-bots/
scp -r .\frontend root@2.26.112.123:/opt/testing-bots/
scp .\deploy.sh root@2.26.112.123:/opt/testing-bots/
```

При запросе пароля введите: `4l316a57v8xX`

## Шаг 3: Запустить деплой

Подключитесь к серверу по SSH:

```bash
ssh root@2.26.112.123
```

Пароль: `4l316a57v8xX`

Запустите скрипт деплоя:

```bash
cd /opt/testing-bots
chmod +x deploy.sh
./deploy.sh
```

## Шаг 4: Проверить работу

Откройте браузер: https://testing.bot-atelier.ru

Войдите с учётными данными:
- Email: `admin@example.com`
- Пароль: `admin123`

## Управление приложением

### Просмотр логов
```bash
pm2 logs testing-bots
```

### Перезапуск backend
```bash
pm2 restart testing-bots
```

### Статус
```bash
pm2 status
```

### Остановка
```bash
pm2 stop testing-bots
```

## Обновление приложения

После внесения изменений локально:

```powershell
# Загрузить обновлённые файлы
scp -r .\backend root@2.26.112.123:/opt/testing-bots/
scp -r .\frontend root@2.26.112.123:/opt/testing-bots/
```

На сервере:
```bash
cd /opt/testing-bots/backend
npm install --production
npm run migrate

cd ../frontend
npm install
npm run build

cd ../backend
pm2 restart testing-bots
```

## Устранение неполадок

### Backend не запускается
```bash
pm2 logs testing-bots --lines 50
```

### Nginx не работает
```bash
nginx -t
systemctl status nginx
systemctl reload nginx
```

### SSL сертификат
```bash
certbot --nginx -d testing.bot-atelier.ru
```

### База данных
```bash
ls -la /opt/testing-bots/backend/data/
```

Резервная копия:
```bash
cp /opt/testing-bots/backend/data/app.db /opt/testing-bots/backup-$(date +%Y%m%d).db
```
