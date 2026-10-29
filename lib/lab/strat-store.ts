// Laboratoř · Strategie – databáze (lab_strategy_defs, lab_strategy_runs, migrace 0035). Volá se z /api/laborator/strategies za labGate
// a ze scripts/lab-strategies.mjs. Všechny dotazy filtrují user_id vlastníka. Definice se ukládá jako JSON text vlastníka (po validaci);
// engine ji při každém použití validuje znovu. Výsledek běhu = JSON zabalený gzipem v base64 („gz:…“, stejně jako lab_sweeps).
import type {Db} from '../mysql.ts';
import {validateDef,type StrategyDef} from './rules-def.ts';
import {packJson,unpackJson} from './sweep-store.ts';
import {runSummary,type StrategyRunResult,type RunSummary} from './strat-engine.ts';
import {cotAvailableAt,type CotSrc} from './strat-blocks.ts';

export const RUNS_KEEP=5,DEFS_MAX=300;
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
// VERZE: každá verze definice je vlastní řádek se stejným názvem (v1, v2, …). Změna obsahu (úprava v editoru i import se stejným názvem)
// vloží NOVÝ řádek s verzí max+1 – staré verze i jejich běhy zůstávají (porovnání v1 vs v2), agenti R… mají vlastní neměnnou kopii.
// Obsah shodný s poslední verzí téhož názvu = beze změny. Porovnání obsahu je bez čísla verze.
const sameContent=(a:StrategyDef,b:StrategyDef)=>JSON.stringify({...a,version:0})===JSON.stringify({...b,version:0});
export type VersionPlan={action:'same';id:string;version:number}|{action:'insert';version:number};
export function versionPlan(existing:Pick<DefRow,'id'|'version'|'def'>[],nd:StrategyDef):VersionPlan{
 if(!existing.length)return {action:'insert',version:nd.version};
 const latest=existing.reduce((a,b)=>b.version>a.version?b:a);
 if(latest.def&&sameContent(latest.def,nd))return {action:'same',id:latest.id,version:latest.version};
 return {action:'insert',version:latest.version+1};
}
export async function listVersions(d:Db,uid:string,name:string):Promise<DefRow[]>{
 return (await d.prepare('SELECT id,name,version,def,created,updated,notes FROM lab_strategy_defs WHERE user_id=? AND name=? ORDER BY version DESC').bind(uid,name).all<Row>()).results.map(toDef);
}
// uložení (nová definice, nebo nová verze při změně obsahu): vrací id řádku verze a číslo verze; raw = objekt definice (validuje se tady znovu).
// id = verze, ze které úprava vychází (musí existovat); nová verze patří k názvu z definice.
export async function saveDef(d:Db,uid:string,id:string|null,raw:unknown,now=Date.now()):Promise<{id:string;version:number;changed:boolean}>{
 const v=validateDef(raw);if(!v.ok)throw Object.assign(new Error('Definice není platná.'),{errors:v.errors});
 const obj=raw as Record<string,unknown>;
 if(id){const old=await getDef(d,uid,id);if(!old)throw Error('Definice nenalezena.');if(old.def&&old.name===v.def.name&&sameContent(old.def,v.def))return {id,version:old.version,changed:false}}
 const plan=versionPlan(await listVersions(d,uid,v.def.name),v.def);
 if(plan.action==='same')return {id:plan.id,version:plan.version,changed:false};
 const c=await d.prepare('SELECT COUNT(*) n FROM lab_strategy_defs WHERE user_id=?').bind(uid).first<{n:number}>();
 if(Number(c?.n)>=DEFS_MAX)throw Error(`Nejvýš ${DEFS_MAX} verzí definic – smaž staré verze.`);
 const nid=crypto.randomUUID(),version=plan.version;
 await d.prepare('INSERT INTO lab_strategy_defs(id,user_id,name,version,def,created,updated) VALUES(?,?,?,?,?,?,?)').bind(nid,uid,v.def.name,version,JSON.stringify({...obj,version},null,1),sqlNow(now),sqlNow(now)).run();
 return {id:nid,version,changed:true};
}
// import ze souboru: podle názvu – shodný obsah s poslední verzí = beze změny, jinak nová verze (nebo nová definice)
export async function importDef(d:Db,uid:string,raw:unknown,now=Date.now()){
 return saveDef(d,uid,null,raw,now);
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
