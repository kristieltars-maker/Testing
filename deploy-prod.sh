#!/usr/bin/env bash
set -euo pipefail
SRC=/srv/testing-bots
DST=/opt/testing-bots
LOG=/var/log/deploy-prod.log
LAST=/var/lib/deploy-prod.last

mkdir -p /var/lib
exec >>"$LOG" 2>&1
echo "=== deploy requested $(date -Is) ==="

# Skip if nothing new since last deploy (unless FORCE=1)
HEAD="$(git -C "$SRC" rev-parse HEAD)"
if [ "${FORCE:-0}" != "1" ] && [ -f "$LAST" ] && [ "$(cat "$LAST")" = "$HEAD" ]; then
  echo "up to date ($HEAD), skip"
  exit 0
fi

echo "deploying $HEAD"

# 1) build frontend from repo
cd "$SRC/frontend"
npm run build

# 2) sync backend source (keep prod uploads, data, env, node_modules)
rsync -a --delete --exclude 'uploads' --exclude 'node_modules' "$SRC/backend/src/" "$DST/backend/src/"
rsync -a "$SRC/backend/package.json" "$DST/backend/package.json"
[ -f "$SRC/backend/package-lock.json" ] && rsync -a "$SRC/backend/package-lock.json" "$DST/backend/package-lock.json" || true

# 3) sync built frontend
rsync -a --delete "$SRC/frontend/dist/" "$DST/frontend/dist/"

# 4) prod deps + migrations
cd "$DST/backend"
npm install --omit=dev
npm run migrate

# 5) restart app
pm2 restart testing-bots --update-env
pm2 save

echo "$HEAD" > "$LAST"
echo "=== deploy done $(date -Is) ==="