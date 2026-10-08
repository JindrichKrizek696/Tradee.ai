#!/usr/bin/env bash
# Živé ceny trhů každých 15 min z cronu (bez buildu a restartu aplikace).
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null
exec 9>/tmp/tradee-live.lock
flock -n 9 || { echo "!! $(date -Is) předchozí běh ještě běží"; exit 0; }
echo "== $(date -Is) live"
node --experimental-strip-types scripts/refresh-live.mjs
