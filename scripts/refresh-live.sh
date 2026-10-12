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
rc=$?
# Laboratoř · Simulace (jen vlastník): jeden krok všech variant A/B/C/D po čerstvých cenách (jeden proces pod jedním zámkem). Vlastní zámek a limit 5 min; selhání nesmí shodit živé ceny.
if [ -f scripts/lab-paper.mjs ]; then
  (
    exec 8>/tmp/tradee-lab-paper.lock
    flock -n 8 || { echo "!! $(date -Is) lab-paper: předchozí běh ještě běží"; exit 0; }
    OWNER_EMAIL="$(grep '^OWNER_EMAIL=' .auth.env 2>/dev/null | cut -d= -f2- | tr -d '"\r')" timeout 300 node --experimental-strip-types scripts/lab-paper.mjs
  ) || echo "!! $(date -Is) lab-paper selhal (živé ceny jsou uložené)"
fi
exit $rc
