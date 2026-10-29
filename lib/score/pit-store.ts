// Úložiště snímků skóre k datu: tabulka score_snapshots_v2 (migrace 0039). Jen INSERT IGNORE – snímek se nikdy nepřepisuje ani nemaže.
// Složky (parts) se ukládají jako gzip + base64 („gz:…“), plný snímek všech trhů má ~0,6 MB JSON.
// Bez tabulky (před migrací) API čte zálohu z data/score-history.json (rekonstrukce, lib/score/pit.ts fromHistory).
import type {Db} from '../mysql.ts';
import {fingerprint,pragueDay,changePoints,deepFreeze,type PitSnapshot,type PitKind,type PitPart} from './pit.ts';

export const PIT_TABLE='score_snapshots_v2';
const COLS='market,at,kind,day,daily_key,method,version,score,coverage,reconstructed,source,note,fingerprint,parts';
/** Jediný zápis do tabulky: INSERT IGNORE (stejný klíč trh+druh+čas nebo stejný denní klíč = nic se nezmění). */
export const insertSql=(n:number)=>`INSERT IGNORE INTO ${PIT_TABLE}(${COLS}) VALUES `+Array.from({length:n},()=>'(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
/** ISO → DATETIME(3) UTC „2026-11-06 14:00:00.000“ */
export const sqlTime=(isoOrMs:string|number)=>new Date(typeof isoOrMs==='number'?isoOrMs:Date.parse(isoOrMs)).toISOString().replace('T',' ').replace('Z','');
/** DATETIME z DB (UTC, bez zóny) → ISO */
export const fromSqlTime=(s:string)=>new Date(String(s).replace(' ','T')+(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s))?'':'Z')).toISOString();

async function pipe(bytes:Uint8Array,stream:CompressionStream|DecompressionStream){return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer())}
const b64=(u:Uint8Array)=>{let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(s)};
const unb64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function encodeParts(parts:PitPart[]):Promise<string>{return 'gz:'+b64(await pipe(new TextEncoder().encode(JSON.stringify(parts)),new CompressionStream('gzip')))}
export async function decodeParts(raw:unknown):Promise<PitPart[]>{
 if(raw===null||raw===undefined)return [];
 const s=typeof raw==='string'?raw:new TextDecoder().decode(raw as Uint8Array);
 const json=s.startsWith('gz:')?new TextDecoder().decode(await pipe(unb64(s.slice(3)),new DecompressionStream('gzip'))):s;
 try{const v=JSON.parse(json);return Array.isArray(v)?v:[]}catch{return []}
}
/** Řádek pro INSERT (daily_key jen u kanonického denního snímku – unikátní trh+den). */
export async function toRow(s:PitSnapshot):Promise<unknown[]>{
 const t=Date.parse(s.at),day=pragueDay(t);
 return [s.market,sqlTime(t),s.kind,day,s.kind==='daily'?s.market+'|'+day:null,s.method,s.version,s.score,s.coverage,s.reconstructed?1:0,s.source,s.note,fingerprint(s),await encodeParts(s.parts)];
}
type Row={market:string;at:string;kind:string;method:string;version:string;score:number|string|null;coverage:number|null;reconstructed:number;source:string;note:string|null;fingerprint:string;parts:unknown};
export async function fromRow(r:Row):Promise<PitSnapshot>{
 return deepFreeze({market:r.market,at:fromSqlTime(r.at),kind:r.kind as PitKind,method:r.method,version:r.version,score:r.score===null?null:Number(r.score),coverage:r.coverage===null?null:Number(r.coverage),reconstructed:Number(r.reconstructed)===1,source:r.source,note:r.note,parts:await decodeParts(r.parts)});
}
/** Zápis snímků (po 40); vrací počet skutečně vložených řádků. Existující klíč se tiše přeskočí – nikdy se nepřepíše. */
export async function insertSnapshots(d:Db,snaps:PitSnapshot[]):Promise<number>{
 let n=0;
 for(let i=0;i<snaps.length;i+=40){const ch=snaps.slice(i,i+40),rows=await Promise.all(ch.map(toRow));
  n+=(await d.prepare(insertSql(ch.length)).bind(...rows.flat()).run()).meta.changes}
 return n;
}
const RCOLS=['market','at','kind','method','version','score','coverage','reconstructed','source','note','fingerprint','parts'],SCOLS=RCOLS.map(c=>'s.'+c).join(',');
const SEL=`SELECT market,at,kind,method,version,score,coverage,reconstructed,source,note,fingerprint,parts FROM ${PIT_TABLE}`;
/** Stav k času t: pro každý trh nejbližší snímek ≤ t (capture/backfill; daily jsou jejich kopie). */
export async function snapshotsAt(d:Db,t:number,markets:string[]|null):Promise<Record<string,PitSnapshot>>{
 const at=sqlTime(t),mk=markets?.length?` AND market IN (${markets.map(()=>'?').join(',')})`:'';
 const rows=(await d.prepare(`SELECT ${SCOLS} FROM ${PIT_TABLE} s JOIN (SELECT market AS m,MAX(at) AS mx FROM ${PIT_TABLE} WHERE at<=? AND kind IN ('capture','backfill')${mk} GROUP BY market) x ON x.m=s.market AND x.mx=s.at WHERE s.kind IN ('capture','backfill')`).bind(at,...(markets||[])).all<Row>()).results;
 const out:Record<string,PitSnapshot>={};
 for(const r of rows){const s=await fromRow(r);const o=out[s.market];if(!o||o.kind==='backfill')out[s.market]=s}
 return out;
}
/** Poslední dřívější snímek s jiným obsahem (otiskem) – „co se změnilo od minula“. */
export async function lastChangeBefore(d:Db,s:PitSnapshot):Promise<PitSnapshot|null>{
 const r=await d.prepare(`${SEL} WHERE market=? AND at<? AND kind IN ('capture','backfill') AND fingerprint<>? ORDER BY at DESC LIMIT 1`).bind(s.market,sqlTime(s.at),fingerprint(s)).first<Row>();
 return r?fromRow(r):null;
}
/** Řada snímků trhu v intervalu (daily = kanonické denní); vrací jen body změny + první a poslední. */
export async function snapshotRange(d:Db,market:string,from:number,to:number,daily:boolean):Promise<PitSnapshot[]>{
 const kinds=daily?"('daily','backfill')":"('capture','backfill')";
 // jen otisky, plné řádky až pro body změny
 const keys=(await d.prepare(`SELECT at,kind,fingerprint,method,version FROM ${PIT_TABLE} WHERE market=? AND at>=? AND at<=? AND kind IN ${kinds} ORDER BY at`).bind(market,sqlTime(from),sqlTime(to)).all<{at:string;kind:string;fingerprint:string;method:string;version:string}>()).results;
 const pick:typeof keys=[];let last='';
 for(const k of keys){const f=k.fingerprint+k.method+k.version;if(f!==last){pick.push(k);last=f}}
 if(keys.length&&pick.at(-1)!==keys.at(-1))pick.push(keys.at(-1)!);
 const out:PitSnapshot[]=[];
 for(let i=0;i<pick.length;i+=50){const ch=pick.slice(i,i+50);
  const rows=(await d.prepare(`${SEL} WHERE market=? AND (${ch.map(()=>'(at=? AND kind=?)').join(' OR ')})`).bind(market,...ch.flatMap(k=>[k.at,k.kind])).all<Row>()).results;
  for(const r of rows)out.push(await fromRow(r));
 }
 return changePoints(out.sort((a,b)=>a.at.localeCompare(b.at)));
}
/** Nejstarší „capture“ (backfill doplňuje jen čas před ní). */
export async function firstCapture(d:Db):Promise<string|null>{const r=await d.prepare(`SELECT MIN(at) AS a FROM ${PIT_TABLE} WHERE kind='capture'`).first<{a:string|null}>();return r?.a?fromSqlTime(r.a):null}
export const isMissingPitTable=(e:unknown)=>{const x=e as {code?:unknown;errno?:unknown;message?:unknown}|null;return !!x&&(x.code==='ER_NO_SUCH_TABLE'||x.errno===1146||/score_snapshots_v2' doesn't exist/i.test(String(x.message??'')))};
