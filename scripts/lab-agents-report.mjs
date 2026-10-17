// Laboratoř · podklady pro týdenního AI analytika (lib/lab/agents-report.ts buildAgentReport) → markdown soubor. Jen vlastník.
// Volá scripts/lab-analyst.py; Claude pak smí číst JEDINĚ tento soubor.
// node --experimental-strip-types scripts/lab-agents-report.mjs --out /cesta/report.md [--owner-email x@y]
import {writeFileSync} from 'node:fs';
import {loadEnv,openDb,ownerId} from './lab-history.mjs';
import {buildAgentReport} from '../lib/lab/agents-report.ts';

const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const out=opt('--out');if(!out){console.error('lab-agents-report: chybí --out');process.exit(1)}
const env=loadEnv('.auth.env','.mariadb.env');
if(!env.MARIADB_HOST){console.error('lab-agents-report: chybí .mariadb.env');process.exit(1)}
const d=await openDb(env),owner=await ownerId(d,env,opt('--owner-email'));
if(!owner){console.error('lab-agents-report: vlastník nenalezen');process.exit(1)}
const uid=owner.id,now=Date.now();
const ps=await import('../lib/lab/paper-store.ts'),as=await import('../lib/lab/agents-store.ts');
const {liveQuotes}=await import('../lib/live-store.ts');
const quotes={};for(const [id,q] of Object.entries((await liveQuotes(d).catch(()=>({quotes:{}}))).quotes))quotes[id]={price:q.price,marketTime:q.marketTime};
const [data,evolution,all]=await Promise.all([as.agentsData(d,uid,quotes,now),as.listEvolution(d,uid,200),ps.paperAll(d,uid,quotes)]);
let known=null,sweep=null;
try{const {latestKnownSummary}=await import('../lib/lab/known-store.ts');known=await latestKnownSummary(d,uid)}catch(e){console.warn('známé strategie:',e.code||e.message)}
try{const {getSweep}=await import('../lib/lab/sweep-store.ts');const {comboAt,comboKey,F}=await import('../lib/lab/sweep.ts');const s=await getSweep(d,uid);
 if(s)sweep={created:s.created,robust:s.result.robust.length,chance:s.result.chance?.median??null,top:s.result.robust.slice(0,5).map(i=>({key:comboKey(comboAt(i)),oosAvg:s.result.rows[i][F.oosAvg],oosN:s.result.rows[i][F.oosN]}))}}catch(e){console.warn('sweep:',e.code||e.message)}
const open=[...all.flatMap(x=>x.open.map(t=>({...t,variant:x.variant}))),...data.open.map(t=>({...t,variant:t.variant}))];
const md=buildAgentReport({now,agents:data.rows,trades:data.tradesOf,evolution,known,sweep,variants:all.map(x=>({id:x.variant,name:x.V.name,stats:x.stats,started:x.account?.started??null})),open});
writeFileSync(out,md);
console.log(`lab-agents-report: ${md.length} znaků → ${out}`);
process.exit(0);
