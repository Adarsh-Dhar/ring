#!/bin/sh
# Nightly backup: Postgres dump + the /data volume (state.json, ring-token.json). Run from the project folder, e.g. via cron.
set -eu
OUT="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
docker compose exec -T postgres_db pg_dump -U doorbell doorbell | gzip > "$OUT/db-$STAMP.sql.gz"
docker compose exec -T server tar -czf - -C /data . > "$OUT/data-$STAMP.tar.gz"
find "$OUT" -type f -mtime +14 -delete
echo "Backup written to $OUT ($STAMP)"
