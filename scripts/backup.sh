#!/bin/bash
BACKUP_DIR="/opt/eqemu/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Database dump
docker exec eqemu-mariadb mysqldump -u root -p"${DB_ROOT_PASSWORD}" eqemu_login \
  | gzip > "$BACKUP_DIR/eqemu_login_$TIMESTAMP.sql.gz"

# Keep last 30 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: eqemu_login_$TIMESTAMP.sql.gz"
