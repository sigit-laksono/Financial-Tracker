#!/usr/bin/env bash
set -euo pipefail

# PostgreSQL online backup using pg_dump with custom format (-Fc) and 14-day retention.
DATABASE_URL="${DATABASE_URL:?Set DATABASE_URL before running backup-postgres.sh}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/financial-tracker}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/financial-tracker-$STAMP.dump"

pg_dump -Fc -d "$DATABASE_URL" -f "$OUT_FILE"
gzip -f "$OUT_FILE"

find "$BACKUP_DIR" -name 'financial-tracker-*.dump.gz' -type f -mtime +"$RETENTION_DAYS" -delete
echo "PostgreSQL backup created: ${OUT_FILE}.gz"
