#!/usr/bin/env sh
# Database backup — a compressed, restorable pg_dump with retention.
#
#   DATABASE_URL=postgres://... ./scripts/backup.sh
#
# Writes backups/reservme-<UTC timestamp>.dump (pg_dump custom format: already
# compressed, restorable with scripts/restore.sh). Keeps the most recent
# BACKUP_RETENTION files. Optionally uploads to S3 if BACKUP_S3_BUCKET is set.
#
# Needs pg_dump on PATH (the postgresql-client package). Schedule it from cron,
# a platform scheduled job, or the backup service in docker-compose.prod.yml.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION:-14}"
PG_DUMP="${PG_DUMP:-pg_dump}"

mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$BACKUP_DIR/reservme-$stamp.dump"

echo "Backing up to $file"
# -Fc: custom format (compressed + selective restore). Excludes pg-boss's
# transient queue tables — jobs are ephemeral, not data worth restoring.
"$PG_DUMP" "$DATABASE_URL" -Fc --no-owner --no-privileges \
  --exclude-schema=pgboss -f "$file"

size=$(wc -c < "$file")
if [ "$size" -lt 1000 ]; then
  echo "Backup looks too small ($size bytes) — aborting so retention doesn't rotate good backups away." >&2
  rm -f "$file"
  exit 1
fi
echo "Wrote $file ($size bytes)"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "Uploading to s3://$BACKUP_S3_BUCKET/"
  aws s3 cp "$file" "s3://$BACKUP_S3_BUCKET/$(basename "$file")"
fi

# Retention: keep the newest $RETENTION, delete the rest.
count=$(ls -1t "$BACKUP_DIR"/reservme-*.dump 2>/dev/null | wc -l)
if [ "$count" -gt "$RETENTION" ]; then
  ls -1t "$BACKUP_DIR"/reservme-*.dump | tail -n +"$((RETENTION + 1))" | while read -r old; do
    echo "Pruning $old"
    rm -f "$old"
  done
fi

echo "Done. $count backup(s) on disk (retention $RETENTION)."
