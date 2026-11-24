#!/usr/bin/env bash
set -euo pipefail

# WAL-safe SQLite online backup with gzip compression and 14-day retention.
DB_PATH="${DATABASE_PATH:-/app/data/financial-tracker.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/financial-tracker}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [ ! -f "$DB_PATH" ]; then
  echo "Database file not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RAW_OUT="$BACKUP_DIR/financial-tracker-$STAMP.db"

sqlite3 "$DB_PATH" ".backup '$RAW_OUT'"
sqlite3 "$RAW_OUT" "PRAGMA integrity_check;" | grep -qx "ok"
gzip -f "$RAW_OUT"

find "$BACKUP_DIR" -name 'financial-tracker-*.db.gz' -type f -mtime +"$RETENTION_DAYS" -delete
echo "Backup created: ${RAW_OUT}.gz"
