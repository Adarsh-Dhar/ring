#!/bin/sh
# Nightly backup: Postgres dump only (all data is now in PostgreSQL). Run from the project folder, e.g. via cron.
set -eu
OUT="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
docker compose exec -T postgres_db pg_dump -U doorbell doorbell | gzip > "$OUT/db-$STAMP.sql.gz"
find "$OUT" -type f -mtime +14 -delete
echo "Backup written to $OUT ($STAMP)"
