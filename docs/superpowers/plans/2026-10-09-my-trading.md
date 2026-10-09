# Traderský Dashboard „Můj trading“ – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nahoře na Dashboardu karta „Můj trading“ (výběr účtu společný s Deníkem, přepínač Týden/Měsíc/Rok/Vše, P&L, obchody, win rate, aktuální a nejdelší série, max drawdown, P&L graf období, graf celkového zisku); stávající karta P&L se do ní sloučí.

**Architecture:** Data z `/api/journal` (stejná jako Deník), výpočty z `lib/journal/stats.ts` (doplněné o období `week`, `currentStreak` a série ignorující nulové obchody), sdílená volba účtu v `app/journal/account-pref.ts` (localStorage `tradee.account`), nová klientská komponenta `app/my-trading.tsx`.

**Tech Stack:** React (vinext/Next 16 klient), čisté TS moduly s testy (`node --experimental-strip-types`).

**Spec (schváleno v chatu 9. 10. 2026):**
- Umístění: úplně nahoře na Dashboardu pod pozdravem, široká karta; nahrazuje kartu P&L; ostatní karty beze změny (kalendář obchodů dál se všemi účty).
- Hlavička: výběr účtu (Všechny účty · každý MT účet · Ručně zapsané – „Ručně“ jen když ruční obchody existují), přepínač období Týden (od pondělí, Praha) / Měsíc / Rok / Vše; obojí se pamatuje; účet je **společný s Deníkem** (změna na jednom místě platí i na druhém).
- Čísla: P&L za období (měna souhrnu, štítek úspěšnosti), Obchody (počet · v zisku · ve ztrátě), Win rate, Série (aktuální „🔥 N výher v řadě“ / „N proher v řadě“ + nejdelší výher/proher v období; **nulový obchod sérii nepřeruší ani neprodlouží**), Max drawdown v období.
- Grafy: P&L v období (sloupce po dnech, u roku po měsících, + průběžný součet, hover) – u „Vše“ se nezobrazuje; Celkový zisk = křivka za celou historii vybraného účtu s hover.
- Bez obchodů: výzva „Připoj MetaTrader“ (/mt) a „Zapsat obchod“ (posun ke kalendáři obchodů).
- Sjednocení: i v Deníku se nulový obchod do sérií nepočítá.

## Global Constraints

- Čísla na Dashboardu = čísla v Deníku pro stejný účet a období (stejná data i funkce).
- Období v pražském čase; týden začíná pondělím.
- Sdílený klíč volby účtu `tradee.account` (hodnota `all` | id MT účtu | `manual`); neexistující účet → `all`.
- Barvy jen z tokenů (`--bull`, `--bear`, `--bull-text`, `--bear-text`, `--t-*`); české texty; kompaktní TS/TSX; hooks před early return.
- Testy: `scripts/check-journal.mjs` (vše ok) + ostatní `check-*.mjs`, `npx tsc --noEmit -p .`, `npm run build`.

## Review Focus

- **Nulový obchod uprostřed série** → série pokračuje (pin: Task 1 testy).
- **Týden přes neděli/pondělí a změnu času** → od pondělí v Praze (pin: Task 1 test `periodRange` week).
- **Smazaný účet uložený jako volba** → `all` (pin: Task 2 `readAccount` + sanitize).
- **Žádné obchody / jen ruční obchody** → výzva / bez R a bez chyb (pin: Task 3).
- **Rozložení Dashboardu** se nesmí rozbít (pin: Task 3, kontrola tile() a mřížky).

---

### Task 1: Statistiky – týden, aktuální série, série bez nul

**Files:** Modify `lib/journal/stats.ts`, `scripts/check-journal.mjs`

**Produces:** `Period` rozšířený o `'week'`; `periodRange` pro `week`; `streaks` ignoruje nulové obchody; `currentStreak(trades):{kind:'win'|'loss'|null;count:number}`.

- [ ] **Step 1: Testy** – do `scripts/check-journal.mjs` přidej `currentStreak` do importu ze `stats.ts` a nad `if(fails.length)`:
```js
// --- série bez nul, aktuální série, týden
const st=(id,day,pnl)=>({...A,id,date:`2026-10-${String(day).padStart(2,'0')}`,closeTs:Date.UTC(2026,9,day,10),pnl});
const zz=[st('z1',1,10),st('z2',2,0),st('z3',3,5),st('z4',4,-3),st('z5',5,0),st('z6',6,-1)];
const sz=summary(zz);
check('série: nula nepřeruší',sz.maxWinStreak===2&&sz.maxLossStreak===2,sz);
check('aktuální série: prohry přes nulu',JSON.stringify(currentStreak(zz))==='{"kind":"loss","count":2}',currentStreak(zz));
check('aktuální série: výhry',JSON.stringify(currentStreak([st('a',1,-1),st('b',2,5),st('c',3,1)]))==='{"kind":"win","count":2}');
check('aktuální série: jen nuly / prázdné',JSON.stringify(currentStreak([st('a',1,0)]))==='{"kind":null,"count":0}'&&JSON.stringify(currentStreak([]))==='{"kind":null,"count":0}');
check('aktuální série: pořadí podle zavření',currentStreak([st('b',5,-2),st('a',4,3)]).kind==='loss');
check('týden od pondělí',JSON.stringify(periodRange(F({period:'week'}),Date.UTC(2026,9,8,10)))==='["2026-10-05","2026-10-08"]',periodRange(F({period:'week'}),Date.UTC(2026,9,8,10)));
check('týden: neděle patří k týdnu od pondělí',periodRange(F({period:'week'}),Date.UTC(2026,9,11,20))[0]==='2026-10-05');
check('týden: pondělí po půlnoci v Praze',periodRange(F({period:'week'}),Date.UTC(2026,9,11,22,30))[0]==='2026-10-12');
check('týden přes změnu času',periodRange(F({period:'week'}),Date.UTC(2026,9,26,10))[0]==='2026-10-26');
```
(`A` a `F` už v souboru existují. Původní test „souhrn: série a drawdown“ musí dál projít – jeho data mají nulu až na konci.)
Run: `node --experimental-strip-types scripts/check-journal.mjs` → FAIL / chyba importu `currentStreak`.

- [ ] **Step 2: `lib/journal/stats.ts`**
  - `export type Period='week'|'month'|'30d'|'90d'|'year'|'all'|'custom';`
  - v `periodRange` na začátek větví:
```ts
 if(f.period==='week'){const wd=(new Date(today+'T12:00:00Z').getUTCDay()+6)%7;return [pragueDate(Date.parse(today+'T12:00:00Z')-wd*DAY),today]}
```
  - `streaks` – nula sérii nemění:
```ts
export function streaks(trades:JournalTrade[]){let w=0,l=0,mw=0,ml=0;for(const t of [...trades].sort(byClose)){if(t.pnl>0){w++;l=0}else if(t.pnl<0){l++;w=0}mw=Math.max(mw,w);ml=Math.max(ml,l)}return {maxWinStreak:mw,maxLossStreak:ml}}
// aktuální série od posledního obchodu (nulové obchody se přeskakují)
export function currentStreak(trades:JournalTrade[]):{kind:'win'|'loss'|null;count:number}{
 const s=[...trades].sort(byClose).filter(t=>t.pnl!==0);if(!s.length)return {kind:null,count:0};
 const kind=s[s.length-1].pnl>0?'win' as const:'loss' as const;let count=0;
 for(let i=s.length-1;i>=0&&(s[i].pnl>0)===(kind==='win');i--)count++;
 return {kind,count};
}
```
  - Ověř, že filtr období v Deníku (`app/journal/filters.tsx`, `PERIODS`) `week` nenabízí – ponech ho beze změny (Deník má vlastní výběr; `week` používá Dashboard).
- [ ] **Step 3:** testy → vše ok; `npx tsc --noEmit -p .` čisté (pokud tsc hlásí neúplný `switch`/mapu podle `Period`, doplň `week`).
- [ ] **Step 4: Commit** „Statistiky: týden, aktuální série, série bez nulových obchodů“

---

### Task 2: Společná volba účtu (Dashboard ↔ Deník)

**Files:** Create `app/journal/account-pref.ts`; Modify `app/journal/journal.tsx`

**Produces:** `readAccount():string` (z `localStorage['tradee.account']`, výchozí `'all'`, v try/catch), `writeAccount(v:string)`.

- [ ] **Step 1:** `app/journal/account-pref.ts`:
```ts
// Volba účtu společná pro Dashboard („Můj trading“) a Deník.
const KEY='tradee.account';
export function readAccount():string{try{return localStorage.getItem(KEY)||'all'}catch{return 'all'}}
export function writeAccount(v:string){try{localStorage.setItem(KEY,v)}catch{}}
```
- [ ] **Step 2:** `app/journal/journal.tsx` – jen pro vlastní deník (ne `viewAs`): počáteční `filter.account` = `readAccount()` (přepíše hodnotu z uloženého filtru); při změně `filter.account` zavolej `writeAccount`. `sanitizeFilter` po načtení dat už neexistující účet vrátí na `all` – v tom případě zapiš i `all`. Cizí deník (`viewAs`) se sdílenou volbou nepracuje.
- [ ] **Step 3:** tsc + build; **Commit** „Deník: volba účtu společná s Dashboardem“

---

### Task 3: Karta „Můj trading“ na Dashboardu

**Files:** Create `app/my-trading.tsx`; Modify `app/dashboard.tsx`, `app/desk.css`, `app/journal/stats-view.tsx` (export `Curve`)

**Consumes:** `/api/journal` (`JournalList`), `filterTrades`, `summary`, `equityCurve`, `currentStreak`, `sanitizeFilter`, `DEFAULT_FILTER`, `Period` (Task 1), `readAccount`/`writeAccount` (Task 2), `periodStats` + `fmtMoney` z `lib/trades.ts`, `PnlChart` z `app/dashboard.tsx` (exportovat), `Curve` z `app/journal/stats-view.tsx` (exportovat).

- [ ] **Step 1: Exporty** – v `app/journal/stats-view.tsx` změň `function Curve` na `export function Curve`; v `app/dashboard.tsx` exportuj `PnlChart` (pokud ho `my-trading.tsx` importuje z `./dashboard`, pozor na cyklický import – raději přesuň `PnlChart` a `barPath` do nového `app/pnl-chart.tsx` a importuj ho v obou souborech).
- [ ] **Step 2: `app/my-trading.tsx`** (`'use client'`), `export function MyTrading({now,onAddTrade}:{now:number;onAddTrade:()=>void})`:
  - načte `/api/journal` (stejně jako `Journal.reload`), stav načítání / chyba (krátká hláška + „Zkusit znovu“);
  - `account` = `readAccount()` (po načtení dat `sanitizeFilter` → neexistující → `all` + `writeAccount('all')`), `period` z localStorage `tradee.mytrading.period` (výchozí `month`);
  - hlavička: nadpis „Můj trading“, `<select>` účtů (`all`→„Všechny účty“, MT účty podle `accounts` (jméno), `manual`→„Ručně zapsané“ jen když existují ruční obchody), segment Týden/Měsíc/Rok/Vše (styl `.d-seg sm` jako dosud u P&L);
  - `list=filterTrades(trades,{...DEFAULT_FILTER,account,period},now)`, `s=summary(list)`, `cur=currentStreak(list)`;
  - KPI řada (styl jako `.d-kv` / karty Dashboardu): **P&L** (`fmtMoney(s.total,currency)`, barva podle znaménka, štítek „X % úspěšnost“), **Obchody** (`s.count`, malým „Y v zisku · Z ve ztrátě“), **Win rate** (`s.winRate` nebo „—“), **Série** (`cur.kind==='win'`: „🔥 N výher v řadě“, `loss`: „N proher v řadě“, jinak „—“; malým „nejdelší: A výher · B proher“; skloňování výhra/výhry/výher, prohra/prohry/proher), **Max drawdown** (`s.maxDrawdown? fmtMoney(-s.maxDrawdown) : '—'`);
  - grafy: **P&L v období** – pro `week|month|year` `PnlChart` s buckety `periodStats(list.map(t=>({…t,created:''})) as any,period,today).buckets` (převeď `JournalTrade` na tvar `Trade` minimálně: `id,date,instrument:symbol,pnl,note:'',created:''`), popisky jako dosavadní karta P&L (hover titulky stejné); pro `all` se nezobrazí. **Celkový zisk** – `Curve` z `equityCurve(filterTrades(trades,{...DEFAULT_FILTER,account},now))` (celá historie, jen účet), nadpis „Celkový zisk · celá historie“;
  - prázdný stav (`list.length===0` a zároveň žádné obchody na účtu vůbec): text „Zatím tu nejsou žádné obchody.“ + odkaz „Připoj MetaTrader“ (`/mt`) + tlačítko „Zapsat obchod“ (`onAddTrade`). Když účet obchody má, ale období ne: „V tomto období žádné obchody.“ a graf celkového zisku zůstane.
- [ ] **Step 3: `app/dashboard.tsx`** – vlož `<MyTrading now={now} onAddTrade={()=>document.querySelector('.d-cal')?.scrollIntoView({behavior:'smooth',block:'start'})}/>` jako první kartu (široká přes celou mřížku, `tile(0)`), přečísluj `tile()` dalších karet sekvenčně; odstraň kartu `d-pnl` a s ní nepoužívané proměnné (`ps`, `period`, `periodLabel` …) – `useTrades` zůstane kvůli kalendáři obchodů. Zkontroluj grid spany v `app/desk.css` (nová karta `grid-column:1/-1`), aby se zbytek nerozhodil (dřív stála `d-pulse`(7)+`d-pnl`(5) vedle sebe – po odstranění P&L uprav `d-pulse` na plnou šířku nebo ji spáruj tak, aby řada vyplnila 12 sloupců).
- [ ] **Step 4: CSS** (`app/desk.css`, třídy `d-mt-*`): KPI mřížka 5 sloupců → na ≤ 860 px 2 sloupce; dva grafy vedle sebe → pod sebou na ≤ 860 px; jen tokeny.
- [ ] **Step 5:** tsc + build; **Commit** „Dashboard: karta Můj trading“

---

### Task 4: Nasazení (po souhlasu Daniela)

- [ ] všechny `check-*.mjs` (kromě dlouhodobě padajícího `check-score.mjs`), tsc, build; merge, push; VPS rebase, build, restart (bez migrace).
- [ ] Kontrola v prohlížeči: Dashboard nahoře „Můj trading“, přepnutí účtu se projeví v Deníku a naopak, období, hover obou grafů, mobil 390 px, světlý/tmavý režim.
