// Laboratoř · Strategie – databáze (lab_strategy_defs, lab_strategy_runs, migrace 0035). Volá se z /api/laborator/strategies za labGate
// a ze scripts/lab-strategies.mjs. Všechny dotazy filtrují user_id vlastníka. Definice se ukládá jako JSON text vlastníka (po validaci);
// engine ji při každém použití validuje znovu. Výsledek běhu = JSON zabalený gzipem v base64 („gz:…“, stejně jako lab_sweeps).
import type {Db} from '../mysql.ts';
import {validateDef,type StrategyDef} from './rules-def.ts';
import {packJson,unpackJson} from './sweep-store.ts';
import {runSummary,type StrategyRunResult,type RunSummary} from './strat-engine.ts';
import {cotAvailableAt,type CotSrc} from './strat-blocks.ts';

export const RUNS_KEEP=5,DEFS_MAX=100;
const sqlNow=(t=Date.now())=>new Date(t).toISOString().slice(0,19).replace('T',' ');
const iso=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d\d-\d\d \d/.test(s)?s.replace(' ','T')+'Z':s instanceof Date?s.toISOString():String(s??'');
const json=<T,>(s:unknown,def:T):T=>{if(typeof s!=='string'||!s)return def;try{return JSON.parse(s) as T}catch{return def}};

export type DefRow={id:string;name:string;version:number;text:string;def:StrategyDef|null;errors:string[];created:string;updated:string;notes:string|null};
type Row={id:string;name:string;version:number;def:string;created:string;updated:string;notes:string|null};
const toDef=(r:Row):DefRow=>{const v=validateDef(json(r.def,null));return {id:r.id,name:r.name,version:Number(r.version),text:r.def,def:v.ok?v.def:null,errors:v.ok?[]:v.errors,created:iso(r.created),updated:iso(r.updated),notes:r.notes??null}};
export async function listDefs(d:Db,uid:string):Promise<DefRow[]>{
 return (await d.prepare('SELECT id,name,version,def,created,updated,notes FROM lab_strategy_defs WHERE user_id=? ORDER BY updated DESC').bind(uid).all<Row>()).results.map(toDef);
}
export async function getDef(d:Db,uid:string,id:string):Promise<DefRow|null>{
 const r=await d.prepare('SELECT id,name,version,def,created,updated,notes FROM lab_strategy_defs WHERE user_id=? AND id=?').bind(uid,id).first<Row>();
 return r?toDef(r):null;
}
// porovnání obsahu bez čísla verze (změna obsahu = nová verze; stejná verze se dvakrát s jiným obsahem neuloží)
const sameContent=(a:StrategyDef,b:StrategyDef)=>JSON.stringify({...a,version:0})===JSON.stringify({...b,version:0});
// uložení (nová nebo úprava): vrací id a výslednou verzi; raw = objekt definice (validuje se tady znovu)
export async function saveDef(d:Db,uid:string,id:string|null,raw:unknown,now=Date.now()):Promise<{id:string;version:number;changed:boolean}>{
 const v=validateDef(raw);if(!v.ok)throw Object.assign(new Error('Definice není platná.'),{errors:v.errors});
 const obj=raw as Record<string,unknown>;
 if(id){
  const old=await getDef(d,uid,id);if(!old)throw Error('Definice nenalezena.');
  if(old.def&&sameContent(old.def,v.def))return {id,version:old.version,changed:false};
  const version=Math.max(v.def.version,old.version+1),text=JSON.stringify({...obj,version},null,1);
  await d.prepare('UPDATE lab_strategy_defs SET name=?,version=?,def=?,updated=? WHERE id=? AND user_id=?').bind(v.def.name,version,text,sqlNow(now),id,uid).run();
  return {id,version,changed:true};
 }
 const c=await d.prepare('SELECT COUNT(*) n FROM lab_strategy_defs WHERE user_id=?').bind(uid).first<{n:number}>();
 if(Number(c?.n)>=DEFS_MAX)throw Error(`Nejvýš ${DEFS_MAX} definic.`);
 const nid=crypto.randomUUID();
 await d.prepare('INSERT INTO lab_strategy_defs(id,user_id,name,version,def,created,updated) VALUES(?,?,?,?,?,?,?)').bind(nid,uid,v.def.name,v.def.version,JSON.stringify(obj,null,1),sqlNow(now),sqlNow(now)).run();
 return {id:nid,version:v.def.version,changed:true};
}
// import ze souboru: podle názvu – existující se upraví (nová verze při změně), jinak vznikne nová
export async function importDef(d:Db,uid:string,raw:unknown,now=Date.now()){
 const v=validateDef(raw);if(!v.ok)throw Object.assign(new Error('Definice není platná.'),{errors:v.errors});
 const ex=await d.prepare('SELECT id FROM lab_strategy_defs WHERE user_id=? AND name=? ORDER BY updated DESC LIMIT 1').bind(uid,v.def.name).first<{id:string}>();
 return saveDef(d,uid,ex?.id??null,raw,now);
}
export async function deleteDef(d:Db,uid:string,id:string){
 await d.prepare('DELETE FROM lab_strategy_runs WHERE user_id=? AND def_id=?').bind(uid,id).run();
 return (await d.prepare('DELETE FROM lab_strategy_defs WHERE user_id=? AND id=?').bind(uid,id).run()).meta.changes>0;
}

// ---- běhy
export async function saveRun(d:Db,uid:string,defId:string,version:number,params:unknown,r:StrategyRunResult,now=Date.now()):Promise<string>{
 const id=crypto.randomUUID();
 await d.prepare('INSERT INTO lab_strategy_runs(id,user_id,def_id,version,params,result,summary,created) VALUES(?,?,?,?,?,?,?,?)').bind(id,uid,defId,version,JSON.stringify(params),await packJson(r),JSON.stringify(runSummary(r)),sqlNow(now)).run();
 const old=(await d.prepare('SELECT id FROM lab_strategy_runs WHERE user_id=? AND def_id=? ORDER BY created DESC,id').bind(uid,defId).all<{id:string}>()).results.slice(RUNS_KEEP);
 for(const o of old)await d.prepare('DELETE FROM lab_strategy_runs WHERE id=? AND user_id=?').bind(o.id,uid).run();
 return id;
}
export type RunListItem={id:string;defId:string;version:number;created:string;summary:RunSummary|null};
// poslední běh každé definice (souhrn bez rozbalování výsledku)
export async function latestRuns(d:Db,uid:string):Promise<Record<string,RunListItem>>{
 const rows=(await d.prepare('SELECT id,def_id,version,created,summary FROM lab_strategy_runs WHERE user_id=? ORDER BY created DESC').bind(uid).all<{id:string;def_id:string;version:number;created:string;summary:string|null}>()).results;
 const out:Record<string,RunListItem>={};
 for(const r of rows)if(!out[r.def_id])out[r.def_id]={id:r.id,defId:r.def_id,version:Number(r.version),created:iso(r.created),summary:json<RunSummary|null>(r.summary,null)};
 return out;
}
export async function getRun(d:Db,uid:string,defId:string,runId?:string|null):Promise<{id:string;version:number;created:string;result:StrategyRunResult}|null>{
 const r=runId?await d.prepare('SELECT id,version,created,result FROM lab_strategy_runs WHERE user_id=? AND def_id=? AND id=?').bind(uid,defId,runId).first<{id:string;version:number;created:string;result:string}>()
  :await d.prepare('SELECT id,version,created,result FROM lab_strategy_runs WHERE user_id=? AND def_id=? ORDER BY created DESC LIMIT 1').bind(uid,defId).first<{id:string;version:number;created:string;result:string}>();
 if(!r)return null;const result=await unpackJson<StrategyRunResult>(r.result);return result?{id:r.id,version:Number(r.version),created:iso(r.created),result}:null;
}

// ---- COT s časem zveřejnění (available_at z migrace 0035; chybí-li sloupec nebo hodnota, dopočítá se přesně podle New Yorku)
export async function loadCotRows(d:Db):Promise<CotSrc>{
 type R={market:string;grp:string;report_date:string;long_pos:number;short_pos:number;available_at?:string|null};
 const q="SELECT market,grp,report_date,long_pos,short_pos{X} FROM lab_cot WHERE grp IN ('leveraged','managedMoney') ORDER BY report_date";
 let rows:R[];
 try{rows=(await d.prepare(q.replace('{X}',',available_at')).bind().all<R>()).results}
 catch{rows=(await d.prepare(q.replace('{X}','')).bind().all<R>()).results}
 const out:CotSrc={};
 for(const r of rows){
  const date=iso(r.report_date).slice(0,10),db=r.available_at?Date.parse(iso(r.available_at)):NaN;
  (out[r.market]||(out[r.market]=[])).push({date,availableAt:Number.isFinite(db)?db:cotAvailableAt(date),net:Number(r.long_pos)-Number(r.short_pos)});
 }
 delete out.USD; // USD index v COT je proxy (stejně jako lib/lab/study.ts) – pár s USD rozhoduje druhá měna
 return out;
}
