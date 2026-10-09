# Checklisty – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trader si v profilu vytvoří vlastní checklisty s body a přiřazenými trhy; na každém trhu je zaškrtává (stav zvlášť pro každý trh, platí dokud ho neodškrtne); při vstupu do obchodu se stav automaticky uloží k obchodu v Deníku (jde upravit); statistiky ukážou výsledky podle splnění checklistu.

**Architecture:** Čistý modul `lib/checklists/core.ts` (mapování MT symbolu na trh, platné checklisty, snímek, míra splnění, skupina) s testy; DB vrstva `lib/checklists/store.ts` + migrace `0009_checklists.sql`; API `app/api/checklists/*` a `app/api/journal/[id]/checklist`; automatický snímek při ingestu MT a při ručním zápisu; UI: stránka `/checklisty`, karta v detailu trhu, sekce v detailu obchodu, rozpad „Checklist“ ve statistikách Deníku.

**Tech Stack:** vinext (Next 16 App Router, Workers runtime), MariaDB přes `lib/mysql.ts`, React.

## Spec (schváleno v chatu 9. 10. 2026)

- **Nastavení** (`/checklisty`, odkaz „Checklisty“ v menu avatara): libovolný počet checklistů; každý má **název**, **body** (krátké texty – přidat, smazat, přejmenovat, posunout nahoru/dolů) a **trhy**, pro které platí (výběr z 51 trhů + rychlé volby po skupinách: všechny FX páry, měnové indexy, akciové indexy, krypto, akcie). Jeden trh může mít víc checklistů, jeden checklist víc trhů.
- **Na trhu** (detail v Analýze trhů): karta **Checklist** se všemi checklisty přiřazenými k trhu; zaškrtnutí **zvlášť pro každý trh**, ukládá se hned a **platí, dokud ho trader sám neodškrtne**; tlačítko „Vymazat“ (pro checklist na tomto trhu); ukazatel „4 / 6 splněno“.
- **U obchodu**: při vstupu (nový obchod z MT, ruční zápis) se k obchodu **automaticky uloží kopie stavu** všech checklistů platných pro jeho trh; na trhu se stav nemění; v detailu obchodu v Deníku „Checklist při vstupu: 4 / 6“, jde upravit (v cizím deníku jen pro čtení).
- **Spárování symbolu**: MT symboly (`EURUSD.r`, `NAS100`, `US500`, `BTCUSD`, `AAPL.US`…) se automaticky převedou na trhy Tradee; co se nepozná, trader jednou přiřadí ručně na stránce Checklisty (nebo nastaví „nesledovat“).
- **Statistiky** (Deník): rozpad **Checklist**: splněno úplně (100 %) / z většiny (≥ 70 %) / méně / bez checklistu – počet, win rate, výsledek, průměrné R.
- Vše patří jen danému traderovi; admin v cizím deníku jen čte.

## Global Constraints

- Body mají stabilní id (náhodné, 8 znaků `[a-z0-9]`), aby přejmenování a přesun nezrušily zaškrtnutí; stav se ukládá jako seznam id zaškrtnutých bodů.
- Limity: max **20** checklistů na uživatele, **30** bodů v checklistu, název **60** znaků, bod **120** znaků.
- Míra splnění obchodu = zaškrtnuté / všechny body napříč všemi checklisty ve snímku; skupiny: `full` (=1), `most` (≥ 0,7), `less` (< 0,7), `none` (bez snímku nebo 0 bodů).
- Automatický snímek z MT jen pro pozice otevřené **nejvýš 60 min** před ingestem (starší dorovnané obchody ze zpětné historie snímek nedostanou – stav trhu by nebyl „při vstupu“); jen jednou na pozici; jen když jsou pro trh nějaké checklisty.
- Snímek je klíčovaný id obchodu z Deníku: `mt:<position_id>` nebo `man:<id>`.
- Vlastnictví ověřit na serveru u každého dotazu; zápisy `sameOrigin` + `identity`; admin `?as=` jen pro čtení (existující `viewAs`).
- Barvy jen z tokenů; české texty; kompaktní TS/TSX; `lib/` importuje relativně s `.ts`.
- Testy: `scripts/check-checklists.mjs` + ostatní `check-*.mjs` (kromě dlouhodobě padajícího `check-score.mjs`), `npx tsc --noEmit -p .`, `npm run build`.

## Review Focus

- **Neznámý / exotický MT symbol** → žádný snímek, symbol se objeví v seznamu k přiřazení (pin: Task 1 testy `mapSymbol`, Task 3).
- **Smazaný bod nebo checklist** → staré snímky u obchodů zůstanou (jsou kopie s textem); stav na trhu ignoruje neexistující id (pin: Task 1 `snapshotFor`).
- **Obrácený FX pár** (`USDEUR` vs Tradee `EUR/USD`) → správný trh (pin: Task 1).
- **Dorovnání historie z MT** → bez snímků (pin: Task 3 podmínka 60 min).
- **Cizí uživatel** nesmí číst ani měnit cizí checklisty/stavy/snímky (pin: Task 2 SQL s `user_id`).

---

### Task 1: Čistý modul `lib/checklists/core.ts` + testy

**Files:** Create `lib/checklists/core.ts`, `scripts/check-checklists.mjs`

**Produces:** `type ChecklistItem={id:string;text:string}`, `type Checklist={id:string;name:string;items:ChecklistItem[];markets:string[]}`, `type SnapshotList={checklistId:string;name:string;items:(ChecklistItem&{checked:boolean})[]}`, `newItemId()`, `mapSymbol(symbol,instrumentIds,userMap)`, `applicable(lists,instrument)`, `snapshotFor(lists,instrument,states)`, `completion(snapshot)`, `completionGroup(ratio)`, `validateChecklist(input)`.

- [ ] **Step 1: Test `scripts/check-checklists.mjs`**
```js
// Kontrola checklistů: node --experimental-strip-types scripts/check-checklists.mjs
import {mapSymbol,applicable,snapshotFor,completion,completionGroup,validateChecklist,newItemId} from '../lib/checklists/core.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const IDS=['EUR/USD','USD/JPY','GBP/USD','USD','EUR','^NDX','^GSPC','BTC-USD','ETH-USD','AAPL','BRK-B','JPM'];
check('FX přímý',mapSymbol('EURUSD',IDS,{})==='EUR/USD'&&mapSymbol('eurusd.r',IDS,{})==='EUR/USD'&&mapSymbol('EURUSDm',IDS,{})==='EUR/USD');
check('FX obrácený',mapSymbol('USDEUR',IDS,{})==='EUR/USD'&&mapSymbol('JPYUSD',IDS,{})==='USD/JPY');
check('FX neexistující měna',mapSymbol('EURPLN',IDS,{})===null);
check('indexy',mapSymbol('NAS100',IDS,{})==='^NDX'&&mapSymbol('US100.cash',IDS,{})==='^NDX'&&mapSymbol('USTEC',IDS,{})==='^NDX'&&mapSymbol('US500',IDS,{})==='^GSPC'&&mapSymbol('SPX500',IDS,{})==='^GSPC');
check('krypto',mapSymbol('BTCUSD',IDS,{})==='BTC-USD'&&mapSymbol('BTCUSDT',IDS,{})==='BTC-USD'&&mapSymbol('ETHUSD.m',IDS,{})==='ETH-USD');
check('akcie',mapSymbol('AAPL',IDS,{})==='AAPL'&&mapSymbol('AAPL.US',IDS,{})==='AAPL'&&mapSymbol('#AAPL',IDS,{})==='AAPL'&&mapSymbol('BRK.B',IDS,{})==='BRK-B'&&mapSymbol('JPM.NYSE',IDS,{})==='JPM');
check('neznámé',mapSymbol('XAUUSD',IDS,{})===null&&mapSymbol('GER40',IDS,{})===null&&mapSymbol('',IDS,{})===null);
check('ruční přiřazení má přednost',mapSymbol('GER40',IDS,{GER40:'^GSPC'})==='^GSPC'&&mapSymbol('EURUSD',IDS,{EURUSD:''})===null);
check('ruční přiřazení: velikost písmen',mapSymbol('ger40.cash',IDS,{'GER40.CASH':'^NDX'})==='^NDX');
check('ruční zápis s lomítkem',mapSymbol('EUR/USD',IDS,{})==='EUR/USD'&&mapSymbol('eur/usd',IDS,{})==='EUR/USD');
const L=[{id:'c1',name:'Breakout',items:[{id:'a1',text:'Trend'},{id:'a2',text:'SL'}],markets:['EUR/USD','^NDX']},{id:'c2',name:'Riziko',items:[{id:'b1',text:'Max 1 %'}],markets:['EUR/USD']},{id:'c3',name:'Krypto',items:[{id:'d1',text:'X'}],markets:['BTC-USD']}];
check('platné checklisty',applicable(L,'EUR/USD').map(c=>c.id).join()==='c1,c2'&&applicable(L,'AAPL').length===0);
const snap=snapshotFor(L,'EUR/USD',{c1:['a2','zz'],c2:[]});
check('snímek: kopie textů a zaškrtnutí, neznámé id ignoruje',JSON.stringify(snap)===JSON.stringify([{checklistId:'c1',name:'Breakout',items:[{id:'a1',text:'Trend',checked:false},{id:'a2',text:'SL',checked:true}]},{checklistId:'c2',name:'Riziko',items:[{id:'b1',text:'Max 1 %',checked:false}]}]),snap);
check('snímek prázdný pro trh bez checklistů',snapshotFor(L,'AAPL',{}).length===0);
check('splnění',completion(snap)===1/3&&completion([])===null&&completion([{checklistId:'x',name:'x',items:[]}])===null);
check('skupiny',completionGroup(1)==='full'&&completionGroup(0.7)==='most'&&completionGroup(0.69)==='less'&&completionGroup(0)==='less'&&completionGroup(null)==='none');
const ok=validateChecklist({name:' Breakout ',items:[{id:'a1',text:' Trend '},{text:'Nový'}],markets:['EUR/USD','XXX','EUR/USD']},IDS);
check('validace: ořez, nové id, neznámé a duplicitní trhy pryč',typeof ok!=='string'&&ok.name==='Breakout'&&ok.items[0].text==='Trend'&&ok.items[1].id.length===8&&JSON.stringify(ok.markets)==='["EUR/USD"]',ok);
check('validace: chyby',typeof validateChecklist({name:'',items:[],markets:[]},IDS)==='string'&&typeof validateChecklist({name:'x'.repeat(61),items:[],markets:[]},IDS)==='string'&&typeof validateChecklist({name:'A',items:Array.from({length:31},(_,i)=>({text:'b'+i})),markets:[]},IDS)==='string'&&typeof validateChecklist({name:'A',items:[{text:''}],markets:[]},IDS)==='string'&&typeof validateChecklist({name:'A',items:[{text:'x'.repeat(121)}],markets:[]},IDS)==='string'&&typeof validateChecklist(null,IDS)==='string');
check('id bodu',/^[a-z0-9]{8}$/.test(newItemId())&&newItemId()!==newItemId());

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
```
Run → chyba importu.

- [ ] **Step 2: `lib/checklists/core.ts`**
```ts
// Checklisty: mapování MT symbolu na trh, platné checklisty pro trh, snímek při vstupu, míra splnění. Čisté funkce – testy scripts/check-checklists.mjs.
export type ChecklistItem={id:string;text:string};
export type Checklist={id:string;name:string;items:ChecklistItem[];markets:string[]};
export type SnapshotList={checklistId:string;name:string;items:(ChecklistItem&{checked:boolean})[]};
export const LIMITS={lists:20,items:30,name:60,item:120};
export function newItemId(){const a='abcdefghijklmnopqrstuvwxyz0123456789';let s='';const b=crypto.getRandomValues(new Uint8Array(8));for(const x of b)s+=a[x%a.length];return s}
const INDEX:Record<string,string>={NAS100:'^NDX',US100:'^NDX',USTEC:'^NDX',NDX:'^NDX',NQ:'^NDX',NASDAQ:'^NDX',NASDAQ100:'^NDX',US500:'^GSPC',SPX500:'^GSPC',SP500:'^GSPC',SPX:'^GSPC',ES:'^GSPC'};
const CRYPTO=['BTC','ETH','SOL'];
// MT symbol → id trhu Tradee; ruční přiřazení (klíč velkými písmeny, '' = nesledovat) má přednost; nepoznané → null
export function mapSymbol(symbol:string,ids:readonly string[],userMap:Record<string,string>):string|null{
 const raw=String(symbol||'').trim().toUpperCase();if(!raw)return null;
 if(Object.hasOwn(userMap,raw))return userMap[raw]&&ids.includes(userMap[raw])?userMap[raw]:null;
 if(ids.includes(raw))return raw;
 const slash=raw.match(/^([A-Z]{3})\/([A-Z]{3})$/);
 const base=raw.replace(/^[#.]+/,'').split(/[._+]/)[0];
 const fx=slash?[slash[1],slash[2]]:base.match(/^([A-Z]{3})([A-Z]{3})[A-Z]{0,2}$/)?.slice(1,3);
 if(fx){const [a,b]=fx;if(ids.includes(a+'/'+b))return a+'/'+b;if(ids.includes(b+'/'+a))return b+'/'+a}
 const cr=CRYPTO.find(c=>base===c+'USD'||base===c+'USDT');if(cr&&ids.includes(cr+'-USD'))return cr+'-USD';
 const idx=INDEX[base]||INDEX[base.replace(/CASH$/,'')];if(idx&&ids.includes(idx))return idx;
 if(ids.includes(base))return base;
 const dot=raw.replace(/^#/,'').match(/^([A-Z]+)\.([A-Z])$/);if(dot&&ids.includes(dot[1]+'-'+dot[2]))return dot[1]+'-'+dot[2];
 return null;
}
export const applicable=(lists:Checklist[],instrument:string)=>lists.filter(l=>l.markets.includes(instrument));
// kopie platných checklistů s aktuálním zaškrtnutím (neexistující id bodů se ignorují)
export function snapshotFor(lists:Checklist[],instrument:string,states:Record<string,string[]>):SnapshotList[]{
 return applicable(lists,instrument).map(l=>{const on=new Set(states[l.id]||[]);return {checklistId:l.id,name:l.name,items:l.items.map(i=>({id:i.id,text:i.text,checked:on.has(i.id)}))}});
}
export function completion(snap:SnapshotList[]):number|null{let n=0,c=0;for(const l of snap)for(const i of l.items){n++;if(i.checked)c++}return n?c/n:null}
export const completionGroup=(r:number|null)=>r===null?'none' as const:r>=1?'full' as const:r>=0.7?'most' as const:'less' as const;
// vstup z UI → očištěný checklist, nebo text chyby
export function validateChecklist(v:unknown,ids:readonly string[]):Omit<Checklist,'id'>|string{
 const o=v as {name?:unknown;items?:unknown;markets?:unknown}|null;if(!o||typeof o!=='object')return 'Neplatný checklist.';
 const name=typeof o.name==='string'?o.name.trim():'';if(!name)return 'Zadej název checklistu.';if(name.length>LIMITS.name)return `Název může mít nejvýš ${LIMITS.name} znaků.`;
 if(!Array.isArray(o.items))return 'Body musí být seznam.';if(o.items.length>LIMITS.items)return `Nejvýš ${LIMITS.items} bodů v checklistu.`;
 const items:ChecklistItem[]=[];
 for(const it of o.items as {id?:unknown;text?:unknown}[]){const text=typeof it?.text==='string'?it.text.trim():'';if(!text)return 'Bod nesmí být prázdný.';if(text.length>LIMITS.item)return `Bod může mít nejvýš ${LIMITS.item} znaků.`;const id=typeof it.id==='string'&&/^[a-z0-9]{8}$/.test(it.id)?it.id:newItemId();items.push({id,text})}
 const markets=Array.isArray(o.markets)?[...new Set((o.markets as unknown[]).filter((m):m is string=>typeof m==='string'&&ids.includes(m)))]:[];
 return {name,items,markets};
}
```
(`crypto.getRandomValues` je v Node 22 i Workers globální.)

- [ ] **Step 3:** testy → vše ok; tsc čisté. **Commit** „Checklisty: čistý modul a testy“

---

### Task 2: Migrace, DB vrstva, API checklistů

**Files:** Create `drizzle/mariadb/0009_checklists.sql`, `lib/checklists/store.ts`, `app/api/checklists/route.ts`, `app/api/checklists/state/route.ts`, `app/api/checklists/symbols/route.ts`, `app/api/journal/[id]/checklist/route.ts`

- [ ] **Step 1: Migrace**
```sql
-- Checklisty traderů
CREATE TABLE IF NOT EXISTS checklists(
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  name VARCHAR(60) NOT NULL,
  items TEXT NOT NULL,
  markets TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  created DATETIME NOT NULL, updated DATETIME NOT NULL,
  INDEX checklists_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS checklist_state(
  user_id VARCHAR(128) NOT NULL,
  checklist_id VARCHAR(40) NOT NULL,
  instrument VARCHAR(16) NOT NULL,
  checked TEXT NOT NULL,
  updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,checklist_id,instrument)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trade_checklists(
  user_id VARCHAR(128) NOT NULL,
  trade_id VARCHAR(100) NOT NULL,
  instrument VARCHAR(16) NOT NULL,
  snapshot MEDIUMTEXT NOT NULL,
  completion DOUBLE NULL,
  created DATETIME NOT NULL, updated DATETIME NOT NULL,
  PRIMARY KEY(user_id,trade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS symbol_map(
  user_id VARCHAR(128) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  instrument VARCHAR(16) NOT NULL DEFAULT '',
  PRIMARY KEY(user_id,symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```
- [ ] **Step 2: `lib/checklists/store.ts`** (Db jako parametr, vše filtrované `user_id`):
  - `listChecklists(d,userId):Promise<Checklist[]>` (řazení `sort,created`; `items`/`markets` JSON.parse s fallbackem `[]`);
  - `saveChecklist(d,userId,id|null,data)` – nový (id `chk_`+24 hex, kontrola limitu 20 → chyba „Nejvýš 20 checklistů.“) nebo update vlastního (jinak `false`);
  - `deleteChecklist(d,userId,id)` – smaže i `checklist_state` toho checklistu (snímky u obchodů zůstávají);
  - `reorderChecklists(d,userId,ids:string[])` – `sort` podle pořadí;
  - `marketState(d,userId,instrument):Promise<Record<string,string[]>>`, `setMarketState(d,userId,checklistId,instrument,checked:string[])` (jen pro vlastní checklist, který trh obsahuje; prázdný seznam = smazat řádek), `clearMarketState(d,userId,checklistId,instrument)`;
  - `symbolMap(d,userId):Promise<Record<string,string>>` (klíč velkými písmeny), `setSymbol(d,userId,symbol,instrument)` (`''` = nesledovat; `null` = smazat přiřazení), `unmappedSymbols(d,userId,ids,map)` – distinct `symbol` z `mt_positions` uživatele (přes `mt_accounts.user_id`), které `mapSymbol` nepozná a nejsou v mapě;
  - `tradeChecklist(d,userId,tradeId)`, `saveTradeChecklist(d,userId,tradeId,instrument,snapshot)` (spočítá a uloží `completion`), `snapshotTrade(d,userId,tradeId,instrument)` – vytvoří snímek ze `listChecklists`+`marketState`, jen když pro trh existují checklisty a pro obchod ještě snímek není (`INSERT IGNORE`).
- [ ] **Step 3: API** (vše `identity`; zápisy `sameOrigin`; chyby přes `failed`; 404 pro cizí):
  - `GET /api/checklists` → `{checklists, markets:[{id,name,group}]}` (z `instruments`); `POST` `{id?,name,items,markets}` → validace `validateChecklist(…, ids)` → uložit → `{ok,id}`; `DELETE` `{id}`; `PATCH` `{order:string[]}`.
  - `GET /api/checklists/state?instrument=X` → `{checklists:applicable(...), state}`; `PUT` `{checklistId,instrument,checked}` (id bodů musí patřit checklistu); `DELETE` `{checklistId,instrument}`.
  - `GET /api/checklists/symbols` → `{map,unmapped}`; `PUT` `{symbol,instrument|''|null}` (instrument musí být platné id nebo ''/null).
  - `GET /api/journal/<id>/checklist` (podpora `?as=` přes `viewAs` = jen čtení) → `{snapshot|null, available:boolean}` (`available` = pro trh obchodu existují checklisty); `PUT` `{snapshot}` → jen vlastník obchodu; ověř, že snímek má tvar `SnapshotList[]` (max 20 seznamů × 30 bodů, texty ≤ 120) a přepočti `completion`; `POST` (bez těla) → vytvoří snímek ze současného stavu trhu, pokud žádný není (tlačítko „Vyplnit checklist“). Trh obchodu: MT → `mapSymbol(position.symbol, ids, symbolMap)`, ruční → `mapSymbol(trade.instrument, …)`.
- [ ] **Step 4:** tsc čisté, `check-checklists` ok. **Commit** „Checklisty: migrace, DB a API“

---

### Task 3: Snímek při vstupu, data pro Deník a statistiky

**Files:** Modify `app/api/mt/ingest/route.ts`, `app/api/trades/route.ts`, `lib/journal/store.ts`, `lib/journal/types.ts`, `lib/journal/rows.ts`, `lib/journal/stats.ts`, `scripts/check-journal.mjs`, `lib/checklists/store.ts`

- [ ] **Step 1: MT ingest** – po `rebuildPositions` zavolej (v try/catch, chyba se jen zaloguje, ingest nesmí selhat) `snapshotNewPositions(d,userId,accountId,now)` v `lib/checklists/store.ts`: pozice účtu s `open_ts >= now-60*60000`, bez řádku v `trade_checklists` (`trade_id='mt:'+id`), → `mapSymbol(symbol, ids, symbolMap)` → `snapshotTrade(...)`. (`userId` je v ingestu z klíče – `authKey` vrací `userId`.)
- [ ] **Step 2: Ruční zápis** – v `POST /api/trades` po INSERT `snapshotTrade(d,u.id,'man:'+id,mapSymbol(b.instrument,…))` (v try/catch; bez trhu nic).
- [ ] **Step 3: Deník** – `JournalTrade` + `checklist:number|null` (míra splnění); `listJournal` načte `SELECT trade_id,completion FROM trade_checklists WHERE user_id=?` a doplní k obchodům podle id (`mt:…`/`man:…`); `mtRowToTrade`/`manualRowToTrade` výchozí `checklist:null` (doplní se v `toJournalTrades` přes volitelný parametr mapy). Uprav testy fixtures v `scripts/check-journal.mjs`, aby zahrnovaly pole.
- [ ] **Step 4: Statistiky** – `BreakdownBy` + `'checklist'`; `keysOf`: `completionGroup(t.checklist)` → `[['0','Splněno úplně'],['1','Z většiny (≥ 70 %)'],['2','Méně'],['3','Bez checklistu']]` podle skupiny (`full,most,less,none`), řazení podle klíče. Test v `check-journal.mjs`: 4 obchody (1, 0.8, 0.2, null) → 4 skupiny ve správném pořadí s počty.
- [ ] **Step 5:** všechny testy, tsc. **Commit** „Checklisty: snímek při vstupu a rozpad ve statistikách“

---

### Task 4: Stránka `/checklisty` + odkaz v menu

**Files:** Create `app/checklisty/page.tsx`, `app/checklists-page.tsx`, `app/checklists.css`; Modify `app/shell.tsx` (odkaz „Checklisty“ v menu avatara pod „Propojení s MetaTraderem“)

- [ ] Stránka ve stylu `/mt` (`mt-page`, `mt-top` s „← Zpět do Tradee“, `mt-main`, `mt-card`; importuje `mt.css`, `checklists.css`, volá `usePalette()`):
  - úvod: 2–3 věty, k čemu checklisty jsou (pravidla před vstupem, zaškrtávání na trhu, uloží se k obchodu, statistiky);
  - seznam checklistů (karty): název, počet bodů, trhy (zkrácený výpis + „+N“), tlačítka Upravit / Smazat (potvrzení) / ↑ ↓ (pořadí → `PATCH order`);
  - editor (nový / úprava, inline v kartě): pole Název, body (input na řádek, ↑ ↓ ✕, „+ Přidat bod“), trhy: rychlé volby skupin (zaškrtávací chipy „Všechny FX páry“ atd. – zaškrtnutí přidá/odebere celou skupinu) + vyhledávatelný seznam 51 trhů s checkboxy; Uložit / Zrušit; chyby ze serveru v `mt-alert`;
  - sekce **Symboly z MetaTraderu**: nepřiřazené symboly z `GET /api/checklists/symbols` s výběrem trhu (`<select>`: „— nesledovat —“ + trhy) a seznam ručních přiřazení s možností zrušit; bez MT obchodů sekce chybí.
- [ ] tsc + build. **Commit** „Checklisty: stránka nastavení“

---

### Task 5: Checklist na trhu, u obchodu a ve statistikách

**Files:** Create `app/checklist-card.tsx`; Modify `app/tradee.tsx` (detail trhu), `app/journal/trade-detail.tsx`, `app/journal/stats-view.tsx`, `app/journal/journal.css`, `app/live.css` nebo nový CSS

- [ ] **Detail trhu** – pod kartou „Dnes“ karta **Checklist** (`ChecklistCard({instrument})`): načte `GET /api/checklists/state?instrument=…`; bez checklistů pro trh: krátký text „Pro tento trh nemáš checklist.“ + odkaz „Nastavit checklisty“ (`/checklisty`); jinak pro každý checklist: název, ukazatel „N / M splněno“ (pruh), checkboxy bodů (změna → optimisticky + `PUT`, při chybě vrátit a ukázat hlášku), „Vymazat“ (`DELETE`, potvrzení).
- [ ] **Detail obchodu v Deníku** – sekce **Checklist při vstupu** (pod Poznámkou): `GET /api/journal/<id>/checklist` (+`query` u `viewAs`); se snímkem: „N / M splněno“ + seznamy s checkboxy (změna → `PUT {snapshot}`); `readOnly` → jen zobrazení; bez snímku a `available`: text „K obchodu není uložený checklist.“ + tlačítko „Vyplnit checklist“ (`POST`, pak načíst) – v `readOnly` bez tlačítka; bez `available`: „Pro tento trh nemáš checklist.“ (v `readOnly` nic).
- [ ] **Statistiky** – v `BY` přidej `['checklist','Checklist']`; u prázdných dat hláška jako u ostatních.
- [ ] **Deník – tabulka** (volitelné, jen pokud se vejde): ikona ✓ u obchodů se snímkem není nutná – vynech.
- [ ] tsc + build. **Commit** „Checklisty: na trhu, u obchodu a ve statistikách“

---

### Task 6: Nasazení (po souhlasu Daniela)

- [ ] testy, tsc, build; merge (větev je založená na `feature/my-trading` – pokud ta už je v `main`, merge normálně), push; VPS: rebase, `mariadb-migrate.py` (`applied 0009_checklists.sql`), build, restart.
- [ ] Kontrola v prohlížeči: vytvořit testovací checklist pro EUR/USD, zaškrtat na trhu, ručně zapsat testovací obchod EUR/USD → v Deníku snímek; Statistiky → rozpad Checklist; smazat testovací data.
