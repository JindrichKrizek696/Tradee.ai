import fs from 'node:fs';
import {marketScore,instruments} from '../lib/markets.ts';
const read=n=>JSON.parse(fs.readFileSync(new URL('../data/'+n,import.meta.url)));
const data={...read('fundamentals.json'),ffMacro:read('ff-macro.json'),tePmi:read('te-pmi.json'),retailOfficial:read('retail-official.json')},core=read('score-market.json'),extra=read('expanded-market.json'),market={...core,prices:{...core.prices,...extra.prices},legacy:extra.legacy};
const path=new URL('../data/score-history.json',import.meta.url);const history=fs.existsSync(path)?JSON.parse(fs.readFileSync(path)):{snapshots:[],observations:[]};const now=Date.now(),at=new Date(now).toISOString();
const scores=Object.fromEntries(instruments.map(i=>{const r=marketScore(data,market,i.id,now);return [i.id,{score:r.score,coverage:r.coverage,method:r.method,parts:Object.fromEntries(r.parts.map(p=>[p.id,r.method==="score-v3"?{value:p.contribution,label:p.label,weight:p.weight,score:p.value,status:p.status,asOf:p.asOf,reason:p.status==="ok"?p.detail:p.missingReason+": "+p.detail}:{value:p.contribution,label:p.label,reason:["decision","guidance","activity","labor"].includes(p.id)?[r.base,...(r.quote?[r.quote]:r.others)].map(c=>c+": "+data.currencies[c]?.factors[p.id]?.reason).join(" / "):p.id==="trend"?"Denní reference "+r.price?.asOf+", GMA50 "+r.price?.gma50+", GMA200 "+r.price?.gma200:p.id==="cot"?"Nový dostupný stav a čtyřtýdenní změna leveraged funds podle CFTC.":p.reason}]))}]}));
const previous=history.snapshots.at(-1);if(!previous||JSON.stringify(previous.scores)!==JSON.stringify(scores)||now-Date.parse(previous.at)>86400000){history.snapshots.push({at,scores,context:data.changes.slice(0,3).map(c=>c.title)});}
for(const [currency,obs] of Object.entries(Object.fromEntries([...new Set([...Object.keys(data.observations),...Object.keys(data.pairObservations)])].map(key=>[key,{...data.observations[key],...data.pairObservations[key]}]))))for(const [id,o] of Object.entries(obs)){if(o.value===null||!o.checkedAt)continue;const last=history.observations.filter(x=>x.currency===currency&&x.id===id).at(-1);if(!last||last.value!==o.value||last.period!==o.period)history.observations.push({currency,id,...o,capturedAt:at});}
fs.writeFileSync(path,JSON.stringify(history,null,2)+'\n');console.log('Saved real score snapshots:',history.snapshots.length,'indicator observations:',history.observations.length);
// Etapa 2A · skóre k datu: plný neměnný snímek každého trhu (vstupy, pravidla, váhy, příspěvky) do score_snapshots_v2
// + kanonický denní (první snímek dne). Bez DB / před migrací 0039 se snímky odloží do .pit-queue.jsonl a zapíšou při dalším běhu.
{
 const {captureAll,asDaily}=await import('../lib/score/pit.ts');
 const snaps=captureAll(instruments.map(i=>i.id),data,market,now),all=[...snaps,...snaps.map(asDaily)];
 const queue=new URL('../.pit-queue.jsonl',import.meta.url),envFile=new URL('../.mariadb.env',import.meta.url);
 const pending=fs.existsSync(queue)?fs.readFileSync(queue,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
 const park=list=>{list=list.slice(-4000);fs.writeFileSync(queue,list.map(s=>JSON.stringify(s)).join('\n')+'\n');console.log(`PIT: ${list.length} snímků odloženo do .pit-queue.jsonl`)};
 if(!fs.existsSync(envFile))park([...pending,...all]);
 else try{
  const {createDb}=await import('../lib/mysql.ts'),{insertSnapshots}=await import('../lib/score/pit-store.ts');
  const env=Object.fromEntries(fs.readFileSync(envFile,'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
  const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
  const n=await insertSnapshots(d,[...pending,...all]);
  if(pending.length)fs.unlinkSync(queue);
  console.log(`PIT: uloženo ${n} nových snímků (${snaps.length} trhů, čas ${at})`);
 }catch(e){console.log('!! PIT snímky: '+e.message);park([...pending,...all])}
}
