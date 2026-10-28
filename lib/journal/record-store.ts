// DB vrstva etapy 1C: nápady s více vstupy, záznam obchodu (režim, plánované riziko, náklady, změny SL/TP, hodnocení procesu),
// limity seance a no-trade okna. Db je parametr, vše filtruje user_id. Bez migrace 0038 čtení vrací výchozí hodnoty, zápis srozumitelnou chybu.
import type {Db} from '../mysql.ts';
import {nowSql} from '../mt/store.ts';
import {pragueDate} from '../mt/trades.ts';
import {fillRiskPct} from '../risk/discipline.ts';
import {currenciesOf} from '../discipline/rules.ts';
import {pragueDayStart} from '../discipline/store.ts';
import {listStrategiesFull,getTradePlan} from '../strategy/store.ts';
import {parseContent} from '../strategy/core.ts';
import {instrumentCurrencies} from '../strategy/scenario.ts';
import {groupIdeas,ideaSummary,checkAddLeg,parseWindow,isIdeaKey,IDEA_WINDOW_MIN,type IdeaLeg,type IdeaSummary,type Side,type LegStatus} from './ideas.ts';
import {originalRisk,rMultiple,breakEven,mergeCosts,costLines,grossOf,parseCosts,emptyCosts,UNKNOWN_R,type Costs,type CostKey} from './accounting.ts';
import {emptyLimits,parseLimits,sessionState,sessionViolations,sizeAfterLoss,stopWidening,SESSION_STATES,type SessionLimits,type Scope,type STrade,type Warning} from './session.ts';
import {collisions,makeWindow,type ImpactEvent,type NewsWindow,type Collision} from './news-window.ts';
import {isMode,type Mode} from './metrics.ts';
import {parseProcess,processComplete,type Process} from './process.ts';
const missing=(e:unknown)=>/doesn't exist|ER_NO_SUCH_TABLE|Unknown column/i.test(String((e as Error)?.message));
const prep=(e:unknown)=>missing(e)?Error('Záznam obchodu se na serveru teprve připravuje. Zkus to prosím později.'):e;
const soft=async<T>(f:()=>Promise<T>,def:T):Promise<T>=>{try{return await f()}catch(e){if(missing(e))return def;throw e}};
const uid=(p:string)=>p+'_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
const num=(v:unknown)=>v===null||v===undefined?null:Number(v);
const msOf=(v:unknown)=>{if(v===null||v===undefined||v==='')return null;const t=Date.parse(String(v).replace(' ','T')+(String(v).includes('Z')?'':'Z'));return Number.isFinite(t)?t:null};
const chunks=<T>(a:T[],n=300)=>{const o:T[][]=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o};
export type TradeRef={kind:'mt'|'man';id:string};
export const tradeKey=(r:TradeRef)=>r.kind+':'+r.id;
export async function ownsTrade(d:Db,userId:string,r:TradeRef):Promise<boolean>{
 if(r.kind==='mt')return !!await d.prepare('SELECT p.id FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE p.id=? AND a.user_id=?').bind(r.id,userId).first();
 return !!await d.prepare('SELECT id FROM trades WHERE id=? AND user_id=?').bind(r.id,userId).first();
}
// ---------- nastavení a metadata pro seznam deníku
export async function getIdeaWindow(d:Db,userId:string):Promise<number>{
 const r=await soft(()=>d.prepare('SELECT idea_window_min FROM journal_settings WHERE user_id=?').bind(userId).first<{idea_window_min:number}>(),null);
 return r?Number(r.idea_window_min):IDEA_WINDOW_MIN;
}
export async function setIdeaWindow(d:Db,userId:string,raw:unknown):Promise<number>{
 const v=parseWindow(raw);if(typeof v==='string')throw Error(v);
 try{await d.prepare('INSERT INTO journal_settings(user_id,idea_window_min,updated) VALUES(?,?,?) ON DUPLICATE KEY UPDATE idea_window_min=VALUES(idea_window_min),updated=VALUES(updated)').bind(userId,v,nowSql()).run()}catch(e){throw prep(e)}
 return v;
}
export type Meta={mode:Mode;plannedRisk:number|null;plannedRiskPct:number|null};
export async function loadMeta(d:Db,userId:string):Promise<Map<string,Meta>>{
 const rows=await soft(async()=>(await d.prepare('SELECT trade_id,mode,planned_risk,planned_risk_pct FROM trade_meta WHERE user_id=?').bind(userId).all<{trade_id:string;mode:string;planned_risk:number|null;planned_risk_pct:number|null}>()).results,[] as {trade_id:string;mode:string;planned_risk:number|null;planned_risk_pct:number|null}[]);
 return new Map(rows.map(r=>[r.trade_id,{mode:isMode(r.mode)?r.mode:'live',plannedRisk:num(r.planned_risk),plannedRiskPct:num(r.planned_risk_pct)}]));
}
type PosLite={id:string;account_id:string;symbol:string;side:string;status:string;open_ts:number;close_ts:number|null;open_price:number;volume_max:number;sl_initial:number|null;risk_money:number|null;risk_pct:number|null;net:number;acc_name:string;acc_login:string;acc_currency:string;platform:string};
async function positions(d:Db,userId:string):Promise<PosLite[]>{
 const raw=(await d.prepare(`SELECT p.id,p.account_id,p.symbol,p.side,p.status,p.open_ts,p.close_ts,p.open_price,p.volume_max,p.sl_initial,p.risk_money,p.risk_pct,p.net,a.name AS acc_name,a.login AS acc_login,a.currency AS acc_currency,a.platform
  FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE a.user_id=? ORDER BY p.open_ts DESC LIMIT 3000`).bind(userId).all<PosLite>()).results.map(r=>({...r,open_ts:Number(r.open_ts),close_ts:num(r.close_ts),open_price:Number(r.open_price),volume_max:Number(r.volume_max),sl_initial:num(r.sl_initial),risk_money:num(r.risk_money),risk_pct:num(r.risk_pct),net:Number(r.net)}));
 const profs=(await d.prepare('SELECT link_id,start_balance,start_date FROM account_profiles WHERE user_id=? AND archived=0 AND link_id IS NOT NULL').bind(userId).all<{link_id:string;start_balance:number;start_date:string}>().catch(()=>({results:[]}))).results;
 type FR=Parameters<typeof fillRiskPct>[0];
 return fillRiskPct(raw as unknown as FR,profs.map(p=>({linkId:p.link_id,start:Number(p.start_balance),startTs:Date.parse(String(p.start_date).slice(0,10)+'T00:00:00Z')-2*3600000}))) as unknown as PosLite[];
}
type LegRow={id:string;idea_id:string;trade_id:string|null;status:string;price:number|null;qty:number|null;stop:number|null;risk_pct:number|null;note:string|null;created:string};
type IdeaRow={id:string;account_id:string|null;symbol:string;side:string;scenario_id:string|null;risk_cap_pct:number|null;stop:number|null;note:string|null;created:string;updated:string};
async function ideaRows(d:Db,userId:string){
 const ideas=await soft(async()=>(await d.prepare('SELECT id,account_id,symbol,side,scenario_id,risk_cap_pct,stop,note,created,updated FROM ideas WHERE user_id=?').bind(userId).all<IdeaRow>()).results,[] as IdeaRow[]);
 const legs=await soft(async()=>(await d.prepare('SELECT id,idea_id,trade_id,status,price,qty,stop,risk_pct,note,created FROM idea_legs WHERE user_id=? ORDER BY created,id').bind(userId).all<LegRow>()).results,[] as LegRow[]);
 return {ideas,legs};
}
async function scenarioLinks(d:Db,userId:string):Promise<Map<string,string>>{
 const rows=await soft(async()=>(await d.prepare('SELECT trade_id,scenario_id FROM trade_plans WHERE user_id=? AND scenario_id IS NOT NULL').bind(userId).all<{trade_id:string;scenario_id:string}>()).results,[] as {trade_id:string;scenario_id:string}[]);
 return new Map(rows.map(r=>[r.trade_id,r.scenario_id]));
}
/** id nápadu pro každou MT pozici (ruční přiřazení > scénář > okno od prvního vstupu). */
export async function ideaMap(d:Db,userId:string,pos?:PosLite[]):Promise<Record<string,string>>{
 const [list,win,{legs},links]=await Promise.all([pos?Promise.resolve(pos):positions(d,userId),getIdeaWindow(d,userId),ideaRows(d,userId),scenarioLinks(d,userId)]);
 const manual=new Map(legs.filter(l=>l.status==='trade'&&l.trade_id).map(l=>[l.trade_id as string,l.idea_id]));
 return groupIdeas(list.map(p=>({tradeId:'mt:'+p.id,accountId:p.account_id,symbol:p.symbol,side:p.side==='sell'?'sell':'buy',openTs:p.open_ts,scenarioId:links.get('mt:'+p.id)??null,manualIdea:manual.get('mt:'+p.id)??null})),win*60000);
}
// ---------- nápady
export type IdeaView={id:string;kind:'manual'|'auto'|'scenario';accountId:string|null;account:string;currency:string;symbol:string;side:Side;scenarioId:string|null;capPct:number|null;stop:number|null;note:string;legs:IdeaLeg[];summary:IdeaSummary;warnings:string[]};
export async function listIdeas(d:Db,userId:string,limit=150):Promise<{window:number;ideas:IdeaView[]}>{
 const pos=await positions(d,userId),[map,win,{ideas,legs}]=await Promise.all([ideaMap(d,userId,pos),getIdeaWindow(d,userId),ideaRows(d,userId)]);
 const byKey=new Map<string,PosLite[]>();
 for(const p of pos){const k=map['mt:'+p.id];if(k)(byKey.get(k)??byKey.set(k,[]).get(k)!).push(p)}
 const out:IdeaView[]=[];
 const keys=new Set([...byKey.keys(),...ideas.map(i=>i.id)]);
 for(const key of keys){
  const ps=(byKey.get(key)||[]).sort((a,b)=>a.open_ts-b.open_ts),row=ideas.find(i=>i.id===key),first=ps[0];
  if(!first&&!row)continue;
  const tradeLegs:IdeaLeg[]=ps.map(p=>({id:'mt:'+p.id,tradeId:'mt:'+p.id,status:p.status==='closed'?'closed':'open',openTs:p.open_ts,closeTs:p.close_ts,price:p.open_price,qty:p.volume_max,stop:p.sl_initial,riskPct:p.risk_pct,riskMoney:p.risk_money,net:p.status==='closed'?p.net:null}));
  const planLegs:IdeaLeg[]=legs.filter(l=>l.idea_id===key&&(l.status==='pending'||l.status==='cancelled')).map(l=>({id:l.id,tradeId:null,status:l.status as LegStatus,openTs:msOf(l.created),closeTs:null,price:num(l.price),qty:num(l.qty),stop:num(l.stop),riskPct:num(l.risk_pct),riskMoney:null,net:null,note:l.note||''}));
  const allLegs=[...tradeLegs,...planLegs],capPct=row?num(row.risk_cap_pct):null,stop=row?num(row.stop):null,summary=ideaSummary(allLegs,{capPct,stop});
  const warnings:string[]=[];if(summary.cap.over)warnings.push(`Riziko nápadu ${summary.cap.total} % je nad limitem ${capPct} %.`);
  if(ps.length>1&&new Set(ps.map(p=>p.account_id)).size>1)warnings.push('Vstupy jsou na různých účtech.');
  out.push({id:key,kind:key.startsWith('idea_')?'manual':key.startsWith('sc:')?'scenario':'auto',accountId:first?.account_id??row?.account_id??null,account:first?(first.acc_name||'••••'+String(first.acc_login).slice(-4)):'',currency:first?.acc_currency??'',symbol:first?.symbol??row!.symbol,side:((first?.side??row!.side)==='sell'?'sell':'buy'),scenarioId:row?.scenario_id??(key.startsWith('sc:')?key.split(':')[1]:null),capPct,stop,note:row?.note||'',legs:allLegs,summary,warnings});
 }
 out.sort((a,b)=>(b.summary.lastTs??0)-(a.summary.lastTs??0));
 return {window:win,ideas:out.slice(0,limit)};
}
/** Auto / scénářový nápad → ruční (řádek v ideas + přiřazení jeho obchodů), aby šel nastavit limit, stop nebo čekající vstup. */
async function materialize(d:Db,userId:string,key:string):Promise<string>{
 if(key.startsWith('idea_')){if(!await d.prepare('SELECT id FROM ideas WHERE id=? AND user_id=?').bind(key,userId).first())throw Error('Nápad nenalezen.');return key}
 const v=(await listIdeas(d,userId,100000)).ideas.find(i=>i.id===key);if(!v)throw Error('Nápad nenalezen.');
 const id=uid('idea'),now=nowSql();
 await d.prepare('INSERT INTO ideas(id,user_id,account_id,symbol,side,scenario_id,risk_cap_pct,stop,note,created,updated) VALUES(?,?,?,?,?,?,NULL,NULL,NULL,?,?)').bind(id,userId,v.accountId,v.symbol,v.side,v.scenarioId,now,now).run();
 for(const l of v.legs)if(l.tradeId)await assignLeg(d,userId,id,l.tradeId);
 return id;
}
async function assignLeg(d:Db,userId:string,ideaId:string,tradeId:string){
 const now=nowSql();
 await d.prepare("INSERT INTO idea_legs(id,idea_id,user_id,trade_id,status,created,updated) VALUES(?,?,?,?,'trade',?,?) ON DUPLICATE KEY UPDATE idea_id=VALUES(idea_id),status='trade',updated=VALUES(updated)").bind(uid('leg'),ideaId,userId,tradeId,now,now).run();
}
async function cleanupIdeas(d:Db,userId:string){
 await d.prepare('DELETE FROM ideas WHERE user_id=? AND id NOT IN (SELECT idea_id FROM idea_legs WHERE user_id=?) AND risk_cap_pct IS NULL AND stop IS NULL AND (note IS NULL OR note=\'\')').bind(userId,userId).run();
}
const posOf=(pos:PosLite[],tradeId:string)=>pos.find(p=>'mt:'+p.id===tradeId);
/** Akce v Deníku: assign (přesunout obchody do nápadu / do nového), split (obchod samostatně), reset (zpět automaticky), update (limit, stop, poznámka), leg (čekající vstup), cancel / remove (čekající vstup). */
export async function ideaAction(d:Db,userId:string,raw:unknown):Promise<{ok:true;id?:string}>{
 const o=(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}) as Record<string,unknown>,act=o.action;
 try{
  if(act==='assign'||act==='split'){
   const ids=act==='split'?[o.tradeId]:Array.isArray(o.tradeIds)?o.tradeIds:[];
   if(!ids.length||ids.length>50||ids.some(x=>typeof x!=='string'))throw Error('Vyber obchody.');
   const pos=await positions(d,userId),list=(ids as string[]).map(t=>posOf(pos,t));
   if(list.some(p=>!p))throw Error('Obchod nenalezen.');
   const ps=list as PosLite[];
   if(new Set(ps.map(p=>p.symbol+'|'+p.side)).size>1)throw Error('Do jednoho nápadu patří jen obchody na stejném trhu a ve stejném směru.');
   let target=act==='assign'&&typeof o.ideaId==='string'&&o.ideaId?o.ideaId:null;
   if(target){if(!isIdeaKey(target))throw Error('Nápad nenalezen.');target=await materialize(d,userId,target);
    const row=await d.prepare('SELECT symbol,side FROM ideas WHERE id=? AND user_id=?').bind(target,userId).first<{symbol:string;side:string}>();
    if(!row||row.symbol!==ps[0].symbol||row.side!==(ps[0].side==='sell'?'sell':'buy'))throw Error('Nápad je na jiném trhu nebo ve druhém směru.');}
   else{target=uid('idea');const now=nowSql();await d.prepare('INSERT INTO ideas(id,user_id,account_id,symbol,side,created,updated) VALUES(?,?,?,?,?,?,?)').bind(target,userId,ps[0].account_id,ps[0].symbol,ps[0].side==='sell'?'sell':'buy',now,now).run()}
   for(const p of ps)await assignLeg(d,userId,target,'mt:'+p.id);
   await cleanupIdeas(d,userId);return {ok:true,id:target};
  }
  if(act==='reset'){
   if(typeof o.tradeId!=='string')throw Error('Vyber obchod.');
   await d.prepare("DELETE FROM idea_legs WHERE user_id=? AND trade_id=? AND status='trade'").bind(userId,o.tradeId).run();
   await cleanupIdeas(d,userId);return {ok:true};
  }
  if(act==='update'){
   if(!isIdeaKey(o.ideaId))throw Error('Nápad nenalezen.');
   const cap=o.capPct===null||o.capPct===''||o.capPct===undefined?null:Number(String(o.capPct).replace(',','.'));
   if(cap!==null&&(!Number.isFinite(cap)||cap<=0||cap>20))throw Error('Limit rizika nápadu zadej v % (0–20).');
   const stop=o.stop===null||o.stop===''||o.stop===undefined?null:Number(String(o.stop).replace(',','.'));
   if(stop!==null&&(!Number.isFinite(stop)||stop<=0))throw Error('Stop musí být kladné číslo.');
   const note=typeof o.note==='string'?o.note.trim().slice(0,1000):'';
   const id=await materialize(d,userId,o.ideaId);
   await d.prepare('UPDATE ideas SET risk_cap_pct=?,stop=?,note=?,updated=? WHERE id=? AND user_id=?').bind(cap,stop,note||null,nowSql(),id,userId).run();
   return {ok:true,id};
  }
  if(act==='leg'){
   if(!isIdeaKey(o.ideaId))throw Error('Nápad nenalezen.');
   const f=(v:unknown)=>v===null||v===undefined||v===''?null:Number(String(v).replace(',','.'));
   const price=f(o.price),qty=f(o.qty),stop=f(o.stop),risk=f(o.riskPct);
   if(price===null||!Number.isFinite(price)||price<=0)throw Error('Zadej limitní cenu vstupu.');
   if(risk===null||!Number.isFinite(risk)||risk<=0||risk>20)throw Error('Zadej riziko vstupu v % účtu.');
   if(qty!==null&&(!Number.isFinite(qty)||qty<=0))throw Error('Objem musí být kladný.');
   if(stop!==null&&(!Number.isFinite(stop)||stop<=0))throw Error('Stop musí být kladné číslo.');
   const v=(await listIdeas(d,userId,100000)).ideas.find(i=>i.id===o.ideaId);if(!v)throw Error('Nápad nenalezen.');
   const chk=checkAddLeg(v.capPct,v.legs,risk);if(!chk.ok)throw Error(chk.message!);
   const id=await materialize(d,userId,o.ideaId),now=nowSql();
   await d.prepare("INSERT INTO idea_legs(id,idea_id,user_id,trade_id,status,price,qty,stop,risk_pct,note,created,updated) VALUES(?,?,?,NULL,'pending',?,?,?,?,?,?,?)").bind(uid('leg'),id,userId,price,qty,stop,risk,typeof o.note==='string'?o.note.trim().slice(0,300)||null:null,now,now).run();
   return {ok:true,id};
  }
  if(act==='cancel'||act==='remove'){
   if(typeof o.legId!=='string'||!/^leg_[a-z0-9]{24}$/.test(o.legId))throw Error('Vstup nenalezen.');
   const r=act==='cancel'?await d.prepare("UPDATE idea_legs SET status='cancelled',updated=? WHERE id=? AND user_id=? AND status='pending'").bind(nowSql(),o.legId,userId).run():await d.prepare("DELETE FROM idea_legs WHERE id=? AND user_id=? AND status IN ('pending','cancelled')").bind(o.legId,userId).run();
   if(!r.meta.changes)throw Error('Vstup nenalezen.');
   return {ok:true};
  }
  throw Error('Neznámá akce.');
 }catch(e){throw prep(e)}
}
// ---------- no-trade okna
export type WindowDef={source:string;kind:'strategy'|'account'|'all';id:string;window:NewsWindow};
export async function windowDefs(d:Db,userId:string):Promise<WindowDef[]>{
 const out:WindowDef[]=[];
 for(const s of await soft(()=>listStrategiesFull(d,userId,true),[])){if(s.archived||!s.latest?.content)continue;const nt=s.latest.content.noTrade,w=makeWindow(nt.newsBefore,nt.newsAfter,nt.minImpact??3,'Strategie '+s.name);if(w)out.push({source:w.source,kind:'strategy',id:s.id,window:w})}
 const accs=new Map((await d.prepare('SELECT id,name,login FROM mt_accounts WHERE user_id=?').bind(userId).all<{id:string;name:string;login:string}>()).results.map(a=>[a.id,a.name||'••••'+String(a.login).slice(-4)]));
 for(const l of await limitRows(d,userId)){if(l.scope==='strategy')continue;const w=makeWindow(l.limits.newsBefore,l.limits.newsAfter,l.limits.newsMinImpact,l.scope==='all'?'Všechny účty':'Účet '+(accs.get(l.scopeId)||l.scopeId));if(w)out.push({source:w.source,kind:l.scope,id:l.scopeId,window:w})}
 return out;
}
async function versionWindows(d:Db,userId:string,versionIds:string[]):Promise<Map<string,NewsWindow>>{
 const m=new Map<string,NewsWindow>();if(!versionIds.length)return m;
 for(const c of chunks([...new Set(versionIds)]))for(const r of (await soft(async()=>(await d.prepare(`SELECT v.id,v.content,s.name FROM strategy_versions v JOIN strategies s ON s.id=v.strategy_id AND s.user_id=v.user_id WHERE v.user_id=? AND v.id IN (${c.map(()=>'?').join(',')})`).bind(userId,...c).all<{id:string;content:string;name:string}>()).results,[] as {id:string;content:string;name:string}[]))){
  const nt=parseContent(r.content).noTrade,w=makeWindow(nt.newsBefore,nt.newsAfter,nt.minImpact??3,'Strategie '+r.name);if(w)m.set(r.id,w);
 }
 return m;
}
/** Otevřené scénáře, do jejichž platnosti (teď → platnost, bez platnosti 24 h) zasahuje no-trade okno verze strategie nebo „všech účtů“. */
export async function scenarioCollisions(d:Db,userId:string,list:{id:string;instrument:string;versionId:string|null;status:string;validUntil:number|null;created:number}[],events:ImpactEvent[],now:number):Promise<Record<string,Collision[]>>{
 const open=list.filter(s=>s.status==='waiting'||s.status==='active');if(!open.length)return {};
 const vw=await versionWindows(d,userId,open.map(s=>s.versionId).filter((x):x is string=>!!x)),all=(await limitRows(d,userId)).find(l=>l.scope==='all');
 const allW=all?makeWindow(all.limits.newsBefore,all.limits.newsAfter,all.limits.newsMinImpact,'Všechny účty'):null,out:Record<string,Collision[]>={};
 for(const s of open){
  const ws=[s.versionId?vw.get(s.versionId):null,allW].filter((x):x is NewsWindow=>!!x);if(!ws.length)continue;
  const c=collisions({from:Math.max(now,s.created),to:s.validUntil??now+864e5},instrumentCurrencies(s.instrument),events,ws);
  if(c.length)out[s.id]=c.slice(0,5);
 }
 return out;
}
// ---------- záznam obchodu
export type ChangeView={id:number|null;ts:number;kind:'sl'|'tp';old:number|null;new:number|null;reason:string;source:'mt'|'manual'};
export type RecordView={tradeId:string;source:'mt'|'manual';mode:Mode;plannedRisk:number|null;plannedRiskPct:number|null;executedRisk:number|null;executedRiskPct:number|null;originalRisk:number|null;riskBasis:'plan'|'first_stop'|null;r:number|null;rLabel:string;be:{kind:string|null;label:string|null;net:number|null};net:number|null;gross:number|null;currency:string;costs:Costs;costLines:ReturnType<typeof costLines>;manualCosts:Partial<Costs>;slippagePoints:number|null;spreadPoints:number|null;changes:ChangeView[];warnings:Warning[];collisions:Collision[];process:Process;plan:{strategyName:string|null;version:number|null;model:string|null}|null;ideaId:string|null;account:string;platform:string|null;files:{id:string;name:string;size:number;type:string}[]};
async function loadProcess(d:Db,userId:string,tid:string):Promise<Process>{
 const r=await soft(()=>d.prepare('SELECT answers,rating,done_at FROM trade_process WHERE user_id=? AND trade_id=?').bind(userId,tid).first<{answers:string;rating:number|null;done_at:string|null}>(),null);
 if(!r)return {answers:{},rating:null,doneAt:null};
 let a:Record<string,unknown>={};try{const v=JSON.parse(r.answers);if(v&&typeof v==='object')a=v}catch{}
 const p=parseProcess({answers:a,rating:num(r.rating)});
 return typeof p==='string'?{answers:{},rating:null,doneAt:null}:{...p,doneAt:msOf(r.done_at)};
}
export async function tradeRecord(d:Db,userId:string,ref:TradeRef,events:()=>ImpactEvent[]):Promise<RecordView|null>{
 const tid=tradeKey(ref),meta=(await loadMeta(d,userId)).get(tid)??{mode:'live' as Mode,plannedRisk:null,plannedRiskPct:null};
 const manualCosts=await soft(async()=>{const r=await d.prepare('SELECT spread,commission,swap,slippage,fee FROM trade_costs WHERE user_id=? AND trade_id=?').bind(userId,tid).first<Record<string,unknown>>();if(!r)return {} as Partial<Costs>;const o:Partial<Costs>={};for(const k of ['spread','commission','swap','slippage','fee'] as CostKey[])if(r[k]!==null&&r[k]!==undefined)o[k]=Number(r[k]);return o},{} as Partial<Costs>);
 const manualChanges=await soft(async()=>(await d.prepare('SELECT id,ts,kind,old_value,new_value,reason,source FROM trade_changes WHERE user_id=? AND trade_id=? ORDER BY ts,id').bind(userId,tid).all<{id:number;ts:number;kind:string;old_value:number|null;new_value:number|null;reason:string|null;source:string}>()).results,[] as {id:number;ts:number;kind:string;old_value:number|null;new_value:number|null;reason:string|null;source:string}[]);
 const process=await loadProcess(d,userId,tid),planRow=await soft(()=>getTradePlan(d,userId,tid),null);
 const plan=planRow?{strategyName:planRow.strategyName,version:planRow.version,model:planRow.model}:null;
 const manualOnly:ChangeView[]=manualChanges.filter(c=>c.source==='manual').map(c=>({id:Number(c.id),ts:Number(c.ts),kind:c.kind==='tp'?'tp':'sl',old:num(c.old_value),new:num(c.new_value),reason:c.reason||'',source:'manual'}));
 if(ref.kind==='man'){
  const t=await d.prepare('SELECT id,date,instrument,pnl FROM trades WHERE id=? AND user_id=?').bind(ref.id,userId).first<{id:string;date:string;instrument:string;pnl:number}>();
  if(!t)return null;
  const net=Number(t.pnl),orig=originalRisk({planned:meta.plannedRisk,firstStop:null}),r=rMultiple(net,orig),costs=mergeCosts({},manualCosts);
  const files=await soft(async()=>(await d.prepare('SELECT id,name,size,type FROM mt_position_files WHERE position_id=? AND user_id=? ORDER BY created,id').bind(tid,userId).all<{id:string;name:string;size:number;type:string}>()).results.map(f=>({...f,size:Number(f.size)})),[] as {id:string;name:string;size:number;type:string}[]);
  return {tradeId:tid,source:'manual',mode:meta.mode,plannedRisk:meta.plannedRisk,plannedRiskPct:meta.plannedRiskPct,executedRisk:null,executedRiskPct:null,originalRisk:orig,riskBasis:orig===null?null:'plan',r,rLabel:r===null?UNKNOWN_R:'',be:breakEven({side:null,entry:null,exit:null,net,risk:orig}),net,gross:grossOf(net,costs),currency:'',costs,costLines:costLines(costs),manualCosts,slippagePoints:null,spreadPoints:null,changes:manualOnly,warnings:[],collisions:[],process,plan,ideaId:null,account:'Ručně',platform:null,files};
 }
 const p=await d.prepare('SELECT p.id,p.account_id,p.symbol,p.side,p.status,p.open_ts,p.close_ts,p.open_price,p.close_price_avg,p.volume_max,p.sl_initial,p.risk_money,p.risk_pct,p.net,p.profit,p.commission,p.swap,p.fee,p.spread_cost,p.slippage_points,p.spread_entry,a.name AS acc_name,a.login AS acc_login,a.currency,a.platform FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE p.id=? AND a.user_id=?').bind(ref.id,userId).first<Record<string,unknown>>();
 if(!p)return null;
 const side:Side=p.side==='sell'?'sell':'buy',openTs=Number(p.open_ts),closed=p.status==='closed',net=closed?Number(p.net):null,firstStop=num(p.risk_money);
 const orig=originalRisk({planned:meta.plannedRisk,firstStop}),r=closed?rMultiple(net,orig):null;
 const t212=p.platform==='t212',spreadCost=num(p.spread_cost);
 const costs=mergeCosts({commission:num(p.commission),swap:num(p.swap),fee:num(p.fee),spread:t212&&spreadCost!==null?-Math.abs(spreadCost):null,slippage:null},manualCosts);
 const reasons=new Map(manualChanges.filter(c=>c.source==='mt').map(c=>[c.kind+'|'+Number(c.ts),c.reason||'']));
 const mtChanges:ChangeView[]=(await d.prepare("SELECT ts,kind,old_value,new_value FROM mt_position_changes WHERE position_id=? AND kind IN ('sl','tp') ORDER BY ts,id").bind(ref.id).all<{ts:number;kind:string;old_value:number|null;new_value:number|null}>()).results.map(c=>({id:null,ts:Number(c.ts),kind:c.kind==='tp'?'tp':'sl',old:num(c.old_value),new:num(c.new_value),reason:reasons.get(c.kind+'|'+Number(c.ts))??'',source:'mt'}));
 const changes=[...mtChanges,...manualOnly].sort((a,b)=>a.ts-b.ts);
 // upozornění: posun stopu ze záznamu změn, větší pozice po ztrátě (předchozí uzavřený obchod účtu)
 const warnings:Warning[]=stopWidening(tid,side,changes.map(c=>({ts:c.ts,kind:c.kind,old:c.old,new:c.new})));
 const prev=await d.prepare("SELECT id,open_ts,close_ts,net,risk_pct,volume_max,symbol FROM mt_positions WHERE account_id=? AND status='closed' AND close_ts<=? AND id<>? ORDER BY close_ts DESC LIMIT 1").bind(p.account_id,openTs,ref.id).first<Record<string,unknown>>();
 if(prev)warnings.push(...sizeAfterLoss([{id:'mt:'+prev.id,accountId:String(p.account_id),openTs:Number(prev.open_ts),closeTs:num(prev.close_ts),net:num(prev.net),riskPct:num(prev.risk_pct),volume:num(prev.volume_max),symbol:String(prev.symbol)},{id:tid,accountId:String(p.account_id),openTs,closeTs:num(p.close_ts),net,riskPct:num(p.risk_pct),volume:num(p.volume_max),symbol:String(p.symbol)}]).filter(w=>w.tradeId===tid));
 // no-trade okna: verze strategie z plánu obchodu + účet + všechny účty
 const ws:NewsWindow[]=[];
 if(planRow?.versionId){const w=(await versionWindows(d,userId,[planRow.versionId])).get(planRow.versionId);if(w)ws.push(w)}
 const acc=String(p.acc_name||'')||'••••'+String(p.acc_login).slice(-4);
 for(const l of await limitRows(d,userId))if(l.scope==='all'||(l.scope==='account'&&l.scopeId===p.account_id)){const w=makeWindow(l.limits.newsBefore,l.limits.newsAfter,l.limits.newsMinImpact,l.scope==='all'?'Všechny účty':'Účet '+acc);if(w)ws.push(w)}
 const coll=ws.length?collisions({from:openTs,to:openTs},currenciesOf(String(p.symbol)),events(),ws):[];
 const ideaId=(await ideaMap(d,userId))[tid]??null;
 return {tradeId:tid,source:'mt',mode:meta.mode,plannedRisk:meta.plannedRisk,plannedRiskPct:meta.plannedRiskPct,executedRisk:firstStop,executedRiskPct:num(p.risk_pct),originalRisk:orig,riskBasis:meta.plannedRisk&&meta.plannedRisk>0?'plan':firstStop?'first_stop':null,r,rLabel:closed&&r===null?UNKNOWN_R:'',
  be:closed?breakEven({side,entry:Number(p.open_price),exit:num(p.close_price_avg),net,risk:orig}):{kind:null,label:null,net:null},net,gross:net===null?null:grossOf(net,costs),currency:String(p.currency||''),costs,costLines:costLines(costs),manualCosts,slippagePoints:num(p.slippage_points),spreadPoints:num(p.spread_entry),changes,warnings,collisions:coll,process,plan,ideaId,account:acc,platform:String(p.platform||'')||null,files:[]};
}
const optNum=(v:unknown,label:string,min:number,max:number):number|null=>{if(v===null||v===undefined||v==='')return null;const n=typeof v==='string'?Number(v.replace(',','.').replace(/\s/g,'')):Number(v);if(!Number.isFinite(n)||n<min||n>max)throw Error(`${label}: zadej číslo ${min}–${max}.`);return n};
/** Uloží režim, plánované riziko, náklady a hodnocení procesu (chybějící pole se nemění). Vlastnictví ověří volající. */
export async function saveRecord(d:Db,userId:string,ref:TradeRef,raw:unknown):Promise<void>{
 const o=(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}) as Record<string,unknown>,tid=tradeKey(ref),now=nowSql();
 try{
  if('mode' in o||'plannedRisk' in o||'plannedRiskPct' in o){
   const cur=(await loadMeta(d,userId)).get(tid)??{mode:'live' as Mode,plannedRisk:null,plannedRiskPct:null};
   if('mode' in o&&!isMode(o.mode))throw Error('Režim musí být živě, simulace nebo replay.');
   const mode='mode' in o?o.mode as Mode:cur.mode,pr='plannedRisk' in o?optNum(o.plannedRisk,'Plánované riziko',0.01,1e9):cur.plannedRisk,pp='plannedRiskPct' in o?optNum(o.plannedRiskPct,'Plánované riziko %',0.01,100):cur.plannedRiskPct;
   await d.prepare('INSERT INTO trade_meta(user_id,trade_id,mode,planned_risk,planned_risk_pct,updated) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE mode=VALUES(mode),planned_risk=VALUES(planned_risk),planned_risk_pct=VALUES(planned_risk_pct),updated=VALUES(updated)').bind(userId,tid,mode,pr,pp,now).run();
  }
  if('costs' in o){
   const c=parseCosts(o.costs);if(typeof c==='string')throw Error(c);
   const cur=await d.prepare('SELECT spread,commission,swap,slippage,fee FROM trade_costs WHERE user_id=? AND trade_id=?').bind(userId,tid).first<Record<string,number|null>>();
   const m={...emptyCosts(),...(cur?Object.fromEntries(Object.entries(cur).map(([k,v])=>[k,num(v)])):{}),...c} as Costs;
   if(Object.values(m).every(v=>v===null))await d.prepare('DELETE FROM trade_costs WHERE user_id=? AND trade_id=?').bind(userId,tid).run();
   else await d.prepare('INSERT INTO trade_costs(user_id,trade_id,spread,commission,swap,slippage,fee,updated) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE spread=VALUES(spread),commission=VALUES(commission),swap=VALUES(swap),slippage=VALUES(slippage),fee=VALUES(fee),updated=VALUES(updated)').bind(userId,tid,m.spread,m.commission,m.swap,m.slippage,m.fee,now).run();
  }
  if('process' in o){
   const p=parseProcess(o.process);if(typeof p==='string')throw Error(p);
   const done=processComplete(p.answers);
   await d.prepare('INSERT INTO trade_process(user_id,trade_id,answers,rating,done_at,updated) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE answers=VALUES(answers),rating=VALUES(rating),done_at=IF(VALUES(done_at) IS NULL,NULL,COALESCE(done_at,VALUES(done_at))),updated=VALUES(updated)').bind(userId,tid,JSON.stringify(p.answers),p.rating,done?now:null,now).run();
  }
 }catch(e){throw prep(e)}
}
/** Záznam změny SL/TP: ruční (nový řádek) nebo důvod ke změně z EA (párování čas + druh). */
export async function addChange(d:Db,userId:string,ref:TradeRef,raw:unknown):Promise<void>{
 const o=(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}) as Record<string,unknown>,tid=tradeKey(ref);
 if(o.changeId!==undefined){
  const id=Number(o.changeId),reason=typeof o.reason==='string'?o.reason.trim():'';if(reason.length>300)throw Error('Důvod může mít nejvýš 300 znaků.');
  if(!Number.isInteger(id)||id<1)throw Error('Změna nenalezena.');
  const r=await d.prepare("UPDATE trade_changes SET reason=? WHERE id=? AND user_id=? AND trade_id=? AND source='manual'").bind(reason||null,id,userId,tid).run().catch(e=>{throw prep(e)});
  if(!r.meta.changes&&!await d.prepare('SELECT id FROM trade_changes WHERE id=? AND user_id=? AND trade_id=?').bind(id,userId,tid).first())throw Error('Změna nenalezena.');
  return;
 }
 const kind=o.kind==='tp'?'tp':o.kind==='sl'?'sl':null;if(!kind)throw Error('Vyber SL nebo TP.');
 const ts=typeof o.ts==='number'?o.ts:Date.parse(String(o.ts||''));if(!Number.isFinite(ts)||ts<Date.UTC(2000,0,1)||ts>Date.now()+864e5)throw Error('Neplatný čas změny.');
 const reason=typeof o.reason==='string'?o.reason.trim():'';if(reason.length>300)throw Error('Důvod může mít nejvýš 300 znaků.');
 try{
  if(o.source==='mt'){
   if(ref.kind!=='mt')throw Error('Změna z MetaTraderu nenalezena.');
   const c=await d.prepare('SELECT old_value,new_value FROM mt_position_changes WHERE position_id=? AND kind=? AND ts=? LIMIT 1').bind(ref.id,kind,ts).first<{old_value:number|null;new_value:number|null}>();
   if(!c)throw Error('Změna z MetaTraderu nenalezena.');
   await d.prepare("INSERT INTO trade_changes(user_id,trade_id,ts,kind,old_value,new_value,reason,source,created) VALUES(?,?,?,?,?,?,?,'mt',?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)").bind(userId,tid,ts,kind,num(c.old_value),num(c.new_value),reason||null,nowSql()).run();
   return;
  }
  const c=await d.prepare("SELECT COUNT(*) AS n FROM trade_changes WHERE user_id=? AND trade_id=?").bind(userId,tid).first<{n:number}>();if(Number(c?.n||0)>=100)throw Error('K obchodu jde zapsat nejvýš 100 změn.');
  const old=optNum(o.old,'Původní hodnota',0,1e12),nw=optNum(o.new,'Nová hodnota',0,1e12);
  if(old===null&&nw===null)throw Error('Zadej původní nebo novou hodnotu.');
  await d.prepare("INSERT INTO trade_changes(user_id,trade_id,ts,kind,old_value,new_value,reason,source,created) VALUES(?,?,?,?,?,?,?,'manual',?)").bind(userId,tid,ts,kind,old,nw,reason||null,nowSql()).run();
 }catch(e){throw prep(e)}
}
export async function deleteChange(d:Db,userId:string,ref:TradeRef,id:number):Promise<boolean>{
 if(!Number.isInteger(id)||id<1)return false;
 return (await d.prepare("DELETE FROM trade_changes WHERE id=? AND user_id=? AND trade_id=? AND source='manual'").bind(id,userId,tradeKey(ref)).run().catch(e=>{throw prep(e)})).meta.changes>0;
}
// ---------- limity seance
export type LimitRow={scope:Scope;scopeId:string;limits:SessionLimits};
export async function limitRows(d:Db,userId:string):Promise<LimitRow[]>{
 const rows=await soft(async()=>(await d.prepare('SELECT scope,scope_id,max_trades,max_losses,max_decisions,end_time,pause_after_sl,review_after_sl,news_before,news_after,news_min_impact FROM session_limits WHERE user_id=? ORDER BY scope,scope_id').bind(userId).all<Record<string,unknown>>()).results,[] as Record<string,unknown>[]);
 return rows.map(r=>({scope:(r.scope==='account'||r.scope==='strategy'?r.scope:'all') as Scope,scopeId:String(r.scope_id||''),limits:{maxTrades:num(r.max_trades),maxLosses:num(r.max_losses),maxDecisions:num(r.max_decisions),endTime:r.end_time?String(r.end_time):null,pauseAfterSl:num(r.pause_after_sl),reviewAfterSl:num(r.review_after_sl),newsBefore:num(r.news_before),newsAfter:num(r.news_after),newsMinImpact:Number(r.news_min_impact)===2?2:3}}));
}
async function checkScope(d:Db,userId:string,scope:unknown,scopeId:unknown):Promise<{scope:Scope;scopeId:string}>{
 if(scope==='all')return {scope,scopeId:''};
 if(typeof scopeId!=='string'||!scopeId)throw Error('Vyber účet nebo strategii.');
 if(scope==='account'&&await d.prepare('SELECT id FROM mt_accounts WHERE id=? AND user_id=?').bind(scopeId,userId).first())return {scope,scopeId};
 if(scope==='strategy'&&await d.prepare('SELECT id FROM strategies WHERE id=? AND user_id=?').bind(scopeId,userId).first())return {scope,scopeId};
 throw Error('Účet nebo strategie nenalezena.');
}
export async function saveLimits(d:Db,userId:string,raw:unknown):Promise<void>{
 const o=(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}) as Record<string,unknown>,s=await checkScope(d,userId,o.scope,o.scopeId);
 const l=parseLimits(o.limits);if(typeof l==='string')throw Error(l);
 try{await d.prepare('INSERT INTO session_limits(user_id,scope,scope_id,max_trades,max_losses,max_decisions,end_time,pause_after_sl,review_after_sl,news_before,news_after,news_min_impact,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE max_trades=VALUES(max_trades),max_losses=VALUES(max_losses),max_decisions=VALUES(max_decisions),end_time=VALUES(end_time),pause_after_sl=VALUES(pause_after_sl),review_after_sl=VALUES(review_after_sl),news_before=VALUES(news_before),news_after=VALUES(news_after),news_min_impact=VALUES(news_min_impact),updated=VALUES(updated)')
  .bind(userId,s.scope,s.scopeId,l.maxTrades,l.maxLosses,l.maxDecisions,l.endTime,l.pauseAfterSl,l.reviewAfterSl,l.newsBefore,l.newsAfter,l.newsMinImpact,nowSql()).run()}catch(e){throw prep(e)}
}
export async function deleteLimits(d:Db,userId:string,scope:unknown,scopeId:unknown):Promise<boolean>{
 const s=scope==='all'?{scope:'all',scopeId:''}:{scope:String(scope),scopeId:String(scopeId||'')};
 return (await d.prepare('DELETE FROM session_limits WHERE user_id=? AND scope=? AND scope_id=?').bind(userId,s.scope,s.scopeId).run().catch(e=>{throw prep(e)})).meta.changes>0;
}
export async function addSessionReview(d:Db,userId:string,raw:unknown):Promise<void>{
 const o=(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}) as Record<string,unknown>,s=await checkScope(d,userId,o.scope,o.scopeId);
 const note=typeof o.note==='string'?o.note.trim():'';if(note.length<10)throw Error('Napiš aspoň krátce, co z review plyne (min. 10 znaků).');if(note.length>1000)throw Error('Review může mít nejvýš 1000 znaků.');
 try{await d.prepare('INSERT INTO session_reviews(user_id,scope,scope_id,note,at) VALUES(?,?,?,?,?)').bind(userId,s.scope,s.scopeId,note,nowSql()).run()}catch(e){throw prep(e)}
}
export type SessionView={scope:Scope;scopeId:string;name:string;limits:SessionLimits;state:keyof typeof SESSION_STATES;reasons:string[];counts:{trades:number;losses:number;decisions:number;streakToday:number;streak:number};open:number;reviewedAt:number|null};
/** Stav seance pro každý nastavený limit (a vždy „všechny účty“), dnešní upozornění; porušení limitů zapíše do disciplíny (trade_violations, bez nutnosti zdůvodnění). */
export async function sessionOverview(d:Db,userId:string,now=Date.now(),record=true):Promise<{sessions:SessionView[];warnings:Warning[];accounts:{id:string;name:string}[];strategies:{id:string;name:string}[]}>{
 const pos=await positions(d,userId),rows=await limitRows(d,userId),dayStart=pragueDayStart(pragueDate(now)),from=now-30*864e5;
 const accounts=[...new Map(pos.map(p=>[p.account_id,p.acc_name||'••••'+String(p.acc_login).slice(-4)])).entries()].map(([id,name])=>({id,name}));
 for(const a of (await d.prepare('SELECT id,name,login FROM mt_accounts WHERE user_id=?').bind(userId).all<{id:string;name:string;login:string}>()).results)if(!accounts.some(x=>x.id===a.id))accounts.push({id:a.id,name:a.name||'••••'+String(a.login).slice(-4)});
 const strategies=(await d.prepare('SELECT id,name FROM strategies WHERE user_id=? AND archived=0 ORDER BY name').bind(userId).all<{id:string;name:string}>()).results;
 const plans=await soft(async()=>(await d.prepare('SELECT trade_id,strategy_id FROM trade_plans WHERE user_id=? AND strategy_id IS NOT NULL').bind(userId).all<{trade_id:string;strategy_id:string}>()).results,[] as {trade_id:string;strategy_id:string}[]);
 const noTrades=await soft(async()=>(await d.prepare('SELECT at,strategy_id FROM no_trades WHERE user_id=? AND at>=?').bind(userId,new Date(dayStart).toISOString().slice(0,19).replace('T',' ')).all<{at:string;strategy_id:string|null}>()).results,[] as {at:string;strategy_id:string|null}[]);
 const reviews=await soft(async()=>(await d.prepare('SELECT scope,scope_id,at FROM session_reviews WHERE user_id=? ORDER BY at').bind(userId).all<{scope:string;scope_id:string;at:string}>()).results,[] as {scope:string;scope_id:string;at:string}[]);
 const recent=pos.filter(p=>(p.close_ts??now)>=from||p.status==='open');
 const toS=(p:PosLite):STrade=>({id:'mt:'+p.id,openTs:p.open_ts,closeTs:p.close_ts,net:p.status==='closed'?p.net:null});
 const scoped=(scope:Scope,id:string)=>scope==='all'?recent:scope==='account'?recent.filter(p=>p.account_id===id):recent.filter(p=>plans.some(x=>x.trade_id==='mt:'+p.id&&x.strategy_id===id));
 const list=[...rows];if(!list.some(r=>r.scope==='all'))list.unshift({scope:'all',scopeId:'',limits:emptyLimits()});
 const sessions:SessionView[]=[],viol:{tradeId:string;rule:string;detail:Record<string,unknown>}[]=[];
 for(const l of list){
  const ts=scoped(l.scope,l.scopeId).map(toS),rev=reviews.filter(r=>r.scope===l.scope&&r.scope_id===l.scopeId).map(r=>msOf(r.at)).filter((x):x is number=>x!==null);
  const decisions=ts.filter(t=>t.openTs>=dayStart).length+(l.scope==='account'?0:noTrades.filter(n=>l.scope==='all'||n.strategy_id===l.scopeId).length);
  const st=sessionState({limits:l.limits,trades:ts,decisions,now,reviewedAt:rev.length?rev[rev.length-1]:null,dayStart});
  sessions.push({scope:l.scope,scopeId:l.scopeId,name:l.scope==='all'?'Všechny účty':l.scope==='account'?accounts.find(a=>a.id===l.scopeId)?.name||'Účet':strategies.find(s=>s.id===l.scopeId)?.name||'Strategie',limits:l.limits,...st,reviewedAt:rev.length?rev[rev.length-1]:null});
  if(record)for(const v of sessionViolations(l.limits,ts.filter(t=>t.openTs>=from),{reviews:rev}))viol.push(v);
 }
 if(record&&viol.length){const c=new Date().toISOString().slice(0,19).replace('T',' ');for(const part of chunks(viol,100))await d.prepare('INSERT IGNORE INTO trade_violations(user_id,trade_id,rule,detail,needs_reason,created) VALUES '+part.map(()=>'(?,?,?,?,0,?)').join(',')).bind(...part.flatMap(v=>[userId,v.tradeId,v.rule,JSON.stringify(v.detail),c])).run().catch(e=>console.error('session violations',e))}
 // dnešní upozornění: větší pozice po ztrátě a posun stopu
 const today=recent.filter(p=>p.open_ts>=dayStart),warnings:Warning[]=[];
 const sized=sizeAfterLoss(recent.map(p=>({id:'mt:'+p.id,accountId:p.account_id,openTs:p.open_ts,closeTs:p.close_ts,net:p.status==='closed'?p.net:null,riskPct:p.risk_pct,volume:p.volume_max,symbol:p.symbol})));
 warnings.push(...sized.filter(w=>today.some(p=>'mt:'+p.id===w.tradeId)));
 if(today.length){const ch=new Map<string,{ts:number;kind:string;old:number|null;new:number|null}[]>();
  for(const c of chunks(today.map(p=>p.id)))for(const r of (await d.prepare(`SELECT position_id,ts,kind,old_value,new_value FROM mt_position_changes WHERE kind='sl' AND position_id IN (${c.map(()=>'?').join(',')}) ORDER BY ts,id`).bind(...c).all<{position_id:string;ts:number;kind:string;old_value:number|null;new_value:number|null}>()).results)(ch.get(r.position_id)??ch.set(r.position_id,[]).get(r.position_id)!).push({ts:Number(r.ts),kind:r.kind,old:num(r.old_value),new:num(r.new_value)});
  for(const p of today)warnings.push(...stopWidening('mt:'+p.id,p.side==='sell'?'sell':'buy',ch.get(p.id)||[]));
 }
 return {sessions,warnings,accounts,strategies};
}
