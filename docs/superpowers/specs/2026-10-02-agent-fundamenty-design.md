# Agent fundamentů na VPS

Datum: 2. 10. 2026 · Stav: ke schválení · Větev: `feature/agent-fundamenty`

## Cíl

FX skóre (60 % váhy = fundament) se pozastaví, když `data/fundamentals.json` není ověřený do 36 h (`staleAfterHours`). Dnes ho ručně aktualizuje Jindřichův agent – naposledy 27. 9. 2026, od 29. 9. jsou všechna FX skóre „—“.

Cíl: **Claude Code běží na VPS 2× denně**, podle `FUNDAMENTALS.md` ověří a aktualizuje `data/fundamentals.json`, výsledek projde automatickou kontrolou, nasadí se a pushne na GitHub. FX skóre tak zůstanou platná bez ručního zásahu.

## Rozhodnutí

- **Agent:** Claude Code (`claude -p`) na VPS, přihlášený přes předplatné (dlouhodobý token už je uložený v `~/.claude`; ověřeno 2. 10. – `claude -p` odpovídá). Verze 2.1.284.
- **Frekvence:** 2× denně, **06:30 a 18:30 UTC**.
- **Vlastník dat:** VPS je hlavní zdroj fundamentů a po úspěšném běhu **pushuje `data/fundamentals.json` do `main`**. Ruční běh Jindřichova agenta se respektuje (viz Git).

## Běh

Cron → `scripts/fundamentals_agent.py` (Python kvůli testovatelnosti – `fcntl` zámek a timeout fungují i lokálně na macOS):

1. **Zámek** `/tmp/tradee-build.lock` (`fcntl.flock`) – sdílený s `scripts/refresh-vps.sh` (ten ho vezme přes `flock -w 1800`), aby se dva buildy a restarty nepotkaly. Když je zámek obsazený déle než 30 min, běh skončí s `zámek obsazen`.
2. **Git sync:** `git pull --rebase --autostash` jen pro `main`; když se nepodaří, běh skončí (`git pull selhal`) a nic nemění.
3. **Pracovní kopie:** `data/fundamentals.json` → `/tmp/tradee-agent/fundamentals.json`; `FUNDAMENTALS.md` a `lib/fundamentals.ts` (typy) se zkopírují vedle pro čtení.
4. **Claude:**
   ```
   timeout 25m claude -p "<prompt>" \
     --allowedTools "WebSearch WebFetch Read(/tmp/tradee-agent/**) Edit(/tmp/tradee-agent/fundamentals.json)" \
     --disallowedTools "Bash Write" --permission-mode dontAsk \
     --add-dir /tmp/tradee-agent --output-format json
   ```
   spuštěný s `cwd=/tmp/tradee-agent`. Prompt: „Jsi ověřovatel fundamentů Tradee.ai. Přečti FUNDAMENTALS.md a aktualizuj fundamentals.json přesně podle něj. Používej jen veřejné primární zdroje. Měň jen tento soubor. Na konci napiš jednu větu shrnutí.“ Model: výchozí z předplatného.
5. **Kontrola** `python3 scripts/check_fundamentals.py <starý> <nový>` (níže). Neprojde → konec, stará data zůstávají.
6. **Beze změny** (JSON obsahově shodný) → log `bez změny`, konec.
7. **Nasazení:** atomická náhrada `data/fundamentals.json` (tmp + `os.replace`/`mv`), `npm run build`, `sudo systemctl restart tradee`. Build selže → vrátí se starý soubor, znovu build, log `build selhal`.
8. **Push:** `git add data/fundamentals.json` · `git commit` (autor `tradee-bot <bot@tradee.dejny.eu>`, zpráva `Fundamenty ověřené agentem (VPS) · <UTC čas>`) · `git pull --rebase` · `git push origin main`. Když `pull --rebase` narazí na konflikt v `fundamentals.json` (Jindřich mezitím pushnul): `git rebase --abort` · `git reset --soft HEAD~1` (zruší jen náš commit) · `git restore --staged --worktree data/fundamentals.json` · `git pull --rebase --autostash` (převezme ruční verzi) · znovu build a restart · log `konflikt – ponechána ruční verze`. **Nikdy `git reset --hard`** – smazal by necommitnutá data cronu.
9. **Log** (níže).

Datové soubory, které mění `refresh-vps.sh` (`score-market.json`, `expanded-market.json`, `score-history.json`, `calendar.json`), se **necommitují** a `git pull --rebase --autostash` je zachová.

## Kontrola výstupu – `scripts/check_fundamentals.py`

Volání: `check_fundamentals.py OLD NEW [--now ISO]`; exit 0 = přijato, 1 = odmítnuto (důvod na stdout, jeden řádek).

Odmítne, když:
1. NEW není platný JSON nebo kořen není objekt.
2. Chybí kterýkoli klíč, který má OLD na nejvyšší úrovni (`schemaVersion`, `methodVersion`, `checkedAt`, `currencies`, `events`, `history`, `sources`, `institutions`, `changes`, …).
3. `currencies` nemá přesně 8 měn `USD EUR GBP JPY CHF AUD NZD CAD`, nebo měně chybí `factors`.
4. Změnilo se `schemaVersion`, `methodVersion`, `staleAfterHours` nebo `reviewCadenceHours` (metodiku agent nemění).
5. `history` je kratší než v OLD, nebo se změnil některý z prvních `len(OLD.history)` záznamů (historie jen přibývá).
6. `checkedAt` NEW není ISO čas, není > `checkedAt` OLD, nebo je víc než 10 min v budoucnosti vůči `--now`.
7. Faktor měny má číselné `value` a prázdný `source` nebo `reason`.
8. Událost v `events` nemá `id`, `at` (ISO), `title`, `source`.
9. Soubor je menší než 50 % OLD (ochrana proti „vyprázdnění“).

Přijme (exit 0, stdout `ok: <počet měn se změnou> měn, <počet nových událostí> událostí`).

## Git přístup na VPS

Fine-grained token nejde (repo patří osobnímu účtu Jindřicha, `Dejnyyy` je jen collaborator). Použije se **deploy key**:
- klíč `~/.ssh/tradee_deploy` (ed25519, bez hesla) vygenerovaný na VPS 2. 10. 2026; veřejná část: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAANz4s/MiWHim/kziL64FC+lWGifpbD2aGh4dDRQtWY tradee-bot@vps`,
- Jindřich ho přidá v repu: Settings → Deploy keys → *Allow write access*,
- push: `GIT_SSH_COMMAND="ssh -i ~/.ssh/tradee_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git push git@github.com:JindrichKrizek696/Tradee.ai.git HEAD:main`.

Dokud klíč v repu není, běh nasadí data na VPS, commitne lokálně a skončí `push přeskočen – chybí deploy key` (resp. `push selhal: …`, když GitHub klíč odmítne); další běh commit dorovná přes `pull --rebase`.

## Log

- `~/tradee/fundamentals-agent.log` – řádek na běh: `<UTC start> · <délka s> · <výsledek> · <detail> · <commit|->`, výsledek ∈ `ok`, `bez změny`, `odmítnuto: <důvod>`, `timeout`, `claude selhal`, `build selhal`, `konflikt – ponechána ruční verze`, `push přeskočen – chybí deploy key`, `push selhal: …`, `zámek obsazen`, `git pull selhal`.
- `~/tradee/logs/agent-YYYYMMDD-HHMM.json` – výstup `claude --output-format json`; drží se posledních 30.

## Hlídání

Dashboard už má v kartě kvality dat řádek **Fundament** (`dataHealth` v `lib/dashboard.ts`) s varováním po `staleAfterHours` (36 h). Žádná nová UI změna; když agent dva běhy po sobě selže, varování se objeví samo.

## Testy

- `scripts/tests/test_check_fundamentals.py` (unittest) – fixtura = aktuální `data/fundamentals.json`; každé pravidlo 1–9 má test, který ho poruší (smazaný klíč, 7 měn, změněná `methodVersion`, zkrácená/upravená historie, starší/budoucí `checkedAt`, faktor bez zdroje, událost bez `at`, poloviční soubor) + test platné změny (nový `checkedAt`, změněná hodnota faktoru se zdrojem, přidaný záznam historie).
- `scripts/tests/test_fundamentals_agent.py` – wrapper nad dočasným git repem (bare remote + klon) s **falešným `claude`** (`TRADEE_CLAUDE_CMD`): přijato → nasazeno + push; odmítnuto (metodika, budoucí `checkedAt`); beze změny; claude selhal; timeout; zámek obsazen; build selhal → obnova; chybí deploy key → push přeskočen; konflikt → ruční verze. Build a restart přes `TRADEE_BUILD_CMD`/`TRADEE_RESTART_CMD`. Necommitnutá data cronu musí každý scénář přežít.
- **První ostrý běh ručně** na VPS, výsledek (diff a log) uživateli **před zapnutím cronu**.

## Mimo rozsah

Fundamenty bez AI z oficiálních API, notifikace (e-mail/Discord), změna metodiky skóre, běh Jindřichova agenta.
