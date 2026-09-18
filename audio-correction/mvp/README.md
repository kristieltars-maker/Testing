# Acoustic Matcher MVP — deployment copy (`audio-correction/mvp`)

Original Acoustic Matcher MVP, deployed unchanged on
`correction-audio.bot-atelier.ru` behind the ecosystem SSO gate.

- `web_app.py`, `acoustic_matcher.py`, `requirements.txt`, `Dockerfile` —
  copied byte-for-byte from `acoustic_matcher_open_source_mvp-2/`.
- `static/index.html` — the only change: a `← На главную` link in the header
  pointing at `https://bot-atelier.ru/`. No other markup, IDs, scripts or
  styles were touched.
- `docker-compose.yml` — builds the container and publishes it on loopback
  `127.0.0.1:8081` (the app listens on `8080` inside the container).

The MVP itself has no authentication. Public access is gated by nginx
(`audio-correction/deploy/nginx-mvp.conf`) via `auth_request` against the
`testing` loopback endpoint `GET /api/internal/session`.

## Layout on the server

```
/opt/audio-correction-mvp/
  Dockerfile
  docker-compose.yml
  requirements.txt
  web_app.py
  acoustic_matcher.py
  static/index.html
  deploy/
    nginx-mvp.conf
    deploy-mvp.sh
```

## Deploy

Upload `audio-correction/mvp/*` to `/opt/audio-correction-mvp/` and the two
files in `audio-correction/deploy/` to `/opt/audio-correction-mvp/deploy/`,
then:

```bash
# Shared secret: set the env var or put it in /root/.internal_auth_token.
export INTERNAL_AUTH_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
# (the same value must be configured for `testing`)

bash /opt/audio-correction-mvp/deploy/deploy-mvp.sh
```

`deploy-mvp.sh` is idempotent: it rebuilds and recreates the container,
installs the nginx block with the token substituted, runs `nginx -t`, reloads
nginx and checks that `http://127.0.0.1:8081/` serves the MVP UI.

The script takes the token from `$INTERNAL_AUTH_TOKEN` or, if unset, from
`/root/.internal_auth_token`.

## Verify

```bash
curl -fsS http://127.0.0.1:8081/ | grep "Acoustic Matcher"   # MVP UI
curl -I http://correction-audio.bot-atelier.ru/               # 302 to testing login (unauth)
curl -I https://correction-audio.bot-atelier.ru/              # 200 when logged in
```

## Update

```bash
cd /opt/audio-correction-mvp
# upload the new MVP files (overwrite web_app.py / static/index.html / ...)
docker compose up -d --build
```

If only the nginx block changed, re-run `deploy/deploy-mvp.sh`.

## Rollback

- **Application:** `docker compose down` in `/opt/audio-correction-mvp`;
  the site returns `502` from nginx.
- **Full removal:** remove the nginx symlink and reload:
  ```bash
  rm -f /etc/nginx/sites-enabled/correction-audio.bot-atelier.ru
  nginx -t && systemctl reload nginx
  ```
  The shared `testing` SSO and other subsystems are unaffected.
- **Version rollback:** keep the previous copy of the MVP files (or the
  upstream `acoustic_matcher_open_source_mvp-2/` archive) and re-run
  `docker compose up -d --build` from it.

## Notes

- TLS is managed by Certbot; the existing certificate for
  `correction-audio.bot-atelier.ru` is reused. Certbot owns the
  `listen 443 ssl` server and the HTTP → HTTPS redirect.
- `INTERNAL_AUTH_TOKEN` must match the value configured in `testing`.
- The unauthenticated redirect target is
  `https://bot-atelier.ru/login?next=https%3A%2F%2Fcorrection-audio.bot-atelier.ru%2F`.
