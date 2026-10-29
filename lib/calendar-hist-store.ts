// Ukládání historie kalendáře (migrace 0040). Používá refresh-ff.mjs (zápis) a /api/calendar* (čtení).
import type {Db} from './mysql.ts';
import type {HistEvent,HistChange,FeedStatus} from './calendar-hist.ts';
import {readExtra,type ExtraFilters} from './calendar-hist.ts';

const COLS='id,currency,title,impact,scheduled_at,at,first_seen,last_seen,forecast,previous,actual,actual_first,actual_at';
const n=(v:unknown)=>v===null||v===undefined?null:Number(v);
const s=(v:unknown)=>v===null||v===undefined?null:String(v);
export const toHist=(r:Record<string,unknown>):HistEvent=>({id:String(r.id),currency:String(r.currency),title:String(r.title),impact:String(r.impact),scheduledAt:Number(r.scheduled_at),at:Number(r.at),firstSeen:Number(r.first_seen),lastSeen:Number(r.last_seen),forecast:s(r.forecast),previous:s(r.previous),actual:s(r.actual),actualFirst:s(r.actual_first),actualAt:n(r.actual_at)});
const cut=(v:string|null,len=40)=>v===null?null:v.slice(0,len);

/** Události s termínem v [from, to] (ms), nejvýš limit. */
export async function histBetween(d:Db,from:number,to:number,limit=5000):Promise<HistEvent[]>{
 return (await d.prepare(`SELECT ${COLS} FROM calendar_events_hist WHERE at>=? AND at<=? ORDER BY at LIMIT ${Math.max(1,Math.min(20000,limit))}`).bind(from,to).all<Record<string,unknown>>()).results.map(toHist);
}
/** Všechna vydání jedné řady (měna + titul FF), nejnovější nakonec. */
export async function histSeries(d:Db,currency:string,title:string,limit=120):Promise<HistEvent[]>{
 const rows=(await d.prepare(`SELECT ${COLS} FROM calendar_events_hist WHERE currency=? AND title=? ORDER BY at DESC LIMIT ${Math.max(1,Math.min(500,limit))}`).bind(currency,title).all<Record<string,unknown>>()).results.map(toHist);
 return rows.reverse();
}
export async function revisionsFor(d:Db,ids:string[]):Promise<HistChange[]>{
 const out:HistChange[]=[];
 for(let i=0;i<ids.length;i+=500){const ch=ids.slice(i,i+500);if(!ch.length)break;
  const rows=(await d.prepare(`SELECT event_id,kind,old_value,new_value,seen_at FROM calendar_revisions WHERE event_id IN (${ch.map(()=>'?').join(',')}) ORDER BY seen_at,id`).bind(...ch).all<Record<string,unknown>>()).results;
  for(const r of rows)out.push({eventId:String(r.event_id),kind:String(r.kind) as HistChange['kind'],old:s(r.old_value),new:s(r.new_value),seenAt:Number(r.seen_at)})}
 return out;
}
export async function saveHist(d:Db,events:HistEvent[],changes:HistChange[]){
 for(let i=0;i<events.length;i+=100){const ch=events.slice(i,i+100);
  await d.prepare(`INSERT INTO calendar_events_hist(${COLS}) VALUES ${ch.map(()=>'(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')} ON DUPLICATE KEY UPDATE impact=VALUES(impact),at=VALUES(at),last_seen=VALUES(last_seen),forecast=VALUES(forecast),previous=VALUES(previous),actual=VALUES(actual),actual_first=VALUES(actual_first),actual_at=VALUES(actual_at)`)
   .bind(...ch.flatMap(e=>[e.id,e.currency.slice(0,8),e.title.slice(0,160),e.impact.slice(0,12),e.scheduledAt,e.at,e.firstSeen,e.lastSeen,cut(e.forecast),cut(e.previous),cut(e.actual),cut(e.actualFirst),e.actualAt])).run()}
 for(let i=0;i<changes.length;i+=200){const ch=changes.slice(i,i+200);
  await d.prepare(`INSERT INTO calendar_revisions(event_id,kind,old_value,new_value,seen_at) VALUES ${ch.map(()=>'(?,?,?,?,?)').join(',')}`).bind(...ch.flatMap(c=>[c.eventId,c.kind,cut(c.old),cut(c.new),c.seenAt])).run()}
}
export async function feedStatus(d:Db,source='ff'):Promise<FeedStatus|null>{
 const r=await d.prepare('SELECT attempted_at,ok_at,error FROM calendar_feed_status WHERE source=?').bind(source).first<Record<string,unknown>>();
 return r?{attemptedAt:n(r.attempted_at),okAt:n(r.ok_at),error:s(r.error)}:null;
}
export async function setFeedStatus(d:Db,at:number,ok:boolean,error:string|null,source='ff'){
 await d.prepare('INSERT INTO calendar_feed_status(source,attempted_at,ok_at,error) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE attempted_at=VALUES(attempted_at),ok_at=IF(VALUES(ok_at) IS NULL,ok_at,VALUES(ok_at)),error=VALUES(error)')
  .bind(source,at,ok?at:null,error?error.slice(0,300):null).run();
}
export async function getPrefs(d:Db,userId:string):Promise<ExtraFilters|null>{
 const r=await d.prepare('SELECT prefs FROM calendar_prefs WHERE user_id=?').bind(userId).first<{prefs:string}>();
 return r?readExtra(r.prefs):null;
}
export async function setPrefs(d:Db,userId:string,raw:unknown){
 const v=readExtra(raw);
 await d.prepare('INSERT INTO calendar_prefs(user_id,prefs,updated) VALUES(?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE prefs=VALUES(prefs),updated=VALUES(updated)').bind(userId,JSON.stringify(v)).run();
 return v;
}
