#!/bin/sh
set -eu
umask 077
BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"
docker compose stop api
BACKUP_RESULT=failed
finish_backup() {
  # Use the existing Node runtime, not a host command execution endpoint.
  docker compose run --rm --no-deps -T -v "$PWD/scripts/record-backup.mjs:/tmp/record-backup.mjs:ro" api node /tmp/record-backup.mjs /srv/nas/storage "$BACKUP_RESULT" || printf '%s\n' 'Warning: could not record backup status' >&2
  docker compose start api
}
trap finish_backup EXIT
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$DEST/database.dump"
# Keep purge/edit journals: they may hold COMPLETE files needed after an
# uncertain DB commit. Only incomplete upload/edit streams are excluded.
tar --exclude='users/*/.tmp/*' --exclude='users/*/.edits/*.tmp' --exclude='users/*/.previews/*' --exclude='.operations/*.tmp' -C "${STORAGE_HOST_PATH:-./storage}" -czf "$DEST/storage.tar.gz" .
(cd "$DEST" && sha256sum database.dump storage.tar.gz > SHA256SUMS)
BACKUP_RESULT=success
printf '%s\n' "Backup created: $DEST"
