# Živé ceny trhů – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Každých 15 minut aktuální cena, dnešní změna a průběh dne u všech 51 trhů (z Yahoo, bez restartu aplikace); zobrazení v Analýze trhů, v detailu trhu a na Dashboardu; skóre v obchodní dny každou hodinu.

**Architecture:** Čistý modul `lib/live.ts` (symboly, parsování Yahoo, síla měn, „dnešní“ body, stav, mini graf) s testy; sběr `scripts/refresh-live.mjs` (Node, reuse `lib/markets.ts` a `lib/live.ts`, zápis přes `lib/mysql.ts`) spouštěný cronem; DB vrstva `lib/live-store.ts` + `GET /api/markets/live`; klient `app/live.tsx` (hook `useLive`, `Spark`, `LiveBadge`) a úpravy UI.

**Tech Stack:** Node 22 (`--experimental-strip-types`, fetch), vinext (Next 16 App Router, Workers runtime), MariaDB přes `lib/mysql.ts`, React SVG.

**Spec:** `docs/superpowers/specs/2026-10-09-live-prices-design.md`

## Global Constraints

- Yahoo: `https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?range=1d&interval=15m`; souběžně nejvýš **6** dotazů, timeout **10 s**, hlavička `User-Agent` prohlížeče.
- Symboly: FX pár `AAA/BBB` → `AAABBB=X`; měnové indexy (`fxCurrencies`) se nestahují, počítají se; ostatní id beze změny.
- Měnový index: změna = průměr % změn proti ostatním (pár `A/B` roste → A +, B −); cena = `100×(1+změna/100)`, předchozí zavření = **100**; průběh jen v časech (zaokrouhleno na **15 min**), kde mají body všechny páry měny.
- „Dnešní“ body = body se stejným **pražským** datem jako nejnovější bod trhu.
- Stav: `delayed` když poslední stažení > **45 min**; jinak `closed` když poslední cena trhu > **30 min**; jinak `live`.
- Body starší **7 dní** se mažou; API posílá jen „dnešní“ body.
- Sběr nikdy nesestavuje ani nerestartuje aplikaci; vlastní zámek `/tmp/tradee-live.lock`.
- Klient obnovuje živá data každých **5 min**, jen když je karta viditelná.
- Barvy jen z tokenů (`--bull`, `--bear`, `--bull-text`, `--bear-text`, `--t-*`) – respektují paletu uživatele.
- Styl repa: kompaktní TS/TSX, české texty; `lib/` importuje relativně s `.ts`.
- Testy: `node --experimental-strip-types scripts/check-live.mjs` (vše ok), `npx tsc --noEmit -p .`, `npm run build`; ostatní `check-*.mjs` zůstávají ok.
- Merge, push, nasazení a změna cronu na VPS jen po souhlasu Daniela. Commity s trailerem `Co-Authored-By:`.

## Review Focus

- **Yahoo vrátí chybu, prázdný výsledek nebo `null` v cenách** → trh se přeskočí, ostatní se uloží, skript skončí 0 → pin: Task 1 testy `parseChart`, Task 2 `--dry` běh.
- **Půlnoc a změna času** při výběru „dnešních“ bodů → pin: Task 1 test `sessionPoints`.
- **Měna, které chybí některé páry** → průměr z dostupných, průběh jen ze společných časů → pin: Task 1 testy `currencyChange`/`currencySeries`.
- **Víkend / zavřený trh** → štítek „zavřeno“, ne „zpožděno“ → pin: Task 1 test `liveState`.
- **API bez dat (první nasazení, prázdné tabulky)** → `{updated:null,quotes:{}}`, UI nic neukáže a nespadne → pin: Task 3 + Task 4–6 (podmíněné vykreslení).

---

### Task 1: Čistý modul `lib/live.ts` + testy

**Files:** Create `lib/live.ts`, `scripts/check-live.mjs`

**Produces:** `type LivePoint=[number,number]`, `type LiveQuote`, `type ParsedChart`, `type LiveState`, `yahooSymbol(id,currencies)`, `changePct(price,prev)`, `parseChart(json)`, `sessionPoints(points)`, `currencyChange(cur,pairs)`, `currencySeries(cur,pairs)`, `liveState(updated,marketTime,now)`, `sparkPath(points,w,h)`.

- [ ] **Step 1: Test `scripts/check-live.mjs`**

```js
// Kontrola živých cen: node --experimental-strip-types scripts/check-live.mjs
import {yahooSymbol,changePct,parseChart,sessionPoints,currencyChange,currencySeries,liveState,sparkPath} from '../lib/live.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const CUR=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD'];
check('symbol FX',yahooSymbol('EUR/USD',CUR)==='EURUSD=X'&&yahooSymbol('USD/EUR',CUR)==='USDEUR=X');
check('symbol měnový index = null',yahooSymbol('USD',CUR)===null);
check('symbol akcie/index/krypto',yahooSymbol('JPM',CUR)==='JPM'&&yahooSymbol('^GSPC',CUR)==='^GSPC'&&yahooSymbol('BTC-USD',CUR)==='BTC-USD'&&yahooSymbol('BRK-B',CUR)==='BRK-B');
check('změna %',changePct(101,100)===1&&changePct(99.5,100)===-0.5&&changePct(1,0)===0&&changePct(Number.NaN,100)===0);
const t0=Date.UTC(2026,9,9,8,0)/1000;
const yj={chart:{result:[{meta:{regularMarketPrice:1.0912,chartPreviousClose:1.09,regularMarketTime:t0+1800},timestamp:[t0,t0+900,t0+1800],indicators:{quote:[{close:[1.09,null,1.0912]}]}}]}};
const pc=parseChart(yj);
check('parse: cena, zavření, čas',pc&&pc.price===1.0912&&pc.prevClose===1.09&&pc.marketTime===(t0+1800)*1000,pc);
check('parse: null body vynechá',pc&&pc.points.length===2&&pc.points[1][0]===(t0+1800)*1000,pc&&pc.points);
check('parse: previousClose jako náhrada',parseChart({chart:{result:[{meta:{regularMarketPrice:10,previousClose:9,regularMarketTime:t0},timestamp:[],indicators:{quote:[{close:[]}]}}]}})?.prevClose===9);
check('parse: nepoužitelné',parseChart(null)===null&&parseChart({chart:{result:null}})===null&&parseChart({chart:{result:[{meta:{regularMarketPrice:0,chartPreviousClose:1,regularMarketTime:t0}}]}})===null);
const P=(iso,p)=>[Date.parse(iso),p];
const sp=sessionPoints([P('2026-10-08T21:30:00Z',1),P('2026-10-09T08:00:00Z',3),P('2026-10-08T22:30:00Z',2)]);
check('dnešní body přes pražskou půlnoc',sp.length===2&&sp[0][1]===2&&sp[1][1]===3,sp);
const dst=sessionPoints([P('2026-10-24T22:30:00Z',1),P('2026-10-25T00:30:00Z',2),P('2026-10-25T23:30:00Z',3)]);
check('dnešní body přes změnu času',dst.length===1&&dst[0][1]===3,dst);
check('dnešní body prázdné',sessionPoints([]).length===0);
const pairs={'USD/EUR':{changePct:1},'EUR/GBP':{changePct:-0.5}};
check('síla měn',currencyChange('USD',pairs)===1&&currencyChange('EUR',pairs)===-0.75&&currencyChange('GBP',pairs)===0.5&&currencyChange('CHF',pairs)===null);
const T=Date.UTC(2026,9,9,8,0),Q=900000;
const ser=currencySeries('EUR',{'USD/EUR':{prevClose:1,points:[[T,1.01],[T+Q,1.02]]},'EUR/GBP':{prevClose:2,points:[[T+5000,2],[T+Q,1.98],[T+2*Q,1.97]]}});
check('průběh indexu měny: společné časy, průměr',ser.length===2&&ser[0][0]===T&&ser[0][1]===99.5&&ser[1][1]===98.5,ser);
check('průběh bez párů',currencySeries('CHF',{'USD/EUR':{prevClose:1,points:[[T,1]]}}).length===0);
const now=Date.UTC(2026,9,9,12,0);
check('stav live',liveState(now-5*60000,now-10*60000,now)==='live');
check('stav zpožděno',liveState(now-50*60000,now-10*60000,now)==='delayed'&&liveState(null,now,now)==='delayed');
check('stav zavřeno',liveState(now-5*60000,now-3*3600000,now)==='closed'&&liveState(now-60000,null,now)==='closed');
check('mini graf',sparkPath([[0,1],[10,2]],100,10)==='M0.0 10.0 L100.0 0.0'&&sparkPath([[0,1]],100,10)==='');
check('mini graf rovná čára',sparkPath([[0,5],[10,5]],100,10)==='M0.0 10.0 L100.0 10.0');

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
```
Run → chyba importu.

- [ ] **Step 2: `lib/live.ts`**

```ts
// Živé ceny trhů (Yahoo, 15 min): symboly, parsování, síla měn, „dnešní“ body, stav. Čisté funkce – testy scripts/check-live.mjs.
export type LivePoint=[number,number]; // [čas ms UTC, cena]
export type LiveQuote={price:number;prevClose:number;changePct:number;high:number|null;low:number|null;marketTime:number;updated:number;points:LivePoint[]};
export type ParsedChart={price:number;prevClose:number;marketTime:number;points:LivePoint[]};
export type LiveState='live'|'delayed'|'closed';
const r4=(n:number)=>Math.round(n*1e4)/1e4;
// FX pár → Yahoo (EURUSD=X); měnové indexy Yahoo nemá (null); ostatní beze změny
export function yahooSymbol(id:string,currencies:readonly string[]):string|null{
 if(currencies.includes(id))return null;
 const m=id.match(/^([A-Z]{3})\/([A-Z]{3})$/);return m?m[1]+m[2]+'=X':id;
}
export const changePct=(price:number,prev:number)=>prev>0&&Number.isFinite(price)?r4((price/prev-1)*100):0;
type YahooChart={chart?:{result?:{meta?:{regularMarketPrice?:number;chartPreviousClose?:number;previousClose?:number;regularMarketTime?:number};timestamp?:number[];indicators?:{quote?:{close?:(number|null)[]}[]}}[]|null}};
// odpověď /v8/finance/chart → cena, předchozí zavření, čas a body (null vynechá); nepoužitelná odpověď → null
export function parseChart(json:unknown):ParsedChart|null{
 const res=(json as YahooChart|null)?.chart?.result?.[0];if(!res)return null;
 const m=res.meta||{},price=Number(m.regularMarketPrice),prev=Number(m.chartPreviousClose??m.previousClose),t=Number(m.regularMarketTime);
 if(!(price>0)||!(prev>0)||!(t>0))return null;
 const ts=res.timestamp||[],cl=res.indicators?.quote?.[0]?.close||[],points:LivePoint[]=[];
 ts.forEach((s,i)=>{const c=cl[i];if(typeof c==='number'&&Number.isFinite(c)&&c>0)points.push([s*1000,c])});
 return {price,prevClose:prev,marketTime:t*1000,points};
}
const pragueDay=(ms:number)=>new Date(ms).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'});
// „dnešní“ body = stejný pražský den jako nejnovější bod (u akcií před otevřením tedy včerejší seance)
export function sessionPoints(points:LivePoint[]):LivePoint[]{
 if(!points.length)return [];
 const sorted=[...points].sort((a,b)=>a[0]-b[0]),d=pragueDay(sorted[sorted.length-1][0]);
 return sorted.filter(p=>pragueDay(p[0])===d);
}
// síla měny dnes: průměr % změn proti ostatním (A/B roste → A sílí, B slábne); chybějící páry se vynechají
export function currencyChange(cur:string,pairs:Record<string,{changePct:number}>):number|null{
 const v:number[]=[];
 for(const [id,q] of Object.entries(pairs)){const [a,b]=id.split('/');if(a===cur)v.push(q.changePct);else if(b===cur)v.push(-q.changePct)}
 return v.length?r4(v.reduce((s,x)=>s+x,0)/v.length):null;
}
// průběh indexu měny (100 = předchozí zavření): jen časy (po 15 min), kde mají body všechny páry měny
export function currencySeries(cur:string,pairs:Record<string,{prevClose:number;points:LivePoint[]}>):LivePoint[]{
 const mine=Object.entries(pairs).filter(([id])=>id.split('/').includes(cur));if(!mine.length)return [];
 const Q=15*60000,maps=mine.map(([id,q])=>{const sign=id.startsWith(cur+'/')?1:-1,m=new Map<number,number>();for(const [t,p] of q.points)m.set(Math.round(t/Q)*Q,sign*(p/q.prevClose-1)*100);return m});
 const times=[...maps[0].keys()].filter(t=>maps.every(m=>m.has(t))).sort((a,b)=>a-b);
 return times.map(t=>[t,r4(100*(1+maps.reduce((s,m)=>s+(m.get(t) as number),0)/maps.length/100))] as LivePoint);
}
export function liveState(updated:number|null,marketTime:number|null,now:number):LiveState{
 if(!updated||now-updated>45*60000)return 'delayed';
 if(!marketTime||now-marketTime>30*60000)return 'closed';
 return 'live';
}
// SVG path mini grafu v rámečku w×h (čas na ose x)
export function sparkPath(points:LivePoint[],w:number,h:number):string{
 if(points.length<2)return '';
 const ps=points.map(p=>p[1]),lo=Math.min(...ps),hi=Math.max(...ps),span=hi-lo,t0=points[0][0],dt=(points[points.length-1][0]-t0)||1;
 return points.map((p,i)=>(i?'L':'M')+((p[0]-t0)/dt*w).toFixed(1)+' '+(span?h-(p[1]-lo)/span*h:h).toFixed(1)).join(' ');
}
```
(Rovná čára (span 0) se kreslí dole – test „mini graf rovná čára“.)

- [ ] **Step 3:** `node --experimental-strip-types scripts/check-live.mjs` → vše ok; `npx tsc --noEmit -p .` čisté.
- [ ] **Step 4: Commit** „Živé ceny: čistý modul a testy“

---

### Task 2: Migrace a sběr z Yahoo

**Files:** Create `drizzle/mariadb/0007_live.sql`, `scripts/refresh-live.mjs`, `scripts/refresh-live.sh` (spustitelný, `chmod +x`)

**Consumes:** Task 1; `instruments`, `fxCurrencies` z `lib/markets.ts` (importovatelné v Node – používá je i `capture-score-history.mjs`); `createDb` z `lib/mysql.ts` (vzor `scripts/mt-rebuild.mjs`).

- [ ] **Step 1: Migrace**
```sql
-- Živé ceny trhů (Yahoo 15 min)
CREATE TABLE IF NOT EXISTS market_live(
  instrument VARCHAR(16) NOT NULL PRIMARY KEY,
  symbol VARCHAR(24) NOT NULL DEFAULT '',
  price DOUBLE NOT NULL,
  prev_close DOUBLE NOT NULL,
  change_pct DOUBLE NOT NULL,
  day_high DOUBLE NULL, day_low DOUBLE NULL,
  market_time BIGINT NOT NULL,
  updated DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS market_intraday(
  instrument VARCHAR(16) NOT NULL,
  ts BIGINT NOT NULL,
  price DOUBLE NOT NULL,
  PRIMARY KEY(instrument,ts),
  INDEX market_intraday_ts(ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```
(Ověř nejdelší id v `instruments` ≤ 16 znaků.)

- [ ] **Step 2: `scripts/refresh-live.mjs`**
```js
// Živé ceny z Yahoo (15 min) → market_live, market_intraday. Cron přes scripts/refresh-live.sh.
// node --experimental-strip-types scripts/refresh-live.mjs [--dry]   (--dry = jen stáhne a vypíše, nic neukládá)
import {readFileSync} from 'node:fs';
import {instruments,fxCurrencies} from '../lib/markets.ts';
import {yahooSymbol,parseChart,changePct,currencyChange,currencySeries} from '../lib/live.ts';
const dry=process.argv.includes('--dry');
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
async function chart(symbol){
 const ac=new AbortController(),t=setTimeout(()=>ac.abort(),10000);
 try{const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=1d&interval=15m',{headers:{'User-Agent':UA},signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);return parseChart(await r.json())}
 finally{clearTimeout(t)}
}
const list=instruments.map(i=>({id:i.id,symbol:yahooSymbol(i.id,fxCurrencies)})).filter(x=>x.symbol);
const got={},fails=[];
for(let i=0;i<list.length;i+=6)await Promise.all(list.slice(i,i+6).map(async x=>{try{const c=await chart(x.symbol);if(!c)throw Error('prázdná odpověď');got[x.id]={...c,symbol:x.symbol}}catch(e){fails.push(x.id+': '+(e.name==='AbortError'?'timeout':e.message))}}));
// měnové indexy z párů
const fx=Object.fromEntries(Object.entries(got).filter(([id])=>id.includes('/')).map(([id,q])=>[id,{...q,changePct:changePct(q.price,q.prevClose)}]));
for(const c of fxCurrencies){
 const ch=currencyChange(c,fx);if(ch===null)continue;
 const mt=Math.max(...Object.entries(fx).filter(([id])=>id.split('/').includes(c)).map(([,q])=>q.marketTime));
 got[c]={symbol:'',price:100*(1+ch/100),prevClose:100,marketTime:mt,points:currencySeries(c,fx)};
}
if(dry){for(const [id,q] of Object.entries(got))console.log(id.padEnd(9),String(q.price).padEnd(12),changePct(q.price,q.prevClose)+' %',q.points.length+' bodů');console.log(`dry: ${Object.keys(got).length} trhů, chyby: ${fails.length?fails.join('; '):'žádné'}`);process.exit(0)}
const {createDb}=await import('../lib/mysql.ts');
const env=Object.fromEntries(readFileSync(new URL('../.mariadb.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
const nowSql=new Date().toISOString().slice(0,19).replace('T',' ');
let saved=0;
for(const [id,q] of Object.entries(got)){
 try{
  const ps=q.points.map(p=>p[1]),hi=ps.length?Math.max(...ps):null,lo=ps.length?Math.min(...ps):null;
  await d.prepare('INSERT INTO market_live(instrument,symbol,price,prev_close,change_pct,day_high,day_low,market_time,updated) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE symbol=VALUES(symbol),price=VALUES(price),prev_close=VALUES(prev_close),change_pct=VALUES(change_pct),day_high=VALUES(day_high),day_low=VALUES(day_low),market_time=VALUES(market_time),updated=VALUES(updated)').bind(id,q.symbol,q.price,q.prevClose,changePct(q.price,q.prevClose),hi,lo,q.marketTime,nowSql).run();
  for(let i=0;i<q.points.length;i+=200){const ch=q.points.slice(i,i+200);await d.prepare('INSERT INTO market_intraday(instrument,ts,price) VALUES '+ch.map(()=>'(?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE price=VALUES(price)').bind(...ch.flatMap(p=>[id,p[0],p[1]])).run()}
  saved++;
 }catch(e){fails.push(id+': DB '+e.message)}
}
await d.prepare('DELETE FROM market_intraday WHERE ts<?').bind(Date.now()-7*86400000).run();
console.log(`live ok: ${saved}/${list.length+fxCurrencies.length} uloženo${fails.length?' · chyby: '+fails.join('; '):''}`);
```
- [ ] **Step 3: `scripts/refresh-live.sh`**
```bash
#!/usr/bin/env bash
# Živé ceny trhů každých 15 min z cronu (bez buildu a restartu aplikace).
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" && nvm use 22 >/dev/null
exec 9>/tmp/tradee-live.lock
flock -n 9 || { echo "!! $(date -Is) předchozí běh ještě běží"; exit 0; }
echo "== $(date -Is) live"
node --experimental-strip-types scripts/refresh-live.mjs
```
- [ ] **Step 4: Ověření** – `node --experimental-strip-types scripts/refresh-live.mjs --dry` (lokálně, bez DB): vypíše ~59 řádků (51 trhů bez 8 indexů = 43 stažených + 8 indexů), měnové páry mají nenulové ceny a body; zapiš výstup (zkrácený) do reportu. Pokud Yahoo odmítá (HTTP 401/429), zkus `query2.finance.yahoo.com` a zapiš to. `npx tsc --noEmit -p .` čisté.
- [ ] **Step 5: Commit** „Živé ceny: migrace a sběr z Yahoo“

---

### Task 3: DB vrstva a API

**Files:** Create `lib/live-store.ts`, `app/api/markets/live/route.ts`

**Produces:** `liveQuotes(d:Db):Promise<{updated:number|null;quotes:Record<string,LiveQuote>}>`; `GET /api/markets/live`.

- [ ] **Step 1: `lib/live-store.ts`**
```ts
// Živé ceny z DB pro API (body jen „dnešní“ podle pražského dne).
import type {Db} from './mysql.ts';
import {sessionPoints,type LiveQuote,type LivePoint} from './live.ts';
const utc=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):0;
const num=(v:unknown)=>v===null||v===undefined?null:Number(v);
export async function liveQuotes(d:Db):Promise<{updated:number|null;quotes:Record<string,LiveQuote>}>{
 const rows=(await d.prepare('SELECT instrument,price,prev_close,change_pct,day_high,day_low,market_time,updated FROM market_live').all<Record<string,unknown>>()).results;
 const pts=(await d.prepare('SELECT instrument,ts,price FROM market_intraday WHERE ts>=? ORDER BY ts').bind(Date.now()-3*86400000).all<{instrument:string;ts:number;price:number}>()).results;
 const by=new Map<string,LivePoint[]>();for(const p of pts){const l=by.get(p.instrument)||[];l.push([Number(p.ts),Number(p.price)]);by.set(p.instrument,l)}
 let updated:number|null=null;const quotes:Record<string,LiveQuote>={};
 for(const r of rows){const u=utc(r.updated),id=String(r.instrument);if(updated===null||u>updated)updated=u;
  quotes[id]={price:Number(r.price),prevClose:Number(r.prev_close),changePct:Number(r.change_pct),high:num(r.day_high),low:num(r.day_low),marketTime:Number(r.market_time),updated:u,points:sessionPoints(by.get(id)||[])}}
 return {updated,quotes};
}
```
- [ ] **Step 2: `app/api/markets/live/route.ts`**
```ts
import {identity,db,failed} from '@/lib/server';
import {liveQuotes} from '@/lib/live-store';
export async function GET(req:Request){try{await identity(req);return Response.json(await liveQuotes(db()),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
```
- [ ] **Step 3:** `npx tsc --noEmit -p .` čisté. **Commit** „Živé ceny: API“

---

### Task 4: Klient – hook, mini graf, Analýza trhů

**Files:** Create `app/live.tsx`, `app/live.css`; Modify `app/tradee.tsx`, `app/markets/markets-view.tsx`, `app/markets/market-table.tsx`, `app/markets/heatmap.tsx`, příslušné CSS (`app/markets.css`)

**Produces (app/live.tsx):** `type LiveData={updated:number|null;quotes:Record<string,LiveQuote>}`, `useLive():LiveData|null`, `Spark({points,changePct,width?,height?})`, `LiveChange({pct})` (text „+0,42 %“ s třídou podle znaménka), `LiveBadge({live,quote,now})` („živě“ / „zpožděno“ / „zavřeno · poslední cena 22:00“ – podle `liveState`).

- [ ] **Step 1: `app/live.tsx`** – `'use client'`; `useLive`: načte `/api/markets/live` při mountu, pak `setInterval` 300000 ms a při `visibilitychange` → visible; načítá jen když `document.visibilityState==='visible'`; chyby ignoruje (nechá poslední data). `Spark`: `<svg viewBox="0 0 W H" preserveAspectRatio="none">` s `<path d={sparkPath(points,W,H)}>` (výchozí W=72, H=22), barva podle `changePct` (`--bull`/`--bear`, nula `--t-muted`), `vector-effect:non-scaling-stroke`, `aria-hidden`; bez bodů nic. `LiveChange`: `fmt` = `(pct>0?'+':'')+pct.toLocaleString('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' %'`. Časy v Europe/Prague (`toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'})`).
- [ ] **Step 2: `app/tradee.tsx`** – `const live=useLive();` a předání `live` do `MarketsView`, do detailu trhu (Task 5) a do `Dashboard` (Task 6) jako prop (`live?:LiveData|null`).
- [ ] **Step 3: Tabulka** (`market-table.tsx`): nový sloupec hlavičky **Dnes** za „Trend“; buňka = `LiveChange` + `Spark` z `live?.quotes[i.id]`, jinak „–“. Na mobilu (stávající breakpoint tabulky) se sloupec smí skrýt jen pokud by tabulka přetekla – jinak nech.
- [ ] **Step 4: Heatmapa** (`heatmap.tsx`): na dlaždici pod skóre malý text dnešní změny (`LiveChange`), když existuje.
- [ ] **Step 5: `MarketsView`** – prop `live` prosadit do tabulky i heatmapy; vedle „kontrola podkladů …“ `LiveBadge` pro celek (`updated` + nejnovější `marketTime`).
- [ ] **Step 6:** tsc + build. **Commit** „Živé ceny: dnešní změna v Analýze trhů“

---

### Task 5: Detail trhu – graf dneška

**Files:** Modify `app/tradee.tsx` (detail trhu, větev `r&&item&&…`), `app/live.tsx` (komponenta `IntradayChart`), `app/live.css`

- [ ] **Step 1: `IntradayChart({quote,currencyIndex?:boolean})`** v `app/live.tsx`: SVG 600×160 (`preserveAspectRatio="none"`), čára průběhu z `quote.points`, vodorovná přerušovaná čára předchozího zavření (`prevClose`), plocha pod čarou jemně podle znaménka změny; **hover/dotyk** (pointer události na obalu, `touch-action:pan-y`): svislá vodítka, bod a bublina „čas (Europe/Prague) · cena · změna od zavření %“ – stejný vzor jako `PnlChart` v `app/dashboard.tsx` (bublina se drží v okraji: `translateX` −12 % / −50 % / −88 %). Ceny formátuj `toLocaleString('cs-CZ',{maximumFractionDigits:<podle velikosti: <10 → 5, <1000 → 2, jinak 0>})`; u měnového indexu cenu nezobrazuj, jen změnu.
- [ ] **Step 2: Karta v detailu** – nad stávajícím obsahem detailu (pod nadpisem trhu) `section className="s-card"` „Dnes“: velká změna (`LiveChange`), cena, max/min, `LiveBadge`, `IntradayChart`. Bez dat karta chybí.
- [ ] **Step 3:** tsc + build. **Commit** „Živé ceny: graf dneška v detailu trhu“

---

### Task 6: Dashboard – Co se dnes hýbe

**Files:** Modify `app/dashboard.tsx`, `app/desk.css`

- [ ] **Step 1: Karta „Co se dnes hýbe“** (`section className="d-card d-movers"`, umístit za kartu Šíře trhu – najdi pořadí přes `tile(n)` a přečísluj tak, aby se rozložení nerozbilo): dva sloupce **Rostou** / **Padají** – 5 trhů s největší kladnou / zápornou dnešní změnou (bez `group==='currency'`), řádek = název, `Spark`, `LiveChange`; klik otevře detail trhu (stejná funkce jako jinde na dashboardu). Pod tím **Síla měn dnes**: 8 měnových indexů seřazených podle změny jako vodorovné pruhy od nuly (rovné u nuly, zakulacené na konci – jako `.d-netbars`), popisek měny a `LiveChange`. V hlavičce karty `LiveBadge`.
- [ ] **Step 2:** Bez živých dat se karta nezobrazí. Mobil: sloupce pod sebou.
- [ ] **Step 3:** tsc + build. **Commit** „Živé ceny: karta Co se dnes hýbe“

---

### Task 7: Nasazení (STOP – souhlas Daniela)

- [ ] všechny `check-*.mjs`, tsc, build.
- [ ] merge `feature/live` → `main`, push.
- [ ] VPS: rebase, `npm ci`, `python3 scripts/mariadb-migrate.py` (`applied 0007_live.sql`), build, restart.
- [ ] `scripts/refresh-live.sh` ručně jednou → `live ok: N/59 uloženo`; `GET /api/markets/live` v prohlížeči vrací kotace.
- [ ] Cron (`crontab -e` přes skript, záloha `crontab -l > ~/backups/crontab-<datum>`): přidat `*/15 * * * * /home/ubuntu/tradee/scripts/refresh-live.sh >> /home/ubuntu/tradee/live.log 2>&1`; řádek `17 */4 * * * …refresh-vps.sh…` nahradit `17 * * * 1-5 …` a `17 */4 * * 0,6 …`.
- [ ] Kontrola v prohlížeči: tabulka (sloupec Dnes), heatmapa, detail EUR/USD a BTC (hover), Dashboard (Co se dnes hýbe), mobil 390 px, světlý/tmavý režim.
- [ ] Paměť `project_tradee.md`.
