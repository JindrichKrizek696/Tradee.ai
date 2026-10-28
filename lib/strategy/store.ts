// DB vrstva strategií s verzemi, scénářů, vynechaných obchodů, stavu dne a plánu u obchodu.
// Každý dotaz je omezený na user_id přihlášeného (kontrola izolace: scripts/check-strategy-versions.mjs).
import type {Db} from '../mysql.ts';
import {emptyContent,parseContent,validateContent,planSave,buildSnapshot,parseSnapshot,validateOrigin,legacyChecklistContent,legacyStrategyName,legacyVersionId,LEGACY_V1_NOTE,LIMITS,type Content,type Origin,type PlanSnapshot} from './core.ts';
import {validateScenario,validateNoTrade,moveStatus,effectiveStatus,isStatus,suggestScenarios,OPEN_STATUSES,SC_LIMITS,emptyLevels,type Status,type Bias,type Levels,type ScenarioFields,type SkipReason,type DayStatus} from './scenario.ts';
const uid=(p:string)=>p+'_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
export const sqlTime=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const msOf=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):null;
const parseJson=<T>(s:unknown,fb:T):T=>{try{return s?JSON.parse(String(s)) as T:fb}catch{return fb}};

// ---------- převod starých dat (idempotentní, volá se při načtení strategií)
export async function ensureMigrated(d:Db,userId:string,marketIds?:readonly string[],now=Date.now()){
 const t=sqlTime(now);
 // strategie bez verze (i založené starým API, např. z hodnocení obchodu) → prázdná verze 1
 await d.prepare("INSERT IGNORE INTO strategy_versions(id,strategy_id,user_id,version,content,changelog,created,updated) SELECT CONCAT('v1_',s.id),s.id,s.user_id,1,?,?,?,? FROM strategies s WHERE s.user_id=? AND NOT EXISTS(SELECT 1 FROM strategy_versions v WHERE v.strategy_id=s.id)").bind(JSON.stringify(emptyContent()),LEGACY_V1_NOTE,t,t,userId).run();
 const pend=(await d.prepare('SELECT id,name,items,markets FROM checklists WHERE user_id=? AND migrate_pending=1 ORDER BY sort,created,id').bind(userId).all<{id:string;name:string;items:string;markets:string}>()).results;
 if(!pend.length)return 0;
 const taken=(await d.prepare('SELECT name FROM strategies WHERE user_id=?').bind(userId).all<{name:string}>()).results.map(r=>r.name);
 let n=0;
 for(const c of pend){
  const sid=uid('str');
  // nejdřív si checklist „zabrat“ – souběžný požadavek ho podruhé nepřevede
  if(!(await d.prepare('UPDATE checklists SET migrate_pending=0,strategy_id=? WHERE id=? AND user_id=? AND migrate_pending=1').bind(sid,c.id,userId).run()).meta.changes)continue;
  const name=legacyStrategyName(c.name,taken);taken.push(name);
  const content=legacyChecklistContent({name:c.name,items:parseJson(c.items,[] as {id:string;text:string}[]),markets:parseJson(c.markets,[] as string[])},marketIds);
  await d.prepare("INSERT INTO strategies(id,user_id,name,archived,created,origin,legacy_checklist_id) VALUES(?,?,?,0,?,'own',?)").bind(sid,userId,name,t,c.id).run();
  await d.prepare('INSERT IGNORE INTO strategy_versions(id,strategy_id,user_id,version,content,changelog,created,updated) VALUES(?,?,?,1,?,?,?,?)').bind(legacyVersionId(sid),sid,userId,JSON.stringify(content),`Verze 1 převedená z checklistu „${c.name}“`.slice(0,300),t,t).run();
  n++;
 }
 return n;
}

// ---------- strategie a verze
export type StrategyFull={id:string;name:string;archived:boolean;origin:Origin;mentor:string|null;fromChecklist:boolean;latest:{id:string;version:number;changelog:string|null;created:number;updated:number;content?:Content}|null};
export async function listStrategiesFull(d:Db,userId:string,withContent=false):Promise<StrategyFull[]>{
 const rows=(await d.prepare(`SELECT s.id,s.name,s.archived,s.origin,s.mentor,s.legacy_checklist_id,v.id AS vid,v.version,v.changelog,v.created AS vcreated,v.updated AS vupdated${withContent?',v.content':''} FROM strategies s LEFT JOIN strategy_versions v ON v.strategy_id=s.id AND v.user_id=s.user_id AND v.version=(SELECT MAX(x.version) FROM strategy_versions x WHERE x.strategy_id=s.id AND x.user_id=s.user_id) WHERE s.user_id=? ORDER BY s.archived,s.name,s.id`).bind(userId).all<Record<string,unknown>>()).results;
 return rows.map(r=>({id:String(r.id),name:String(r.name),archived:!!Number(r.archived),origin:(r.origin==='mentor'||r.origin==='example'?r.origin:'own') as Origin,mentor:r.mentor?String(r.mentor):null,fromChecklist:!!r.legacy_checklist_id,
  latest:r.vid?{id:String(r.vid),version:Number(r.version),changelog:r.changelog?String(r.changelog):null,created:msOf(r.vcreated)??0,updated:msOf(r.vupdated)??0,...(withContent?{content:parseContent(r.content)}:{})}:null}));
}
export async function setStrategyOrigin(d:Db,userId:string,id:string,origin:unknown,mentor:unknown){
 const v=validateOrigin(origin,mentor);if(typeof v==='string')throw Error(v);
 return (await d.prepare('UPDATE strategies SET origin=?,mentor=? WHERE id=? AND user_id=?').bind(v.origin,v.mentor,id,userId).run()).meta.changes>0||!!await d.prepare('SELECT id FROM strategies WHERE id=? AND user_id=?').bind(id,userId).first();
}
export async function versionUsage(d:Db,userId:string,strategyId:string):Promise<Map<string,{trades:number;scenarios:number;skips:number}>>{
 const m=new Map<string,{trades:number;scenarios:number;skips:number}>(),get=(id:string)=>m.get(id)??m.set(id,{trades:0,scenarios:0,skips:0}).get(id)!;
 for(const [tbl,k] of [['trade_plans','trades'],['scenarios','scenarios'],['no_trades','skips']] as const)
  for(const r of (await d.prepare(`SELECT version_id,COUNT(*) AS n FROM ${tbl} WHERE user_id=? AND strategy_id=? AND version_id IS NOT NULL GROUP BY version_id`).bind(userId,strategyId).all<{version_id:string;n:number}>()).results)get(r.version_id)[k]=Number(r.n);
 return m;
}
export async function isVersionUsed(d:Db,userId:string,versionId:string){
 const r=await d.prepare('SELECT (EXISTS(SELECT 1 FROM trade_plans WHERE user_id=? AND version_id=?) OR EXISTS(SELECT 1 FROM scenarios WHERE user_id=? AND version_id=?) OR EXISTS(SELECT 1 FROM no_trades WHERE user_id=? AND version_id=?)) AS used').bind(userId,versionId,userId,versionId,userId,versionId).first<{used:number}>();
 return !!Number(r?.used);
}
export type VersionRow={id:string;strategyId:string;version:number;content:Content;changelog:string|null;created:number;updated:number};
const toVersion=(r:Record<string,unknown>):VersionRow=>({id:String(r.id),strategyId:String(r.strategy_id),version:Number(r.version),content:parseContent(r.content),changelog:r.changelog?String(r.changelog):null,created:msOf(r.created)??0,updated:msOf(r.updated)??0});
export async function listVersions(d:Db,userId:string,strategyId:string){
 const rows=(await d.prepare('SELECT id,strategy_id,version,content,changelog,created,updated FROM strategy_versions WHERE user_id=? AND strategy_id=? ORDER BY version DESC').bind(userId,strategyId).all<Record<string,unknown>>()).results.map(toVersion);
 const use=await versionUsage(d,userId,strategyId);
 return rows.map(v=>{const u=use.get(v.id)??{trades:0,scenarios:0,skips:0};return {...v,usage:u,locked:u.trades+u.scenarios+u.skips>0}});
}
export async function getVersion(d:Db,userId:string,versionId:string):Promise<(VersionRow&{strategyName:string})|null>{
 const r=await d.prepare('SELECT v.id,v.strategy_id,v.version,v.content,v.changelog,v.created,v.updated,s.name FROM strategy_versions v JOIN strategies s ON s.id=v.strategy_id AND s.user_id=v.user_id WHERE v.id=? AND v.user_id=?').bind(versionId,userId).first<Record<string,unknown>>();
 return r?{...toVersion(r),strategyName:String(r.name)}:null;
}
export async function latestVersion(d:Db,userId:string,strategyId:string):Promise<(VersionRow&{strategyName:string})|null>{
 const r=await d.prepare('SELECT v.id,v.strategy_id,v.version,v.content,v.changelog,v.created,v.updated,s.name FROM strategy_versions v JOIN strategies s ON s.id=v.strategy_id AND s.user_id=v.user_id WHERE v.strategy_id=? AND v.user_id=? ORDER BY v.version DESC LIMIT 1').bind(strategyId,userId).first<Record<string,unknown>>();
 return r?{...toVersion(r),strategyName:String(r.name)}:null;
}
// Uložení obsahu: nepoužitou poslední verzi přepíše, použitou nechá být a založí další (s popisem změny)
export async function saveVersion(d:Db,userId:string,strategyId:string,raw:unknown,changelog:unknown,marketIds:readonly string[],now=Date.now()){
 if(!await d.prepare('SELECT id FROM strategies WHERE id=? AND user_id=?').bind(strategyId,userId).first())return null;
 const content=validateContent(raw,marketIds);if(typeof content==='string')throw Error(content);
 const note=typeof changelog==='string'?changelog.trim():'';
 const latest=await latestVersion(d,userId,strategyId),used=latest?await isVersionUsed(d,userId,latest.id):false;
 const plan=planSave(latest?{version:latest.version,used,content:latest.content}:null,content,note);
 if('error' in plan)throw Error(plan.error);
 const t=sqlTime(now);
 if(plan.action==='none')return {action:'none' as const,versionId:latest!.id,version:latest!.version};
 if(plan.action==='update'){
  // podmínka na neměnnost: mezitím mohla verzi použít jiná akce – pak se nic nepřepíše a uživatel dostane chybu
  const vid=latest!.id,r=await d.prepare('UPDATE strategy_versions SET content=?,changelog=COALESCE(?,changelog),updated=? WHERE id=? AND user_id=? AND NOT EXISTS(SELECT 1 FROM trade_plans WHERE user_id=? AND version_id=?) AND NOT EXISTS(SELECT 1 FROM scenarios WHERE user_id=? AND version_id=?) AND NOT EXISTS(SELECT 1 FROM no_trades WHERE user_id=? AND version_id=?)').bind(JSON.stringify(content),note||null,t,vid,userId,userId,vid,userId,vid,userId,vid).run();
  if(!r.meta.changes)throw Error('Verzi mezitím použil obchod nebo scénář. Ulož znovu – vznikne nová verze.');
  return {action:'update' as const,versionId:latest!.id,version:latest!.version};
 }
 const c=await d.prepare('SELECT COUNT(*) AS n FROM strategy_versions WHERE user_id=? AND strategy_id=?').bind(userId,strategyId).first<{n:number}>();
 if(Number(c?.n||0)>=LIMITS.versions)throw Error(`Strategie může mít nejvýš ${LIMITS.versions} verzí.`);
 const id=plan.version===1?legacyVersionId(strategyId):uid('stv');
 const r=await d.prepare('INSERT IGNORE INTO strategy_versions(id,strategy_id,user_id,version,content,changelog,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind(id,strategyId,userId,plan.version,JSON.stringify(content),note||null,t,t).run();
 if(!r.meta.changes)throw Error('Strategii mezitím upravilo jiné okno. Načti ji znovu.');
 return {action:'create' as const,versionId:id,version:plan.version};
}

// ---------- scénáře
export type Scenario={id:string;instrument:string;bias:Bias;hypothesis:string;strategyId:string|null;versionId:string|null;version:number|null;strategyName:string|null;model:string|null;levels:Levels;validUntil:number|null;reviewAt:number|null;status:Status;snapshot:PlanSnapshot|null;note:string;chartUrl:string|null;fileId:string|null;alertId:string|null;closedAt:number|null;created:number;updated:number;trades:number};
const SC_COLS='c.id,c.instrument,c.bias,c.hypothesis,c.strategy_id,c.version_id,c.model,c.levels,c.valid_until,c.review_at,c.status,c.snapshot,c.note,c.chart_url,c.file_id,c.alert_id,c.closed_at,c.created,c.updated,v.version,s.name AS sname,(SELECT COUNT(*) FROM trade_plans p WHERE p.user_id=c.user_id AND p.scenario_id=c.id) AS trades';
const SC_FROM='FROM scenarios c LEFT JOIN strategy_versions v ON v.id=c.version_id AND v.user_id=c.user_id LEFT JOIN strategies s ON s.id=c.strategy_id AND s.user_id=c.user_id';
const toScenario=(r:Record<string,unknown>):Scenario=>({id:String(r.id),instrument:String(r.instrument),bias:(r.bias==='long'||r.bias==='short'?r.bias:'both') as Bias,hypothesis:String(r.hypothesis||''),strategyId:r.strategy_id?String(r.strategy_id):null,versionId:r.version_id?String(r.version_id):null,version:r.version===null||r.version===undefined?null:Number(r.version),strategyName:r.sname?String(r.sname):null,model:r.model?String(r.model):null,levels:{...emptyLevels(),...parseJson(r.levels,{})},validUntil:msOf(r.valid_until),reviewAt:msOf(r.review_at),status:isStatus(r.status)?r.status:'waiting',snapshot:parseSnapshot(r.snapshot),note:String(r.note||''),chartUrl:r.chart_url?String(r.chart_url):null,fileId:r.file_id?String(r.file_id):null,alertId:r.alert_id?String(r.alert_id):null,closedAt:msOf(r.closed_at),created:msOf(r.created)??0,updated:msOf(r.updated)??0,trades:Number(r.trades||0)});
// otevřené scénáře po platnosti se zapíšou jako vypršelé
export async function expireScenarios(d:Db,userId:string,now=Date.now()){
 const t=sqlTime(now);
 await d.prepare("UPDATE scenarios SET status='expired',closed_at=?,updated=? WHERE user_id=? AND status IN ('waiting','active') AND valid_until IS NOT NULL AND valid_until<=?").bind(t,t,userId,t).run();
}
export async function listScenarios(d:Db,userId:string,o:{scope?:'open'|'closed'|'all';instrument?:string|null;limit?:number}={},now=Date.now()):Promise<Scenario[]>{
 await expireScenarios(d,userId,now);
 const where=['c.user_id=?'],args:unknown[]=[userId];
 if(o.scope==='open')where.push("c.status IN ('waiting','active')");else if(o.scope==='closed')where.push("c.status NOT IN ('waiting','active')");
 if(o.instrument){where.push('c.instrument=?');args.push(o.instrument)}
 const lim=Math.max(1,Math.min(500,o.limit??200));
 return (await d.prepare(`SELECT ${SC_COLS} ${SC_FROM} WHERE ${where.join(' AND ')} ORDER BY c.status IN ('waiting','active') DESC,c.updated DESC LIMIT ${lim}`).bind(...args).all<Record<string,unknown>>()).results.map(toScenario);
}
export async function getScenario(d:Db,userId:string,id:string){
 const r=await d.prepare(`SELECT ${SC_COLS} ${SC_FROM} WHERE c.id=? AND c.user_id=?`).bind(id,userId).first<Record<string,unknown>>();
 return r?toScenario(r):null;
}
// strategie + verze (výchozí = poslední) + model a snímek checklistu; vše ověřené proti uživateli
async function resolvePlan(d:Db,userId:string,strategyId:string|null,versionId:string|null,model:string|null,checklist:unknown,now:number):Promise<{strategyId:string|null;versionId:string|null;model:string|null;snapshot:PlanSnapshot|null}>{
 if(!strategyId)return {strategyId:null,versionId:null,model:null,snapshot:null};
 const ver=versionId?await getVersion(d,userId,versionId):await latestVersion(d,userId,strategyId);
 if(!ver||ver.strategyId!==strategyId)throw Error('Strategie nebo její verze nenalezena.');
 const ck=(checklist&&typeof checklist==='object'?checklist:{}) as {states?:unknown;chartUrl?:unknown;fileId?:unknown;note?:unknown};
 const snap=buildSnapshot({id:strategyId,name:ver.strategyName},ver,model,ck.states,ck,now);
 if(typeof snap==='string')throw Error(snap);
 return {strategyId,versionId:ver.id,model:snap.model,snapshot:snap};
}
async function ownAlert(d:Db,userId:string,alertId:string|null){if(alertId&&!await d.prepare('SELECT id FROM price_alerts WHERE id=? AND user_id=?').bind(alertId,userId).first())throw Error('Alert nenalezen.')}
export async function createScenario(d:Db,userId:string,raw:unknown,ids:readonly string[],now=Date.now()){
 const v=validateScenario(raw,ids,now) as ScenarioFields|string;if(typeof v==='string')throw Error(v);
 const c=await d.prepare("SELECT COUNT(*) AS n,SUM(status IN ('waiting','active')) AS o FROM scenarios WHERE user_id=?").bind(userId).first<{n:number;o:number|null}>();
 if(Number(c?.o||0)>=SC_LIMITS.open)throw Error(`Nejvýš ${SC_LIMITS.open} otevřených scénářů. Uzavři nebo smaž staré.`);
 if(Number(c?.n||0)>=SC_LIMITS.total)throw Error(`Nejvýš ${SC_LIMITS.total} scénářů celkem.`);
 await ownAlert(d,userId,v.alertId);
 const p=await resolvePlan(d,userId,v.strategyId,v.versionId,v.model,(raw as {checklist?:unknown}).checklist,now);
 const id=uid('scn'),t=sqlTime(now),fileId=await ownFileId(d,userId,(raw as {fileId?:unknown}).fileId);
 await d.prepare('INSERT INTO scenarios(id,user_id,instrument,bias,hypothesis,strategy_id,version_id,model,levels,valid_until,review_at,status,snapshot,note,chart_url,file_id,alert_id,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(id,userId,v.instrument,v.bias,v.hypothesis,p.strategyId,p.versionId,p.model,JSON.stringify(v.levels),v.validUntil===null?null:sqlTime(v.validUntil),v.reviewAt===null?null:sqlTime(v.reviewAt),'waiting',p.snapshot?JSON.stringify(p.snapshot):null,v.note||null,v.chartUrl,fileId,v.alertId,t,t).run();
 return getScenario(d,userId,id);
}
export async function updateScenario(d:Db,userId:string,id:string,raw:unknown,ids:readonly string[],now=Date.now()){
 const cur=await getScenario(d,userId,id);if(!cur)return null;
 const v=validateScenario(raw,ids,now,true);if(typeof v==='string')throw Error(v);
 const o=raw as Record<string,unknown>,set:string[]=[],args:unknown[]=[];
 const put=(col:string,val:unknown)=>{set.push(col+'=?');args.push(val)};
 if(v.instrument!==undefined)put('instrument',v.instrument);
 if(v.bias!==undefined)put('bias',v.bias);
 if(v.hypothesis!==undefined)put('hypothesis',v.hypothesis);
 if(v.levels!==undefined)put('levels',JSON.stringify(v.levels));
 if(v.validUntil!==undefined)put('valid_until',v.validUntil===null?null:sqlTime(v.validUntil));
 if(v.reviewAt!==undefined)put('review_at',v.reviewAt===null?null:sqlTime(v.reviewAt));
 if(v.note!==undefined)put('note',v.note||null);
 if(v.chartUrl!==undefined)put('chart_url',v.chartUrl);
 if('fileId' in o)put('file_id',await ownFileId(d,userId,o.fileId));
 if(v.alertId!==undefined){await ownAlert(d,userId,v.alertId);put('alert_id',v.alertId)}
 // strategie / verze / model / checklist: snímek se postaví znovu (staré stavy zůstanou, pokud nepřišly nové)
 if('strategyId' in o||'versionId' in o||'model' in o||'checklist' in o){
  const sid=v.strategyId!==undefined?v.strategyId:cur.strategyId,vid='versionId' in o?v.versionId??null:sid===cur.strategyId?cur.versionId:null,model=v.model!==undefined?v.model:cur.model;
  const prev=cur.snapshot,ck=o.checklist&&typeof o.checklist==='object'?o.checklist as Record<string,unknown>:{states:prev?Object.fromEntries(prev.items.map(i=>[i.id,i.state])):{},chartUrl:prev?.chartUrl,fileId:prev?.fileId,note:prev?.note};
  const p=await resolvePlan(d,userId,sid,vid,model,ck,now);
  put('strategy_id',p.strategyId);put('version_id',p.versionId);put('model',p.model);put('snapshot',p.snapshot?JSON.stringify(p.snapshot):null);
 }
 if('status' in o){
  if(!isStatus(o.status))throw Error('Neznámý stav scénáře.');
  const vu=v.validUntil!==undefined?v.validUntil:cur.validUntil,err=moveStatus({status:cur.status,validUntil:vu},o.status,now);if(err)throw Error(err);
  put('status',o.status);put('closed_at',OPEN_STATUSES.includes(o.status)?null:sqlTime(now));
 }
 if(!set.length)throw Error('Není co uložit.');
 put('updated',sqlTime(now));
 await d.prepare(`UPDATE scenarios SET ${set.join(',')} WHERE id=? AND user_id=?`).bind(...args,id,userId).run();
 return getScenario(d,userId,id);
}
export async function deleteScenario(d:Db,userId:string,id:string){
 const ok=(await d.prepare('DELETE FROM scenarios WHERE id=? AND user_id=?').bind(id,userId).run()).meta.changes>0;
 // obchody a vynechané obchody si snímek plánu nechávají, jen ztratí odkaz
 if(ok){await d.prepare('UPDATE trade_plans SET scenario_id=NULL WHERE user_id=? AND scenario_id=?').bind(userId,id).run();await d.prepare('UPDATE no_trades SET scenario_id=NULL WHERE user_id=? AND scenario_id=?').bind(userId,id).run()}
 return ok;
}
export async function scenariosForAlerts(d:Db,userId:string,alertIds:string[]):Promise<Record<string,string>>{
 const ids=[...new Set(alertIds)].slice(0,200);if(!ids.length)return {};
 const out:Record<string,string>={};
 for(const r of (await d.prepare(`SELECT id,alert_id FROM scenarios WHERE user_id=? AND alert_id IN (${ids.map(()=>'?').join(',')}) ORDER BY updated`).bind(userId,...ids).all<{id:string;alert_id:string}>()).results)out[r.alert_id]=r.id;
 return out;
}

// ---------- vynechané obchody a stav dne
export type NoTrade={id:string;scenarioId:string|null;instrument:string|null;direction:'long'|'short'|null;reason:SkipReason;note:string;strategyId:string|null;versionId:string|null;snapshot:PlanSnapshot|null;at:number;created:number};
const toNoTrade=(r:Record<string,unknown>):NoTrade=>({id:String(r.id),scenarioId:r.scenario_id?String(r.scenario_id):null,instrument:r.instrument?String(r.instrument):null,direction:r.direction==='long'||r.direction==='short'?r.direction:null,reason:String(r.reason) as SkipReason,note:String(r.note||''),strategyId:r.strategy_id?String(r.strategy_id):null,versionId:r.version_id?String(r.version_id):null,snapshot:parseSnapshot(r.snapshot),at:msOf(r.at)??0,created:msOf(r.created)??0});
const range=(from?:number|null,to?:number|null)=>{const w:string[]=[],a:unknown[]=[];if(from!=null){w.push('at>=?');a.push(sqlTime(from))}if(to!=null){w.push('at<?');a.push(sqlTime(to))}return {w,a}};
export async function listNoTrades(d:Db,userId:string,from?:number|null,to?:number|null,limit=1000){
 const {w,a}=range(from,to);
 return (await d.prepare(`SELECT id,scenario_id,instrument,direction,reason,note,strategy_id,version_id,snapshot,at,created FROM no_trades WHERE user_id=?${w.map(x=>' AND '+x).join('')} ORDER BY at DESC LIMIT ${Math.max(1,Math.min(5000,limit))}`).bind(userId,...a).all<Record<string,unknown>>()).results.map(toNoTrade);
}
export async function createNoTrade(d:Db,userId:string,raw:unknown,ids:readonly string[],now=Date.now()){
 const v=validateNoTrade(raw,ids,now);if(typeof v==='string')throw Error(v);
 const c=await d.prepare('SELECT COUNT(*) AS n FROM no_trades WHERE user_id=?').bind(userId).first<{n:number}>();
 if(Number(c?.n||0)>=SC_LIMITS.noTrades)throw Error('Dosáhl jsi limitu vynechaných obchodů.');
 const o=raw as Record<string,unknown>;
 let instrument=v.instrument,direction=v.direction,plan:{strategyId:string|null;versionId:string|null;snapshot:PlanSnapshot|null}={strategyId:null,versionId:null,snapshot:null},sc=null as Scenario|null;
 if(v.scenarioId){
  sc=await getScenario(d,userId,v.scenarioId);if(!sc)throw Error('Scénář nenalezen.');
  instrument=sc.instrument;direction=direction??(sc.bias==='both'?null:sc.bias);
  plan=o.checklist&&sc.strategyId?await resolvePlan(d,userId,sc.strategyId,sc.versionId,sc.model,o.checklist,now):{strategyId:sc.strategyId,versionId:sc.versionId,snapshot:sc.snapshot};
 }else if(typeof o.strategyId==='string'&&o.strategyId){
  plan=await resolvePlan(d,userId,o.strategyId,typeof o.versionId==='string'&&o.versionId?o.versionId:null,typeof o.model==='string'?o.model:null,o.checklist,now);
 }
 const id=uid('ntr');
 await d.prepare('INSERT INTO no_trades(id,user_id,scenario_id,instrument,direction,reason,note,strategy_id,version_id,snapshot,at,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(id,userId,v.scenarioId,instrument,direction,v.reason,v.note||null,plan.strategyId,plan.versionId,plan.snapshot?JSON.stringify(plan.snapshot):null,sqlTime(v.at),sqlTime(now)).run();
 // vynechaný otevřený scénář se uzavře
 if(sc&&OPEN_STATUSES.includes(effectiveStatus(sc,now)))await d.prepare("UPDATE scenarios SET status='skipped',closed_at=?,updated=? WHERE id=? AND user_id=? AND status IN ('waiting','active')").bind(sqlTime(now),sqlTime(now),sc.id,userId).run();
 return id;
}
export async function deleteNoTrade(d:Db,userId:string,id:string){return (await d.prepare('DELETE FROM no_trades WHERE id=? AND user_id=?').bind(id,userId).run()).meta.changes>0}
export async function listDays(d:Db,userId:string,from?:string|null,to?:string|null){
 const w:string[]=[],a:unknown[]=[];if(from){w.push('day>=?');a.push(from)}if(to){w.push('day<=?');a.push(to)}
 return (await d.prepare(`SELECT day,status,note FROM day_status WHERE user_id=?${w.map(x=>' AND '+x).join('')} ORDER BY day DESC LIMIT 1000`).bind(userId,...a).all<{day:string;status:string;note:string|null}>()).results.map(r=>({day:String(r.day).slice(0,10),status:r.status as DayStatus,note:r.note||''}));
}
export async function setDay(d:Db,userId:string,day:string,status:DayStatus|null,note:string,now=Date.now()){
 if(status===null){await d.prepare('DELETE FROM day_status WHERE user_id=? AND day=?').bind(userId,day).run();return}
 await d.prepare('INSERT INTO day_status(user_id,day,status,note,updated) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),note=VALUES(note),updated=VALUES(updated)').bind(userId,day,status,note.slice(0,500)||null,sqlTime(now)).run();
}

// ---------- plán u obchodu
export type TradePlan={tradeId:string;scenarioId:string|null;strategyId:string|null;versionId:string|null;version:number|null;strategyName:string|null;model:string|null;snapshot:PlanSnapshot|null;updated:number};
export async function getTradePlan(d:Db,userId:string,tradeId:string):Promise<TradePlan|null>{
 const r=await d.prepare('SELECT p.trade_id,p.scenario_id,p.strategy_id,p.version_id,p.model,p.snapshot,p.updated,v.version,s.name FROM trade_plans p LEFT JOIN strategy_versions v ON v.id=p.version_id AND v.user_id=p.user_id LEFT JOIN strategies s ON s.id=p.strategy_id AND s.user_id=p.user_id WHERE p.user_id=? AND p.trade_id=?').bind(userId,tradeId).first<Record<string,unknown>>();
 return r?{tradeId,scenarioId:r.scenario_id?String(r.scenario_id):null,strategyId:r.strategy_id?String(r.strategy_id):null,versionId:r.version_id?String(r.version_id):null,version:r.version==null?null:Number(r.version),strategyName:r.name?String(r.name):null,model:r.model?String(r.model):null,snapshot:parseSnapshot(r.snapshot),updated:msOf(r.updated)??0}:null;
}
// vstup obchodu pro návrh scénáře (MT pozice: čas a směr; ruční zápis: poledne dne, bez směru)
export async function tradeEntry(d:Db,userId:string,kind:'mt'|'man',id:string):Promise<{openTs:number|null;side:'buy'|'sell'|null}|null>{
 if(kind==='mt'){const r=await d.prepare('SELECT p.open_ts,p.side FROM mt_positions p JOIN mt_accounts a ON a.id=p.account_id WHERE p.id=? AND a.user_id=?').bind(id,userId).first<{open_ts:number;side:string}>();return r?{openTs:Number(r.open_ts),side:r.side==='sell'?'sell':'buy'}:null}
 const r=await d.prepare('SELECT date FROM trades WHERE id=? AND user_id=?').bind(id,userId).first<{date:string}>();
 return r?{openTs:Date.parse(String(r.date).slice(0,10)+'T12:00:00Z'),side:null}:null;
}
export async function suggestForTrade(d:Db,userId:string,instrument:string|null,entry:{openTs:number|null;side:'buy'|'sell'|null}){
 if(!instrument)return [];
 const list=await listScenarios(d,userId,{instrument,limit:100});
 const ids=suggestScenarios({instrument,...entry},list.map(s=>({id:s.id,instrument:s.instrument,bias:s.bias,status:s.status,created:s.created,validUntil:s.validUntil,closedAt:s.closedAt})));
 return ids.map(id=>list.find(s=>s.id===id)!).slice(0,5);
}
export async function linkTrade(d:Db,userId:string,tradeId:string,raw:unknown,now=Date.now()){
 const o=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>;
 let scenarioId:string|null=null,plan:{strategyId:string|null;versionId:string|null;model:string|null;snapshot:PlanSnapshot|null};
 if(typeof o.scenarioId==='string'&&o.scenarioId){
  const sc=await getScenario(d,userId,o.scenarioId);if(!sc)throw Error('Scénář nenalezen.');scenarioId=sc.id;
  // stavy z checklistu obchodu mají přednost, jinak se převezme snímek scénáře (stav v době rozhodnutí)
  plan=o.checklist&&sc.strategyId?await resolvePlan(d,userId,sc.strategyId,sc.versionId,sc.model,o.checklist,now):{strategyId:sc.strategyId,versionId:sc.versionId,model:sc.model,snapshot:sc.snapshot};
  if(OPEN_STATUSES.includes(effectiveStatus(sc,now))||sc.status==='expired')await d.prepare("UPDATE scenarios SET status='entered',closed_at=?,updated=? WHERE id=? AND user_id=? AND status IN ('waiting','active','expired')").bind(sqlTime(now),sqlTime(now),sc.id,userId).run();
 }else if(typeof o.strategyId==='string'&&o.strategyId){
  plan=await resolvePlan(d,userId,o.strategyId,typeof o.versionId==='string'&&o.versionId?o.versionId:null,typeof o.model==='string'?o.model:null,o.checklist,now);
 }else throw Error('Vyber scénář nebo strategii.');
 const t=sqlTime(now);
 await d.prepare('INSERT INTO trade_plans(user_id,trade_id,scenario_id,strategy_id,version_id,model,snapshot,created,updated) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE scenario_id=VALUES(scenario_id),strategy_id=VALUES(strategy_id),version_id=VALUES(version_id),model=VALUES(model),snapshot=VALUES(snapshot),updated=VALUES(updated)')
  .bind(userId,tradeId,scenarioId,plan.strategyId,plan.versionId,plan.model,plan.snapshot?JSON.stringify(plan.snapshot):null,t,t).run();
 // statistiky podle strategie v Journalingu: strategie z plánu se doplní do vyhodnocení, pokud tam ještě žádná není
 if(plan.strategyId)await d.prepare("INSERT INTO trade_reviews(user_id,trade_id,strategy_id,emotions,updated) VALUES(?,?,?,'',?) ON DUPLICATE KEY UPDATE strategy_id=IFNULL(strategy_id,VALUES(strategy_id))").bind(userId,tradeId,plan.strategyId,t).run();
 return getTradePlan(d,userId,tradeId);
}
export async function unlinkTrade(d:Db,userId:string,tradeId:string){return (await d.prepare('DELETE FROM trade_plans WHERE user_id=? AND trade_id=?').bind(userId,tradeId).run()).meta.changes>0}
// snímky plánů obchodů pro statistiky dodržování (obchody v období vybírá volající podle id)
export async function planEvals(d:Db,userId:string){
 return (await d.prepare('SELECT trade_id,snapshot FROM trade_plans WHERE user_id=? AND snapshot IS NOT NULL').bind(userId).all<{trade_id:string;snapshot:string}>()).results.map(r=>({tradeId:r.trade_id,eval:parseSnapshot(r.snapshot)?.eval??null}));
}

// ---------- obrázky k plánům
export const PLAN_FILES_MAX=300;
export async function countPlanFiles(d:Db,userId:string){return Number((await d.prepare('SELECT COUNT(*) AS n FROM plan_files WHERE user_id=?').bind(userId).first<{n:number}>())?.n||0)}
export async function addPlanFile(d:Db,f:{id:string;userId:string;r2Key:string;name:string;size:number;type:string},now=Date.now()){
 await d.prepare('INSERT INTO plan_files(id,user_id,r2_key,name,size,type,created) VALUES(?,?,?,?,?,?,?)').bind(f.id,f.userId,f.r2Key,f.name,f.size,f.type,sqlTime(now)).run();
}
export async function ownPlanFile(d:Db,userId:string,id:string){return d.prepare('SELECT id,r2_key,name,type FROM plan_files WHERE id=? AND user_id=?').bind(id,userId).first<{id:string;r2_key:string;name:string;type:string}>()}
export async function deletePlanFile(d:Db,userId:string,id:string){return (await d.prepare('DELETE FROM plan_files WHERE id=? AND user_id=?').bind(id,userId).run()).meta.changes>0}
async function ownFileId(d:Db,userId:string,v:unknown){if(typeof v!=='string'||!/^plf_[a-z0-9]{24}$/.test(v))return null;return (await ownPlanFile(d,userId,v))?v:null}
