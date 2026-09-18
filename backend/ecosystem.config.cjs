module.exports = {
  apps: [{
    name: 'testing-bots',
    script: 'src/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      FRONTEND_URL: 'https://testing.bot-atelier.ru',
      PORTAL_URLS: 'https://bot-atelier.ru,https://www.bot-atelier.ru',
      COOKIE_DOMAIN: '.bot-atelier.ru',
      // Shared secret for GET /api/internal/session. Replace the placeholder
      // during deploy (or provide INTERNAL_AUTH_TOKEN in the environment).
      INTERNAL_AUTH_TOKEN: process.env.INTERNAL_AUTH_TOKEN || 'REPLACE_WITH_STRONG_RANDOM_TOKEN'
    }
  }]
};
