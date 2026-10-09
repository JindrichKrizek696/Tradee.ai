#!/usr/bin/env bash
# Upozornění na výzvy ke zdůvodnění (push + mail) každých 5 min z cronu.
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null
exec 9>/tmp/tradee-notify.lock
flock -n 9 || { echo "!! $(date -Is) předchozí běh ještě běží"; exit 0; }
node --experimental-strip-types scripts/notify.mjs
