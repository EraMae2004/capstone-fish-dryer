#!/bin/bash
set -e

cd /var/www/html

# Create .env from .env.example if missing
if [ ! -f .env ]; then
    cp .env.example .env
fi

# Generate APP_KEY if empty
if ! grep -q '^APP_KEY=.\+' .env; then
    php artisan key:generate --force
fi

# Ensure Laravel storage/cache directory structure exists (needed when using volumes)
mkdir -p storage/framework/sessions storage/framework/views storage/framework/cache/data storage/framework/cache/default
mkdir -p storage/logs storage/app/public bootstrap/cache

# Ensure SQLite database file exists when using sqlite
if [ "${DB_CONNECTION:-sqlite}" = "sqlite" ]; then
    DB_PATH="${DB_DATABASE:-database/database.sqlite}"
    if [ ! -f "$DB_PATH" ]; then
        touch "$DB_PATH"
    fi
fi

# Ensure writable directories
chown -R www-data:www-data storage bootstrap/cache database 2>/dev/null || true
chmod -R 775 storage bootstrap/cache database 2>/dev/null || true

# Run migrations
php artisan migrate --force

# Cache config for production
php artisan config:cache 2>/dev/null || true
php artisan route:cache 2>/dev/null || true
php artisan view:cache 2>/dev/null || true

exec "$@"
