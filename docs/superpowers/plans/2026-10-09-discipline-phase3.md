# Disciplína – fáze 3: výzvy ke zdůvodnění a dlaždice Disciplína

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Porušení `no_early_close` a `no_sl_widen` bez zdůvodnění se uživateli připomenou: okno v aplikaci při otevření Tradee (s možností „Později“ na 4 h), odznak s počtem u položky Journaling v menu a dlaždice **Disciplína** na Dashboardu.

**Spec:** `docs/superpowers/specs/2026-10-09-journaling-discipline-design.md` (Výzvy ke zdůvodnění, Nastavení upozornění, Dashboard, Data). Fáze 1–2 nasazené (`trade_violations`, `trade_reviews`, `/api/reviews/[id]`, `/api/journaling`, `lib/discipline/overview.ts`, záložka `#journaling`).

## Global Constraints
- Vlastnictví přes `user_id`; zápisy `sameOrigin` + `identity`; `?as=` jen GET; `Cache-Control: private, no-store`; chyby česky přes `failed`.
- MariaDB 10.6, kolace `utf8mb4_general_ci`, `user_id VARCHAR(128)` jako v 0010/0011; migrace `drizzle/mariadb/0012_notify.sql` se aplikuje `python3 scripts/mariadb-migrate.py`.
- Důvody z `REASONS` v `lib/discipline/rules.ts` (u `other` text povinný, text ≤ `REVIEW_LIMITS`), validace stejná jako v `saveReview`.
- Barvy jen z tokenů (výjimka: existující warn barva `#b45309` / dark `#f0a24b` jako v `app/journaling/journaling.css`), české texty a skloňování, kompaktní TSX, hooks před early return, mobil ≤ 640 px, tmavý motiv, přístupnost (dialog `role="dialog"`, `aria-modal`, fokus do okna, Esc = Později).

## Review Focus
1. Okno se nesmí ukázat adminovi v cizím pohledu ani na stránkách mimo hlavní aplikaci (`/pravidla`, `/mt`, `/admin`).
2. „Později“ odloží na 4 h na serveru (jiné zařízení / reload okno neukáže); nové porušení vzniklé během odložení okno neukáže do konce odložení, odznak ale počítá hned.
3. Porušení, které mezitím zmizelo nebo už má zdůvodnění (uložené v Journalingu) – okno ho přeskočí, uložení vrátí 404/ignoruje bez pádu.
4. Uživatel s vypnutým „Okno v aplikaci“ (`popup=0`) okno nevidí, odznak ano.
5. Dlaždice Disciplína respektuje sdílený výběr účtu z Dashboardu (`account`) a období z „Můj trading“ (pokud není dostupné, Měsíc).

---

### Task 1: Data, API, okno, odznak, dlaždice

**Files:** Create `drizzle/mariadb/0012_notify.sql`, `app/api/violations/pending/route.ts`, `app/api/violations/reason/route.ts`, `app/api/notify/route.ts`, `app/reason-prompt.tsx`, `app/reason-prompt.css`, `app/discipline-tile.tsx`; Modify `lib/discipline/store.ts`, `app/shell.tsx` (odznak u Journaling), `app/tradee.tsx` (okno + počet do Shellu), `app/dashboard.tsx` (dlaždice za `OpenPositionsCard`, přečíslovat `tile()`), `app/desk.css` nebo nový CSS soubor pro dlaždici.

**Migrace 0012:** `notify_settings(user_id VARCHAR(128) PK, popup TINYINT(1) NOT NULL DEFAULT 1, mail TINYINT(1) NOT NULL DEFAULT 1, push TINYINT(1) NOT NULL DEFAULT 0, snooze_until DATETIME NULL, last_mail DATETIME NULL, updated DATETIME NOT NULL)`.

**Store:**
- `pendingReasons(d,userId)` → `{id:number;tradeId:string;rule:string;detail:Record<string,unknown>;created:string;trade:{symbol:string;side:string|null;closeTs:number|null;net:number|null;currency:string|null}}[]` – porušení `needs_reason=1 AND reason_code IS NULL`, nejstarší první, max. 20; údaje obchodu joinem na `mt_positions`/`mt_accounts` (MT) – ruční obchody tato pravidla nemají.
- `saveViolationReason(d,userId,id,code,text)` → `boolean` (false = neexistuje / cizí / už zdůvodněno) – `UPDATE … WHERE id=? AND user_id=? AND needs_reason=1 AND reason_code IS NULL`.
- `getNotify(d,userId)` → `{popup,mail,push,snoozeUntil:number|null}` (výchozí řádek, když chybí); `setNotify(d,userId,{popup?,mail?,push?})`; `snooze(d,userId,hours=4)`.

**API:**
- `GET /api/violations/pending` → `{items, count, showPopup}`; `showPopup = popup && (snoozeUntil===null || snoozeUntil<now) && count>0`; s `?as=` (admin) vždy `showPopup:false`.
- `POST /api/violations/reason` `{id,code,text?}` → `{ok:true}` / 404 „Porušení už není k zdůvodnění.“
- `GET /api/notify` → nastavení; `PUT /api/notify` `{popup?,mail?,push?}`; `POST /api/notify` `{action:'snooze'}` → `{snoozeUntil}`.

**UI:**
- `app/tradee.tsx`: po načtení (a pak každých 5 min, jen když je stránka viditelná) `GET /api/violations/pending`; `count` předat do `Shell` → odznak (malé číslo, warn barva) u položky Journaling v menu i na mobilu; když `showPopup`, otevřít `ReasonPrompt`.
- `ReasonPrompt` (modální okno): nadpis „Proč jsi …?“ podle pravidla (`no_early_close`: „Zavřel jsi {pár} dřív, proč?“, `no_sl_widen`: „Posunul jsi SL u {pár} proti sobě, proč?“), podtitul s výsledkem a časem zavření (`money`, datum Praha), detail (např. „SL 1,0950 → 1,0920“), výběr důvodu (chipy z `REASONS`), textarea (u „Jiné“ povinná), tlačítka „Uložit“ (→ další výzva, po poslední zavřít + přepočítat odznak), „Později“ (`POST /api/notify {action:'snooze'}`, zavřít), odkaz „Otevřít v Journalingu“ (`#journaling/<tradeId>`); „1 z N“. Chyby česky. Esc = Později.
- `DisciplineTile` na Dashboardu: data `/api/journal` (už je na Dashboardu načteno – použij existující `trades`, pokud jsou dostupné v `dashboard.tsx`, jinak fetch) + `/api/journaling`; `overview()` pro vybraný účet a období Měsíc (stejné filtrování jako `MyTrading` – `filterTrades`); zobrazit Disciplína % (barva: ≥ 80 bull, 50–79 warn, < 50 bear), „N obchodů bez porušení z M“, nejčastěji porušené pravidlo, počet výzev ke zdůvodnění (warn chip) – klik na dlaždici → `#journaling`. Bez posouzených obchodů: „Zatím žádné obchody k posouzení“ a odkaz na `/pravidla`.
- [ ] `npx tsc --noEmit -p .`, `npm run build`, check-discipline/check-journaling/check-journal vše ok.
- [ ] Commit „Disciplína: výzvy ke zdůvodnění, odznak a dlaždice“.

### Task 2: Kontrola + nasazení
- [ ] Závěrečná kontrola + opravy; merge, push, VPS: migrace 0012 před restartem, build, restart.
- [ ] Ověření v prohlížeči: vložit testovací porušení `no_early_close` k vlastní MT pozici? (vlastní MT účet má pozici – jinak dočasný řádek v DB pro existující pozici uživatele), okno se ukáže, „Později“ ho skryje i po reloadu, zdůvodnění uloží; dlaždice a odznak; test data smazat.
