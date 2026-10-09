// Zprávy se signálem 3 (nejvyšší dopad) z kalendáře pro pravidlo „Neobchodovat kolem zpráv“. Zdroj JSON dodává volající (route / skript).
import {mergeCalendar,eventMarkets,type AutoEvent,type CuratedEvent} from '../calendar.ts';
export type NewsEvent={at:number;currencies:string[]};
export function highNews(auto:AutoEvent[],curated:CuratedEvent[],sources?:Record<string,{url?:string}>):NewsEvent[]{
 const out:NewsEvent[]=[];
 for(const e of mergeCalendar(auto,curated,sources)){
  if(e.signal!==3||!e.timeKnown)continue;
  const at=Date.parse(e.at),cur=eventMarkets(e).filter(m=>/^[A-Z]{3}$/.test(m));
  if(Number.isFinite(at)&&cur.length)out.push({at,currencies:cur});
 }
 return out;
}
