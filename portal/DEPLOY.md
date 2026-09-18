# Портал экосистемы — деплой (`bot-atelier.ru`)

Статический сайт без backend, без БД и без PM2. Статику отдаёт nginx.
Подробности архитектуры — `.opencode/architecture/portal.md`.

## Предварительное условие: DNS

В зоне `bot-atelier.ru` (reg.ru) должны быть A-записи на `2.26.112.123`:

| Имя | Тип | Значение |
|-----|-----|----------|
| `@` (apex) | `A` | `2.26.112.123` |
| `www` | `A` | `2.26.112.123` |

Проверка (дождитесь propagation):

```bash
nslookup bot-atelier.ru
nslookup www.bot-atelier.ru
```

> Wildcard-запись не покрывает apex — нужна явная A-запись для `@`.

## 1. Загрузить статику

```bash
ssh root@2.26.112.123 'mkdir -p /opt/portal'
scp -r portal/index.html portal/styles.css portal/subsystems.js portal/assets \
    root@2.26.112.123:/opt/portal/
```

Билд не требуется.

## 2. Установить nginx-блок

```bash
cp /opt/portal/nginx.conf /etc/nginx/sites-available/bot-atelier.ru
ln -sf /etc/nginx/sites-available/bot-atelier.ru /etc/nginx/sites-enabled/bot-atelier.ru
nginx -t && systemctl reload nginx
```

> `portal/nginx.conf` — референсный блок; на сервере certbot позже дополнит
> его `listen 443 ssl` и редиректом. Сам файл в репозитории не содержит
> сертификатов.

Проверка по HTTP:

```bash
curl -I http://bot-atelier.ru
```

## 3. Выпустить TLS (apex + www)

```bash
certbot --nginx -d bot-atelier.ru -d www.bot-atelier.ru \
  --non-interactive --agree-tos --email admin@bot-atelier.ru
```

Certbot добавит `listen 443 ssl`, ссылки на сертификат и редирект `80 → 443`.
Автопродление — штатным таймером certbot. Существующие сертификаты
поддоменов (`testing`, `correction-audio`) не затрагиваются.

Проверка по HTTPS:

```bash
curl -I https://bot-atelier.ru
openssl s_client -connect bot-atelier.ru:443 -servername bot-atelier.ru </dev/null
```

## 4. Обновление портала

После правки файлов локально:

```bash
scp -r portal/index.html portal/styles.css portal/subsystems.js portal/assets \
    root@2.26.112.123:/opt/portal/
```

Перезагрузка nginx не нужна (статика читается с диска). `systemctl reload nginx`
требуется только при изменении самого server-блока.

## 5. Добавление новой подсистемы

Одна запись в `portal/subsystems.js` (`{ id, title, description, url, badge, icon }`)
и синхронизация списка в `AGENTS.md` §4. Затем — повторить шаг 4.

## Откат

```bash
rm /etc/nginx/sites-enabled/bot-atelier.ru
rm -rf /opt/portal
systemctl reload nginx
certbot delete --cert-name bot-atelier.ru   # при необходимости
```

Откат портала не влияет на подсистемы: они не зависят от него.
