// Laboratoř · Hledání prahů – databáze (lab_sweeps, migrace 0028). Volá se z /api/laborator/sweep za labGate a ze scripts/lab-sweep.mjs.
// Všechny dotazy filtrují user_id vlastníka. Výsledek je JSON zabalený gzipem v base64 („gz:…“), aby řádek zůstal malý;
// rozbalení přes DecompressionStream (Node i edge runtime).
import type {Db} from '../mysql.ts';
import type {SweepResult} from './sweep.ts';

export const SWEEP_KEEP=10;
const sqlNow=(t=Date.now())=>new Date(t).toISOString().slice(0,19).replace('T',' ');
const iso=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d\d-\d\d \d/.test(s)?s.replace(' ','T')+'Z':String(s??'');
const json=<T,>(s:unknown,def:T):T=>{if(typeof s!=='string'||!s)return def;try{return JSON.parse(s) as T}catch{return def}};

async function streamBytes(input:Uint8Array,t:CompressionStream|DecompressionStream):Promise<Uint8Array>{
 const out=new Blob([input as BlobPart]).stream().pipeThrough(t as unknown as ReadableWritablePair<Uint8Array,Uint8Array>);
 return new Uint8Array(await new Response(out).arrayBuffer());
}
const b64=(u:Uint8Array)=>{let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(s)};
const unb64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function packResult(r:SweepResult):Promise<string>{return 'gz:'+b64(await streamBytes(new TextEncoder().encode(JSON.stringify(r)),new CompressionStream('gzip')))}
export async function unpackResult(s:string):Promise<SweepResult|null>{
 try{if(s.startsWith('gz:'))return JSON.parse(new TextDecoder().decode(await streamBytes(unb64(s.slice(3)),new DecompressionStream('gzip'))));return JSON.parse(s)}catch{return null}
}

export type SweepSummary={combos:number;robust:number;best:{combo:number;oosAvg:number|null}|null;chance:number|null;ms:number;from:string;split:string;to:string;markets:number};
export function sweepSummary(r:SweepResult):SweepSummary{
 const best=r.robust[0]??null,oos=r.fields.indexOf('oosAvg');
 return {combos:r.rows.filter(Boolean).length,robust:r.robust.length,best:best===null?null:{combo:best,oosAvg:r.rows[best]?.[oos] as number??null},chance:r.chance?.median??null,ms:r.ms,from:r.from,split:r.split,to:r.to,markets:r.markets.length};
}
export async function saveSweep(d:Db,uid:string,params:unknown,r:SweepResult,now=Date.now()):Promise<string>{
 const id=crypto.randomUUID();
 await d.prepare('INSERT INTO lab_sweeps(id,user_id,created,params,results,summary) VALUES(?,?,?,?,?,?)').bind(id,uid,sqlNow(now),JSON.stringify(params),await packResult(r),JSON.stringify(sweepSummary(r))).run();
 const old=(await d.prepare('SELECT id FROM lab_sweeps WHERE user_id=? ORDER BY created DESC,id').bind(uid).all<{id:string}>()).results.slice(SWEEP_KEEP);
 for(const o of old)await d.prepare('DELETE FROM lab_sweeps WHERE id=? AND user_id=?').bind(o.id,uid).run();
 return id;
}
export type SweepListItem={id:string;created:string;params:unknown;summary:SweepSummary|null};
export async function listSweeps(d:Db,uid:string):Promise<SweepListItem[]>{
 return (await d.prepare(`SELECT id,created,params,summary FROM lab_sweeps WHERE user_id=? ORDER BY created DESC LIMIT ${SWEEP_KEEP}`).bind(uid).all<{id:string;created:string;params:string;summary:string}>()).results
  .map(r=>({id:r.id,created:iso(r.created),params:json(r.params,null),summary:json<SweepSummary|null>(r.summary,null)}));
}
export async function getSweep(d:Db,uid:string,id?:string|null):Promise<{id:string;created:string;result:SweepResult}|null>{
 const r=id?await d.prepare('SELECT id,created,results FROM lab_sweeps WHERE user_id=? AND id=?').bind(uid,id).first<{id:string;created:string;results:string}>()
  :await d.prepare('SELECT id,created,results FROM lab_sweeps WHERE user_id=? ORDER BY created DESC LIMIT 1').bind(uid).first<{id:string;created:string;results:string}>();
 if(!r)return null;const result=await unpackResult(r.results);return result?{id:r.id,created:iso(r.created),result}:null;
}
