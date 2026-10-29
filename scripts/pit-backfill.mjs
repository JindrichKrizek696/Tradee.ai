// Skóre k datu · jednorázové doplnění starší historie do score_snapshots_v2 (druh backfill, „rekonstruováno z historie“).
// node --experimental-strip-types scripts/pit-backfill.mjs [--dry]
// Zdroje: data/score-history.json + tabulka score_snapshots (sync-mariadb.py). Vstupní čísla tam nejsou → snímky mají
// reconstructed=1 a prázdné vstupy. Doplňuje jen čas před prvním skutečným snímkem (capture); opakované spuštění nic nezmění (INSERT IGNORE).
import fs from 'node:fs';
import {fromHistory,fromHistoryEntry} from '../lib/score/pit.ts';
const dry=process.argv.includes('--dry');
const hist=JSON.parse(fs.readFileSync(new URL('../data/score-history.json',import.meta.url)));
let snaps=fromHistory(hist);
console.log(`score-history.json: ${snaps.length} záznamů`);
const envFile=new URL('../.mariadb.env',import.meta.url);
if(!fs.existsSync(envFile)){console.log('Chybí .mariadb.env – jen kontrola převodu.');process.exit(0)}
const {createDb}=await import('../lib/mysql.ts'),{insertSnapshots,firstCapture,fromSqlTime}=await import('../lib/score/pit-store.ts');
const env=Object.fromEntries(fs.readFileSync(envFile,'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
try{
 const rows=(await d.prepare('SELECT at,instrument,score,coverage,method,parts FROM score_snapshots').all()).results;
 const seen=new Set(snaps.map(s=>s.market+'|'+s.at));let add=0;
 for(const r of rows){const at=Number.isFinite(Date.parse(r.at))?new Date(Date.parse(r.at)).toISOString():fromSqlTime(r.at);if(seen.has(r.instrument+'|'+at))continue;seen.add(r.instrument+'|'+at);
  let parts=null;try{parts=JSON.parse(r.parts)}catch{}
  snaps.push(fromHistoryEntry(r.instrument,at,{score:r.score===null?null:Number(r.score),coverage:r.coverage,method:r.method,parts}));add++}
 console.log(`score_snapshots (DB): +${add} záznamů navíc`);
}catch(e){console.log('score_snapshots (DB) nedostupná: '+e.message)}
const first=await firstCapture(d);
if(first){const before=snaps.length;snaps=snaps.filter(s=>s.at<first);console.log(`První skutečný snímek ${first}: doplní se ${snaps.length} z ${before}`)}
if(dry){console.log('--dry: nic se nezapisuje');process.exit(0)}
const n=await insertSnapshots(d,snaps);
console.log(`Hotovo: vloženo ${n} rekonstruovaných snímků (existující se nemění).`);
