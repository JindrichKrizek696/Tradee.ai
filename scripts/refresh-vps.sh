#!/usr/bin/env bash
# Obnova podkladů na VPS: stáhne veřejná data (ECB, CFTC, Yahoo), uloží snímek skóre,
# sestaví nový build Workeru a restartuje službu tradee. Spouští cron každé 4 hodiny.
set -uo pipefail
cd "$(dirname "$0")/.."
export WRANGLER_SEND_METRICS=false
export PYTHONUNBUFFERED=1
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null
# Sdílený zámek s agentem fundamentů (scripts/fundamentals_agent.py) – build a restart nesmí běžet dvakrát.
exec 9>/tmp/tradee-build.lock
flock -w 1800 9 || { echo "!! $(date -Is) zámek obsazen, refresh přeskočen"; exit 1; }
echo "== $(date -Is) refresh start"
python3 scripts/refresh-score-data.py || echo "!! refresh-score-data selhal"
python3 scripts/refresh-expanded-data.py || echo "!! refresh-expanded-data selhal"
node --experimental-strip-types scripts/capture-score-history.mjs || echo "!! capture-score-history selhal"
node --experimental-strip-types scripts/check-score.mjs || echo "!! check-score hlásí problém"
python3 scripts/refresh_calendar.py || echo "!! refresh_calendar selhal"
node --experimental-strip-types scripts/refresh-ff.mjs || echo "!! refresh-ff selhal"
python3 scripts/refresh_fx.py || echo "!! refresh_fx selhal"
python3 scripts/mt_maintenance.py || echo "!! mt_maintenance selhal"
if npm run build >/tmp/tradee-build.log 2>&1; then
  sudo systemctl restart tradee && echo "== $(date -Is) nasazeno"
else
  echo "!! build selhal"; tail -20 /tmp/tradee-build.log
fi
python3 scripts/sync-mariadb.py || echo "!! sync do MariaDB selhal"
