// Laboratoř · Známé strategie – databáze (lab_known, migrace 0030). Volá se z /api/laborator/known za labGate a ze scripts/lab-known.mjs.
// Všechny dotazy filtrují user_id vlastníka. Výsledek = JSON zabalený gzipem v base64 („gz:…“, stejně jako lab_sweeps); drží se posledních 10.
import type {Db} from '../mysql.ts';
import type {KnownResult} from './known.ts';
import {packJson,unpackJson} from './sweep-store.ts';

export const KNOWN_KEEP=10;
const sqlNow=(t=Date.now())=>new Date(t).toISOString().slice(0,19).replace('T',' ');
const iso=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d\d-\d\d \d/.test(s)?s.replace(' ','T')+'Z':String(s??'');
const json=<T,>(s:unknown,def:T):T=>{if(typeof s!=='string'||!s)return def;try{return JSON.parse(s) as T}catch{return def}};

export type KnownSummaryRow={family:string;label:string;skipped:string|null;combo:number|null;key:string|null;robust:boolean;beatsChance:boolean;isAvg:number|null;oosAvg:number|null;oosN:number;oosPf:number|null;oosDd:number;chance:number|null};
export function knownSummary(r:KnownResult):KnownSummaryRow[]{
 return r.families.map(f=>{const x=f.best===null?null:r.rows.find(y=>y.i===f.best)??null;
  return {family:f.id,label:f.label,skipped:f.skipped,combo:f.best,key:x?JSON.stringify(x.combo):null,robust:!!x?.robust,beatsChance:!!x?.beatsChance,isAvg:x?.is.avgR??null,oosAvg:x?.oos.avgR??null,oosN:x?.oos.trades??0,oosPf:x?.oos.pf??null,oosDd:x?.oos.maxDd??0,chance:f.chance.median}});
}
export async function saveKnown(d:Db,uid:string,params:unknown,r:KnownResult,now=Date.now()):Promise<string>{
 const id=crypto.randomUUID();
 await d.prepare('INSERT INTO lab_known(id,user_id,created,params,results,summary) VALUES(?,?,?,?,?,?)').bind(id,uid,sqlNow(now),JSON.stringify(params),await packJson(r),JSON.stringify(knownSummary(r))).run();
 const old=(await d.prepare('SELECT id FROM lab_known WHERE user_id=? ORDER BY created DESC,id').bind(uid).all<{id:string}>()).results.slice(KNOWN_KEEP);
 for(const o of old)await d.prepare('DELETE FROM lab_known WHERE id=? AND user_id=?').bind(o.id,uid).run();
 return id;
}
export async function getKnown(d:Db,uid:string,id?:string|null):Promise<{id:string;created:string;result:KnownResult}|null>{
 const r=id?await d.prepare('SELECT id,created,results FROM lab_known WHERE user_id=? AND id=?').bind(uid,id).first<{id:string;created:string;results:string}>()
  :await d.prepare('SELECT id,created,results FROM lab_known WHERE user_id=? ORDER BY created DESC LIMIT 1').bind(uid).first<{id:string;created:string;results:string}>();
 if(!r)return null;const result=await unpackJson<KnownResult>(r.results);return result?{id:r.id,created:iso(r.created),result}:null;
}
export async function listKnown(d:Db,uid:string){
 return (await d.prepare(`SELECT id,created,summary FROM lab_known WHERE user_id=? ORDER BY created DESC LIMIT ${KNOWN_KEEP}`).bind(uid).all<{id:string;created:string;summary:string}>()).results
  .map(r=>({id:r.id,created:iso(r.created),summary:json<KnownSummaryRow[]>(r.summary,[])}));
}
// jen souhrn posledního běhu (bez rozbalování výsledku) – pro populaci, report a shrnutí pro AI
export async function latestKnownSummary(d:Db,uid:string):Promise<{created:string;rows:KnownSummaryRow[]}|null>{
 const r=await d.prepare('SELECT created,summary FROM lab_known WHERE user_id=? ORDER BY created DESC LIMIT 1').bind(uid).first<{created:string;summary:string}>();
 return r?{created:iso(r.created),rows:json<KnownSummaryRow[]>(r.summary,[])}:null;
}
