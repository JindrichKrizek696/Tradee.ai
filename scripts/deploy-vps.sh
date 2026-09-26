#!/usr/bin/env bash
# Nasazení zdrojů na VPS z lokálního počítače (Git Bash). Data v data/ se NEpřepisují,
# protože je na serveru průběžně obnovuje cron (scripts/refresh-vps.sh).
# Použití: bash scripts/deploy-vps.sh
set -euo pipefail
HOST="${TRADEE_VPS:-ubuntu@dejnyhoserver.bagros.eu}"
cd "$(dirname "$0")/.."
tar --exclude=./node_modules --exclude=./.wrangler --exclude=./dist --exclude=./.next --exclude=./.vinext \
    --exclude=./.sites-runtime --exclude=./tsconfig.tsbuildinfo --exclude=./.git --exclude=./data -czf - . \
 | ssh -o BatchMode=yes "$HOST" 'set -e; cd ~/tradee && tar -xzf - && chmod +x scripts/*.sh; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; export WRANGLER_SEND_METRICS=false; npm ci --no-audit --no-fund 2>&1 | tail -1; npm run build 2>&1 | grep -i "build complete\|error"; sudo systemctl restart tradee; for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:8787/ && break; sleep 1; done; echo "service: $(systemctl is-active tradee)"'
