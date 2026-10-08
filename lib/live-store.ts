// Živé ceny z DB pro API (body jen „dnešní": od začátku seance Yahoo, bez něj podle pražského dne).
import type {Db} from './mysql.ts';
import {sessionPoints,type LiveQuote,type LivePoint} from './live.ts';
const utc=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):0;
const num=(v:unknown)=>v===null||v===undefined?null:Number(v);
// body od začátku seance (zarovnaného na slot 15 min); bez začátku seance pražský den
const todayPoints=(ps:LivePoint[],start:number|null)=>start&&start>0?ps.filter(p=>p[0]>=start-start%900000):sessionPoints(ps);
export async function liveQuotes(d:Db):Promise<{updated:number|null;quotes:Record<string,LiveQuote>}>{
 const rows=(await d.prepare('SELECT instrument,price,prev_close,change_pct,day_high,day_low,market_time,session_start,updated FROM market_live').all<Record<string,unknown>>()).results;
 const pts=(await d.prepare('SELECT i.instrument,i.ts,i.price FROM market_intraday i JOIN (SELECT instrument,MAX(ts) m FROM market_intraday GROUP BY instrument) x ON x.instrument=i.instrument AND i.ts>=x.m-26*3600000 ORDER BY i.ts').all<{instrument:string;ts:number;price:number}>()).results;
 const by=new Map<string,LivePoint[]>();for(const p of pts){const l=by.get(p.instrument)||[];l.push([Number(p.ts),Number(p.price)]);by.set(p.instrument,l)}
 let updated:number|null=null;const quotes:Record<string,LiveQuote>={};
 for(const r of rows){const u=utc(r.updated),id=String(r.instrument);if(updated===null||u>updated)updated=u;
  quotes[id]={price:Number(r.price),prevClose:Number(r.prev_close),changePct:Number(r.change_pct),high:num(r.day_high),low:num(r.day_low),marketTime:Number(r.market_time),updated:u,points:todayPoints(by.get(id)||[],num(r.session_start))}}
 return {updated,quotes};
}
