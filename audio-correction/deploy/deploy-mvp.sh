#!/bin/bash
set -e

# Idempotent deployment for the original Acoustic Matcher MVP
# (correction-audio.bot-atelier.ru) behind the ecosystem SSO gate.
#
# What it does:
#   1. builds and starts the unmodified MVP container (127.0.0.1:8081);
#   2. installs the nginx server block, substituting the shared secret;
#   3. validates and reloads nginx;
#   4. verifies the MVP UI is reachable locally.
#
# Re-running is safe: the image is rebuilt, the container recreated and the
# nginx block refreshed.
#
# Assumes the MVP files have been uploaded to $APP_DIR (default
# /opt/audio-correction-mvp), i.e. $APP_DIR/docker-compose.yml exists.
# The nginx block is read next to this script (deploy/nginx-mvp.conf), or
# from $APP_DIR/deploy/nginx-mvp.conf.

DOMAIN="correction-audio.bot-atelier.ru"
APP_DIR="${APP_DIR:-/opt/audio-correction-mvp}"
NGINX_AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
NGINX_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"
TOKEN_FILE="/root/.internal_auth_token"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Deploying Acoustic Matcher MVP to https://$DOMAIN ==="

# ---------------------------------------------------------------------------
# 0. Prerequisites
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker is not installed" >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: the 'docker compose' plugin is not available" >&2
    exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
    echo "ERROR: nginx is not installed" >&2
    exit 1
fi

if [ ! -d "$APP_DIR" ]; then
    echo "ERROR: $APP_DIR not found. Upload the MVP files first." >&2
    exit 1
fi

if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
    echo "ERROR: $APP_DIR/docker-compose.yml not found." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 1. Shared secret (SSO gate)
# ---------------------------------------------------------------------------
if [ -z "${INTERNAL_AUTH_TOKEN:-}" ] && [ -f "$TOKEN_FILE" ]; then
    INTERNAL_AUTH_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
fi

if [ -z "${INTERNAL_AUTH_TOKEN:-}" ]; then
    echo "ERROR: INTERNAL_AUTH_TOKEN is not set (neither in the environment" >&2
    echo "       nor in $TOKEN_FILE). It must match the token used by" >&2
    echo "       'testing'. Generate one with:" >&2
    echo "         node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Build and start the MVP container
# ---------------------------------------------------------------------------
echo "Building and starting the MVP container..."
cd "$APP_DIR"
docker compose up -d --build

echo "Waiting for the MVP UI on http://127.0.0.1:8081/ ..."
MVP_OK=""
for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8081/ 2>/dev/null | grep -q "Acoustic Matcher"; then
        MVP_OK="1"
        break
    fi
    sleep 2
done
if [ -z "$MVP_OK" ]; then
    echo "ERROR: the MVP UI did not become reachable on 127.0.0.1:8081" >&2
    echo "       Inspect logs: docker compose logs -f" >&2
    exit 1
fi
echo "MVP container is serving the UI."

# ---------------------------------------------------------------------------
# 3. Nginx server block (with the token substituted)
# ---------------------------------------------------------------------------
NGINX_SRC="$SCRIPT_DIR/nginx-mvp.conf"
if [ ! -f "$NGINX_SRC" ]; then
    NGINX_SRC="$APP_DIR/deploy/nginx-mvp.conf"
fi
if [ ! -f "$NGINX_SRC" ]; then
    echo "ERROR: nginx-mvp.conf not found next to this script or in" >&2
    echo "       $APP_DIR/deploy/." >&2
    exit 1
fi

echo "Installing nginx server block for $DOMAIN..."
sed "s|<INTERNAL_AUTH_TOKEN>|$INTERNAL_AUTH_TOKEN|g" "$NGINX_SRC" > "$NGINX_AVAILABLE"
chmod 644 "$NGINX_AVAILABLE"
ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"

# ---------------------------------------------------------------------------
# 4. Validate and reload nginx
# ---------------------------------------------------------------------------
echo "Validating nginx configuration..."
nginx -t
systemctl reload nginx
echo "Nginx reloaded."

echo ""
echo "=== Deployment complete ==="
echo "URL:   https://$DOMAIN"
echo "Local: http://127.0.0.1:8081/"
echo ""
echo "Useful commands:"
echo "  docker compose -f $APP_DIR/docker-compose.yml logs -f   # MVP logs"
echo "  docker compose -f $APP_DIR/docker-compose.yml restart   # restart MVP"
