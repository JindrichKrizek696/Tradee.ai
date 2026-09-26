#!/usr/bin/env bash
# Souborová záloha D1 (SQLite) a složky data/ do ~/backups/tradee. Drží 60 kopií databáze a 30 archivů dat.
set -uo pipefail
cd "$(dirname "$0")/.."
DEST="$HOME/backups/tradee"; mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M)
SRC=$(ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite 2>/dev/null | grep -v metadata | head -1)
if [ -z "$SRC" ]; then echo "!! SQLite databáze nenalezena"; exit 1; fi
python3 - "$SRC" "$DEST/d1-$STAMP.sqlite" <<'PY'
import sqlite3, sys
src = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close(); src.close()
PY
gzip -f "$DEST/d1-$STAMP.sqlite"
tar -czf "$DEST/data-$STAMP.tar.gz" data
ls -1t "$DEST"/d1-*.sqlite.gz 2>/dev/null | tail -n +61 | xargs -r rm -f
ls -1t "$DEST"/data-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
echo "backup $STAMP ok · $(ls "$DEST" | wc -l) souborů · $(du -sh "$DEST" | cut -f1)"
