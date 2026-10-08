# Task 2 report
Status: DONE_WITH_CONCERNS
Files: drizzle/mariadb/0007_live.sql, scripts/refresh-live.mjs, scripts/refresh-live.sh (100755).
Longest instrument id: 11 chars (<=16 OK).

## Deviation: User-Agent
Brief's long Chrome UA gave HTTP 429 on every request (query1 AND query2, also via curl; 0 markets).
Short UA `Mozilla/5.0` returns 200 on query1, so query2 not needed. UA const in refresh-live.mjs changed to 'Mozilla/5.0' with comment.
Risk: Yahoo anti-bot behaviour may differ from the VPS IP; verify on the VPS with --dry.

## Dry run (query1, UA Mozilla/5.0)
GBP/USD 1.323 -0.0151 % 3 bodů
USD/CAD 1.4224 -0.007 % 3 bodů
EUR/USD 1.1216 0 % 3 bodů
AUD/USD 0.6962 0 % 3 bodů
USD/JPY 157.975 0.1153 % 3 bodů
... (52 lines)
USD 100.0237 0.0237 % 2 bodů / EUR 100.0406 0.0406 % 2 bodů / JPY 99.8091 -0.1909 % 2 bodů
dry: 51 trhů, chyby: žádné
(51 total = 43 fetched + 8 currency indexes; brief's "~59" is inconsistent with its own arithmetic.)
Weekend/off-hours: pairs show only 3 points, currency indexes 2.

## Checks
tsc --noEmit: clean. check-live.mjs: vše ok.

## Fix round 1
Change: env read, createDb, save loop and final DELETE wrapped in one try/catch (pushes 'DB: <message>' to fails); summary line always prints; exit 0.
Non-dry run locally (no .mariadb.env): `live ok: 0/51 uloženo · chyby: DB: ENOENT: no such file or directory, open '.../.mariadb.env'`, exit=0. tsc clean.
