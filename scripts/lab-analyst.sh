#!/usr/bin/env bash
# Laboratoř · týdenní AI analytik agentů – obálka pro cron (nvm Node 22, OWNER_EMAIL z .auth.env, jeden běh naráz).
# Cron (UTC, skript sám pustí jen běh v neděli 18 h pražského času – letní i zimní čas):
#   30 16,17 * * 0 cd ~/tradee && bash scripts/lab-analyst.sh >> ~/logs/lab-analyst.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; nvm use 22 >/dev/null; fi
export OWNER_EMAIL="${OWNER_EMAIL:-$(grep '^OWNER_EMAIL=' .auth.env 2>/dev/null | cut -d= -f2- | tr -d '"\r')}"
exec flock -n /tmp/tradee-lab-analyst.lock python3 scripts/lab-analyst.py "$@"
