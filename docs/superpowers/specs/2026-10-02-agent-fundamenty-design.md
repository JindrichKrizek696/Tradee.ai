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

Cron → `scripts/fundamentals-agent.sh`:

1. **Zámek** `flock /tmp/tradee-build.lock` – sdílený s `scripts/refresh-vps.sh` (ten se upraví, aby bral stejný zámek), aby se dva buildy a restarty nepotkaly. Když je zámek obsazený déle než 30 min, běh skončí s `zámek obsazen`.
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
5. **Kontrola** `python3 scripts/check-fundamentals.py <starý> <nový>` (níže). Neprojde → konec, stará data zůstávají.
6. **Beze změny** (soubory shodné) → log `bez změny`, konec.
7. **Nasazení:** atomická náhrada `data/fundamentals.json` (tmp + `os.replace`/`mv`), `npm run build`, `sudo systemctl restart tradee`. Build selže → vrátí se starý soubor, znovu build, log `build selhal`.
8. **Push:** `git add data/fundamentals.json` · `git commit` (autor `tradee-bot <bot@tradee.dejny.eu>`, zpráva `Fundamenty ověřené agentem (VPS) · <UTC čas>`) · `git pull --rebase` · `git push origin main`. Když `pull --rebase` narazí na konflikt v `fundamentals.json` (Jindřich mezitím pushnul): `git rebase --abort` · `git reset --soft HEAD~1` (zruší jen náš commit) · `git restore --staged --worktree data/fundamentals.json` · `git pull --rebase --autostash` (převezme ruční verzi) · znovu build a restart · log `konflikt – ponechána ruční verze`. **Nikdy `git reset --hard`** – smazal by necommitnutá data cronu.
9. **Log** (níže).

Datové soubory, které mění `refresh-vps.sh` (`score-market.json`, `expanded-market.json`, `score-history.json`, `calendar.json`), se **necommitují** a `git pull --rebase --autostash` je zachová.

## Kontrola výstupu – `scripts/check-fundamentals.py`

Volání: `check-fundamentals.py OLD NEW [--now ISO]`; exit 0 = přijato, 1 = odmítnuto (důvod na stdout, jeden řádek).

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

VPS potřebuje právo pushovat do `JindrichKrizek696/Tradee.ai`:
- **fine-grained token** účtu `Dejnyyy` (collaborator s write), omezený na toto repo, oprávnění *Contents: Read and write*, platnost 1 rok – vytvoří uživatel a vloží na VPS do `~/.config/tradee/github-token` (`chmod 600`), **nebo**
- deploy key s write přístupem (musí přidat Jindřich jako admin).

Skript používá `git -c credential.helper= -c "http.extraheader=Authorization: Basic <base64(x-access-token:TOKEN)>"` jen pro push; token se nikdy nevypisuje ani neloguje. Bez tokenu běh proběhne, ale skončí `push přeskočen – chybí token` (data na VPS jsou aktualizovaná).

## Log

- `~/tradee/fundamentals-agent.log` – řádek na běh: `<UTC start> · <délka s> · <výsledek> · <detail> · <commit|->`, výsledek ∈ `ok`, `bez změny`, `odmítnuto: <důvod>`, `timeout`, `claude selhal`, `build selhal`, `konflikt – ponechána ruční verze`, `push přeskočen – chybí token`, `zámek obsazen`, `git pull selhal`.
- `~/tradee/logs/agent-YYYYMMDD-HHMM.json` – výstup `claude --output-format json`; drží se posledních 30.

## Hlídání

Dashboard už má v kartě kvality dat řádek **Fundament** (`dataHealth` v `lib/dashboard.ts`) s varováním po `staleAfterHours` (36 h). Žádná nová UI změna; když agent dva běhy po sobě selže, varování se objeví samo.

## Testy

- `scripts/tests/test_check_fundamentals.py` (unittest) – fixtura = aktuální `data/fundamentals.json`; každé pravidlo 1–9 má test, který ho poruší (smazaný klíč, 7 měn, změněná `methodVersion`, zkrácená/upravená historie, starší/budoucí `checkedAt`, faktor bez zdroje, událost bez `at`, poloviční soubor) + test platné změny (nový `checkedAt`, změněná hodnota faktoru se zdrojem, přidaný záznam historie).
- `scripts/tests/test_fundamentals_agent.sh` – wrapper spuštěný v dočasné kopii repa s **falešným `claude`** (skript v `PATH`, který zapíše připravený soubor): scénáře přijato → nasazeno + commit; odmítnuto → beze změny; beze změny; zámek obsazen; chybějící token → push přeskočen. Build a restart se v testu nahradí proměnnými `TRADEE_BUILD_CMD`/`TRADEE_RESTART_CMD` (`true`).
- **První ostrý běh ručně** na VPS, výsledek (diff a log) uživateli **před zapnutím cronu**.

## Mimo rozsah

Fundamenty bez AI z oficiálních API, notifikace (e-mail/Discord), změna metodiky skóre, běh Jindřichova agenta.
