#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then printf '%s\n' "Usage: $0 ./backups/TIMESTAMP" >&2; exit 2; fi
SRC="$1"
test -f "$SRC/database.dump" && test -f "$SRC/storage.tar.gz"
(cd "$SRC" && sha256sum -c SHA256SUMS)
printf '%s' "This replaces the current database and storage. Type RESTORE: "
read answer
[ "$answer" = "RESTORE" ] || exit 1
docker compose stop api
docker compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < "$SRC/database.dump"
tar -C "${STORAGE_HOST_PATH:-./storage}" -xzf "$SRC/storage.tar.gz"
docker compose up -d api
