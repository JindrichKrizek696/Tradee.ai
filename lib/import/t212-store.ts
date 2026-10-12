// DB část importu z Trading 212: účet 't212' v mt_accounts (jeden na měnu účtu), obchody v mt_positions → deník, kalendář, analytika i disciplína jako u MT.
import type {Db} from '../mysql.ts';
import {nowSql} from '../mt/store.ts';
import {mapSymbol} from '../checklists/core.ts';
import {symbolMap} from '../checklists/store.ts';
import {evaluateAccount} from '../discipline/store.ts';
import type {NewsEvent} from '../discipline/news.ts';
import {planImport,t212Position,type T212Parsed,type T212Trade} from './t212.ts';
export const T212_SERVER='Trading 212';
const login=(currency:string)=>'CFD '+currency;
const CHUNK=50;
async function findAccount(d:Db,userId:string,currency:string){
 return (await d.prepare('SELECT id FROM mt_accounts WHERE user_id=? AND server=? AND login=?').bind(userId,T212_SERVER,login(currency)).first<{id:string}>())?.id??null;
}
async function ensureAccount(d:Db,userId:string,currency:string){
 const found=await findAccount(d,userId,currency);if(found)return found;
 const id='mta_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
 await d.prepare("INSERT IGNORE INTO mt_accounts(id,user_id,platform,login,server,company,currency,leverage,mode,name,ea_version,last_seen,balance,equity,created) VALUES(?,?,'t212',?,?,?,?,0,'import',?,'',NULL,NULL,NULL,?)").bind(id,userId,login(currency),T212_SERVER,'Trading 212',currency,'Trading 212 CFD'+(currency?' '+currency:''),nowSql()).run();
 return (await findAccount(d,userId,currency))??id;
}
async function existing(d:Db,accountId:string|null,trades:T212Trade[]){
 if(!accountId)return [];
 const pids=[...new Set(trades.map(t=>t.positionId))],out:{ticket:string;close_ts:number}[]=[];
 for(let i=0;i<pids.length;i+=CHUNK){const c=pids.slice(i,i+CHUNK);out.push(...(await d.prepare(`SELECT ticket,close_ts FROM mt_positions WHERE account_id=? AND SUBSTRING_INDEX(ticket,':r',1) IN (${c.map(()=>'?').join(',')})`).bind(accountId,...c).all<{ticket:string;close_ts:number}>()).results)}
 return out;
}
async function plan(d:Db,userId:string,p:T212Parsed,create:boolean){
 const out=[];
 for(const currency of p.currencies){
  const list=p.trades.filter(t=>t.accountCurrency===currency),accountId=create?await ensureAccount(d,userId,currency):await findAccount(d,userId,currency);
  out.push({currency,accountId,...planImport(list,await existing(d,accountId,list))});
 }
 return out;
}
export type T212Preview={newTrades:number;duplicates:number;currencies:string[];period:{from:number;to:number}|null;totals:T212Parsed['totals'];cash:T212Parsed['cash'];openPositions:number;withSl:number;incomplete:number;symbols:{symbol:string;count:number;instrument:string|null}[];unmapped:string[]};
export async function previewT212(d:Db,userId:string,p:T212Parsed,ids:readonly string[]):Promise<T212Preview>{
 const plans=await plan(d,userId,p,false),map=await symbolMap(d,userId),count=new Map<string,number>();
 for(const t of p.trades)count.set(t.symbol,(count.get(t.symbol)||0)+1);
 const symbols=[...count].map(([symbol,n])=>({symbol,count:n,instrument:mapSymbol(symbol,ids,map)})).sort((a,b)=>b.count-a.count||a.symbol.localeCompare(b.symbol));
 return {newTrades:plans.reduce((s,x)=>s+x.fresh.length,0),duplicates:plans.reduce((s,x)=>s+x.dup.length,0),currencies:p.currencies,period:p.period,totals:p.totals,cash:p.cash,openPositions:p.openPositions,
  withSl:p.trades.filter(t=>t.slInitial!==null).length,incomplete:p.trades.filter(t=>!t.complete).length,symbols,unmapped:symbols.filter(s=>s.instrument===null&&!Object.hasOwn(map,s.symbol)).map(s=>s.symbol)};
}
/** Uloží nové obchody (idempotentně podle Position ID + času uzavření) a vyhodnotí pravidla disciplíny u úplných obchodů. */
export async function importT212(d:Db,userId:string,p:T212Parsed,news:()=>NewsEvent[]=()=>[]){
 let imported=0,duplicates=0;
 for(const pl of await plan(d,userId,p,true)){
  duplicates+=pl.dup.length;
  const accountId=pl.accountId as string,built=pl.fresh.map(t=>t212Position(accountId,t)),now=nowSql();
  for(let i=0;i<built.length;i+=CHUNK){
   const c=built.slice(i,i+CHUNK),cols=Object.keys(c[0].position) as (keyof typeof c[0]['position'])[];
   const r=await d.prepare(`INSERT IGNORE INTO mt_positions(${cols.join(',')},updated) VALUES ${c.map(()=>`(${cols.map(()=>'?').join(',')},?)`).join(',')}`).bind(...c.flatMap(b=>[...cols.map(k=>b.position[k]),now])).run();
   imported+=r.meta.changes;
   const ch=c.flatMap(b=>b.changes.map(x=>[b.position.id,x.ts,x.kind,x.old_value,x.new_value,x.price,x.volume,x.reason]));
   for(let j=0;j<ch.length;j+=100){const cc=ch.slice(j,j+100);await d.prepare('INSERT INTO mt_position_changes(position_id,ts,kind,old_value,new_value,price,volume,reason) VALUES '+cc.map(()=>'(?,?,?,?,?,?,?,?)').join(',')).bind(...cc.flat()).run()}
  }
  // obchody bez otevíracího/zavíracího příkazu v souboru (začaly před obdobím exportu) se nevyhodnocují – SL ani důvod výstupu nejsou známé
  const tickets=[...new Set(pl.fresh.filter(t=>t.complete).map(t=>t.positionId))];
  if(tickets.length)try{await evaluateAccount(d,userId,accountId,tickets,news)}catch(e){console.error('discipline t212',accountId,e)}
 }
 return {imported,duplicates};
}
