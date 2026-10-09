#!/usr/bin/env bash
# Archiv svíček (Yahoo H1 + D1) z cronu, např. 1× denně: 20 6 * * * /cesta/tradee/scripts/bars-sync.sh >> /var/log/tradee-bars.log 2>&1
# První naplnění: scripts/bars-sync.sh --backfill [instrument…]
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null
exec 9>/tmp/tradee-bars.lock
flock -n 9 || { echo "!! $(date -Is) předchozí běh ještě běží"; exit 0; }
echo "== $(date -Is) bars"
node --experimental-strip-types scripts/bars-sync.mjs "$@"
