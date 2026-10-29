// Historie kalendáře ForexFactory: každé stažení exportu se porovná s uloženými událostmi (tabulka calendar_events_hist)
// a změny se zapíšou do calendar_revisions. Čistá logika bez DB; kontrola: node --experimental-strip-types scripts/check-calendar-hist.mjs
//
// • Identita události: měna + titul + první plánovaný čas. Stejný titul do ±72 h od uloženého termínu = tatáž událost
//   (posun času → změna 'time', „plánovaný vs skutečný čas“).
// • Změna odhadu FF → změna 'forecast' (historie konsenzu), změna předchozí hodnoty → 'previous', dopadu → 'impact'.
// • Export nemá skutečné hodnoty. Skutečnost vydání X = `previous` dalšího vydání stejné řady (stejná měna a titul)
//   → 'actual' (odvozeno z dalšího vydání). Když se ta hodnota později změní, jde o revizi → 'revision';
//   první zveřejněná hodnota zůstává v actual_first.
import type {FFRow} from './calendar-ff.ts';
import type {CalendarEvent} from './calendar.ts';
import {flaggedMarkets} from './calendar.ts';

export type HistEvent={id:string;currency:string;title:string;impact:string;scheduledAt:number;at:number;firstSeen:number;lastSeen:number;forecast:string|null;previous:string|null;actual:string|null;actualFirst:string|null;actualAt:number|null};
export type ChangeKind='time'|'forecast'|'previous'|'impact'|'actual'|'revision';
export type HistChange={eventId:string;kind:ChangeKind;old:string|null;new:string|null;seenAt:number};

const DAY=86400000;
export const SAME_EVENT_MS=72*3600000;
// Nejdelší rozestup dvou vydání téže řady, kdy ještě platí „previous dalšího vydání = skutečnost předchozího“ (čtvrtletní řady + rezerva).
export const MAX_SERIES_GAP_MS=200*DAY;

// Krátké stabilní ID (FNV-1a 32 bit ×2) – titul může být dlouhý, klíč se musí vejít do VARCHAR(40).
function fnv(s:string,seed:number){let h=seed>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0}return h.toString(16).padStart(8,'0')}
export const seriesKey=(currency:string,title:string)=>currency+'|'+title;
export const histId=(currency:string,title:string,scheduledAt:number)=>{const k=seriesKey(currency,title)+'|'+new Date(scheduledAt).toISOString();return 'ff_'+fnv(k,2166136261)+fnv(k,40503)};

const skip=(r:FFRow)=>r.impact==='Holiday';

/** Porovná nové řádky exportu s uloženými událostmi. Vrací nové a změněné události a záznamy změn. */
export function planUpsert(existing:HistEvent[],fresh:FFRow[],now:number):{events:HistEvent[];changes:HistChange[]}{
 const bySeries=new Map<string,HistEvent[]>();
 for(const e of existing)(bySeries.get(seriesKey(e.currency,e.title))??bySeries.set(seriesKey(e.currency,e.title),[]).get(seriesKey(e.currency,e.title))!).push({...e});
 const rows=fresh.filter(r=>!skip(r)&&Number.isFinite(Date.parse(r.at)));
 // nejdřív přesné shody času, pak nejbližší termín v okně ±72 h (posun času) – jedna uložená událost = jeden řádek
 const claimed=new Set<string>(),pick=new Map<FFRow,HistEvent>();
 for(const r of rows){const t=Date.parse(r.at),e=(bySeries.get(seriesKey(r.currency,r.title))||[]).find(x=>x.at===t&&!claimed.has(x.id));if(e){claimed.add(e.id);pick.set(r,e)}}
 for(const r of rows){if(pick.has(r))continue;const t=Date.parse(r.at);let best:HistEvent|null=null;
  for(const x of bySeries.get(seriesKey(r.currency,r.title))||[])if(!claimed.has(x.id)&&Math.abs(x.at-t)<=SAME_EVENT_MS&&(!best||Math.abs(x.at-t)<Math.abs(best.at-t)))best=x;
  // v jednom exportu může být stejný titul dvakrát blízko sebe (např. dvě vystoupení) – pak se nepárují křížem
  if(best&&!rows.some(o=>o!==r&&o.currency===r.currency&&o.title===r.title&&Date.parse(o.at)===best!.at)){claimed.add(best.id);pick.set(r,best)}}
 const events:HistEvent[]=[],changes:HistChange[]=[];
 for(const r of rows){
  const t=Date.parse(r.at),e=pick.get(r);
  if(!e){const n:HistEvent={id:histId(r.currency,r.title,t),currency:r.currency,title:r.title,impact:r.impact,scheduledAt:t,at:t,firstSeen:now,lastSeen:now,forecast:r.forecast,previous:r.previous,actual:null,actualFirst:null,actualAt:null};
   events.push(n);(bySeries.get(seriesKey(n.currency,n.title))??bySeries.set(seriesKey(n.currency,n.title),[]).get(seriesKey(n.currency,n.title))!).push(n);claimed.add(n.id);continue}
  const ch=(kind:ChangeKind,o:string|null,v:string|null)=>changes.push({eventId:e.id,kind,old:o,new:v,seenAt:now});
  let dirty=false;
  if(e.at!==t){ch('time',new Date(e.at).toISOString(),new Date(t).toISOString());e.at=t;dirty=true}
  // prázdná nová hodnota nepřepíše dřívější vyplněnou (stejně jako mergeFF)
  if(r.forecast!==null&&r.forecast!==e.forecast){ch('forecast',e.forecast,r.forecast);e.forecast=r.forecast;dirty=true}
  if(r.previous!==null&&r.previous!==e.previous){ch('previous',e.previous,r.previous);e.previous=r.previous;dirty=true}
  if(r.impact&&r.impact!==e.impact){ch('impact',e.impact,r.impact);e.impact=r.impact;dirty=true}
  e.lastSeen=now;events.push(e);void dirty;
 }
 return {events,changes};
}

/** Skutečnost vydání = `previous` dalšího vydání téže řady; změna později = revize. Vrací změněné události a záznamy. */
export function deriveActuals(all:HistEvent[],now:number):{events:HistEvent[];changes:HistChange[]}{
 const groups=new Map<string,HistEvent[]>();
 for(const e of all)(groups.get(seriesKey(e.currency,e.title))??groups.set(seriesKey(e.currency,e.title),[]).get(seriesKey(e.currency,e.title))!).push(e);
 const events:HistEvent[]=[],changes:HistChange[]=[];
 for(const list of groups.values()){
  list.sort((a,b)=>a.at-b.at);
  for(let i=0;i<list.length-1;i++){
   const e=list[i],next=list[i+1];
   if(e.at>now||next.previous===null||next.at-e.at>MAX_SERIES_GAP_MS)continue;
   const v=next.previous;
   if(e.actual===null){const n={...e,actual:v,actualFirst:e.actualFirst??v,actualAt:now};events.push(n);changes.push({eventId:e.id,kind:'actual',old:null,new:v,seenAt:now})}
   else if(e.actual!==v){const n={...e,actual:v,actualFirst:e.actualFirst??e.actual};events.push(n);changes.push({eventId:e.id,kind:'revision',old:e.actual,new:v,seenAt:now})}
  }
 }
 return {events,changes};
}

/** Jeden krok obnovy: upsert + odvození skutečností nad sloučeným stavem. */
export function refreshPlan(existing:HistEvent[],fresh:FFRow[],now:number){
 const up=planUpsert(existing,fresh,now);
 const merged=new Map(existing.map(e=>[e.id,e]));for(const e of up.events)merged.set(e.id,e);
 const act=deriveActuals([...merged.values()],now);
 const out=new Map(up.events.map(e=>[e.id,e]));for(const e of act.events)out.set(e.id,{...(out.get(e.id)??e),actual:e.actual,actualFirst:e.actualFirst,actualAt:e.actualAt});
 return {events:[...out.values()],changes:[...up.changes,...act.changes]};
}

// ---- zobrazení
const NUM=/^\s*([+\-−]?\d+(?:[.,]\d+)?)\s*(%|K|M|B|T)?\s*$/i;
/** Číslo z textu FF („0.3%“, „-12K“, „1.2M“); jednotka se vrací zvlášť, K/M/B se nepřepočítávají (řada má jednu jednotku). */
export function parseValue(s:string|null|undefined):{value:number;unit:string}|null{
 if(!s)return null;const m=NUM.exec(s);return m?{value:Number(m[1].replace('−','-').replace(',','.')),unit:(m[2]||'').toUpperCase()}:null;
}
export type SeriesPoint={id:string;at:number;scheduledAt:number;forecast:number|null;actual:number|null;actualFirst:number|null;unit:string;revised:boolean;timeMoved:boolean};
/** Body řady pro graf: vydání v čase, odhad, skutečnost (odvozená) a první zveřejněná hodnota. */
export function seriesPoints(events:HistEvent[]):SeriesPoint[]{
 return [...events].sort((a,b)=>a.at-b.at).map(e=>{const a=parseValue(e.actual),f=parseValue(e.forecast),af=parseValue(e.actualFirst);
  return {id:e.id,at:e.at,scheduledAt:e.scheduledAt,forecast:f?.value??null,actual:a?.value??null,actualFirst:af?.value??null,unit:a?.unit||f?.unit||af?.unit||'',revised:e.actualFirst!==null&&e.actual!==null&&e.actualFirst!==e.actual,timeMoved:e.scheduledAt!==e.at}});
}

// ---- stav zdroje
export type FeedStatus={attemptedAt:number|null;okAt:number|null;error:string|null};
export type FeedState='ok'|'stale'|'unavailable';
/** ok = poslední pokus prošel a data jsou mladší než staleH; unavailable = poslední pokus selhal; stale = data jsou stará. */
export function feedState(s:FeedStatus|null,generatedAt:number|null,now:number,staleH=6):FeedState{
 if(s&&s.attemptedAt!==null&&s.error&&(s.okAt===null||s.attemptedAt>s.okAt))return 'unavailable';
 const last=Math.max(s?.okAt??0,generatedAt??0);
 return last&&now-last<=staleH*3600000?'ok':'stale';
}

// ---- filtry kalendáře nad rámec základních (lib/calendar.ts Filters)
export type Impact='High'|'Medium'|'Low';
export const IMPACTS:Impact[]=['High','Medium','Low'];
export const impactLabels:Record<Impact,string>={High:'Vysoký',Medium:'Střední',Low:'Nízký'};
export type ExtraFilters={impacts:Impact[];mine:'all'|'watch'|'positions'|'either';ffAll:boolean};
export const defaultExtra:ExtraFilters={impacts:[...IMPACTS],mine:'all',ffAll:false};
export function readExtra(raw:unknown):ExtraFilters{
 try{const v=typeof raw==='string'?JSON.parse(raw):raw;if(!v||typeof v!=='object')return {...defaultExtra,impacts:[...IMPACTS]};const o=v as Record<string,unknown>;
  return {impacts:Array.isArray(o.impacts)?IMPACTS.filter(i=>(o.impacts as unknown[]).includes(i)):[...IMPACTS],mine:o.mine==='watch'||o.mine==='positions'||o.mine==='either'?o.mine:'all',ffAll:o.ffAll===true}}
 catch{return {...defaultExtra,impacts:[...IMPACTS]}}
}
/** Dopad události: z ForexFactory, jinak ze síly (3 = vysoký, 2 = střední, 1 = nízký). */
export const impactOf=(e:Pick<CalendarEvent,'signal'|'ff'>):Impact=>{const i=e.ff?.impact;return i==='High'||i==='Medium'||i==='Low'?i:e.signal===3?'High':e.signal===2?'Medium':'Low'};
/** Trhy otevřených pozic (id instrumentů) → trhy kalendáře (stejný převod jako vlaječky). */
export const positionMarkets=(instruments:(string|null)[])=>flaggedMarkets(Object.fromEntries(instruments.filter((x):x is string=>!!x).map(i=>[i,'pos'])));
export function filterExtra<E extends Pick<CalendarEvent,'signal'|'markets'|'global'|'ff'>>(events:E[],f:ExtraFilters,watch:Set<string>,positions:Set<string>):E[]{
 return events.filter(e=>{
  if(!f.impacts.includes(impactOf(e)))return false;
  if(f.mine==='all')return true;
  const hit=(s:Set<string>)=>e.markets.some(m=>s.has(m));
  return f.mine==='watch'?hit(watch):f.mine==='positions'?hit(positions):hit(watch)||hit(positions);
 });
}

/** Řádky FF, které nemají vlastní událost v kalendáři → události kalendáře (jen když si je uživatel zapne). */
export function ffOnlyEvents(rows:FFRow[],matchedKeys:Set<string>):CalendarEvent[]{
 return rows.filter(r=>!skip(r)&&!matchedKeys.has(r.currency+'|'+r.title+'|'+r.at)).map(r=>({id:'ff:'+r.currency+'|'+r.title+'|'+r.at,at:r.at,timeKnown:true,title:r.currency+' • '+r.title,category:'macro' as const,markets:[r.currency],signal:(r.impact==='High'?3:r.impact==='Medium'?2:1) as 1|2|3,global:false,verified:false,source:'https://www.forexfactory.com/calendar',forecast:r.forecast,previous:r.previous,ff:{title:r.title,currency:r.currency,at:r.at,impact:r.impact}}));
}
