// DB vrstva replaye (migrace 0042). Každý dotaz na tabulky replay_* je omezený na user_id přihlášeného (kontrola: scripts/check-replay.mjs).
// Svíčky se čtou z archivu market_bars jen do simulačních hodin uložených v seanci – klient budoucí svíčky nikdy nedostane.
import type {Db} from '../mysql.ts';
import {loadBars} from '../bars/query.ts';
import type {Bar} from '../bars/yahoo.ts';
import {TF_MS,PREROLL_MS,type BaseTf,type ReplayTf} from './clock.ts';
import {run,type ReplayEvent,type EventKind,type RunResult,type Trade} from './engine.ts';
import {summarize,type Mode,type Summary} from './results.ts';
import type {SessionConfig,SessionInput} from './core.ts';
import {pragueDate} from '../mt/trades.ts';
const uid=(p:string)=>p+'_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
export const sqlTime=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const msOf=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):null;
const parse=<T>(s:unknown,fb:T):T=>{try{return s?JSON.parse(String(s)) as T:fb}catch{return fb}};
export type StoredResults={summary:Summary;breach:RunResult['breach'];prop:RunResult['prop'];computedAt:number;clock:number};
export type Session={id:string;name:string;mode:Mode;status:'active'|'ended'|'breached';symbols:string[];baseTf:BaseTf;tfs:ReplayTf[];start:number;clock:number;decideN:number|null;revealUntil:number|null;rewinds:number;resets:number;config:SessionConfig;results:StoredResults|null;journaled:boolean;created:number;updated:number;endedAt:number|null};
const toSession=(r:Record<string,unknown>):Session=>({id:String(r.id),name:String(r.name),mode:r.mode==='validate'?'validate':'learn',status:(r.status==='ended'||r.status==='breached'?r.status:'active') as Session['status'],symbols:parse(r.symbols,[] as string[]),baseTf:r.base_tf==='D1'?'D1':'H1',tfs:parse(r.tfs,[] as ReplayTf[]),start:Number(r.start_ts),clock:Number(r.clock),
 decideN:r.decide_n===null||r.decide_n===undefined?null:Number(r.decide_n),revealUntil:r.reveal_until===null||r.reveal_until===undefined?null:Number(r.reveal_until),rewinds:Number(r.rewinds||0),resets:Number(r.resets||0),config:parse(r.config,{} as SessionConfig),results:parse(r.results,null as StoredResults|null),journaled:!!Number(r.journaled),created:msOf(r.created)??0,updated:msOf(r.updated)??0,endedAt:msOf(r.ended_at)});
const COLS='id,name,mode,status,symbols,base_tf,tfs,start_ts,clock,decide_n,reveal_until,rewinds,resets,config,results,journaled,created,updated,ended_at';
export async function listSessions(d:Db,userId:string):Promise<Session[]>{
 return (await d.prepare(`SELECT ${COLS} FROM replay_sessions WHERE user_id=? ORDER BY updated DESC LIMIT 100`).bind(userId).all<Record<string,unknown>>()).results.map(toSession);
}
export async function getSession(d:Db,userId:string,id:string):Promise<Session|null>{
 const r=await d.prepare(`SELECT ${COLS} FROM replay_sessions WHERE id=? AND user_id=?`).bind(id,userId).first<Record<string,unknown>>();
 return r?toSession(r):null;
}
export async function countSessions(d:Db,userId:string){const r=await d.prepare('SELECT COUNT(*) AS n FROM replay_sessions WHERE user_id=?').bind(userId).first<{n:number}>();return Number(r?.n||0)}
export async function createSession(d:Db,userId:string,v:SessionInput,config:SessionConfig,now=Date.now()):Promise<string>{
 const id=uid('rp'),t=sqlTime(now);
 await d.prepare('INSERT INTO replay_sessions(id,user_id,name,mode,status,symbols,base_tf,tfs,start_ts,clock,decide_n,reveal_until,rewinds,resets,config,results,journaled,created,updated,ended_at) VALUES(?,?,?,?,\'active\',?,?,?,?,?,?,?,0,0,?,NULL,0,?,?,NULL)')
  .bind(id,userId,v.name,v.mode,JSON.stringify(v.symbols),v.baseTf,JSON.stringify(v.tfs),v.start,v.start,v.decideN,v.decideN?v.start:null,JSON.stringify(config),t,t).run();
 return id;
}
export async function deleteSession(d:Db,userId:string,id:string){
 for(const tbl of ['replay_events','replay_orders','replay_trades'])await d.prepare(`DELETE FROM ${tbl} WHERE session_id=? AND user_id=?`).bind(id,userId).run();
 return (await d.prepare('DELETE FROM replay_sessions WHERE id=? AND user_id=?').bind(id,userId).run()).meta.changes>0;
}
// ---- události
export async function loadEvents(d:Db,userId:string,id:string):Promise<ReplayEvent[]>{
 return (await d.prepare('SELECT seq,clock,kind,data,void FROM replay_events WHERE session_id=? AND user_id=? ORDER BY seq').bind(id,userId).all<Record<string,unknown>>()).results
  .map(r=>({seq:Number(r.seq),clock:Number(r.clock),kind:String(r.kind) as EventKind,data:parse(r.data,{} as Record<string,unknown>),void:!!Number(r.void)}));
}
export async function appendEvent(d:Db,userId:string,id:string,clock:number,kind:EventKind,data:Record<string,unknown>,now=Date.now()):Promise<ReplayEvent>{
 for(let i=0;i<3;i++){
  const r=await d.prepare('SELECT COALESCE(MAX(seq),0) AS s,COUNT(*) AS n FROM replay_events WHERE session_id=? AND user_id=?').bind(id,userId).first<{s:number;n:number}>();
  if(Number(r?.n||0)>=5000)throw Error('Seance má příliš mnoho událostí.');
  const seq=Number(r?.s||0)+1;
  try{await d.prepare('INSERT INTO replay_events(session_id,user_id,seq,clock,kind,data,void,created) VALUES(?,?,?,?,?,?,0,?)').bind(id,userId,seq,clock,kind,JSON.stringify(data),sqlTime(now)).run();return {seq,clock,kind,data}}
  catch(e){if(!/Duplicate|ER_DUP/i.test(String((e as Error).message)))throw e}
 }
 throw Error('Událost se nepodařilo uložit, zkus to znovu.');
}
export async function setClock(d:Db,userId:string,id:string,clock:number,revealUntil:number|null,now=Date.now()){
 await d.prepare("UPDATE replay_sessions SET clock=?,reveal_until=?,updated=? WHERE id=? AND user_id=? AND status='active'").bind(clock,revealUntil,sqlTime(now),id,userId).run();
}
/** Přetočení / reset: události po novém čase se zneplatní (rewind a reset zůstávají), hodiny zpět, počitadlo pro výsledky. */
export async function rewindSession(d:Db,userId:string,s:Session,to:number,kind:'rewind'|'reset',now=Date.now()){
 await d.prepare(`UPDATE replay_events SET void=1 WHERE session_id=? AND user_id=? AND ${kind==='reset'?'clock>=?':'clock>?'} AND kind NOT IN ('rewind','reset')`).bind(s.id,userId,kind==='reset'?s.start:to).run();
 const ev=await appendEvent(d,userId,s.id,to,kind,{from:s.clock,to},now);
 await d.prepare(`UPDATE replay_sessions SET clock=?,reveal_until=?,${kind==='reset'?'resets=resets+1':'rewinds=rewinds+1'},updated=? WHERE id=? AND user_id=? AND status='active'`).bind(to,s.decideN?to:null,sqlTime(now),s.id,userId).run();
 return ev;
}
// ---- svíčky jen do hodin
/** Svíčky základního rámce uzavřené v (fromClose, toClose]. Načítá se s rezervou dozadu, aby oprava otevření denních FX svíček (fixFxOpen) dala stejné hodnoty jako jeden velký dotaz. */
export async function barsBetween(d:Db,symbol:string,base:BaseTf,fromClose:number,toClose:number):Promise<Bar[]>{
 const ms=TF_MS[base];if(toClose<=fromClose)return [];
 const rows=await loadBars(d,symbol,base,fromClose-ms-8*86400000,toClose-ms+1);
 return rows.filter(b=>b.t+ms>fromClose&&b.t+ms<=toClose);
}
export async function sessionBars(d:Db,s:Pick<Session,'symbols'|'baseTf'|'start'|'clock'>,withPreroll=true):Promise<Record<string,Bar[]>>{
 const out:Record<string,Bar[]>={};
 for(const sym of s.symbols)out[sym]=await barsBetween(d,sym,s.baseTf,withPreroll?s.start-PREROLL_MS[s.baseTf]:s.start-TF_MS[s.baseTf]*2,s.clock);
 return out;
}
/** Časy uzavření dalších n svíček po hodinách (server – klient je nevidí). */
export async function nextCloses(d:Db,symbol:string,base:BaseTf,clock:number,n:number):Promise<number[]>{
 const ms=TF_MS[base];
 const rows=(await d.prepare(`SELECT t FROM market_bars WHERE instrument=? AND tf=? AND t>? ORDER BY t LIMIT ${Math.max(1,Math.min(500,Math.floor(n)))}`).bind(symbol,base,clock-ms).all<{t:number}>()).results;
 return rows.map(r=>Number(r.t)+ms).filter(c=>c>clock);
}
/** Kolik svíček je v archivu před a po startu (kontrola při založení). */
export async function dataCheck(d:Db,symbol:string,base:BaseTf,start:number){
 const r=await d.prepare('SELECT SUM(t<?) AS before_n,SUM(t>=?) AS after_n,MIN(t) AS first_t FROM market_bars WHERE instrument=? AND tf=?').bind(start,start,symbol,base).first<{before_n:number|null;after_n:number|null;first_t:number|null}>();
 return {before:Number(r?.before_n||0),after:Number(r?.after_n||0),first:r?.first_t===null||r?.first_t===undefined?null:Number(r.first_t)};
}
/** Nejbližší silná zpráva po hodinách pro měny seance (historie kalendáře). */
export async function nextNews(d:Db,currencies:string[],clock:number):Promise<{at:number;title:string;currency:string}|null>{
 if(!currencies.length)return null;
 const r=await d.prepare(`SELECT at,title,currency FROM calendar_events_hist WHERE at>? AND impact='High' AND currency IN (${currencies.map(()=>'?').join(',')}) ORDER BY at LIMIT 1`).bind(clock,...currencies).first<{at:number;title:string;currency:string}>().catch(()=>null);
 return r?{at:Number(r.at),title:String(r.title),currency:String(r.currency)}:null;
}
// ---- přepočet a uložení výsledků (autoritativně na serveru z uložených událostí a svíček do hodin)
export function compute(s:Session,bars:Record<string,Bar[]>,events:ReplayEvent[]){
 const res=run({bars,base:s.baseTf,events,exec:s.config.exec,specs:s.config.specs,account:s.config.account,clock:s.clock,start:s.start});
 return {res,summary:summarize(res.trades,events,s.config.account.balance,res.breach,s.mode)};
}
/** Snímek checklistu k obchodu: rozhodnutí z příkazu, jinak poslední rozhodnutí stejného směru na trhu před vstupem. */
export function snapshotFor(t:Trade,events:ReplayEvent[]):unknown{
 const dec=events.filter(e=>!e.void&&e.kind==='decision');
 const byId=t.decisionId?dec.find(e=>e.data.id===t.decisionId):undefined;
 const e=byId??[...dec].reverse().find(e=>e.data.symbol===t.symbol&&e.data.choice===t.side&&e.clock<=t.entryTs);
 return e?.data.snapshot??null;
}
export async function saveResults(d:Db,userId:string,s:Session,bars:Record<string,Bar[]>,events:ReplayEvent[],end:boolean,now=Date.now()){
 const {res,summary}=compute(s,bars,events);
 await d.prepare('DELETE FROM replay_orders WHERE session_id=? AND user_id=?').bind(s.id,userId).run();
 await d.prepare('DELETE FROM replay_trades WHERE session_id=? AND user_id=? AND journal_trade_id IS NULL').bind(s.id,userId).run();
 for(const o of res.orders)await d.prepare('INSERT INTO replay_orders(session_id,id,user_id,symbol,side,type,price,qty,sl,tp,status,placed_at,filled_at,fill_price,reason,decision_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(s.id,String(o.id).slice(0,40),userId,String(o.symbol||'').slice(0,32),String(o.side||'').slice(0,5),String(o.type||'').slice(0,6),o.price??null,Number(o.qty)||0,o.sl??null,o.tp??null,o.status,o.placedAt,o.filledAt,o.fillPrice,o.reason?String(o.reason).slice(0,200):null,o.decisionId??null).run();
 for(const t of res.trades){const snap=snapshotFor(t,events);
  await d.prepare('INSERT IGNORE INTO replay_trades(session_id,id,user_id,order_id,symbol,side,qty,entry_ts,entry_price,exit_ts,exit_price,exit_reason,sl,tp,gross,commission,swap,spread_cost,slippage_cost,net,planned_risk,r,ambiguous,gap,decision_id,plan_snapshot,journal_trade_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
   .bind(s.id,t.id,userId,t.orderId.slice(0,40),t.symbol,t.side,t.qty,t.entryTs,t.entry,t.exitTs,t.exit,t.reason,t.sl,t.tp,t.gross,t.commission,t.swap,t.spreadCost,t.slippageCost,t.net,t.plannedRisk,t.r,t.ambiguous?1:0,t.gap?1:0,t.decisionId,snap?JSON.stringify(snap):null).run()}
 const stored:StoredResults={summary,breach:res.breach,prop:res.prop,computedAt:now,clock:s.clock};
 const status=res.breach?'breached':end?'ended':'active',done=status!=='active';
 await d.prepare(`UPDATE replay_sessions SET results=?,status=?,updated=?${done?',ended_at=?':''} WHERE id=? AND user_id=?`).bind(...[JSON.stringify(stored),status,sqlTime(now),...(done?[sqlTime(now)]:[]),s.id,userId]).run();
 return {res,summary,status};
}
export type TradeRow={id:string;orderId:string;symbol:string;side:string;qty:number;entryTs:number;entry:number;exitTs:number;exit:number;reason:string;sl:number|null;tp:number|null;gross:number;commission:number;swap:number;spreadCost:number;slippageCost:number;net:number;plannedRisk:number|null;r:number|null;ambiguous:boolean;gap:boolean;decisionId:string|null;snapshot:unknown;journalTradeId:string|null};
export async function loadTrades(d:Db,userId:string,id:string):Promise<TradeRow[]>{
 const n=(v:unknown)=>v===null||v===undefined?null:Number(v);
 return (await d.prepare('SELECT * FROM replay_trades WHERE session_id=? AND user_id=? ORDER BY exit_ts,id').bind(id,userId).all<Record<string,unknown>>()).results.map(r=>({id:String(r.id),orderId:String(r.order_id),symbol:String(r.symbol),side:String(r.side),qty:Number(r.qty),entryTs:Number(r.entry_ts),entry:Number(r.entry_price),exitTs:Number(r.exit_ts),exit:Number(r.exit_price),reason:String(r.exit_reason),sl:n(r.sl),tp:n(r.tp),gross:Number(r.gross),commission:Number(r.commission),swap:Number(r.swap),spreadCost:Number(r.spread_cost),slippageCost:Number(r.slippage_cost),net:Number(r.net),plannedRisk:n(r.planned_risk),r:n(r.r),ambiguous:!!Number(r.ambiguous),gap:!!Number(r.gap),decisionId:r.decision_id?String(r.decision_id):null,snapshot:parse(r.plan_snapshot,null),journalTradeId:r.journal_trade_id?String(r.journal_trade_id):null}));
}
// ---- Deník: obchody replaye jako ruční zápisy s režimem „replay“ (statistiky živého obchodování je ve výchozím stavu nepočítají)
type Snap={strategyId?:string;versionId?:string;model?:string|null};
export async function exportToJournal(d:Db,userId:string,s:Session,now=Date.now()):Promise<number>{
 const rows=(await loadTrades(d,userId,s.id)).filter(t=>!t.journalTradeId);let n=0;const t0=sqlTime(now);
 for(const t of rows){
  const jid='rp'+crypto.randomUUID().replace(/-/g,'').slice(0,30);
  const note=`Replay „${s.name}“ (${s.mode==='validate'?'validační':'výukový'}) · ${t.side==='long'?'long':'short'} ${t.qty} · ${t.entry} → ${t.exit}${t.r!==null?` · ${t.r} R`:''}${t.ambiguous?' · nejednoznačná svíčka':''} · ${s.config.account.currency}`.slice(0,500);
  await d.prepare('INSERT INTO trades(id,user_id,date,instrument,pnl,note,created) VALUES(?,?,?,?,?,?,?)').bind(jid,userId,pragueDate(t.exitTs),t.symbol,Math.round(t.net*100)/100,note,new Date(now).toISOString()).run();
  await d.prepare("INSERT INTO trade_meta(user_id,trade_id,mode,planned_risk,planned_risk_pct,updated) VALUES(?,?,'replay',?,?,?) ON DUPLICATE KEY UPDATE mode='replay',planned_risk=VALUES(planned_risk),planned_risk_pct=VALUES(planned_risk_pct),updated=VALUES(updated)")
   .bind(userId,'man:'+jid,t.plannedRisk,t.plannedRisk&&s.config.account.balance>0?Math.round(t.plannedRisk/s.config.account.balance*10000)/100:null,t0).run();
  const sn=t.snapshot as Snap|null;
  if(sn&&sn.strategyId&&sn.versionId)await d.prepare('INSERT INTO trade_plans(user_id,trade_id,scenario_id,strategy_id,version_id,model,snapshot,created,updated) VALUES(?,?,NULL,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE snapshot=VALUES(snapshot),updated=VALUES(updated)')
   .bind(userId,'man:'+jid,sn.strategyId,sn.versionId,sn.model??null,JSON.stringify(sn),t0,t0).run();
  await d.prepare('UPDATE replay_trades SET journal_trade_id=? WHERE session_id=? AND id=? AND user_id=?').bind(jid,s.id,t.id,userId).run();
  n++;
 }
 await d.prepare('UPDATE replay_sessions SET journaled=1,updated=? WHERE id=? AND user_id=?').bind(t0,s.id,userId).run();
 return n;
}
