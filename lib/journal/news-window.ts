// No-trade okna kolem zpráv: vlastnost verze strategie (blok „Kdy neobchodovat“: minuty před / po a min. dopad) a účtu (limity seance).
// Scénář nebo obchod, který do okna zasahuje, se označí; kalendář ukáže okna pro sledované trhy. Čisté funkce – testy scripts/check-journal-ideas.mjs.
import {mergeCalendar,eventMarkets,OIL_KINDS,type AutoEvent,type CuratedEvent} from '../calendar.ts';
export type ImpactEvent={at:number;title:string;currencies:string[];signal:number};
export type NewsWindow={before:number;after:number;minImpact:2|3;source:string};
/** Zprávy se známým časem a dopadem ≥ 2 (ropa EIA / OPEC i s nižším signálem jako OIL). */
export function impactNews(auto:AutoEvent[],curated:CuratedEvent[],sources?:Record<string,{url?:string}>):ImpactEvent[]{
 const out:ImpactEvent[]=[];
 for(const e of mergeCalendar(auto,curated,sources)){
  if(!e.timeKnown)continue;
  const oil=OIL_KINDS.includes(e.kind??''),signal=oil?Math.max(3,e.signal):e.signal;
  if(signal<2)continue;
  const at=Date.parse(e.at),cur=(oil?[...new Set([...eventMarkets(e),'OIL'])]:eventMarkets(e)).filter(m=>/^[A-Z]{3}$/.test(m));
  if(Number.isFinite(at)&&cur.length)out.push({at,title:e.title,currencies:cur,signal});
 }
 return out.sort((a,b)=>a.at-b.at);
}
/** Okno z pravidel strategie / účtu; bez minut před i po = žádné okno. */
export function makeWindow(before:number|null|undefined,after:number|null|undefined,minImpact:unknown,source:string):NewsWindow|null{
 const b=before??null,a=after??null;if(b===null&&a===null)return null;
 return {before:Math.max(0,b??0),after:Math.max(0,a??0),minImpact:Number(minImpact)===2?2:3,source};
}
export type Collision={title:string;at:number;start:number;end:number;source:string;signal:number};
/** Zprávy, jejichž okno [čas − před, čas + po] zasahuje do intervalu [from, to] (pro obchod from = to = vstup) a týkají se měn trhu. */
export function collisions(span:{from:number;to:number},currencies:string[],events:ImpactEvent[],windows:NewsWindow[]):Collision[]{
 const out:Collision[]=[];if(!currencies.length)return out;
 for(const w of windows)for(const e of events){
  if(e.signal<w.minImpact||!e.currencies.some(c=>currencies.includes(c)))continue;
  const start=e.at-w.before*60000,end=e.at+w.after*60000;
  if(start<=span.to&&end>=span.from)out.push({title:e.title,at:e.at,start,end,source:w.source,signal:e.signal});
 }
 return out.sort((a,b)=>a.start-b.start);
}
/** Kalendář: nadcházející okna pro sledované měny (sledované trhy převedené na měny volajícím), seřazená podle začátku; stejná zpráva z více zdrojů = jedno okno nejširší. */
export function upcomingWindows(events:ImpactEvent[],currencies:Set<string>,windows:NewsWindow[],now:number,horizonMs=7*864e5):(Collision&{currencies:string[];sources:string[]})[]{
 const m=new Map<string,Collision&{currencies:string[];sources:string[]}>();
 for(const w of windows)for(const e of events){
  if(e.signal<w.minImpact)continue;
  const cur=e.currencies.filter(c=>currencies.has(c));if(!cur.length)continue;
  const start=e.at-w.before*60000,end=e.at+w.after*60000;if(end<now||start>now+horizonMs)continue;
  const k=e.at+'|'+e.title,cur0=m.get(k);
  if(!cur0)m.set(k,{title:e.title,at:e.at,start,end,source:w.source,signal:e.signal,currencies:cur,sources:[w.source]});
  else{cur0.start=Math.min(cur0.start,start);cur0.end=Math.max(cur0.end,end);if(!cur0.sources.includes(w.source))cur0.sources.push(w.source)}
 }
 return [...m.values()].sort((a,b)=>a.start-b.start);
}
