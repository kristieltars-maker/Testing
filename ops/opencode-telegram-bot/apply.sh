#!/usr/bin/env bash
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/files"
DST=/opt/node22/lib/node_modules/@grinev/opencode-telegram-bot/dist
cp -a "$SRC/." "$DST/"
systemctl restart opencode-telegram-bot
echo "opencode-telegram-bot patches applied and service restarted"
