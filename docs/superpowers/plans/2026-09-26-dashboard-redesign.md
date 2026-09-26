# Tradee.ai Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dát aplikaci vzhled světlého dashboardu z ukázky (horní navigace, hero s maskoty, KPI dlaždice, karty) při zachování veškerého dnešního obsahu a dat.

**Architecture:** `app/tradee.tsx` zůstává držitelem stavu a dat (fetch `/api/fundamentals`, `/api/watchlist`, výpočet `marketScore`). Přibude `app/shell.tsx` (navigace + layout), `app/dashboard.tsx` (hero, KPI, karty) a `app/calendar.tsx`. Čisté výpočty pro dashboard jdou do `lib/dashboard.ts`, aby šly ověřit skriptem bez prohlížeče. Vzhled se řeší v `app/globals.css` novými tokeny a přepsáním tříd `.s-*` a `.n-*`.

**Tech Stack:** vinext (Next App Router na Vite), React 19, Tailwind 4 tokeny + vlastní CSS, lucide-react, sharp (úprava obrázků), Cloudflare Worker přes wrangler.

## Global Constraints
- Nemění se `lib/score-engine.ts`, `lib/markets.ts`, `lib/fundamentals.ts`, `data/`, `drizzle/`, `scripts/*.py`, `app/trading-app.tsx`, `app/fundamental-analyzer.tsx`.
- Texty česky. Pozdrav: „Dobré ráno“ 5–11 h, „Dobré odpoledne“ 11–18 h, jinak „Dobrý večer“, čas Europe/Prague. Jméno z `/api/watchlist` (`user.name`), fallback „Jindro“.
- Barvy: primární `#245bff`, kladné `#16a34a`, záporné `#dc2626`, text `#141518`, sekundární `#6b7280`, pozadí gradient `#f3f6fc → #e9eef8`, hranice karet `#e3e8f2`, zaoblení karet 18 px.
- Písmo: `Inter, "Segoe UI", system-ui, sans-serif`, bez externího načítání.
- Žádná nová runtime závislost. Grafy v inline SVG.
- Ověření každé úlohy: `npx tsc --noEmit` projde, poté ruční kontrola v prohlížeči na http://localhost:5173 (dev server běží z `D:\webs\Tradee.ai`).
- Projekt nemá testovací runner; čisté funkce se ověřují skriptem `node --experimental-strip-types`.

---

### Task 1: Brand assets (maskoti bez pozadí, přejmenování)

**Files:**
- Create: `scripts/prepare-brand-assets.mjs`
- Create (výstup): `public/brand/mascots-pair.png`, `public/brand/bull.png`, `public/brand/bear.png`, `public/brand/mascots-wordmark.png`, `public/brand/logo-chrome.png`, `public/brand/logo-chrome-wordmark.png`, `public/brand/logo-concepts.png`, `public/brand/mascots-pair-original.png`
- Delete: osm PNG s náhodnými názvy v `public/`

**Interfaces:**
- Produces: `/brand/mascots-pair.png` (průhledné pozadí, šířka 640 px) používaný v Task 5.

- [ ] **Step 1: Napsat skript**

```js
// scripts/prepare-brand-assets.mjs
import sharp from 'sharp';
import {mkdirSync, renameSync, existsSync, unlinkSync} from 'node:fs';
const src='public', out='public/brand'; mkdirSync(out,{recursive:true});
const map={
 '36300803-e3ff-47aa-85ca-baaef1c1264b.png':'bear-original.png',
 'fbf99909-6795-4aeb-a373-6c9aaecda49b.png':'bull-original.png',
 '8616235f-75c7-4814-a2f6-189ed95e3fcc.png':'mascots-pair-original.png',
 '33e7de03-a010-42c9-8a78-75d7caeed8bb.png':'mascots-wordmark.png',
 '18f78c64-b629-4a33-ac29-4fbb92ecbf8a.png':'mascots-pair-watermark.png',
 '09016f6e-f571-4c87-a0cd-6cab75e09634.png':'logo-chrome.png',
 'c6a1b3c7-8e7e-4465-aa18-929c8bd75491.png':'logo-chrome-wordmark.png',
 'd8b642e5-41d0-417d-9cea-d16c1d0cb9cd.png':'logo-concepts.png'};
for(const [from,to] of Object.entries(map)) if(existsSync(`${src}/${from}`)) renameSync(`${src}/${from}`,`${out}/${to}`);
// Odstranění bílého pozadí: pixel s r,g,b >= 242 dostane alpha 0, měkký přechod 225–242.
async function cutout(file){
 const img=sharp(`${out}/${file}`).ensureAlpha();
 const {data,info}=await img.raw().toBuffer({resolveWithObject:true});
 for(let i=0;i<data.length;i+=4){const m=Math.min(data[i],data[i+1],data[i+2]);if(m>=242)data[i+3]=0;else if(m>225)data[i+3]=Math.round(255*(242-m)/17)}
 return sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).trim().png().toBuffer();
}
const bull=await cutout('bull-original.png'), bear=await cutout('bear-original.png');
await sharp(bull).resize({height:520}).png({compressionLevel:9}).toFile(`${out}/bull.png`);
await sharp(bear).resize({height:520}).png({compressionLevel:9}).toFile(`${out}/bear.png`);
const b=await sharp(bull).resize({height:520}).toBuffer(), r=await sharp(bear).resize({height:520}).toBuffer();
const bm=await sharp(b).metadata(), rm=await sharp(r).metadata();
await sharp({create:{width:bm.width+rm.width-40,height:520,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
 .composite([{input:b,left:0,top:0},{input:r,left:bm.width-40,top:0}]).resize({width:640}).png({compressionLevel:9}).toFile(`${out}/mascots-pair.png`);
for(const f of ['mascots-wordmark.png','mascots-pair-watermark.png','logo-chrome.png','logo-chrome-wordmark.png','logo-concepts.png','mascots-pair-original.png']){
 const tmp=`${out}/tmp-${f}`; await sharp(`${out}/${f}`).resize({width:1200,withoutEnlargement:true}).png({compressionLevel:9,palette:true}).toFile(tmp); unlinkSync(`${out}/${f}`); renameSync(tmp,`${out}/${f}`);
}
console.log('done');
```

- [ ] **Step 2: Spustit** `node scripts/prepare-brand-assets.mjs` a zkontrolovat, že `public/brand/mascots-pair.png` existuje, má průhledné rohy a velikost pod 300 kB. Otevřít obrázek a vizuálně zkontrolovat okraje.

---

### Task 2: Identita uživatele pro pozdrav

**Files:**
- Modify: `app/api/watchlist/route.ts` (GET)

**Interfaces:**
- Produces: GET `/api/watchlist` → `{flags:Record<string,string>, user:{name:string;role:string}}`.

- [ ] **Step 1:** V GET přidat do odpovědi `user:{name:user.name,role:user.role}` (objekt `user` už vrací `identity(req)`).
- [ ] **Step 2:** Ověřit: `curl -s http://localhost:5173/api/watchlist` po přihlášení vrátí `"user":{"name":"Seedy","role":"member"}`.

---

### Task 3: Nové tokeny a základní vzhled karet

**Files:**
- Modify: `app/globals.css` (řádky 4–6 tokeny; řádek 28 světlé přepisy `.s-*`; řádek 29 `.n-*`; nový blok `.t-*` pro shell a dashboard)

- [ ] **Step 1:** V `:root` nastavit `--background:#f3f6fc; --card:#ffffff; --border:#e3e8f2; --muted-foreground:#6b7280; --radius:1rem; --font-sans:Inter,"Segoe UI",system-ui,sans-serif` a v `body` gradient `linear-gradient(180deg,#f3f6fc,#e9eef8) fixed`, `font-family` Inter.
- [ ] **Step 2:** Přepsat světlé přepisy: `.s-card{background:#fff;border:1px solid #e3e8f2;border-radius:18px;box-shadow:0 6px 24px -18px #1b2a5a33}`, `.score-v2 .positive{color:#16a34a}`, `.score-v2 .negative{color:#dc2626}`, `.s-market th{background:#f6f8fc}`, `.n-groups button.active{background:#245bff;border-color:#245bff}`, `.s-tabs [data-state=active]{background:#fff;box-shadow:0 1px 3px #0000000f}`.
- [ ] **Step 3:** Přidat blok `.t-*`:
  - `.t-app` (min-height 100vh), `.t-top` (sticky, bílá s blur, 64 px, flex), `.t-brand` (logo + text), `.t-nav` (flex, gap 4, položky `button` s ikonou, `.active` = `background:#e8efff;color:#245bff;border-radius:12px`), `.t-actions` (kruhová tlačítka 36 px), `.t-avatar` (36 px kruh #e8efff, modrá iniciála), `.t-main` (max-width 1440, padding 24).
  - `.t-hero` (grid 1fr auto, min-height 190, přetékající maskot `img` absolutně vpravo, `h1` 40 px váha 800), `.t-date` (bílá karta s ikonou kalendáře).
  - `.t-kpis` (grid 5 sloupců, gap 16), `.t-kpi` (karta, ikona v kruhu, `b` 28 px, `small` zelená/červená, SVG vpravo 64×36).
  - `.t-row` (grid `2fr 1fr`, gap 16), `.t-row3` (grid 3 sloupce), `.t-card-head` (flex mezi, `h2` 17 px 700, `.t-link` modrý odkaz), `.t-seg` (přepínače 1T/1M/3M/Vše), `.t-list` (řádky se stavem), `.t-check` (zelený kruh s fajfkou / šedý s hodinami), `.t-bar` (pruh 6 px), `.t-badge-high` (červené pozadí), `.t-badge-medium` (žluté), `.t-badge-low` (šedé).
  - Media: `≤1100px` KPI 3 sloupce, `.t-row` a `.t-row3` 1 sloupec; `≤760px` KPI 2 sloupce, hero bez maskota, `.t-nav` vodorovné scrollování.
- [ ] **Step 4:** `npx tsc --noEmit` (CSS nemá vliv, kontrola projde) a vizuálně zkontrolovat, že dnešní Analyzer vypadá dobře na novém pozadí.

---

### Task 4: Shell s horní navigací

**Files:**
- Create: `app/shell.tsx`
- Modify: `app/page.tsx`, `app/tradee.tsx` (řádky 27–38: stav `view`, výchozí hodnota, vykreslení)

**Interfaces:**
- Produces: `export type View='dashboard'|'analyzer'|'reports'|'calendar'`; `export function Shell({view,setView,busy,onRefresh,userName,children}:{view:View;setView:(v:View)=>void;busy:boolean;onRefresh:()=>void;userName:string;children:React.ReactNode})`.

- [ ] **Step 1:** `app/shell.tsx`: `'use client'`; položky `[['dashboard','Dashboard',LayoutDashboard],['analyzer','Analýza trhů',ChartNoAxesCombined],['reports','Reporty',Landmark],['calendar','Kalendář',CalendarDays]]`; vlevo `<a className="t-brand"><img src="/favicon.svg"/>Tradee</a>`, uprostřed `.t-nav`, vpravo `.t-actions`: tlačítko obnovit (`RefreshCw`, `disabled={busy}`, třída `spin` při busy), `.t-avatar` s první písmenem `userName`. Pod tím `<main className="t-main">{children}</main>` a `<footer className="t-footer">TRADEE.AI · Veřejná data. Dohledatelné výpočty. Vlastní rozhodnutí.</footer>`.
- [ ] **Step 2:** `app/page.tsx` zjednodušit na `<Tradee/>` (shell vykresluje Tradee sám).
- [ ] **Step 3:** V `tradee.tsx`: `view` typ `View`, výchozí `'dashboard'`; stav `userName` z `loadFlags` (`j.user?.name||'Jindra'`); obalit dnešní JSX do `<Shell …>`; odstranit `.n-topnav` blok; `view==='reports'` → `<Reports/>`, `view==='analyzer'` → dnešní analyzer/detail, `view==='dashboard'` a `'calendar'` zatím `null`. `open(id)` navíc nastaví `setView('analyzer')`.
- [ ] **Step 4:** tsc + prohlížeč: navigace přepíná, obnovit funguje, avatar ukazuje „S“ (Seedy) lokálně.

---

### Task 5: Výpočty pro dashboard

**Files:**
- Create: `lib/dashboard.ts`
- Create: `scripts/check-dashboard.mjs` (ověřovací skript)

**Interfaces:**
- Produces:
```ts
export type Row={id:string;name:string;group:string;r:ReturnType<typeof marketScore>};
export function kpis(rows:Row[],flags:Record<string,string>):{bullish:number;bearish:number;strongest:Row|null;freshness:number;flagged:number;inTrade:number}
export function greeting(now:Date):string // Dobré ráno / Dobré odpoledne / Dobrý večer
export function scoreSeries(history:{snapshots:{at:string;scores:Record<string,{score:number|null;method:string}>}[]},instrument:string,method:string,range:'1w'|'1m'|'3m'|'all',now:number):{at:string;score:number}[]
export function dataHealth(data:FundamentalData,market:MarketData,now:number):{label:string;ok:boolean;detail:string;usage:number}[]
export function recentChanges(history:…,now:number):{at:string;title:string;body:string}[] // posledních 5
export function upcomingEvents(data:FundamentalData,now:number,limit:number):FundamentalData['events']
```
- `freshness` = podíl trhů s `r.coverage===100` v procentech, zaokrouhlený.
- `dataHealth` řádky: `Fundament` (max stáří `data.checkedAt` vs `data.staleAfterHours`), `COT` (nejnovější `market.cot[*].history.at(-1).date` do 11 dní), `Ceny` (nejnovější `market.prices[*].asOf` do 7 dní), `Kontrola` (`market.refresh.attemptedAt` do 4 h + `issues.length`). `usage` = stáří / limit × 100, omezeno na 100.
- `recentChanges`: porovnat dva poslední snímky, pro každý trh s rozdílným `score` vytvořit záznam „EUR/USD: −21,7 → −18,3“, seřadit podle |rozdíl|, vzít 5; když jen jeden snímek, vrátit `[]`.

- [ ] **Step 1:** Implementovat podle rozhraní výše. Datum/čas pouze přes `Date` a `Europe/Prague` v `toLocaleString`.
- [ ] **Step 2:** `scripts/check-dashboard.mjs`: načte JSON z `data/`, sestaví `rows` přes `marketScore`, vypíše `kpis`, prvních 3 `recentChanges`, `dataHealth`, `upcomingEvents(…,3)`. Spustit `node --experimental-strip-types scripts/check-dashboard.mjs`; očekávané: bullish+bearish ≤ 51, `strongest` má nejvyšší |score|, freshness 0–100.

---

### Task 6: Dashboard stránka

**Files:**
- Create: `app/dashboard.tsx`
- Modify: `app/tradee.tsx` (vykreslení `view==='dashboard'`)

**Interfaces:**
- Consumes: Task 5 funkce, `rowsAll` (všechny trhy bez filtrů: `instruments.map(i=>({...i,r:marketScore(data,market,i.id,now)}))`), `flags`, `history`, `data`, `market`, `open(id)`, `userName`.
- Produces: `export function Dashboard(props:{rows:Row[];flags:Record<string,string>;history:History;data:FundamentalData;market:MarketData;now:number;userName:string;open:(id:string)=>void;setView:(v:View)=>void})`.

- [ ] **Step 1: Hero** `.t-hero`: `<span>{greeting}</span><h1>{jméno} 👋</h1><p>Disciplína dnes. Svoboda zítra.</p>`, `<img src="/brand/mascots-pair.png" alt="">`, `.t-date` s `Dnes` a datem `cs-CZ` (`weekday short, day numeric, month short, year`).
- [ ] **Step 2: KPI** pět `.t-kpi`: Bullish trhy (ikona TrendingUp, mini sparkline z počtu bullish v posledních 8 snímcích), Bearish trhy (TrendingDown), Nejsilnější signál (Target, hodnota `fmt(score)`, small = název trhu, klik `open`), Čerstvost podkladů (Gauge, donut SVG s podílem), Moje vlaječky (Flag, `flagged`, small `inTrade` v tradu, pruhy podle barev).
- [ ] **Step 3: Řada 1** `.t-row`: karta Historie skóre (`Picker` trhu, `.t-seg` 1T/1M/3M/Vše, SVG čára + plocha, poslední bod s bublinou hodnoty; když série prázdná, text „Pro tento model zatím není uložený výpočet.“) a karta Moje vlaječky (tři čísla: Sleduji / V tradu / Čekám; tabulka řádků s vlaječkou ≠ none: trh, skóre, trend, štítek vlaječky; prázdný stav s odkazem na Analýzu trhů).
- [ ] **Step 4: Řada 2** `.t-row3`: Stav podkladů (`dataHealth` řádky s `.t-check`, `.t-bar` a detail), Poslední změny (`recentChanges` + `data.changes.slice(-3)`), Kalendář (`upcomingEvents(…,5)`: čas `HH:mm`, měna, název, štítek High/Medium/Low → česky Vysoká/Střední/Nízká; odkaz „Zobrazit vše“ → `setView('calendar')`).
- [ ] **Step 5:** tsc + prohlížeč 1280 px a 390 px; nastavit vlaječku v Analýze a ověřit, že se objeví na dashboardu.

---

### Task 7: Kalendář

**Files:**
- Create: `app/calendar.tsx`
- Modify: `app/tradee.tsx` (`view==='calendar'`)

- [ ] **Step 1:** `export function CalendarPage({events,now}:{events:FundamentalData['events'];now:number})`: seřadit podle `at`, seskupit po dnech (`toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',weekday:'long',day:'numeric',month:'long'})`), pro každý den karta se seznamem: čas (nebo „čas neověřen“), měna, název, štítek důležitosti, `watch`, Očekávání / Výsledek. Minulé události zešednout.
- [ ] **Step 2:** tsc + prohlížeč.

---

### Task 8: Restyle Analyzeru, detailu a Reportů + mobil

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1:** Tabulka trhů: hlavička bez pozadí, řádky s hover `#f6f8fc`, skóre 22 px, chip trendu s barvou. Detail: `.s-score` bílá karta s modrým gradientem nahoře, `.n-main-analysis` mezery 16. Reporty: `.s-event` s jemným oddělením.
- [ ] **Step 2:** Mobil 390 px: hero, KPI 2 sloupce, tabulka s vodorovným scrollem (`.s-market{overflow:auto}`), detail v jednom sloupci.
- [ ] **Step 3:** Screenshoty: dashboard, analýza, detail, reporty, kalendář, mobil dashboard.

---

### Task 9: Build a nasazení

- [ ] **Step 1:** `npx tsc --noEmit && npm run build` lokálně.
- [ ] **Step 2:** Nahrát na VPS (`tar` přes SSH jako dosud, bez `node_modules`, `.wrangler`, `dist`), tam `npm ci`, `npm run build`, `sudo systemctl restart tradee`.
- [ ] **Step 3:** Ověřit https://tradee.dejny.eu s heslem: titulek, dashboard, API vlaječek, jméno v pozdravu „Jindra“.
