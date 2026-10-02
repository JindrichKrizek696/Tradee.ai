# Analýza trhů – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seznam trhů jako rychlý přehled (nejsilnější signály + heatmapa všech 51 trhů + hustá tabulka) a pět předvoleb barev signálu, které si uživatel vybere u avataru a které platí v celé aplikaci.

**Architecture:** Čisté výpočty v `lib/market-view.ts` a předvolby v `lib/palettes.ts` (testované `scripts/check-market-view.mjs`). Barvy jdou přes CSS proměnné `--bull/--bear/--bull-text/--bear-text` nastavované hookem `usePalette()` a ukládané do `members.palette` přes `/api/settings`. Seznam trhů je nová komponenta `app/markets/markets-view.tsx`, která v `tradee.tsx` nahradí starou tabulku.

**Tech Stack:** TypeScript/React (vinext/Next 16, Cloudflare Worker build), MariaDB (produkce) / D1 (lokálně), Node 22 `--experimental-strip-types` pro kontrolní skripty, Python 3 pro scriptované úpravy minifikovaných souborů.

**Spec:** `docs/superpowers/specs/2026-10-02-analyza-trhu-design.md`

## Global Constraints

- Větev `feature/analyza`; do `main` jen po souhlasu uživatele.
- Výchozí předvolba `green-red`; id předvoleb: `green-red`, `blue-black`, `blue-yellow`, `purple-orange`, `neon-pink`.
- Barva značky `#245bff` (navigace, odkazy, tlačítka, čára historie skóre) se **nemění**; na proměnné jdou jen barvy směru signálu.
- Textové odstíny předvoleb mají kontrast ≥ 4,5 : 1 vůči `#fff`; text na dlaždici bílý, dokud má kontrast ≥ 3 : 1, jinak `#141518`.
- `localStorage` vždy v try/catch (`tradee.palette`, `tradee.markets.view`).
- UI česky. Styl kódu jako okolí (kompaktní TSX, CSS prefix `m-` pro seznam, `p-` pro výběr barev).
- `tradee.tsx`, `dashboard.tsx`, `score-analyzer.tsx`, `shell.tsx` jsou minifikované jednořádkové soubory – upravují se **jen** přiloženými Python skripty s přesnými náhradami (`assert count==1`), ne ručně.
- Commity končí řádkem `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Klik na tečku vlaječky nesmí otevřít detail** (dlaždice i řádek) – `FlagDot` zastavuje propagaci; ověřeno v Task 4, krok s prohlížečem.
2. **Bez přihlášení / chyba `/api/settings`** – barvy zůstanou z `localStorage` nebo výchozí, žádná chyba v konzoli ani bílá stránka. Task 3, krok s prohlížečem (API vrací 400).
3. **Neznámá předvolba v DB nebo localStorage** (např. smazaná) – použije se výchozí. `getPalette`/`isPalette` v Task 1 checku.
4. **Pozdější CSS přebíjí proměnné** – `.score-v2 .positive` v `globals.css` má vyšší specifičnost; `palette.css` používá `:root …`. Task 3, krok s prohlížečem (fialová předvolba → čísla fialová).
5. **Trh bez skóre** – šedá dlaždice, „—“, v top signálech ani v řazení nahoře. Task 1 check (`heatmapa: … null na konci`, `top: … bez null/0`).

---

## Souborová struktura

| Soubor | Odpovědnost |
|---|---|
| `lib/palettes.ts` (nový) | předvolby, výchozí, `isPalette`, `getPalette` |
| `lib/market-view.ts` (nový) | `toItem`, `topSignals`, `heatmapGroups`, `sortItems`, `filterItems`, `matchesQuery`, `intensity`, `tileBackground`, `textOn`, `hexContrastOnWhite` |
| `scripts/check-market-view.mjs` (nový) | kontrola obou modulů |
| `drizzle/0003_palette.sql`, `drizzle/mariadb/0002_palette.sql` (nové), `db/schema.ts` | sloupec `members.palette` |
| `app/api/settings/route.ts` (nový) | GET/POST předvolby |
| `app/palette.tsx`, `app/palette.css` (nové) | hook `usePalette`, `PalettePicker`, CSS proměnné a přepisy směrových barev |
| `app/shell.tsx`, `app/tradee.tsx`, `app/score-analyzer.tsx`, `app/dashboard.tsx`, `app/globals.css` | napojení barev |
| `app/markets/*.tsx`, `app/markets.css` (nové) | seznam trhů |

---

### Task 1: Předvolby a výpočty seznamu trhů

**Files:**
- Create: `lib/palettes.ts`, `lib/market-view.ts`
- Test: `scripts/check-market-view.mjs`

**Interfaces:**
- Produces: `Palette={id,label,bull,bear,bullText,bearText}`, `palettes`, `DEFAULT_PALETTE`, `isPalette(id:unknown):id is string`, `getPalette(id:unknown):Palette`; `MarketItem={id,name,group,score:number|null,trend:1|-1|0|null,coverage,bias}`, `Trend`, `SortKey='name'|'score'|'coverage'`, `ScoreFilter='all'|'positive'|'negative'|'strong'|'missing'`, `toItem(row)`, `topSignals(items,n=5)→{bull,bear}`, `heatmapGroups(items,labels)→{group,label,items}[]`, `sortItems(items,key,dir)`, `filterItems(items,{query,score,flag},flags)`, `matchesQuery(item,q)`, `intensity(score)`, `tileBackground(hex,alpha)`, `textOn(hex,alpha)`, `hexContrastOnWhite(hex)`.

- [ ] **Step 1: Napiš kontrolu** `scripts/check-market-view.mjs`

```js
// Kontrola seznamu trhů a předvoleb barev: node --experimental-strip-types scripts/check-market-view.mjs
import {toItem,topSignals,heatmapGroups,sortItems,filterItems,matchesQuery,intensity,textOn,hexContrastOnWhite} from '../lib/market-view.ts';
import {palettes,getPalette,isPalette,DEFAULT_PALETTE} from '../lib/palettes.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const it=(id,group,score,coverage=80,name=id)=>({id,name,group,score,trend:null,coverage,bias:''});
const items=[it('EUR/USD','fx',42),it('GBP/USD','fx',-71),it('USD/JPY','fx',null),it('AUD/USD','fx',12),it('USD','currency',-5),it('BTC-USD','crypto',88),it('AAPL','stock',0),it('NZD/USD','fx',-30),it('^NDX','index',55,80,'Nasdaq 100'),it('MSFT','stock',-12),it('TSLA','stock',-90)];

const t=topSignals(items);
check('top bullish: jen kladné, sestupně',t.bull.map(i=>i.id).join()==='BTC-USD,^NDX,EUR/USD,AUD/USD',t.bull.map(i=>i.id));
check('top bearish: jen záporné, od nejsilnějšího',t.bear.map(i=>i.id).join()==='TSLA,GBP/USD,NZD/USD,MSFT,USD',t.bear.map(i=>i.id));
check('top: limit 5 a bez null/0',topSignals(items,2).bull.length===2&&!t.bull.concat(t.bear).some(i=>i.score===null||i.score===0),null);
check('top: prázdný vstup',topSignals([]).bull.length===0&&topSignals([]).bear.length===0,null);

const h=heatmapGroups(items,{fx:'FX páry',currency:'Měnové indexy',index:'Akciové indexy',crypto:'Krypto',stock:'Akcie'});
check('heatmapa: pořadí skupin',h.map(g=>g.group).join()==='fx,currency,index,crypto,stock',h.map(g=>g.group));
check('heatmapa: fx sestupně, null na konci',h[0].items.map(i=>i.id).join()==='EUR/USD,AUD/USD,NZD/USD,GBP/USD,USD/JPY',h[0].items.map(i=>i.id));
check('heatmapa: prázdné skupiny vynechá',heatmapGroups([it('A','fx',1)],{}).length===1,null);

check('řazení skóre sestupně, null na konci',sortItems(items,'score',-1).map(i=>i.score).slice(-1)[0]===null&&sortItems(items,'score',-1)[0].id==='BTC-USD',sortItems(items,'score',-1).map(i=>i.id));
check('řazení skóre vzestupně, null pořád na konci',sortItems(items,'score',1)[0].id==='TSLA'&&sortItems(items,'score',1).slice(-1)[0].score===null,sortItems(items,'score',1).map(i=>i.id));
check('řazení podle názvu',sortItems(items,'name',1)[0].id==='AAPL',sortItems(items,'name',1).map(i=>i.id));

check('hledání ignoruje lomítko a velikost',matchesQuery(it('EUR/USD','fx',1),'eurusd')&&matchesQuery(it('EUR/USD','fx',1),'eur/u')&&!matchesQuery(it('EUR/USD','fx',1),'gbp'),null);
check('filtr silné ≥ |40|',filterItems(items,{query:'',score:'strong',flag:'all'},{}).map(i=>i.id).join()==='EUR/USD,GBP/USD,BTC-USD,^NDX,TSLA',filterItems(items,{query:'',score:'strong',flag:'all'},{}).map(i=>i.id));
check('filtr bez skóre',filterItems(items,{query:'',score:'missing',flag:'all'},{}).map(i=>i.id).join()==='USD/JPY',null);
check('filtr vlaječky (none = bez vlaječky)',filterItems(items,{query:'',score:'all',flag:'green'},{'EUR/USD':'green'}).map(i=>i.id).join()==='EUR/USD'&&filterItems(items,{query:'',score:'all',flag:'none'},{'EUR/USD':'green'}).length===items.length-1,null);

check('intenzita',intensity(null)===0&&intensity(0)===0.15&&intensity(70)===1&&intensity(-100)===1&&Math.abs(intensity(35)-0.575)<1e-9,[intensity(null),intensity(0),intensity(70),intensity(35)]);
check('text na sytě zelené je bílý, na bledé tmavý',textOn('#16a34a',1)==='#fff'&&textOn('#16a34a',0.15)==='#141518',[textOn('#16a34a',1),textOn('#16a34a',0.15)]);
check('text na sytě žluté a křiklavě zelené je tmavý, na černé bílý',textOn('#eab308',1)==='#141518'&&textOn('#00d664',1)==='#141518'&&textOn('#17191e',0.6)==='#fff',[textOn('#eab308',1),textOn('#00d664',1),textOn('#17191e',0.6)]);

check('výchozí předvolba je zelená/červená',DEFAULT_PALETTE==='green-red'&&getPalette(undefined).id==='green-red'&&getPalette('nesmysl').id==='green-red',getPalette('nesmysl').id);
check('isPalette',isPalette('neon-pink')&&!isPalette('x')&&!isPalette(3),null);
check('5 předvoleb s unikátním id',palettes.length===5&&new Set(palettes.map(p=>p.id)).size===5,palettes.map(p=>p.id));
const low=palettes.flatMap(p=>[[p.id+' bullText',hexContrastOnWhite(p.bullText)],[p.id+' bearText',hexContrastOnWhite(p.bearText)]]).filter(([,c])=>c<4.5);
check('textové odstíny mají kontrast ≥ 4,5 na bílé',low.length===0,low);

console.log(fails.length?'CHECK FAILED':'CHECK OK');
if(fails.length)process.exitCode=1;
```

- [ ] **Step 2: Spusť – musí selhat**

Run: `node --experimental-strip-types scripts/check-market-view.mjs`
Expected: `ERR_MODULE_NOT_FOUND … lib/market-view.ts`

- [ ] **Step 3: `lib/palettes.ts`**

```ts
// Předvolby barev signálu (bullish/bearish). Barva značky (#245bff) se nemění.
export type Palette={id:string;label:string;bull:string;bear:string;bullText:string;bearText:string};
export const palettes:Palette[]=[
 {id:'green-red',label:'Zelená / červená',bull:'#16a34a',bear:'#dc2626',bullText:'#15803d',bearText:'#b91c1c'},
 {id:'blue-black',label:'Modrá / černá',bull:'#245bff',bear:'#17191e',bullText:'#1d4ed8',bearText:'#17191e'},
 {id:'blue-yellow',label:'Modrá / žlutá',bull:'#2563eb',bear:'#eab308',bullText:'#1d4ed8',bearText:'#a16207'},
 {id:'purple-orange',label:'Fialová / oranžová',bull:'#7c3aed',bear:'#ea580c',bullText:'#6d28d9',bearText:'#c2410c'},
 {id:'neon-pink',label:'Křiklavě zelená / růžová',bull:'#00d664',bear:'#ec4899',bullText:'#15803d',bearText:'#be185d'},
];
export const DEFAULT_PALETTE='green-red';
export const isPalette=(id:unknown):id is string=>typeof id==='string'&&palettes.some(p=>p.id===id);
export const getPalette=(id:unknown)=>palettes.find(p=>p.id===id)??palettes[0];
```

- [ ] **Step 4: `lib/market-view.ts`**

```ts
// Seznam trhů: čisté výpočty pro top signály, heatmapu a tabulku.
export type Trend=1|-1|0|null;
export type MarketItem={id:string;name:string;group:string;score:number|null;trend:Trend;coverage:number;bias:string};
type RowLike={id:string;name:string;group:string;r:{score:number|null;coverage:number;bias:string;parts:{id:string;signal:number|null}[];price?:{trend?:number}|null}};
export type SortKey='name'|'score'|'coverage';
export type ScoreFilter='all'|'positive'|'negative'|'strong'|'missing';

export function toItem(row:RowLike):MarketItem{
 const t=row.r.parts.find(p=>p.id==='trend')?.signal;
 const v=row.r.price?.trend??0;
 return {id:row.id,name:row.name,group:row.group,score:row.r.score,coverage:row.r.coverage,bias:row.r.bias,trend:t===null||t===undefined?null:v>0?1:v<0?-1:0};
}

const byScoreDesc=(a:MarketItem,b:MarketItem)=>a.score===null?(b.score===null?a.name.localeCompare(b.name):1):b.score===null?-1:b.score-a.score;

export function topSignals(items:MarketItem[],n=5){
 const valid=items.filter(i=>i.score!==null&&i.score!==0);
 return {
  bull:valid.filter(i=>i.score!>0).sort(byScoreDesc).slice(0,n),
  bear:valid.filter(i=>i.score!<0).sort((a,b)=>a.score!-b.score!).slice(0,n),
 };
}

export const GROUP_ORDER=['fx','currency','index','crypto','stock'];
export function heatmapGroups(items:MarketItem[],labels:Record<string,string>){
 return GROUP_ORDER.map(g=>({group:g,label:labels[g]??g,items:items.filter(i=>i.group===g).sort(byScoreDesc)})).filter(g=>g.items.length);
}

export function sortItems(items:MarketItem[],key:SortKey,dir:1|-1){
 return [...items].sort((a,b)=>{
  if(key==='name')return dir*a.name.localeCompare(b.name,'cs');
  const x=key==='score'?a.score:a.coverage,y=key==='score'?b.score:b.coverage;
  if(x===null)return y===null?0:1;
  if(y===null)return -1;
  return dir*(x-y);
 });
}

export const normalize=(s:string)=>s.toUpperCase().replaceAll('/','').replace(/\s+/g,'');
export const matchesQuery=(i:MarketItem,q:string)=>!q.trim()||normalize(i.id+' '+i.name).includes(normalize(q));

export function filterItems(items:MarketItem[],f:{query:string;score:ScoreFilter;flag:string},flags:Record<string,string>){
 return items.filter(i=>matchesQuery(i,f.query)&&(f.flag==='all'||(flags[i.id]||'none')===f.flag)&&(
  f.score==='all'||f.score==='positive'&&i.score!==null&&i.score>0||f.score==='negative'&&i.score!==null&&i.score<0||
  f.score==='strong'&&i.score!==null&&Math.abs(i.score)>=40||f.score==='missing'&&i.score===null));
}

// Sytost barvy dlaždice: slabý signál 15 %, od |70| plná.
export const intensity=(score:number|null)=>score===null?0:0.15+0.85*Math.min(1,Math.abs(score)/70);

const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const lin=(c:number)=>{const s=c/255;return s<=0.03928?s/12.92:((s+0.055)/1.055)**2.4};
export const luminance=([r,g,b]:number[])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
export const contrast=(a:number[],b:number[])=>{const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05)};
// Barva smíchaná s bílou podle sytosti (stejně jako rgba přes bílé pozadí).
export const blend=(hex:string,alpha:number)=>rgb(hex).map(c=>Math.round(255+(c-255)*alpha));
export const tileBackground=(hex:string,alpha:number)=>{const [r,g,b]=blend(hex,alpha);return `rgb(${r},${g},${b})`};
// Text na dlaždici (tučný): bílý, dokud má vůči pozadí kontrast aspoň 3:1, jinak tmavý.
export const textOn=(hex:string,alpha:number)=>contrast(blend(hex,alpha),[255,255,255])>=3?'#fff':'#141518';
export const hexContrastOnWhite=(hex:string)=>contrast(rgb(hex),[255,255,255]);
```

- [ ] **Step 5: Spusť – musí projít**

Run: `node --experimental-strip-types scripts/check-market-view.mjs`
Expected: 21 řádků `ok`, poslední `CHECK OK`

- [ ] **Step 6: Commit**

```bash
git add lib/palettes.ts lib/market-view.ts scripts/check-market-view.mjs
git commit -m "Analýza: předvolby barev a výpočty seznamu trhů

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Uložení předvolby – migrace a `/api/settings`

**Files:**
- Create: `drizzle/0003_palette.sql`, `drizzle/mariadb/0002_palette.sql`, `app/api/settings/route.ts`
- Modify: `db/schema.ts` (skript níže)

**Interfaces:**
- Consumes: `isPalette` z Task 1; `identity`, `db`, `failed`, `sameOrigin` z `lib/server.ts`.
- Produces: `GET /api/settings → {palette:string|null}`, `POST /api/settings {palette} → {ok:true}` nebo 400 „Neznámá předvolba barev.“

- [ ] **Step 1: Migrace**

`drizzle/0003_palette.sql`:
```sql
ALTER TABLE `members` ADD `palette` text;
```

`drizzle/mariadb/0002_palette.sql`:
```sql
-- Předvolba barev signálu (lib/palettes.ts); NULL = výchozí zelená/červená.
ALTER TABLE members ADD COLUMN IF NOT EXISTS palette VARCHAR(32) NULL;
```

- [ ] **Step 2: Schéma** – spusť z kořene repa:

```python
# Úkol 2: sloupec palette v D1 schématu
p='db/schema.ts';s=open(p).read()
old="role:text('role').notNull().default('member')});"
assert s.count(old)==1,old
open(p,'w').write(s.replace(old,"role:text('role').notNull().default('member'),palette:text('palette')});"))
```

- [ ] **Step 3: `app/api/settings/route.ts`**

```ts
import {identity,db,failed,sameOrigin} from '@/lib/server';
import {isPalette} from '@/lib/palettes';
export async function GET(req:Request){try{const u=await identity(req);const row=await db().prepare('SELECT palette FROM members WHERE id=?').bind(u.id).first<{palette:string|null}>();return Response.json({palette:isPalette(row?.palette)?row!.palette:null},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);const {palette}=await req.json() as {palette:unknown};if(!isPalette(palette))throw Error('Neznámá předvolba barev.');await db().prepare('UPDATE members SET palette=? WHERE id=?').bind(palette,u.id).run();return Response.json({ok:true})}catch(e){return failed(e)}}
```

- [ ] **Step 4: Typová kontrola**

Run: `npx tsc --noEmit -p . && echo tsc ok`
Expected: `tsc ok`

- [ ] **Step 5: Commit**

```bash
git add drizzle/0003_palette.sql drizzle/mariadb/0002_palette.sql db/schema.ts app/api/settings/route.ts
git commit -m "Analýza: sloupec members.palette a /api/settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Barvy signálu v celé aplikaci + výběr u avataru

**Files:**
- Create: `app/palette.tsx`, `app/palette.css`
- Modify: `app/globals.css`, `app/shell.tsx`, `app/tradee.tsx`, `app/score-analyzer.tsx`, `app/dashboard.tsx` (skript níže)

**Interfaces:**
- Consumes: `palettes`, `getPalette`, `isPalette`, `DEFAULT_PALETTE`, `Palette` (Task 1); `/api/settings` (Task 2).
- Produces: `usePalette()→{palette:Palette;choose:(id:string)=>void}`, `PalettePicker({value,onChoose})`; v `tradee.tsx` proměnná `palette` (typ `Palette`) – Task 4 ji předá do `MarketsView`. Shell dostane props `palette:string`, `onPalette:(id)=>void`.

- [ ] **Step 1: `app/palette.tsx`**

```tsx
'use client';
import {useEffect,useLayoutEffect,useState} from 'react';
import {palettes,getPalette,isPalette,DEFAULT_PALETTE,type Palette} from '@/lib/palettes';
const KEY='tradee.palette';
const useIso=typeof window==='undefined'?useEffect:useLayoutEffect;
function apply(p:Palette){const s=document.documentElement.style;s.setProperty('--bull',p.bull);s.setProperty('--bear',p.bear);s.setProperty('--bull-text',p.bullText);s.setProperty('--bear-text',p.bearText)}

// Předvolba barev signálu: hned z localStorage (bez bliknutí), pak sjednocení s účtem přes /api/settings.
export function usePalette(){
 const [id,setId]=useState(DEFAULT_PALETTE);
 useIso(()=>{let saved:string|null=null;try{saved=localStorage.getItem(KEY)}catch{}if(isPalette(saved))setId(saved)},[]);
 useIso(()=>apply(getPalette(id)),[id]);
 useEffect(()=>{let live=true;fetch('/api/settings',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{palette?:string|null}>:null).then(j=>{if(live&&isPalette(j?.palette)){setId(j!.palette!);try{localStorage.setItem(KEY,j!.palette!)}catch{}}}).catch(()=>{});return()=>{live=false}},[]);
 const choose=(next:string)=>{if(!isPalette(next))return;setId(next);try{localStorage.setItem(KEY,next)}catch{}fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({palette:next})}).catch(()=>{})};
 return {palette:getPalette(id),choose};
}

export function PalettePicker({value,onChoose}:{value:string;onChoose:(id:string)=>void}){
 return <div className="p-picker" role="radiogroup" aria-label="Barvy signálu">
  <b>Barvy signálu</b>
  {palettes.map(p=><button key={p.id} type="button" role="radio" aria-checked={p.id===value} className={p.id===value?'on':''} onClick={()=>onChoose(p.id)}>
   <span className="p-swatch"><i style={{background:p.bull}}/><i style={{background:p.bear}}/></span>{p.label}{p.id===DEFAULT_PALETTE&&<small>výchozí</small>}
  </button>)}
 </div>;
}
```

- [ ] **Step 2: `app/palette.css`**

```css
/* Barvy signálu – výchozí zelená/červená, přepisuje usePalette() na <html>. Barva značky #245bff se nemění.
   :root zvyšuje specifičnost – soubor se importuje na začátku globals.css a pozdější pravidla by ho jinak přebila. */
:root{--bull:#16a34a;--bear:#dc2626;--bull-text:#15803d;--bear-text:#b91c1c}
:root .score-v2{--good:var(--bull);--bad:var(--bear)}
:root .positive,:root .score-v2 .positive{color:var(--bull-text)!important}
:root .negative,:root .score-v2 .negative{color:var(--bear-text)!important}
:root .s-scale{background:linear-gradient(90deg,var(--bear),#bfc3cc 50%,var(--bull))}
.up,.t-cal-d.up b,.t-cal-w.up b{color:var(--bull-text)}
.down,.t-cal-d.down b,.t-cal-w.down b{color:var(--bear-text)}
.t-chip.up{background:color-mix(in srgb,var(--bull) 12%,#fff);color:var(--bull-text)}
.t-chip.down{background:color-mix(in srgb,var(--bear) 12%,#fff);color:var(--bear-text)}
/* výběr předvolby u avataru */
.t-avatar-wrap{position:relative}
.t-avatar{cursor:pointer;border:0}
.p-picker{position:absolute;right:0;top:46px;z-index:30;width:250px;display:grid;gap:2px;padding:10px;background:#fff;border:1px solid #e3e8f2;border-radius:14px;box-shadow:0 12px 32px -12px #1b2a5a40}
.p-picker b{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#8b93a3;margin:2px 6px 6px}
.p-picker button{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:9px;border:1px solid transparent;background:none;font-size:13px;color:#141518;text-align:left;cursor:pointer}
.p-picker button:hover{background:#f1f4fb}
.p-picker button.on{border-color:#245bff55;background:#eef3ff}
.p-picker small{margin-left:auto;font-size:11px;color:#8b93a3}
.p-swatch{display:flex;border-radius:5px;overflow:hidden}.p-swatch i{width:14px;height:14px}
```

- [ ] **Step 3: Napojení** – spusť z kořene repa:

```python
# Úkol 3: předvolby barev – import stylů, avatar s výběrem, směrové barvy přes CSS proměnné
def edit(p,pairs):
    s=open(p).read()
    for old,new in pairs:
        assert s.count(old)==1,(p,old[:80]); s=s.replace(old,new)
    open(p,'w').write(s)

edit('app/globals.css',[('@import "./calendar.css";\n','@import "./calendar.css";\n@import "./palette.css";\n')])

edit('app/shell.tsx',[
 ("'use client';\n","'use client';\nimport {useEffect,useRef,useState} from 'react';\nimport {PalettePicker} from './palette';\n"),
 ("export function Shell({view,setView,busy,onRefresh,userName,children}:{view:View;setView:(v:View)=>void;busy:boolean;onRefresh:()=>void;userName:string;children:React.ReactNode}){\n",
  "export function Shell({view,setView,busy,onRefresh,userName,palette,onPalette,children}:{view:View;setView:(v:View)=>void;busy:boolean;onRefresh:()=>void;userName:string;palette:string;onPalette:(id:string)=>void;children:React.ReactNode}){\n const [menu,setMenu]=useState(false),wrap=useRef<HTMLDivElement>(null);\n useEffect(()=>{if(!menu)return;const close=(e:MouseEvent)=>{if(!wrap.current?.contains(e.target as Node))setMenu(false)};const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false)};document.addEventListener('mousedown',close);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',esc)}},[menu]);\n"),
 ("<div className=\"t-avatar\" title={userName} aria-label={'Přihlášen: '+userName}>{userName.trim().charAt(0).toUpperCase()||'?'}</div>",
  "<div className=\"t-avatar-wrap\" ref={wrap}><button type=\"button\" className=\"t-avatar\" title={userName+' · barvy signálu'} aria-label={'Přihlášen: '+userName+'. Nastavení barev signálu'} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{userName.trim().charAt(0).toUpperCase()||'?'}</button>{menu&&<PalettePicker value={palette} onChoose={onPalette}/>}</div>"),
])

edit('app/tradee.tsx',[
 ("import calendarAuto from '@/data/calendar.json';\n","import calendarAuto from '@/data/calendar.json';\nimport {usePalette} from './palette';\n"),
 (" const calendar=mergeCalendar("," const {palette,choose:choosePalette}=usePalette();\n const calendar=mergeCalendar("),
 ("<Shell view={view} setView={setView} busy={busy} onRefresh={()=>{refresh();loadFlags()}} userName={userName}>",
  "<Shell view={view} setView={setView} busy={busy} onRefresh={()=>{refresh();loadFlags()}} userName={userName} palette={palette.id} onPalette={choosePalette}>"),
 ("background:(p.contribution??0)>=0?'#245bff':'#17191e'","background:(p.contribution??0)>=0?'var(--bull)':'var(--bear)'"),
 ("conic-gradient(#245bff 0 ${share}%, #17191e ${share}","conic-gradient(var(--bull) 0 ${share}%, var(--bear) ${share}"),
])

edit('app/score-analyzer.tsx',[
 ("background:y.logReturn>=0?'#245bff':'#17191e'","background:y.logReturn>=0?'var(--bull)':'var(--bear)'"),
 ("background:(p.contribution??0)>=0?'#245bff':'#17191e'","background:(p.contribution??0)>=0?'var(--bull)':'var(--bear)'"),
])

# SVG atributy (fill=, stroke=) neumí var() – barvy grafů jdou přes style
import re
p='app/dashboard.tsx';s=open(p).read()
m=re.search(r'<circle cx="32" cy="20" r=\{r\} fill="none" stroke=\{color\}',s); assert m
s=s.replace(m.group(0),'<circle cx="32" cy="20" r={r} fill="none" style={{stroke:color}}');open(p,'w').write(s)
edit('app/dashboard.tsx',[
 ('<Spark values={bullishTrail(history)} color="#16a34a"/>','<Spark values={bullishTrail(history)} color="var(--bull)"/>'),
 ('<Spark values={bearishTrail(history)} color="#dc2626"/>','<Spark values={bearishTrail(history)} color="var(--bear)"/>'),
 ("color={strongestUp?'#16a34a':'#dc2626'}","color={strongestUp?'var(--bull)':'var(--bear)'}"),
 ('fill={color} opacity=".12"/><path d={d} fill="none" stroke={color} strokeWidth="2"','style={{fill:color}} opacity=".12"/><path d={d} fill="none" style={{stroke:color}} strokeWidth="2"'),
])
```

- [ ] **Step 4: Typová kontrola a build**

Run: `npx tsc --noEmit -p . && echo tsc ok && npm run build 2>&1 | grep "Build complete"`
Expected: `tsc ok`, `Build complete.`

- [ ] **Step 5: Kontrola v prohlížeči** (`npm run dev`, Playwright/Chrome)

Lokální data jsou starší než 48 h → nastav hodiny prohlížeče na den po posledním `checkedAt` v `data/score-market.json` (Playwright `page.clock.setFixedTime`), jinak jsou všechna skóre „Nedostatek dat“. Chybový overlay vinext (hydratace kvůli posunutému času) skryj stylem `#__vinext_dev_error_overlay_root{display:none!important}`.
1. Klik na avatar → panel „Barvy signálu“ s 5 předvolbami, „výchozí“ u Zelená / červená; Escape i klik mimo ho zavře.
2. Výběr „Fialová / oranžová“ → `getComputedStyle(document.documentElement).getPropertyValue('--bull')` = `#7c3aed`; POST `/api/settings` s `{"palette":"purple-orange"}`.
3. Detail trhu: velké skóre a „Bullish/Bearish“ fialové/oranžové, škála oranžová→šedá→fialová; dashboard: mini grafy Bullish/Bearish trhů a kroužek nejsilnějšího signálu ve fialové/oranžové.
4. Reload → předvolba drží (z `localStorage`), i když `/api/settings` vrací 400.

- [ ] **Step 6: Commit**

```bash
git add app/palette.tsx app/palette.css app/globals.css app/shell.tsx app/tradee.tsx app/score-analyzer.tsx app/dashboard.tsx
git commit -m "Analýza: předvolby barev signálu v celé aplikaci, výběr u avataru

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Seznam trhů – top signály, heatmapa, tabulka, vlaječky

**Files:**
- Create: `app/markets/parts.tsx`, `app/markets/flag-dot.tsx`, `app/markets/top-signals.tsx`, `app/markets/heatmap.tsx`, `app/markets/market-table.tsx`, `app/markets/markets-view.tsx`, `app/markets.css`
- Modify: `app/globals.css`, `app/tradee.tsx` (skript níže)

**Interfaces:**
- Consumes: vše z `lib/market-view.ts` (Task 1), `Palette` (Task 1), `palette` v `tradee.tsx` (Task 3), `Picker` z `app/score-analyzer.tsx`, `groups`, `flagLabels` z `lib/markets.ts`, `saveFlag(instrument,flag)`, `flags`, `flagsReady`, `saving`, `open(id)` z `tradee.tsx`.
- Produces: `MarketsView({items,checkedAt,palette,flags,flagsReady,onFlag,open})`.

- [ ] **Step 1: `app/markets/parts.tsx`**

```tsx
'use client';
import type {Trend} from '@/lib/market-view';
export const fmtScore=(s:number|null)=>s===null?'—':(s>0?'+':'')+Math.round(s);
// Pruh od středu: vpravo bullish, vlevo bearish.
export function ScoreBar({score}:{score:number|null}){
 return <span className="m-bar" aria-hidden="true"><i className="m-mid"/>{score!==null&&score!==0&&<i className={score>0?'m-fill bull':'m-fill bear'} style={{[score>0?'left':'right']:'50%',width:Math.min(50,Math.abs(score)/2)+'%'}}/>}</span>;
}
export function TrendMark({trend}:{trend:Trend}){
 const [cls,sym,label]=trend===null?['m-trend','·','Trend neověřen']:trend>0?['m-trend positive','▲','Trend bullish']:trend<0?['m-trend negative','▼','Trend bearish']:['m-trend','■','Trend neutrální'];
 return <span className={cls} title={label} aria-label={label}>{sym}</span>;
}
```

- [ ] **Step 2: `app/markets/flag-dot.tsx`**

```tsx
'use client';
import {useEffect,useRef,useState} from 'react';
import {flagLabels} from '@/lib/markets';
// Tečka vlaječky; klik otevře menu se čtyřmi volbami. Klik nikdy nepropadne do řádku/dlaždice (detail).
export function FlagDot({id,flag,disabled,onPick}:{id:string;flag:string;disabled:boolean;onPick:(id:string,flag:string)=>void}){
 const [open,setOpen]=useState(false),ref=useRef<HTMLSpanElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[open]);
 return <span className="m-flag" ref={ref} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
  <button type="button" className={'m-dot flag-'+flag} disabled={disabled} aria-label={'Vlaječka '+id+': '+flagLabels[flag]} aria-expanded={open} title={flagLabels[flag]} onClick={()=>setOpen(!open)}><i/></button>
  {open&&<span className="m-flag-menu" role="menu">{Object.entries(flagLabels).map(([value,label])=><button key={value} type="button" role="menuitemradio" aria-checked={value===flag} className={value===flag?'on':''} onClick={()=>{setOpen(false);onPick(id,value)}}><i className={'flag-'+value}/>{label}</button>)}</span>}
 </span>;
}
```

- [ ] **Step 3: `app/markets/top-signals.tsx`**

```tsx
'use client';
import type {MarketItem} from '@/lib/market-view';
import {ScoreBar,TrendMark,fmtScore} from './parts';
function Column({title,items,dir,open}:{title:string;items:MarketItem[];dir:'bull'|'bear';open:(id:string)=>void}){
 return <div className="m-top-col"><h3 className={dir==='bull'?'positive':'negative'}>{dir==='bull'?'▲':'▼'} {title}</h3>
  {items.length?items.map(i=><button key={i.id} type="button" className="m-top" onClick={()=>open(i.id)}><b>{i.name}</b><span className={dir==='bull'?'positive':'negative'}>{fmtScore(i.score)}</span><ScoreBar score={i.score}/><TrendMark trend={i.trend}/></button>):<p className="m-none">Žádný platný signál</p>}
 </div>;
}
export function TopSignals({bull,bear,open}:{bull:MarketItem[];bear:MarketItem[];open:(id:string)=>void}){
 return <section className="m-tops"><Column title="Nejsilnější bullish" items={bull} dir="bull" open={open}/><Column title="Nejsilnější bearish" items={bear} dir="bear" open={open}/></section>;
}
```

- [ ] **Step 4: `app/markets/heatmap.tsx`**

```tsx
'use client';
import type {MarketItem} from '@/lib/market-view';
import {intensity,matchesQuery,textOn,tileBackground} from '@/lib/market-view';
import type {Palette} from '@/lib/palettes';
import {FlagDot} from './flag-dot';
import {fmtScore} from './parts';
const trendText=(t:MarketItem['trend'])=>t===null?'trend neověřen':t>0?'trend bullish':t<0?'trend bearish':'trend neutrální';
export function Heatmap({groups,query,palette,flags,flagsReady,onFlag,open}:{groups:{group:string;label:string;items:MarketItem[]}[];query:string;palette:Palette;flags:Record<string,string>;flagsReady:boolean;onFlag:(id:string,flag:string)=>void;open:(id:string)=>void}){
 return <div className="m-heat">{groups.map(g=><section key={g.group}><h3>{g.label}</h3><div className="m-tiles">{g.items.map(i=>{
  const a=intensity(i.score),hex=i.score!==null&&i.score<0?palette.bear:palette.bull;
  const style=i.score===null?undefined:{background:tileBackground(hex,a),color:textOn(hex,a)};
  return <div key={i.id} role="button" tabIndex={0} className={'m-tile'+(i.score===null?' m-empty':'')+(matchesQuery(i,query)?'':' m-dim')} style={style} title={`${i.name} · ${i.bias} · ${trendText(i.trend)} · ${i.coverage} % podkladů`} onClick={()=>open(i.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(i.id)}}}>
   <b>{i.name.replace(/ · měnový index$/,'')}</b><span>{fmtScore(i.score)}</span>
   <FlagDot id={i.id} flag={flags[i.id]||'none'} disabled={!flagsReady} onPick={onFlag}/>
  </div>})}</div></section>)}</div>;
}
```

- [ ] **Step 5: `app/markets/market-table.tsx`**

```tsx
'use client';
import type {MarketItem,SortKey} from '@/lib/market-view';
import {FlagDot} from './flag-dot';
import {ScoreBar,TrendMark,fmtScore} from './parts';
export function MarketTable({items,sort,onSort,groupLabels,flags,flagsReady,onFlag,open}:{items:MarketItem[];sort:{key:SortKey;dir:1|-1};onSort:(k:SortKey)=>void;groupLabels:Record<string,string>;flags:Record<string,string>;flagsReady:boolean;onFlag:(id:string,flag:string)=>void;open:(id:string)=>void}){
 const head=(k:SortKey,label:string)=><button type="button" className={'m-sort'+(sort.key===k?' on':'')} onClick={()=>onSort(k)} aria-sort={sort.key===k?(sort.dir>0?'ascending':'descending'):undefined}>{label}{sort.key===k?(sort.dir>0?' ↑':' ↓'):''}</button>;
 return <div className="m-table" role="table">
  <div className="m-row m-head" role="row">{head('name','Trh')}{head('score','Skóre')}<span>−100 · bearish ← → bullish · +100</span><span>Trend</span>{head('coverage','Data')}<span>Vlaječka</span></div>
  {items.map(i=><div key={i.id} className="m-row" role="row" tabIndex={0} onClick={()=>open(i.id)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();open(i.id)}}}>
   <span className="m-name"><b>{i.name}</b><small>{groupLabels[i.group]}</small></span>
   <b className={'m-score '+(i.score===null||i.score===0?'':i.score>0?'positive':'negative')}>{fmtScore(i.score)}</b>
   <ScoreBar score={i.score}/><TrendMark trend={i.trend}/><span className="m-cov">{i.coverage} %</span>
   <FlagDot id={i.id} flag={flags[i.id]||'none'} disabled={!flagsReady} onPick={onFlag}/>
  </div>)}
  {!items.length&&<p className="m-none">Filtrům neodpovídá žádný trh.</p>}
 </div>;
}
```

- [ ] **Step 6: `app/markets/markets-view.tsx`**

```tsx
'use client';
import {useMemo,useState} from 'react';
import {LayoutGrid,List,Search} from 'lucide-react';
import {Picker} from '../score-analyzer';
import {groups,flagLabels} from '@/lib/markets';
import {topSignals,heatmapGroups,sortItems,filterItems,type MarketItem,type ScoreFilter,type SortKey} from '@/lib/market-view';
import type {Palette} from '@/lib/palettes';
import {TopSignals} from './top-signals';
import {Heatmap} from './heatmap';
import {MarketTable} from './market-table';
const VIEW_KEY='tradee.markets.view';
const readView=()=>{try{return localStorage.getItem(VIEW_KEY)==='table'?'table':'heatmap'}catch{return 'heatmap'}};

export function MarketsView({items,checkedAt,palette,flags,flagsReady,onFlag,open}:{items:MarketItem[];checkedAt:string;palette:Palette;flags:Record<string,string>;flagsReady:boolean;onFlag:(id:string,flag:string)=>void;open:(id:string)=>void}){
 // Seznam trhů se vykreslí až po přepnutí pohledu v prohlížeči, localStorage je dostupné hned.
 const [view,setViewState]=useState<'heatmap'|'table'>(readView),[group,setGroup]=useState('all'),[query,setQuery]=useState(''),[score,setScore]=useState<ScoreFilter>('all'),[flag,setFlag]=useState('all'),[sort,setSort]=useState<{key:SortKey;dir:1|-1}>({key:'score',dir:-1});
 const setView=(v:'heatmap'|'table')=>{setViewState(v);try{localStorage.setItem(VIEW_KEY,v)}catch{}};
 const inGroup=useMemo(()=>items.filter(i=>group==='all'||i.group===group),[items,group]);
 const top=useMemo(()=>topSignals(inGroup),[inGroup]);
 const heat=useMemo(()=>heatmapGroups(inGroup,groups),[inGroup]);
 const rows=useMemo(()=>sortItems(filterItems(inGroup,{query,score,flag},flags),sort.key,sort.dir),[inGroup,query,score,flag,flags,sort]);
 const onSort=(k:SortKey)=>setSort(s=>s.key===k?{key:k,dir:s.dir>0?-1:1}:{key:k,dir:k==='name'?1:-1});
 const stamp=new Date(checkedAt).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
 return <div className="m-page">
  <div className="m-head-bar">
   <h1>Analýza trhů</h1><span className="m-stamp">kontrola podkladů {stamp}</span>
   <label className="m-search"><Search size={15}/><input aria-label="Hledat trh" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Hledat trh…"/></label>
   <div className="m-switch" role="tablist" aria-label="Zobrazení"><button type="button" role="tab" aria-selected={view==='heatmap'} className={view==='heatmap'?'on':''} onClick={()=>setView('heatmap')}><LayoutGrid size={15}/>Heatmapa</button><button type="button" role="tab" aria-selected={view==='table'} className={view==='table'?'on':''} onClick={()=>setView('table')}><List size={15}/>Tabulka</button></div>
  </div>
  <div className="m-groups">{Object.entries(groups).map(([g,label])=><button key={g} type="button" className={g===group?'on':''} onClick={()=>setGroup(g)}>{label}<small>{g==='all'?items.length:items.filter(i=>i.group===g).length}</small></button>)}{view==='table'&&<div className="m-filters"><Picker label="Filtrovat skóre" value={score} onChange={v=>setScore(v as ScoreFilter)} items={[{value:'all',label:'Všechna skóre'},{value:'positive',label:'Bullish · nad 0'},{value:'negative',label:'Bearish · pod 0'},{value:'strong',label:'Výrazné · |40| a více'},{value:'missing',label:'Bez platného skóre'}]}/><Picker label="Filtrovat vlaječky" value={flag} onChange={setFlag} items={[{value:'all',label:'Všechny vlaječky'},...Object.entries(flagLabels).map(([value,label])=>({value,label}))]}/></div>}</div>
  {view==='heatmap'&&<TopSignals bull={top.bull} bear={top.bear} open={open}/>}
  {view==='heatmap'?<Heatmap groups={heat} query={query} palette={palette} flags={flags} flagsReady={flagsReady} onFlag={onFlag} open={open}/>:<>
   <MarketTable items={rows} sort={sort} onSort={onSort} groupLabels={groups} flags={flags} flagsReady={flagsReady} onFlag={onFlag} open={open}/>
  </>}
  <p className="m-legend"><i className="bull"/>bullish <i className="bear"/>bearish · sytost = síla signálu · <i className="none"/>bez platného skóre · tečka = tvoje vlaječka. FX kompozit kombinuje fundament, COT, trend a sezónu; akcie, indexy a krypto mají technický model.</p>
 </div>;
}
```

- [ ] **Step 7: `app/markets.css`**

```css
/* Tradee.ai · seznam trhů (rychlý přehled) */
.m-head-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 10px}
.m-page .m-head-bar h1{font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-.5px;margin:0}
.m-stamp{font-size:12px;color:#8b93a3;margin-right:auto}
.m-page .m-search{display:flex;flex-direction:row;align-items:center;gap:6px;padding:6px 10px;border:1px solid #e3e8f2;border-radius:10px;background:#fff;color:#8b93a3}
.m-page .m-search input{border:0!important;outline:0;background:transparent!important;box-shadow:none!important;padding:0!important;height:auto!important;font-size:13px;width:160px;color:#141518!important}
.m-switch{display:flex;padding:2px;border-radius:10px;background:#e9edf5}
.m-switch button{display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;border:0;background:none;font-size:13px;font-weight:600;color:#6b7280;cursor:pointer}
.m-switch button.on{background:#fff;color:#141518;box-shadow:0 1px 2px #0000001a}
.m-groups{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px}
.m-groups button{display:flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;border:1px solid #e3e8f2;background:#fff;font-size:13px;font-weight:600;color:#4b5563;cursor:pointer}
.m-groups button.on{background:#e8efff;border-color:#245bff55;color:#245bff}
.m-groups small{font-size:11px;color:#8b93a3}
/* nejsilnější signály */
.m-tops{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px}
.m-top-col h3{margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.m-top{display:grid;grid-template-columns:minmax(0,130px) 44px minmax(0,1fr) 16px;gap:10px;align-items:center;width:100%;padding:5px 10px;margin-bottom:3px;border-radius:10px;border:1px solid #eef1f7;background:#fff;font-size:13px;text-align:left;cursor:pointer}
.m-top:hover{border-color:#cdd5e6}
.m-top b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m-top>span:nth-child(2){font-weight:800;text-align:right;font-variant-numeric:tabular-nums}
.m-none{margin:6px 0;font-size:13px;color:#8b93a3}
/* pruh skóre a trend */
.m-bar{position:relative;display:block;height:8px;border-radius:4px;background:#eef1f7}
.m-mid{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:#c9ced8}
.m-fill{position:absolute;top:0;bottom:0;border-radius:4px}
.m-fill.bull{background:var(--bull)}.m-fill.bear{background:var(--bear)}
.m-trend{font-size:12px;text-align:center;color:#9aa1ad}
/* heatmapa */
.m-heat{display:flex;flex-wrap:wrap;column-gap:22px}
.m-heat section{flex:0 1 auto;margin-bottom:8px;min-width:0}
.m-heat h3{margin:0 0 5px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b7280}
.m-tiles{display:flex;flex-wrap:wrap;gap:5px}
.m-tile{position:relative;display:flex;flex-direction:column;justify-content:space-between;width:94px;height:46px;padding:6px 8px;border-radius:9px;background:#dfe3ea;color:#141518;cursor:pointer;transition:transform .1s,opacity .15s}
.m-tile:hover{transform:translateY(-1px);box-shadow:0 4px 12px -6px #1b2a5a55}
.m-tile:focus-visible{outline:2px solid #245bff;outline-offset:2px}
.m-tile b{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:16px}
.m-tile>span{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
.m-tile.m-empty{color:#6b7280}
.m-dim{opacity:.18}
.m-tile .m-flag{position:absolute;top:2px;right:2px}
/* vlaječka */
.m-flag{position:relative;display:inline-flex}
.m-dot{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;background:none;cursor:pointer}
.m-dot i{width:10px;height:10px;border-radius:50%;border:1.5px solid currentColor;background:currentColor}
.m-dot.flag-none i{background:transparent;border-color:#b8bfcc}
.m-tile .m-dot i{box-shadow:0 0 0 1.5px #fff}
.m-tile .m-dot.flag-none i{opacity:.55}
.m-dot:disabled{cursor:default;opacity:.5}
.m-flag-menu{position:absolute;right:0;top:26px;z-index:20;display:grid;min-width:210px;padding:6px;background:#fff;border:1px solid #e3e8f2;border-radius:12px;box-shadow:0 12px 32px -12px #1b2a5a40}
.m-flag-menu button{display:flex;align-items:center;gap:8px;padding:7px 8px;border:0;border-radius:8px;background:none;font-size:13px;color:#141518;text-align:left;cursor:pointer}
.m-flag-menu button:hover,.m-flag-menu button.on{background:#f1f4fb}
.m-flag-menu i{width:10px;height:10px;border-radius:50%;background:currentColor;border:1.5px solid currentColor}
.m-flag-menu i.flag-none{background:transparent;border-color:#b8bfcc}
/* tabulka */
.m-filters{display:flex;gap:8px;margin-left:auto}
.m-table{background:#fff;border:1px solid #e3e8f2;border-radius:14px;overflow:visible}
.m-row{display:grid;grid-template-columns:minmax(0,200px) 52px minmax(0,1fr) 40px 56px 32px;gap:12px;align-items:center;height:32px;padding:0 12px;border-top:1px solid #f1f4fb;font-size:13px;cursor:pointer}
.m-row:hover{background:#fbfcff}
.m-row:focus-visible{outline:2px solid #245bff;outline-offset:-2px}
.m-head{height:30px;border-top:0;cursor:default;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8b93a3;background:#f7f9fd;border-radius:14px 14px 0 0}
.m-head:hover{background:#f7f9fd}
.m-sort{padding:0;border:0;background:none;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;text-align:left;cursor:pointer}
.m-sort.on{color:#245bff}
.m-name{display:flex;align-items:baseline;gap:8px;min-width:0}
.m-name b{font-weight:600;white-space:nowrap}
.m-name small{font-size:11px;color:#9aa1ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m-score{text-align:right;font-variant-numeric:tabular-nums}
.m-cov{font-size:12px;color:#8b93a3;text-align:right}
.m-legend{margin-top:12px;font-size:12px;color:#6b7280}
.m-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin:0 4px 0 8px;vertical-align:-1px}
.m-legend i.bull{background:var(--bull)}.m-legend i.bear{background:var(--bear)}.m-legend i.none{background:#dfe3ea}
@media (max-width:640px){
 .m-tops{grid-template-columns:1fr}
 .m-tile{width:calc((100vw - 32px - 15px)/4)}
 .m-heat section{flex-basis:100%}
 .m-search{flex:1}.m-search input{width:100%}
 .m-row{grid-template-columns:minmax(0,1fr) 44px 90px 28px}
 .m-row>.m-trend,.m-row>.m-cov,.m-head>span:nth-child(4),.m-head>span:nth-child(5),.m-head>button:nth-child(5){display:none}
 .m-name small{display:none}
}
```

- [ ] **Step 8: Napojení** – spusť z kořene repa:

```python
# Úkol 4: seznam trhů – nahradí starou tabulku v tradee.tsx komponentou MarketsView
import re
def edit(p,pairs):
    s=open(p).read()
    for old,new in pairs:
        assert s.count(old)==1,(p,old[:80]); s=s.replace(old,new)
    open(p,'w').write(s)

edit('app/globals.css',[('@import "./calendar.css";\n','@import "./calendar.css";\n@import "./markets.css";\n')])

p='app/tradee.tsx';s=open(p).read()
a=s.index("{!id?<>");b=s.index("</>:r&&item&&<>")
s=s[:a]+"{!id?<MarketsView items={rowsAll.map(toItem)} checkedAt={market.refresh.attemptedAt} palette={palette} flags={flags} flagsReady={flagsReady&&saving===null} onFlag={saveFlag} open={open}/>"+s[b+len("</>"):]
old=",[query,setQuery]=useState(''),[group,setGroup]=useState('fx'),[sort,setSort]=useState('desc'),[scoreFilter,setScoreFilter]=useState('all'),[flagFilter,setFlagFilter]=useState('all')"
assert s.count(old)==1; s=s.replace(old,'')
m=re.search(r"const rows=rowsAll\.filter\(.*?\);(?=const open=| const open=|\n)",s,re.S); assert m
s=s.replace(m.group(0),'')
s=s.replace("import {usePalette} from './palette';\n","import {usePalette} from './palette';\nimport {MarketsView} from './markets/markets-view';\nimport {toItem} from '@/lib/market-view';\n",1)
line=re.search(r"import \{([^}]*)\} from 'lucide-react';",s)
keep=[n.strip() for n in line.group(1).split(',') if n.strip() not in ('Search','Activity','ChevronRight')]
s=s.replace(line.group(0),"import {"+",".join(keep)+"} from 'lucide-react';")
old="import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table';\n"
assert s.count(old)==1; s=s.replace(old,'')
open(p,'w').write(s)
```

- [ ] **Step 9: Typová kontrola, lint nových souborů, build**

Run: `npx tsc --noEmit -p . && echo tsc ok && npx eslint app/markets app/palette.tsx app/shell.tsx lib/market-view.ts lib/palettes.ts app/api/settings && echo lint ok && npm run build 2>&1 | grep "Build complete"`
Expected: `tsc ok`, `lint ok`, `Build complete.`

- [ ] **Step 10: Kontrola v prohlížeči** (stejné nastavení hodin jako v Task 3; `/api/watchlist` podvrhni s `{flags:{'EUR/USD':'green','GBP/JPY':'orange'},user:{name:'Dan',role:'admin'}}`, POST vrací `{ok:true}`)
1. 1440×900, heatmapa: 51 dlaždic, **všech 51 viditelných** bez scrollu; top 5 bullish/bearish nahoře.
2. Měnové indexy, Akciové indexy a Krypto jsou vedle sebe v jedné řadě; indexy bez „· měnový index“.
3. Klik na tečku u EUR/USD → menu se 4 volbami, detail se **neotevře**; výběr „Čekám…“ → tečka červená.
4. Hledání „jpy“ → nevyhovující dlaždice ztlumené (43 z 51).
5. Přepnutí na Tabulku → top signály zmizí, filtry v řádku se skupinami, ≥ 18 řádků viditelných; klik na „Skóre“ obrátí řazení.
6. Reload → zůstane zvolené zobrazení; klik na dlaždici otevře detail.
7. 390 px: bez vodorovného scrollu, dlaždice ve 4 sloupcích.

- [ ] **Step 11: Commit**

```bash
git add app/markets app/markets.css app/globals.css app/tradee.tsx
git commit -m "Analýza: seznam trhů – nejsilnější signály, heatmapa, tabulka, vlaječky jako tečka

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ověření a nasazení

- [ ] **Step 1: Všechny kontroly**

```bash
node --experimental-strip-types scripts/check-market-view.mjs
node --experimental-strip-types scripts/check-calendar.mjs
node --experimental-strip-types scripts/check-dashboard.mjs
python3 -m unittest discover -s scripts/tests
npx tsc --noEmit -p . && echo tsc ok
npm run build
```
Expected: 3× `CHECK OK`, unittest `OK`, `tsc ok`, `Build complete.`; `npm run lint` nesmí mít víc nálezů než `main`.

- [ ] **Step 2: Merge a nasazení** (jen po souhlasu uživatele)

```bash
git checkout main && git merge --ff-only feature/analyza && git push origin main
ssh ubuntu@130.61.122.142 'cd ~/tradee && git pull --ff-only && python3 scripts/mariadb-migrate.py && source ~/.nvm/nvm.sh && nvm use 22 && npm run build && sudo systemctl restart tradee'
```
Expected: migrace vypíše `0002_palette.sql`, `Build complete.`, služba `active`. Na webu: výběr barev u avataru se po reloadu i na jiném zařízení drží.
