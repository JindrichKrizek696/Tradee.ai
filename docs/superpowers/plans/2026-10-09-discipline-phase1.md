# Disciplína – fáze 1: Pravidla a strategie

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Nastavení automatických pravidel, vlastních pravidel a strategií na `/pravidla` a automatické vyhodnocování MT obchodů proti pravidlům (uložená porušení), včetně jednorázového vyhodnocení existujících obchodů.

**Architecture:** Čistý modul `lib/discipline/rules.ts` (definice + `evaluate`) s testy; DB `lib/discipline/store.ts` + migrace `0010_discipline.sql`; vyhodnocení se volá z `/api/mt/ingest` stejně jako snímek checklistu (try/catch, nikdy neshodí příjem); API `/api/rules`, `/api/strategies`, `/api/custom-rules`; stránka `/pravidla` (přejmenovaná `/checklisty`).

**Tech Stack:** vinext (Next 16 App Router) na Cloudflare Workers runtime (wrangler) na VPS, MariaDB 10.6 přes `lib/mysql.ts` (`d.prepare(sql).bind(...).all/first/run`), testy `node --experimental-strip-types scripts/check-*.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-09-journaling-discipline-design.md` (sekce Automatická pravidla, Nastavení „Pravidla a strategie“, Data, Architektura, Fáze 1).

## Global Constraints

- Vlastnictví vždy přes `user_id` (u MT obchodů přes `mt_accounts.user_id`); zápisy `sameOrigin` + `identity` jako `app/api/checklists/route.ts`; API `Cache-Control: private, no-store`; admin `?as=` (`viewAs`) jen GET.
- Kolace tabulek `utf8mb4_general_ci`, `ENGINE=InnoDB`; migrace se spouští `python3 scripts/mariadb-migrate.py` (soubory `drizzle/mariadb/NNNN_*.sql`, příkazy oddělené `--> statement-breakpoint`).
- Pražský den: `pragueDate` z `lib/mt/trades.ts`. SL okno 2 min: `INITIAL_SL_WINDOW` v `lib/mt/build.ts` (`sl_initial` je null, když SL nepřišel do 2 min).
- Limity: vlastní pravidla max. 30 × ≤ 120 znaků; strategie max. 50 × ≤ 60 znaků (unikátní název na uživatele, bez ohledu na velikost písmen).
- Barvy jen z tokenů (`--t-*`, `--bull`, `--bear`), české texty a skloňování, kompaktní TSX ve stylu repa, hooks před early return, mobil ≤ 640 px, světlý i tmavý motiv.
- Vyhodnocení pravidel nikdy neshodí `/api/mt/ingest` (vlastní try/catch, `console.error`).
- Žádná tajemství v repu.

## Review Focus

1. Pozice přeskupená při `rebuildPositions` (`:rN` segmenty) – porušení se přenese na nový segment, nezdvojí se a nezmizí (stejně jako `trade_checklists` v `lib/mt/store.ts`).
2. Obchody dvou účtů téhož uživatele ve stejný den – `max_trades_day`, `stop_after_losses`, `max_daily_loss` se počítají **na účet**.
3. Opakované vyhodnocení (duplicitní dávka EA, backfill spuštěný dvakrát) – žádné duplicitní řádky (`UNIQUE(trade_id,rule)`), zdůvodnění už zapsané se nepřepíše.
4. Pravidlo vypnuté v nastavení – nové porušení nevznikne, existující zůstane.
5. Pozice bez `risk_pct` (bez SL) – `max_risk` se nevyhodnotí (porušení nese jen `sl_required`).

---

### Task 1: Čistý modul pravidel + testy

**Files:** Create `lib/discipline/rules.ts`, `scripts/check-discipline.mjs`

**Produces:**
- `type RuleId='sl_required'|'max_risk'|'max_trades_day'|'stop_after_losses'|'max_daily_loss'|'no_early_close'|'no_sl_widen'|'no_news'`
- `RULES:{id:RuleId;label:string;unit:'%'|'×'|null;def:{on:boolean;value:number|null};min?:number;max?:number;needsReason:boolean;help:string}[]` – hodnoty a texty přesně podle tabulky ve spec (`max_risk` 1 %, 0.1–20; `max_trades_day` 3, 1–50; `stop_after_losses` 2, 1–20; `max_daily_loss` 2 %, 0.1–50; ostatní value null; `no_news` vypnuto; `needsReason` jen `no_early_close`, `no_sl_widen`).
- `type RuleSettings=Record<RuleId,{on:boolean;value:number|null}>`; `normalizeSettings(raw:unknown):RuleSettings` (doplní výchozí, ořízne meze, ignoruje neznámé klíče).
- `type EvalTrade={id:string;accountId:string;side:'buy'|'sell';status:'open'|'closed';openTs:number;closeTs:number|null;openPrice:number;slInitial:number|null;tpInitial:number|null;riskPct:number|null;net:number;closeReason:string|null;balanceStart:number|null;slChanges:{ts:number;old:number|null;new:number|null}[];currencies:string[]}` (`currencies` = měny páru pro `no_news`, např. EURUSD → ['EUR','USD']).
- `type Violation={rule:RuleId;detail:Record<string,unknown>;needsReason:boolean}`
- `evaluate(t:EvalTrade,day:EvalTrade[],s:RuleSettings,news:{at:number;currencies:string[]}[]):Violation[]` – `day` = obchody téhož účtu otevřené týž pražský den (včetně `t`), seřazené podle `openTs`.
- `currenciesOf(symbol:string):string[]` – 6písmenné FX páry (i s příponou `.m`, `#`, `-ecn`) → dvě měny; ostatní → `[]`.

**Pravidla (detaily, které musí testy pokrýt):**
- `sl_required`: `slInitial===null` → porušení `{}`.
- `max_risk`: `riskPct!==null && riskPct>value` → `{riskPct,limit}`.
- `max_trades_day`: pořadí `t` v `day` (1-based) > value → `{n,limit}`.
- `stop_after_losses`: obchody v `day` **uzavřené před `t.openTs`** seřazené podle `closeTs`; počet posledních ztrátových (`net<0`) v řadě (zisk nebo nula řadu přeruší) ≥ value → `{losses,limit}`.
- `max_daily_loss`: součet `net` obchodů v `day` uzavřených před `t.openTs`; `balanceStart>0` a `-(součet)/balanceStart*100 ≥ value` → `{lossPct,limit}`; bez `balanceStart` se nevyhodnotí.
- `no_early_close`: `status==='closed'`, `closeReason` není `sl`/`tp`/`so` a (`slInitial!==null` nebo `tpInitial!==null` nebo některá změna SL má `new!==null`) → `{closeReason}`, `needsReason:true`.
- `no_sl_widen`: některá změna SL s `old!==null&&new!==null`, kde buy `new<old`, sell `new>old` → `{from:old,to:new,ts}` (první taková), `needsReason:true`.
- `no_news`: existuje zpráva s průnikem měn a `|at-openTs|≤15 min` → `{at}`.
- Vypnuté pravidlo nikdy nevrací porušení.

- [ ] Testy (konkrétní hodnoty, každé pravidlo hranice): SL `null` vs `1.1`; riziko 1.0 (ne) / 1.01 (ano); 3. obchod dne (ne) / 4. (ano); dvě ztráty v řadě pak obchod (ano), ztráta-zisk-ztráta (ne), ztráta uzavřená až po vstupu `t` (nepočítá se); denní ztráta 2 % ze zůstatku 10 000 = −200 (ano) / −199 (ne); zavření `client` s SL (ano), `sl`/`tp` (ne), `client` bez SL i TP (ne); posun SL buy 1.09→1.08 (ano), 1.09→1.095 (ne), sell 1.12→1.13 (ano); zpráva USD 14 min před vstupem EURUSD (ano), 16 min (ne), GBP (ne); vypnuté pravidlo; `normalizeSettings` (chybějící klíče → výchozí, hodnota mimo meze → oříznout, nesmysl → výchozí); `currenciesOf('EURUSD.m')`, `('XAUUSD')` → ['XAU','USD'], `('US500')` → [].
- [ ] Implementace, `node --experimental-strip-types scripts/check-discipline.mjs` → „vše ok“, `npx tsc --noEmit -p .`.
- [ ] Commit „Disciplína: pravidla a testy“.

### Task 2: Migrace, store, vyhodnocení při příjmu, backfill, API

**Files:** Create `drizzle/mariadb/0010_discipline.sql`, `lib/discipline/store.ts`, `app/api/rules/route.ts`, `app/api/strategies/route.ts`, `app/api/custom-rules/route.ts`, `scripts/discipline-backfill.mjs`; Modify `app/api/mt/ingest/route.ts`, `lib/mt/store.ts` (přenos/mazání při rebuild a smazání účtu), `app/api/trades/route.ts` (smazání ručního obchodu maže porušení – pro budoucí ruční review).

**Consumes:** Task 1 (`RULES`, `normalizeSettings`, `evaluate`, `currenciesOf`, typy).

**Migrace (jen tabulky fáze 1; `trade_reviews`, `notify_settings`, `push_subscriptions` přijdou v dalších fázích):**
- `rules_settings(user_id VARCHAR(64) PK, rules JSON/LONGTEXT NOT NULL, updated DATETIME NOT NULL)`
- `custom_rules(id VARCHAR(40) PK, user_id VARCHAR(64) NOT NULL, text VARCHAR(120) NOT NULL, position INT NOT NULL, created DATETIME NOT NULL, INDEX(user_id,position))`
- `strategies(id VARCHAR(40) PK, user_id VARCHAR(64) NOT NULL, name VARCHAR(60) NOT NULL, archived TINYINT(1) NOT NULL DEFAULT 0, created DATETIME NOT NULL, UNIQUE KEY(user_id,name))`
- `trade_violations(id BIGINT AUTO_INCREMENT PK, user_id VARCHAR(64) NOT NULL, trade_id VARCHAR(100) NOT NULL, rule VARCHAR(32) NOT NULL, detail LONGTEXT NOT NULL, needs_reason TINYINT(1) NOT NULL, reason_code VARCHAR(32) NULL, reason_text TEXT NULL, reasoned_at DATETIME NULL, notified_mail DATETIME NULL, notified_push DATETIME NULL, created DATETIME NOT NULL, UNIQUE KEY(trade_id,rule), INDEX(user_id,needs_reason,reasoned_at))`
- Délky `user_id` a `trade_id` sjednoť s existujícími tabulkami (`members.id`, `trade_checklists.trade_id`) – ověř v `drizzle/mariadb/0009_checklists.sql`.

**Store (`lib/discipline/store.ts`):**
- `getRuleSettings(d,userId):Promise<RuleSettings>` / `saveRuleSettings(d,userId,raw)` (normalizace).
- `listCustomRules`, `saveCustomRules(d,userId,items:{id?:string;text:string}[])` (celý seznam najednou, pořadí = pořadí v poli, zachová id, limity).
- `listStrategies`, `createStrategy(d,userId,name)` (vrátí existující při shodě názvu bez ohledu na velikost písmen), `renameStrategy`, `archiveStrategy(d,userId,id,archived)`.
- `evaluateAccount(d,userId,accountId,positionIds?:string[])`: načte dotčené pozice (nebo všechny), pro každý pražský den dotčených pozic načte všechny pozice účtu toho dne, `mt_position_changes` (kind `sl`), zůstatek na začátku dne (nejbližší `mt_snapshots.balance` před začátkem dne, jinak `balance` z prvního dealu dne v `mt_events` – zvol jednodušší spolehlivou cestu a popiš ji), zprávy z kalendáře (najdi, odkud bere kalendář `/api/fundamentals`/`lib/fundamentals.ts`; jen když je `no_news` zapnuté; signál 3), spustí `evaluate` a `INSERT IGNORE` porušení s `trade_id='mt:'+position.id`. Nová porušení jen přidává; existující nemaže (Review Focus 4) – výjimka: porušení, které po přepočtu stejné pozice už neplatí **a nemá zdůvodnění**, se smaže (např. EA doposlal SL).
- Výkon: jeden dotaz na pozice dne, ne N+1; při běžné dávce EA (1–3 pozice) ≤ 5 dotazů.

**Ingest:** po `snapshotNewPositions` zavolat `evaluateAccount(d,a.userId,accountId,dotčené pozice)` v try/catch (`console.error('discipline',accountId,e)`); dotčené = pozice z `rebuildPositions` / událostí dávky (stejný zdroj jako rebuild).

**Úklid:** v `rebuildPositions` přenést `trade_violations` z `mt:<old>` na `mt:<target>` (`UPDATE IGNORE` + smazání zbytku) vedle `trade_checklists`; `deleteAccount` maže porušení pozic účtu; DELETE ručního obchodu maže `man:<id>`.

**API:**
- `GET/PUT /api/rules` → `{rules:RuleSettings, defs:RULES}` / PUT `{rules}`.
- `GET/POST/PATCH /api/strategies` → `{strategies}`; POST `{name}` (vrátí `{id}`), PATCH `{id,name?,archived?}`.
- `GET/PUT /api/custom-rules` → `{rules:{id,text}[]}`; PUT `{rules:[{id?,text}]}`.
- Chyby česky `{error}` se status 400; limity podle Global Constraints.

**Backfill:** `scripts/discipline-backfill.mjs` (Node, `.mariadb.env` jako `scripts/smoke` vzory v repu – najdi existující skript s DB připojením, např. `scripts/mt-rebuild.mjs`) zavolá `evaluateAccount` pro všechny MT účty; idempotentní.

- [ ] Implementace + `npx tsc --noEmit -p .`, `check-discipline`, `check-mt`, `check-journal`, `check-checklists` vše ok.
- [ ] Commit „Disciplína: data, vyhodnocení a API“.

### Task 3: Stránka `/pravidla`

**Files:** Create `app/pravidla/page.tsx`, `app/rules-page.tsx`, `app/rules.css`; Modify `app/checklisty/page.tsx` (přesměrování na `/pravidla`), `app/shell.tsx` (odkaz „Pravidla a strategie“ místo „Checklisty“), případné odkazy na `/checklisty` v `app/checklist-card.tsx` a jinde (grep).

**Consumes:** API z Task 2, stávající `app/checklists-page.tsx` (vložit jako sekci „Checklisty“, neměnit chování).

- Stránka ve stylu `/mt` a `/checklisty` (`mt-page`, `mt-card`), nadpis „Pravidla a strategie“, krátký úvod.
- **Automatická pravidla:** karta s řádky: přepínač (checkbox switch), název, nápověda (`help`), číselné pole s jednotkou (jen u pravidel s hodnotou, disabled když vypnuto), štítek „chce zdůvodnění“ u `needsReason`. Ukládá se po změně (debounce 600 ms) přes PUT `/api/rules`, stav „Uloženo“ / chyba česky.
- **Vlastní pravidla:** seznam s přidáním, úpravou textu, smazáním, posunem ↑↓ (vzor editoru bodů v `checklists-page.tsx`), uložit tlačítkem; limity.
- **Strategie:** seznam (aktivní, pod tím „Archivované“ sbalené), přidat, přejmenovat inline, archivovat / obnovit.
- **Checklisty:** stávající obsah `checklists-page.tsx` jako sekce (komponenta beze změny logiky).
- Barvy z tokenů, mobil, tmavý motiv, `usePalette`.
- [ ] `npx tsc --noEmit -p .`, `npm run build`.
- [ ] Commit „Disciplína: stránka Pravidla a strategie“.

### Task 4: Kontrola, nasazení, backfill
- [ ] Závěrečná kontrola větve + opravy.
- [ ] Merge do main, push, na VPS: migrace `0010` před restartem, build, restart, pak `node --experimental-strip-types scripts/discipline-backfill.mjs`.
- [ ] Ověření v prohlížeči: `/pravidla` (změna hodnoty pravidla, strategie, vlastní pravidlo), `/checklisty` přesměruje; v DB porušení u existujících obchodů (Jindřichova pozice EURUSD 10 lotů bez SL → `sl_required`).
