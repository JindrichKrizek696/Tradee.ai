// Laboratoř · databáze (lab_notes, lab_rules, lab_studies, lab_summary, lab_cot). Volá se jen z /api/laborator/* za labGate.
// Všechny dotazy filtrují user_id přihlášeného vlastníka; nikdy se nepoužívá ?as= (lib/admin/http.ts viewAs).
import type {Db} from '../mysql.ts';
import {LAB_LIMITS,parseTagsCol,aiSummary,isMissingLabTable,type LabNote,type LabRuleRow} from './core.ts';
import {normalizeLabRule} from './rules.ts';
import type {CotSource,ScoreSnap,StudyResult} from './study.ts';
import {fxCurrencies} from '../markets.ts';
import {liveQuotes} from '../live-store.ts';
import {paperSummary} from './paper-store.ts';
import {agentsData,listEvolution} from './agents-store.ts';
import {agentsSummaryMd} from './agents-report.ts';

const sqlNow=()=>new Date().toISOString().slice(0,19).replace('T',' ');
const iso=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d\d-\d\d \d/.test(s)?s.replace(' ','T')+'Z':String(s??'');
const json=<T,>(s:unknown,def:T):T=>{if(typeof s!=='string'||!s)return def;try{return JSON.parse(s) as T}catch{return def}};

// ---- poznámky
type NoteRow={id:string;title:string;body:string;tags:string;created:string;updated:string};
const toNote=(r:NoteRow):LabNote=>({id:r.id,title:r.title,body:r.body,tags:parseTagsCol(r.tags),created:iso(r.created),updated:iso(r.updated)});
export async function listNotes(d:Db,uid:string){return (await d.prepare('SELECT id,title,body,tags,created,updated FROM lab_notes WHERE user_id=? ORDER BY updated DESC').bind(uid).all<NoteRow>()).results.map(toNote)}
export async function createNote(d:Db,uid:string,n:{title:string;body:string;tags:string[]}){
 const c=await d.prepare('SELECT COUNT(*) n FROM lab_notes WHERE user_id=?').bind(uid).first<{n:number}>();
 if(Number(c?.n)>=LAB_LIMITS.notes)throw Error(`Nejvýš ${LAB_LIMITS.notes} poznámek.`);
 const id=crypto.randomUUID(),now=sqlNow();
 await d.prepare('INSERT INTO lab_notes(id,user_id,title,body,tags,created,updated) VALUES(?,?,?,?,?,?,?)').bind(id,uid,n.title,n.body,JSON.stringify(n.tags),now,now).run();
 return id;
}
export async function updateNote(d:Db,uid:string,id:string,n:{title:string;body:string;tags:string[]}){
 const r=await d.prepare('UPDATE lab_notes SET title=?,body=?,tags=?,updated=? WHERE id=? AND user_id=?').bind(n.title,n.body,JSON.stringify(n.tags),sqlNow(),id,uid).run();return r.meta.changes>0;
}
export async function deleteNote(d:Db,uid:string,id:string){return (await d.prepare('DELETE FROM lab_notes WHERE id=? AND user_id=?').bind(id,uid).run()).meta.changes>0}

// ---- pravidla
type RuleRow={id:string;name:string;rule:string;last_summary:string|null;created:string;updated:string};
const toRule=(r:RuleRow):LabRuleRow=>({id:r.id,name:r.name,rule:normalizeLabRule(json(r.rule,{})),summary:json(r.last_summary,null),created:iso(r.created),updated:iso(r.updated)});
export async function listRules(d:Db,uid:string){return (await d.prepare('SELECT id,name,rule,last_summary,created,updated FROM lab_rules WHERE user_id=? ORDER BY updated DESC').bind(uid).all<RuleRow>()).results.map(toRule)}
export async function saveRule(d:Db,uid:string,id:string|null,name:string,rule:unknown,summary:unknown){
 const now=sqlNow(),s=summary&&typeof summary==='object'?JSON.stringify(summary):null;
 if(id){const r=await d.prepare('UPDATE lab_rules SET name=?,rule=?,last_summary=COALESCE(?,last_summary),updated=? WHERE id=? AND user_id=?').bind(name,JSON.stringify(rule),s,now,id,uid).run();return r.meta.changes>0?id:null}
 const c=await d.prepare('SELECT COUNT(*) n FROM lab_rules WHERE user_id=?').bind(uid).first<{n:number}>();
 if(Number(c?.n)>=LAB_LIMITS.rules)throw Error(`Nejvýš ${LAB_LIMITS.rules} uložených pravidel.`);
 const nid=crypto.randomUUID();
 await d.prepare('INSERT INTO lab_rules(id,user_id,name,rule,last_summary,created,updated) VALUES(?,?,?,?,?,?,?)').bind(nid,uid,name,JSON.stringify(rule),s,now,now).run();
 return nid;
}
export async function deleteRule(d:Db,uid:string,id:string){return (await d.prepare('DELETE FROM lab_rules WHERE id=? AND user_id=?').bind(id,uid).run()).meta.changes>0}

// ---- studie (posledních 5 na vlastníka)
export async function saveStudy(d:Db,uid:string,params:unknown,result:StudyResult){
 await d.prepare('INSERT INTO lab_studies(id,user_id,params,result,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),uid,JSON.stringify(params),JSON.stringify(result),sqlNow()).run();
 const old=(await d.prepare('SELECT id FROM lab_studies WHERE user_id=? ORDER BY created DESC').bind(uid).all<{id:string}>()).results.slice(5);
 for(const o of old)await d.prepare('DELETE FROM lab_studies WHERE id=? AND user_id=?').bind(o.id,uid).run();
}
export async function latestStudy(d:Db,uid:string):Promise<{params:unknown;result:StudyResult}|null>{
 const r=await d.prepare('SELECT params,result FROM lab_studies WHERE user_id=? ORDER BY created DESC LIMIT 1').bind(uid).first<{params:string;result:string}>();
 return r?{params:json(r.params,null),result:json(r.result,null as unknown as StudyResult)}:null;
}

// ---- shrnutí pro AI: uloží se do lab_summary (Claude ho přečte přímo z DB)
export async function refreshSummary(d:Db,uid:string){
 const [notes,rules,study]=await Promise.all([listNotes(d,uid),listRules(d,uid),latestStudy(d,uid)]);
 // simulace (lab_paper_*): bez migrace 0026 nebo živých cen se jen vynechá
 let paper='';
 const quotes=(await liveQuotes(d).catch(()=>({quotes:{}}))).quotes;
 try{paper=await paperSummary(d,uid,quotes)}catch(e){if(!isMissingLabTable(e))console.error(e)}
 // populace agentů (lab_evolution, migrace 0030): bez migrace se jen vynechá
 let agents='';
 try{const [a,ev]=await Promise.all([agentsData(d,uid,quotes,Date.now()),listEvolution(d,uid,40)]);agents=agentsSummaryMd(a.rows,ev)}catch(e){if(!isMissingLabTable(e))console.error(e)}
 const body=aiSummary(notes,rules,study?.result??null)+(paper?'\n'+paper:'')+(agents?'\n'+agents:''),now=sqlNow();
 await d.prepare('INSERT INTO lab_summary(user_id,body,updated) VALUES(?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body),updated=VALUES(updated)').bind(uid,body,now).run();
 return {body,updated:iso(now)};
}

// ---- data pro studii
type CotDb={market:string;grp:string;report_date:string;open_interest:number;long_pos:number;short_pos:number;spread_pos:number};
// COT z lab_cot (měny: leveraged, komodity: managedMoney); USD je jen proxy (USD Index) – do párů nevstupuje
export async function loadCot(d:Db):Promise<CotSource>{
 const rows=(await d.prepare("SELECT market,grp,report_date,open_interest,long_pos,short_pos,spread_pos FROM lab_cot WHERE grp IN ('leveraged','managedMoney') ORDER BY report_date").bind().all<CotDb>()).results;
 const out:CotSource={};
 for(const r of rows){
  const k=r.market,x=out[k]||(out[k]={rows:[],group:r.grp,proxy:k==='USD'});
  const L=Number(r.long_pos),S=Number(r.short_pos);
  x.rows.push({date:String(r.report_date).slice(0,10),openInterest:Number(r.open_interest),groups:{[r.grp]:{long:L,short:S,spread:Number(r.spread_pos),net:L-S}}});
 }
 return out;
}
// COT z JSON souborů (posledních ~56 týdnů) – záloha, když lab_cot ještě není naplněná
export function cotFromMarketJson(core:{cot?:Record<string,{isProxy?:boolean;history:unknown[]}>},legacy:Record<string,{history:unknown[]}>|undefined):CotSource{
 const out:CotSource={};
 for(const c of fxCurrencies){const x=core.cot?.[c];if(x)out[c]={rows:x.history as CotSource[string]['rows'],group:'leveraged',proxy:!!x.isProxy}}
 for(const k of ['GC=F','SI=F','CL=F']){const x=legacy?.[k];if(x)out[k]={rows:x.history as CotSource[string]['rows'],group:'managedMoney'}}
 return out;
}
// uložené snapshoty skóre: tabulka score_snapshots (sync-mariadb.py), když existuje, + data/score-history.json
export async function loadScoreSnaps(d:Db,markets:string[],json:{snapshots:{at:string;scores:Record<string,{score:number|null;method?:string}|undefined>}[]}):Promise<ScoreSnap[]>{
 const seen=new Set<string>(),out:ScoreSnap[]=[],want=new Set(markets);
 const push=(at:string,instrument:string,score:unknown,method:unknown)=>{const t=Date.parse(at),v=Number(score);if(!want.has(instrument)||!Number.isFinite(t)||score===null||!Number.isFinite(v))return;const k=t+' '+instrument;if(seen.has(k))return;seen.add(k);out.push({at:t,instrument,score:v,method:String(method||'')})};
 for(const s of json.snapshots||[])for(const [i,v] of Object.entries(s.scores||{}))if(v)push(s.at,i,v.score,v.method);
 if(markets.length)try{
  const rows=(await d.prepare('SELECT at,instrument,score,method FROM score_snapshots WHERE instrument IN ('+markets.map(()=>'?').join(',')+')').bind(...markets).all<{at:string;instrument:string;score:number|null;method:string|null}>()).results;
  for(const r of rows)push(r.at,r.instrument,r.score,r.method);
 }catch{} // tabulka nemusí existovat (zrcadlení vypnuté) – stačí JSON
 return out;
}
