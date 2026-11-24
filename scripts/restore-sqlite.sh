#!/usr/bin/env bash
set -euo pipefail

# Restore a gzipped SQLite backup safely before restarting the service.
if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <path-to-backup.db.gz> [target-db-path]" >&2
  exit 1
fi

BACKUP_GZ="$1"
TARGET_DB="${2:-${DATABASE_PATH:-/app/data/financial-tracker.db}}"

if [ ! -f "$BACKUP_GZ" ]; then
  echo "Backup archive not found: $BACKUP_GZ" >&2
  exit 1
fi

TMP_DB="$(mktemp)"
trap 'rm -f "$TMP_DB"' EXIT

gzip -dc "$BACKUP_GZ" > "$TMP_DB"
sqlite3 "$TMP_DB" "PRAGMA integrity_check;" | grep -qx "ok"

mkdir -p "$(dirname "$TARGET_DB")"
rm -f "${TARGET_DB}-wal" "${TARGET_DB}-shm"
mv "$TMP_DB" "$TARGET_DB"
echo "Restored database to $TARGET_DB"
