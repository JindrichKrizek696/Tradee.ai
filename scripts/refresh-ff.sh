#!/usr/bin/env bash
# Odhady z ForexFactory každou hodinu z cronu (bez buildu; do aplikace se dostanou při dalším buildu v refresh-vps.sh).
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null
exec 9>/tmp/tradee-ff.lock
flock -n 9 || { echo "!! $(date -Is) předchozí běh ještě běží"; exit 0; }
echo "== $(date -Is) ff"
node --experimental-strip-types scripts/refresh-ff.mjs
