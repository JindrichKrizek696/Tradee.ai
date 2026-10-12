// Laboratoř · Simulace – databáze (lab_paper_*). Volá se z /api/laborator/paper za labGate a ze scripts/lab-paper.mjs (jen pro vlastníka).
// Všechny dotazy filtrují user_id vlastníka; nikdy se nepoužívá ?as= (lib/admin/http.ts viewAs).
import type {Db} from '../mysql.ts';
import {PAPER_RULES,PAPER_RULES_VERSION,markToMarket,paperStats,paperSummaryMd,type PaperTrade,type PaperStepResult,type PaperSnapshot,type ExitReason,type Direction,type PaperEquityPoint} from './paper.ts';

export const toSql=(ms:number,frac=false)=>{const s=new Date(ms).toISOString().replace('T',' ');return frac?s.slice(0,23):s.slice(0,19)};
export const fromSql=(s:unknown)=>s===null||s===undefined?null:Date.parse(String(s).replace(' ','T')+(String(s).endsWith('Z')?'':'Z'));
const num=(v:unknown)=>v===null||v===undefined?null:Number(v);
const json=<T,>(s:unknown,def:T):T=>{if(typeof s!=='string'||!s)return def;try{return JSON.parse(s) as T}catch{return def}};

export type PaperAccount={startEquity:number;started:number;rulesVersion:string;active:boolean};
export async function getAccount(d:Db,uid:string):Promise<PaperAccount|null>{
 const r=await d.prepare('SELECT start_equity,started,rules_version,active FROM lab_paper_accounts WHERE user_id=?').bind(uid).first<{start_equity:number;started:string;rules_version:string;active:number}>();
 return r?{startEquity:Number(r.start_equity),started:fromSql(r.started)!,rulesVersion:r.rules_version,active:Number(r.active)===1}:null;
}
export async function ensureAccount(d:Db,uid:string,now:number):Promise<PaperAccount>{
 const a=await getAccount(d,uid);if(a)return a;
 await d.prepare('INSERT IGNORE INTO lab_paper_accounts(user_id,start_equity,started,rules_version,active,updated) VALUES(?,?,?,?,1,?)').bind(uid,PAPER_RULES.startEquity,toSql(now),PAPER_RULES_VERSION,toSql(now)).run();
 await addLog(d,uid,now,`Start simulace: ${PAPER_RULES.startEquity.toLocaleString('cs-CZ')} Kč, pravidla ${PAPER_RULES_VERSION}.`);
 return (await getAccount(d,uid))!;
}

type TradeRow={id:string;instrument:string;direction:string;opened:string;entry:number;sl:number;tp:number;risk_czk:number;confidence:number;score_at_entry:number;parts_at_entry:string;why:string;closed:string|null;exit_price:number|null;exit_reason:string|null;r:number|null;pnl_czk:number|null;pct:number|null;score_at_exit:number|null;result_note:string|null;rules_version:string};
const COLS='id,instrument,direction,opened,entry,sl,tp,risk_czk,confidence,score_at_entry,parts_at_entry,why,closed,exit_price,exit_reason,r,pnl_czk,pct,score_at_exit,result_note,rules_version';
const toTrade=(r:TradeRow):PaperTrade=>({id:r.id,instrument:r.instrument,direction:r.direction as Direction,opened:fromSql(r.opened)!,entry:Number(r.entry),sl:Number(r.sl),tp:Number(r.tp),riskCzk:Number(r.risk_czk),confidence:Number(r.confidence),
 scoreAtEntry:Number(r.score_at_entry),partsAtEntry:json<PaperSnapshot>(r.parts_at_entry,{method:'',coverage:0,alignment:0,freshness:0,atr:0,parts:[]}),why:r.why,
 closed:fromSql(r.closed),exit:num(r.exit_price),exitReason:(r.exit_reason as ExitReason|null)??null,r:num(r.r),pnlCzk:num(r.pnl_czk),pct:num(r.pct),scoreAtExit:num(r.score_at_exit),resultNote:r.result_note,rulesVersion:r.rules_version});
export async function listTrades(d:Db,uid:string,instrument?:string):Promise<PaperTrade[]>{
 const rows=instrument?(await d.prepare(`SELECT ${COLS} FROM lab_paper_trades WHERE user_id=? AND instrument=? ORDER BY opened DESC`).bind(uid,instrument).all<TradeRow>()).results
  :(await d.prepare(`SELECT ${COLS} FROM lab_paper_trades WHERE user_id=? ORDER BY opened DESC`).bind(uid).all<TradeRow>()).results;
 return rows.map(toTrade);
}
export async function addLog(d:Db,uid:string,at:number,text:string){await d.prepare('INSERT INTO lab_paper_log(user_id,at,text) VALUES(?,?,?)').bind(uid,toSql(at),text.slice(0,2000)).run()}
export async function listLog(d:Db,uid:string,limit=60){return (await d.prepare('SELECT at,text FROM lab_paper_log WHERE user_id=? ORDER BY at DESC,id DESC LIMIT '+Math.max(1,Math.min(500,Math.floor(limit)))).bind(uid).all<{at:string;text:string}>()).results.map(r=>({at:fromSql(r.at)!,text:r.text}))}
// equity křivka = uzavřený zůstatek + otevřený P&L v každém snímku
export async function equitySeries(d:Db,uid:string):Promise<PaperEquityPoint[]>{
 return (await d.prepare('SELECT at,equity,open_pnl FROM lab_paper_equity WHERE user_id=? ORDER BY at').bind(uid).all<{at:string;equity:number;open_pnl:number}>()).results.map(r=>({t:fromSql(r.at)!,equity:Number(r.equity)+Number(r.open_pnl)}));
}

// zápis jednoho kroku (idempotentní: vstup má id podle slotu 15 min a trhu, výstup jen u ještě otevřeného obchodu, snímek equity podle slotu)
export async function applyStep(d:Db,uid:string,now:number,slot:number,s:PaperStepResult){
 for(const c of s.closes)await d.prepare('UPDATE lab_paper_trades SET closed=?,exit_price=?,exit_reason=?,r=?,pnl_czk=?,pct=?,score_at_exit=?,result_note=? WHERE id=? AND user_id=? AND closed IS NULL')
  .bind(toSql(c.closed,true),c.exit,c.exitReason,c.r,c.pnlCzk,c.pct,c.scoreAtExit,c.resultNote,c.id,uid).run();
 for(const t of s.opens)await d.prepare(`INSERT IGNORE INTO lab_paper_trades(id,user_id,instrument,direction,opened,entry,sl,tp,risk_czk,confidence,score_at_entry,parts_at_entry,why,rules_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(t.id,uid,t.instrument,t.direction,toSql(t.opened,true),t.entry,t.sl,t.tp,t.riskCzk,t.confidence,t.scoreAtEntry,JSON.stringify(t.partsAtEntry),t.why,t.rulesVersion).run();
 await d.prepare('INSERT INTO lab_paper_equity(user_id,at,equity,open_pnl,open_count) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE equity=VALUES(equity),open_pnl=VALUES(open_pnl),open_count=VALUES(open_count)').bind(uid,toSql(slot),s.balance,s.openPnl,s.openCount).run();
 for(const l of s.log)await addLog(d,uid,now,l);
}
// restart: smaže obchody, křivku i deník a začne znovu se 100 000 Kč
export async function resetPaper(d:Db,uid:string,now:number){
 for(const t of ['lab_paper_trades','lab_paper_equity','lab_paper_log'])await d.prepare(`DELETE FROM ${t} WHERE user_id=?`).bind(uid).run();
 await d.prepare('INSERT INTO lab_paper_accounts(user_id,start_equity,started,rules_version,active,updated) VALUES(?,?,?,?,1,?) ON DUPLICATE KEY UPDATE start_equity=VALUES(start_equity),started=VALUES(started),rules_version=VALUES(rules_version),active=1,updated=VALUES(updated)')
  .bind(uid,PAPER_RULES.startEquity,toSql(now),PAPER_RULES_VERSION,toSql(now)).run();
 await addLog(d,uid,now,`Simulace restartována: ${PAPER_RULES.startEquity.toLocaleString('cs-CZ')} Kč, pravidla ${PAPER_RULES_VERSION}.`);
}

// pohled pro API, graf i shrnutí: otevřené pozice přeceněné živou cenou (mid ∓ ½ spread)
export type Quotes=Record<string,{price:number;marketTime:number}|undefined>;
export function withMarks(trades:PaperTrade[],quotes:Quotes){
 return trades.map(t=>{const q=t.closed===null?quotes[t.instrument]:undefined;return {...t,mark:q&&q.price>0?{...markToMarket(t,q.price),at:q.marketTime}:null}});
}
export async function paperView(d:Db,uid:string,quotes:Quotes){
 const [account,trades,equity,log]=await Promise.all([getAccount(d,uid),listTrades(d,uid),equitySeries(d,uid),listLog(d,uid)]);
 const marked=withMarks(trades,quotes),open=marked.filter(t=>t.closed===null),closed=marked.filter(t=>t.closed!==null).sort((a,b)=>(b.closed??0)-(a.closed??0));
 const openPnl=open.reduce((s,t)=>s+(t.mark?.pnlCzk??0),0),start=account?.startEquity??PAPER_RULES.startEquity;
 return {account,stats:paperStats(trades,start,openPnl,equity),equity,open,closed,log};
}
export async function paperSummary(d:Db,uid:string,quotes:Quotes){
 const v=await paperView(d,uid,quotes);
 return paperSummaryMd({started:v.account?.started??null,stats:v.stats,open:v.open,closed:v.closed});
}
