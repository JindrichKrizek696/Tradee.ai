// Zprávy se signálem 3 (nejvyšší dopad) z kalendáře pro pravidlo „Neobchodovat kolem zpráv“. Zdroj JSON dodává volající (route / skript).
import {mergeCalendar,eventMarkets,OIL_KINDS,type AutoEvent,type CuratedEvent} from '../calendar.ts';
export type NewsEvent={at:number;currencies:string[]};
export function highNews(auto:AutoEvent[],curated:CuratedEvent[],sources?:Record<string,{url?:string}>):NewsEvent[]{
 const out:NewsEvent[]=[];
 for(const e of mergeCalendar(auto,curated,sources)){
  const oil=OIL_KINDS.includes(e.kind??''); // ropa: zásoby EIA a OPEC platí i se signálem 2 (trh OIL)
  if((e.signal!==3&&!oil)||!e.timeKnown)continue;
  const at=Date.parse(e.at),cur=(oil?[...new Set([...eventMarkets(e),'OIL'])]:eventMarkets(e)).filter(m=>/^[A-Z]{3}$/.test(m)&&(e.signal===3||m==='OIL'));
  if(Number.isFinite(at)&&cur.length)out.push({at,currencies:cur});
 }
 return out;
}
