#!/bin/bash
set -e

DOMAIN="testing.bot-atelier.ru"
APP_DIR="/opt/testing-bots"
BACKEND_PORT=3001

echo "=== Deploying Testing Bots to $DOMAIN ==="

# Update system
apt update && apt upgrade -y

# Install Node.js 20 LTS
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Install nginx if not present
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    apt install -y nginx
fi

# Install certbot if not present
if ! command -v certbot &> /dev/null; then
    echo "Installing certbot..."
    apt install -y certbot python3-certbot-nginx
fi

# Create app directory
mkdir -p $APP_DIR
cd $APP_DIR

# Check if files exist
if [ ! -f "backend/package.json" ]; then
    echo "ERROR: Application files not found in $APP_DIR"
    echo "Please upload files first using:"
    echo "  scp -r ./backend ./frontend deploy.sh root@2.26.112.123:$APP_DIR/"
    exit 1
fi

# Install backend dependencies
echo "Installing backend dependencies..."
cd backend
npm install --production

# Run migrations
echo "Running database migrations..."
npm run migrate
npm run seed

# Build frontend
echo "Building frontend..."
cd ../frontend
npm install
npm run build

# Setup PM2
cd $APP_DIR/backend
pm2 delete testing-bots 2>/dev/null || true
pm2 start src/server.js --name testing-bots --env production
pm2 save
pm2 startup systemd -u root --hp /root

# Create nginx config
echo "Configuring nginx..."
cat > /etc/nginx/sites-available/$DOMAIN << 'NGINX_EOF'
server {
    listen 80;
    server_name testing.bot-atelier.ru;

    client_max_body_size 20M;

    # Frontend static files
    location / {
        root /opt/testing-bots/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Internal API (loopback only)
    location ^~ /api/internal/ {
        deny all;
        return 403;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Uploaded files
    location /uploads/ {
        alias /opt/testing-bots/backend/src/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN

# Test nginx config
nginx -t

# Reload nginx
systemctl reload nginx

# Get SSL certificate
echo "Requesting SSL certificate..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@bot-atelier.ru || {
    echo "Certbot failed. You may need to run it manually after DNS propagation:"
    echo "  certbot --nginx -d $DOMAIN"
}

echo ""
echo "=== Deployment complete! ==="
echo "URL: https://$DOMAIN"
echo ""
echo "Admin credentials:"
echo "  Email: admin@example.com"
echo "  Password: admin123"
echo ""
echo "Useful commands:"
echo "  pm2 logs testing-bots    # View logs"
echo "  pm2 restart testing-bots # Restart backend"
echo "  pm2 status               # Check status"
