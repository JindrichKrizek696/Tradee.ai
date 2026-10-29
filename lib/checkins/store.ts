// DB vrstva check-inů: VŠECHNY dotazy filtrují user_id přihlášeného – žádný pohled správce (?as=) ani sdílení.
// Tabulka drizzle/mariadb/0043_onboarding.sql. Testy soukromí: scripts/check-checkins.mjs (podvržená DB).
import type {Db} from '../mysql.ts';
import {processScore} from '../journal/process.ts';
import {rowToCheckin,checkinStats,pragueDay,LIMITS,type Checkin,type CheckinInput} from './core.ts';
export const MISSING='Check-iny ještě nejsou na serveru zapnuté (chybí migrace databáze). Dej prosím vědět správci.';
export const isMissing=(e:unknown)=>/doesn't exist|ER_NO_SUCH_TABLE|Unknown column/i.test(String((e as Error)?.message??''));
const uid=()=>'chk_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
const sqlNow=()=>new Date().toISOString().slice(0,19).replace('T',' ');
const COLS='id,kind,day,ts,energy,focus,mood,fomo,plan,verdict,trade_id,scenario_id,note';
export async function listCheckins(d:Db,userId:string,o:{from?:string|null;to?:string|null;tradeId?:string|null;scenarioId?:string|null;limit?:number}={}):Promise<Checkin[]>{
 const where=['user_id=?'],args:unknown[]=[userId];
 if(o.from){where.push('day>=?');args.push(o.from)}if(o.to){where.push('day<=?');args.push(o.to)}if(o.tradeId){where.push('trade_id=?');args.push(o.tradeId)}if(o.scenarioId){where.push('scenario_id=?');args.push(o.scenarioId)}
 const r=await d.prepare(`SELECT ${COLS} FROM checkins WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ${Math.min(5000,Math.max(1,Math.floor(o.limit??1000)))}`).bind(...args).all<Record<string,unknown>>();
 return r.results.map(rowToCheckin);
}
export async function createCheckin(d:Db,userId:string,c:CheckinInput):Promise<Checkin>{
 const n=await d.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id=? AND day=?').bind(userId,c.day).first<{n:number}>();
 if(Number(n?.n||0)>=LIMITS.perDay)throw Error(`Nejvýš ${LIMITS.perDay} check-inů za den.`);
 // po obchodu: jedno zařazení na obchod (nové přepíše staré)
 if(c.kind==='after'&&c.tradeId)await d.prepare("DELETE FROM checkins WHERE user_id=? AND kind='after' AND trade_id=?").bind(userId,c.tradeId).run();
 const id=uid(),b=(v:boolean|null)=>v===null?null:v?1:0;
 await d.prepare(`INSERT INTO checkins(${COLS},user_id,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,c.kind,c.day,c.ts,c.energy,c.focus,c.mood,b(c.fomo),b(c.plan),c.verdict,c.tradeId,c.scenarioId,c.note,userId,sqlNow()).run();
 return {id,...c};
}
export async function deleteCheckin(d:Db,userId:string,id:string){return (await d.prepare('DELETE FROM checkins WHERE id=? AND user_id=?').bind(id,userId).run()).meta.changes>0}
/** Statistika do Deníku: check-iny + skóre procesu a den obchodu (jen vlastní obchody). */
export async function statsFor(d:Db,userId:string){
 const list=await listCheckins(d,userId,{limit:5000});
 const soft=async<T,>(f:()=>Promise<T>,def:T)=>{try{return await f()}catch{return def}};
 const proc=await soft(async()=>(await d.prepare('SELECT trade_id,answers FROM trade_process WHERE user_id=?').bind(userId).all<{trade_id:string;answers:string}>()).results,[] as {trade_id:string;answers:string}[]);
 const man=await soft(async()=>(await d.prepare('SELECT id,date FROM trades WHERE user_id=?').bind(userId).all<{id:string;date:string}>()).results,[] as {id:string;date:string}[]);
 const mt=await soft(async()=>(await d.prepare('SELECT p.id,p.open_ts FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE a.user_id=? ORDER BY p.open_ts DESC LIMIT 20000').bind(userId).all<{id:string;open_ts:number}>()).results,[] as {id:string;open_ts:number}[]);
 const days=new Map<string,string>([...man.map(t=>['man:'+t.id,String(t.date).slice(0,10)] as const),...mt.map(p=>['mt:'+p.id,pragueDay(Number(p.open_ts))] as const)]);
 const trades=proc.map(p=>{let a:Record<string,unknown>={};try{a=JSON.parse(p.answers)||{}}catch{}return {id:p.trade_id,day:days.get(p.trade_id)??null,process:processScore(a)}});
 return checkinStats(list,trades);
}
