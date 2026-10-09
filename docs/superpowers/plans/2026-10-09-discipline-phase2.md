# Disciplína – fáze 2: záložka Journaling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Samostatná záložka **Journaling** v hlavním menu: přehled disciplíny, seznam obchodů s hodnocením a porušeními a panel vyhodnocení (★, strategie, důvod vstupu, pravidla se zdůvodněním, emoce, ponaučení).

**Architecture:** Migrace `0011_reviews.sql` (`trade_reviews`); čistý modul `lib/discipline/overview.ts` (výpočty přehledu) s testy; store funkce v `lib/discipline/store.ts`; API `GET /api/journaling` (mapy review a porušení k obchodům, `?as=`) a `GET/PUT /api/reviews/[id]`; klient `app/journaling/*` jako nový `View` `'journaling'` v `app/shell.tsx` / `app/tradee.tsx`. Seznam obchodů se bere ze stávajícího `GET /api/journal` (`JournalList`), filtry z `lib/journal/stats.ts`.

**Tech Stack:** vinext (Next 16 App Router) na Cloudflare Workers runtime, MariaDB 10.6 přes `lib/mysql.ts`, testy `node --experimental-strip-types scripts/check-*.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-09-journaling-discipline-design.md` (sekce Záložka Journaling, Data). Fáze 1 je nasazená (`/pravidla`, `trade_violations`, `strategies`, `custom_rules`).

## Global Constraints

- Vlastnictví přes `user_id` (MT obchody přes `mt_accounts.user_id`, ruční přes `trades.user_id` – ověř existující `tradeMarket` v `lib/checklists/store.ts`); zápisy `sameOrigin` + `identity`; `?as=` (`viewAs`) jen GET; `Cache-Control: private, no-store`.
- ID obchodu = ID z Deníku (`mt:<position id>` / `man:<id>`), stejně jako `trade_checklists`.
- Limity: důvod vstupu a ponaučení ≤ 2000 znaků, zdůvodnění porušení text ≤ 500, emoce jen z pevného seznamu, hodnocení 1–5 nebo null.
- Emoce: `calm` Klid, `confident` Sebevědomí, `fear` Strach, `fomo` FOMO, `boredom` Nuda, `tired` Únava, `revenge` Pomsta, `greed` Chamtivost.
- Důvody zdůvodnění: `market` Změnil se trh, `news` Zprávy / událost, `target` Splněný cíl, `fear` Strach, `tired` Únava, `plan` Chyba v plánu, `other` Jiné (u `other` text povinný).
- Barvy jen z tokenů, české texty a skloňování, kompaktní TSX ve stylu repa, hooks před early return, mobil ≤ 640 px, světlý i tmavý motiv.

## Review Focus

1. Uložení zdůvodnění porušení, které mezitím zmizelo (EA doposlal SL) – PUT nesmí spadnout, jen ignoruje neexistující porušení.
2. Strategie napsaná při vyhodnocení, která už existuje (i archivovaná) – použije se existující (`createStrategy` to umí).
3. Admin v cizím deníku (`?as=`) – Journaling jen ke čtení, PUT nedostupné (UI bez tlačítek).
4. Smazání ručního obchodu / MT účtu / přeskupení MT pozic – `trade_reviews` se maže / přenáší stejně jako `trade_violations` a `trade_checklists`.
5. Obchod bez review a bez porušení – v přehledu se počítá do disciplíny jen jako MT obchod (vyhodnocená pravidla); ruční obchod bez review se do disciplíny nepočítá.

---

### Task 1: Data, výpočty přehledu, API

**Files:** Create `drizzle/mariadb/0011_reviews.sql`, `lib/discipline/overview.ts`, `scripts/check-journaling.mjs`, `app/api/journaling/route.ts`, `app/api/reviews/[id]/route.ts`; Modify `lib/discipline/store.ts`, `lib/discipline/rules.ts` (konstanty emocí a důvodů – klient je potřebuje), `lib/mt/store.ts` (carry + delete `trade_reviews`), `app/api/trades/route.ts` (DELETE maže `trade_reviews` `man:<id>`).

**Migrace:** `trade_reviews(user_id VARCHAR(128) NOT NULL, trade_id VARCHAR(100) NOT NULL, rating TINYINT NULL, strategy_id VARCHAR(40) NULL, reason TEXT NULL, emotions VARCHAR(255) NOT NULL DEFAULT '', lesson TEXT NULL, custom_broken LONGTEXT NULL, updated DATETIME NOT NULL, PRIMARY KEY(user_id,trade_id), INDEX(user_id,strategy_id))` – kolace `utf8mb4_general_ci`.

**Produces (`lib/discipline/overview.ts`, čisté):**
- `type ReviewLite={rating:number|null;strategyId:string|null;emotions:string[]}`
- `type ViolationLite={rule:string;needsReason:boolean;reasoned:boolean}`
- `type CustomBroken=string[]` (id vlastních pravidel)
- `overview(trades:JournalTrade[],reviews:Record<string,ReviewLite>,violations:Record<string,ViolationLite[]>,custom:Record<string,string[]>,strategies:{id:string;name:string}[])` → `{discipline:number|null /* % 0–100 */,judged:number,clean:number,top:{rule:string;count:number}|null,avgRating:number|null,toReview:number,needReason:number,byStrategy:{id:string|null;name:string;trades:number;winRate:number;pnl:number;avgRating:number|null}[]}`
  - „Posouzený“ obchod (judged) = MT obchod (`source==='mt'`) nebo obchod s review; „čistý“ = posouzený bez porušení (automatických) a bez zaškrtnutých vlastních pravidel.
  - `discipline` = clean/judged×100 zaokrouhleno na celé, null když judged=0.
  - `top` = nejčastější pravidlo (automatická id i vlastní `custom:<id>`), remíza → abecedně.
  - `toReview` = obchody bez `rating`; `needReason` = porušení `needsReason && !reasoned`.
  - `byStrategy` seřazené podle počtu obchodů, „Bez strategie“ (id null) poslední; winRate = podíl `pnl>0` v %.
- `trend(cur:number|null,prev:number|null):number|null` = rozdíl v procentních bodech.

**Store:** `listReviews(d,userId)` → mapa `trade_id → ReviewLite + custom_broken`; `listViolations(d,userId)` → mapa `trade_id → ViolationLite[]`; `getReview(d,userId,tradeId)` → `{review, violations:{id,rule,detail,needsReason,reasonCode,reasonText}[]}`; `saveReview(d,userId,tradeId,input)` (validace limitů, strategie přes `strategyId` nebo `strategyName` → `createStrategy`, upsert, zdůvodnění porušení `{[rule]:{code,text}}` → `UPDATE trade_violations SET reason_code,reason_text,reasoned_at WHERE user_id=? AND trade_id=? AND rule=? AND needs_reason=1`; neexistující porušení ignorovat).
- Ověření vlastnictví obchodu: `tradeMarket(d,userId,kind,id,ids)` z `lib/checklists/store.ts` vrací `undefined` pro cizí/neexistující obchod → 404.

**API:**
- `GET /api/journaling` (`?as=`) → `{reviews, violations, custom:CustomRule[], strategies:Strategy[], rules:RuleSettings}` (obchody si klient bere z `/api/journal` se stejným `?as=`).
- `GET /api/reviews/[id]` (`?as=`) → `getReview` + `checklist` (snímek z `tradeChecklist`) ; `PUT /api/reviews/[id]` `{rating?,strategyId?,strategyName?,reason?,emotions?,lesson?,customBroken?,reasons?}` → uložené review.
- Chyby česky (`failed`), 404 pro cizí obchod.

- [ ] Testy `scripts/check-journaling.mjs` (konkrétní data): 3 MT obchody (1 s porušením `sl_required`) + 1 ruční s review bez porušení + 1 ruční bez review → judged 4, clean 3, discipline 75; vlastní pravidlo zaškrtnuté → obchod není čistý a `top` počítá `custom:<id>`; `toReview`, `needReason`; `byStrategy` pořadí, winRate, „Bez strategie“ poslední; `trend(80,75)=5`, `trend(null,5)=null`.
- [ ] Implementace, `npx tsc --noEmit -p .`, check-journaling/check-discipline/check-journal/check-mt/check-checklists vše ok.
- [ ] Commit „Journaling: data, přehled a API“.

### Task 2: Záložka Journaling (UI)

**Files:** Create `app/journaling/journaling.tsx`, `app/journaling/review-panel.tsx`, `app/journaling/journaling.css`; Modify `app/shell.tsx` (`View` + `'journaling'`, položka menu „Journaling“ vedle „Deník“, ikona z lucide, např. `NotebookPen`), `app/tradee.tsx` (render view; hash `#journaling` / `#journaling/<id>` jako `#journal`), `app/dashboard.tsx` není součástí (dlaždice Disciplína je fáze 3).

- **Přehled nahoře** (stejný výběr účtu a období jako „Můj trading“ – `readAccount/writeAccount` z `app/journal/account-pref.ts`, období Týden/Měsíc/Rok/Vše): dlaždice Disciplína % (+ trend vs. předchozí stejně dlouhé období), Nejčastěji porušené (název pravidla z `RULES`/vlastních), Průměr ★, K vyhodnocení (N) – klik zapne filtr; tabulka Podle strategie.
- **Seznam**: filtry z Deníku (`app/journal/filters.tsx` – použij, pokud jde bez úprav; jinak jen účet + období) + přepínače „Jen nevyhodnocené“, „Jen s porušením“; řádek: datum, pár, směr, výsledek (barva), ★ (5 malých hvězd), strategie, štítky porušení (červené, název pravidla), oranžový „Chybí zdůvodnění“.
- **Panel vyhodnocení** (vpravo, na mobilu přes celou obrazovku; URL `#journaling/<id>`):
  - ★ 1–5 (klik, znovu klik na stejnou = zrušit), strategie (select aktivních + „+ Nová strategie…“ s inputem), Proč jsem šel dovnitř (textarea), Pravidla: automatická porušení s popisem (`detail` lidsky: např. „Riziko 1,8 % (limit 1 %)“) a u `needsReason` výběr důvodu + text; nesplněné body checklistu při vstupu (jen zobrazení, ze snímku); vlastní pravidla jako checkboxy „porušil jsem“; Emoce (chipy, víc možností); Co příště jinak (textarea).
  - Tlačítka Uložit / Uložit a další (další nevyhodnocený v aktuálním filtru); stav ukládání a chyba česky; neuložené změny → potvrzení při zavření.
  - Vpravo/nahoře náhled: pár, směr, výsledek, R, doba držení, odkaz „Otevřít v Deníku“ (`#journal/<id>`); graf neřeš (fáze později).
  - `?as=` (admin) → jen čtení, bez tlačítek.
- Barvy z tokenů a palety (`--bull/--bear`), tmavý motiv, mobil.
- [ ] `npx tsc --noEmit -p .`, `npm run build`.
- [ ] Commit „Journaling: záložka s vyhodnocením obchodů“.

### Task 3: Kontrola + nasazení
- [ ] Závěrečná kontrola větve + opravy; merge, push, VPS: migrace `0011` před restartem, build, restart.
- [ ] Ověření v prohlížeči: Journaling (přehled, seznam, vyhodnocení testovacího obchodu → uložit → smazat test), Jindřichův deník přes admin (jen čtení, porušení „Vždy SL“).
