// Zprávy s vysokým dopadem (signál 3, ropa i EIA/OPEC) s názvem – pro „nejbližší událost“ u scénáře. Kalendář dodá volající.
import {mergeCalendar,eventMarkets,OIL_KINDS,type AutoEvent,type CuratedEvent} from '../calendar.ts';
import type {NewsLite} from './scenario.ts';
export function newsForScenarios(auto:AutoEvent[],curated:CuratedEvent[],sources?:Record<string,{url?:string}>):NewsLite[]{
 const out:NewsLite[]=[];
 for(const e of mergeCalendar(auto,curated,sources)){
  const oil=OIL_KINDS.includes(e.kind??'');
  if((e.signal!==3&&!oil)||!e.timeKnown)continue;
  const at=Date.parse(e.at),cur=(oil?[...new Set([...eventMarkets(e),'OIL'])]:eventMarkets(e)).filter(m=>/^[A-Z]{3}$/.test(m));
  if(Number.isFinite(at)&&cur.length)out.push({at,title:e.title,currencies:cur});
 }
 return out;
}
