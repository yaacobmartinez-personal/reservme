#!/usr/bin/env sh
# Restore the database from a backup produced by scripts/backup.sh.
#
#   DATABASE_URL=postgres://... ./scripts/restore.sh backups/reservme-....dump
#
# THIS OVERWRITES the target database. It asks for confirmation unless FORCE=1.
# Needs pg_restore on PATH.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"

file="${1:-}"
if [ -z "$file" ]; then
  echo "usage: DATABASE_URL=... ./scripts/restore.sh <dump-file>" >&2
  exit 1
fi
if [ ! -f "$file" ]; then
  echo "No such file: $file" >&2
  exit 1
fi

# The target host, for the human to see what they're about to overwrite.
target=$(printf '%s' "$DATABASE_URL" | sed -E 's#^.*@##; s#\?.*$##')
echo "About to OVERWRITE the database at: $target"
echo "From backup: $file"

if [ "${FORCE:-}" != "1" ]; then
  printf "Type 'restore' to proceed: "
  read -r answer
  if [ "$answer" != "restore" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# --clean --if-exists drops existing objects first; --no-owner avoids role
# mismatches between environments.
"$PG_RESTORE" --clean --if-exists --no-owner --no-privileges \
  -d "$DATABASE_URL" "$file"

echo "Restore complete."
