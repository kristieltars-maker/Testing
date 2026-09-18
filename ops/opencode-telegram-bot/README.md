# opencode-telegram-bot customization

Snapshot of the patched files applied on top of `@grinev/opencode-telegram-bot`
(dist files). Re-apply after a package update with:

    ./apply.sh

Patches included:
- multi-user whitelist: TELEGRAM_ALLOWED_USER_ID accepts a comma-separated list
  (config.js, bot/middleware/auth.js, bot/routers/command-router.js, runtime/bootstrap.js)
- simplified UI: main reply keyboard has only "New session" and "Settings"
  (bot/keyboards/main-reply-keyboard.js, bot/message-patterns.js, bot/routers/message-router.js)
- settings hub menu with project/agent/model/variant/context
  (bot/menus/hub-menu.js, bot/callbacks/hub-callback-handler.js, bot/callbacks/callback-router.js)
- project display name "Bot-atelier Ecosystem" for /srv/testing-bots
  (app/services/project-display-name.js + project menu/status/pinned)
