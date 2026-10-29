// Replay: datové panely omezené simulačními hodinami – skóre (nejbližší snímek ≤ hodiny), COT podle data zveřejnění,
// kalendář a makro z historie kalendáře (termín, odhad a skutečnost tak, jak byly známé v čase hodin; revize až po jejich zachycení).
// Čisté funkce – testy scripts/check-replay.mjs.
import {cotPublishedAt} from '../cot-dates.ts';
import type {HistEvent,HistChange} from '../calendar-hist.ts';
/** Nejbližší položka s časem ≤ t (seřazeno vzestupně podle at). */
export function atOrBefore<T>(list:T[],t:number,at:(x:T)=>number):T|null{
 let best:T|null=null,bt=-Infinity;for(const x of list){const v=at(x);if(v<=t&&v>=bt){best=x;bt=v}}return best;
}
// ---- COT: report k úterý, CFTC zveřejní v pátek 15:30 ET (≤ 20:30 UTC) → dostupné od pátku 21:00 UTC
export const COT_AVAILABLE_UTC_H=21;
export const cotAvailableAt=(reportDate:string)=>cotPublishedAt(reportDate)+COT_AVAILABLE_UTC_H*3600000;
type CotGroup={long:number;short:number;net:number};
type CotRow={date:string;openInterest:number;groups:Record<string,CotGroup>};
export type CotView={currency:string;date:string;availableAt:number;net:number;change:number|null;netPct:number|null;weeks:number};
/** Poslední report zveřejněný do hodin (skupina leveraged funds) + změna proti předchozímu zveřejněnému. */
export function cotAt(currency:string,history:CotRow[],clock:number,group='leveraged'):CotView|null{
 const known=history.filter(r=>r.groups[group]&&cotAvailableAt(r.date)<=clock).sort((a,b)=>a.date.localeCompare(b.date));
 const cur=known[known.length-1];if(!cur)return null;const prev=known[known.length-2],g=cur.groups[group];
 return {currency,date:cur.date,availableAt:cotAvailableAt(cur.date),net:g.net,change:prev?g.net-prev.groups[group].net:null,netPct:cur.openInterest>0?Math.round(g.net/cur.openInterest*1000)/10:null,weeks:known.length};
}
// ---- kalendář v čase hodin
export type CalView={id:string;currency:string;title:string;impact:string;at:number;
 /** termín byl v čase hodin jiný, než nakonec platil */timeMovedLater:boolean;
 forecast:string|null;previous:string|null;actual:string|null;
 /** událost jsme poprvé zachytili až po hodinách – odhad z té doby neznáme */lateCapture:boolean;released:boolean};
/** Stav události v čase clock: posuny termínu, odhad a předchozí hodnota ze záznamu změn, skutečnost jen po vydání (první hodnota, revize až po zachycení). */
export function eventAt(e:HistEvent,changes:HistChange[],clock:number):CalView{
 const mine=changes.filter(c=>c.eventId===e.id).sort((a,b)=>a.seenAt-b.seenAt);
 const later=(kind:HistChange['kind'])=>mine.find(c=>c.kind===kind&&c.seenAt>clock);
 const tm=later('time'),atClock=tm?.old?Date.parse(tm.old):e.at;
 const lateCapture=e.firstSeen>clock;
 const fc=later('forecast'),pv=later('previous');
 const forecast=lateCapture?null:fc?fc.old:e.forecast,previous=lateCapture?null:pv?pv.old:e.previous;
 const released=e.at<=clock;let actual:string|null=null;
 if(released){actual=e.actualFirst??e.actual;for(const c of mine)if(c.kind==='revision'&&c.seenAt<=clock)actual=c.new}
 return {id:e.id,currency:e.currency,title:e.title,impact:e.impact,at:Number.isFinite(atClock)?atClock:e.at,timeMovedLater:!!tm,forecast,previous,actual,lateCapture,released};
}
/** Panel kalendáře: vydané události za posledních `pastH` hodin a nadcházející do `nextH` hodin (pro měny seance). */
export function calendarAt(events:HistEvent[],changes:HistChange[],clock:number,currencies:string[],pastH=48,nextH=72):{past:CalView[];next:CalView[]}{
 const cs=new Set(currencies),list=events.filter(e=>cs.has(e.currency)).map(e=>eventAt(e,changes,clock));
 const past=list.filter(v=>v.released&&v.at>=clock-pastH*3600000).sort((a,b)=>b.at-a.at);
 const next=list.filter(v=>!v.released&&v.at<=clock+nextH*3600000).sort((a,b)=>a.at-b.at);
 return {past,next};
}
/** Makro: poslední vydaná hodnota každé řady (měna + titul) do hodin, silné a střední zprávy, nejnovější nahoře. */
export function macroAt(events:HistEvent[],changes:HistChange[],clock:number,currencies:string[],limit=16):CalView[]{
 const cs=new Set(currencies),by=new Map<string,CalView>();
 for(const e of events){if(!cs.has(e.currency)||e.at>clock||!/high|medium/i.test(e.impact))continue;const v=eventAt(e,changes,clock);if(v.actual===null)continue;
  const k=e.currency+'|'+e.title,o=by.get(k);if(!o||o.at<v.at)by.set(k,v)}
 return [...by.values()].sort((a,b)=>b.at-a.at).slice(0,limit);
}
/** Měny seance z trhů („EUR/USD“ → EUR, USD; ostatní → USD). */
export function currenciesOf(symbols:string[]):string[]{
 const s=new Set<string>();for(const m of symbols){const x=/^([A-Z]{3})\/([A-Z]{3})$/.exec(m);if(x){s.add(x[1]);s.add(x[2])}else s.add('USD')}
 return [...s];
}
