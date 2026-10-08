// Živé ceny z DB pro API (body jen „dnešní" podle pražského dne).
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
