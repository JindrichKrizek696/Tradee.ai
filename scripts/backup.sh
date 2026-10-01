#!/usr/bin/env bash
# Denní záloha: mysqldump databáze tradee + archiv složky data/ do ~/backups/tradee. Drží 60 dumpů a 30 archivů dat.
set -uo pipefail
cd "$(dirname "$0")/.."
DEST="$HOME/backups/tradee"; mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M)
ENVF=".mariadb.env"
val(){ grep "^$1=" "$ENVF" | cut -d= -f2-; }
CNF=$(mktemp); chmod 600 "$CNF"
printf "[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n" "$(val MARIADB_HOST)" "${MARIADB_PORT:-$(val MARIADB_PORT)}" "$(val MARIADB_USER)" "$(val MARIADB_PASSWORD)" > "$CNF"
[ -z "$(val MARIADB_PORT)" ] && sed -i 's/^port=$/port=3306/' "$CNF"
if mysqldump --defaults-extra-file="$CNF" --single-transaction --routines --triggers "$(val MARIADB_DB)" | gzip -6 > "$DEST/mariadb-$STAMP.sql.gz"; then
  echo "dump ok $(du -h "$DEST/mariadb-$STAMP.sql.gz" | cut -f1)"
else
  echo "!! mysqldump selhal"; rm -f "$DEST/mariadb-$STAMP.sql.gz"
fi
rm -f "$CNF"
tar -czf "$DEST/data-$STAMP.tar.gz" data
ls -1t "$DEST"/mariadb-*.sql.gz 2>/dev/null | tail -n +61 | xargs -r rm -f
ls -1t "$DEST"/data-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
echo "backup $STAMP ok · $(ls "$DEST" | wc -l) souborů · $(du -sh "$DEST" | cut -f1)"
