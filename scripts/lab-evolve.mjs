// Laboratoř · Populace agentů: založení populace (20 agentů G01…G20) a týdenní evoluce (lib/lab/agents.ts planEvolution) – jen vlastník.
// Pořadí v neděli (Europe/Prague): 18:00 týdenní souhrn (lab-paper-weekly.mjs) → 18:15 evoluce (tento skript) → 18:30 AI analytik (lab-analyst.sh).
// Cron na VPS (crontab v UTC → 16:15 i 17:15 UTC, skript sám pustí jen běh, kdy je v Praze 18 h – letní i zimní čas):
//   15 16,17 * * 0 cd ~/tradee && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && OWNER_EMAIL="$(grep '^OWNER_EMAIL=' .auth.env | cut -d= -f2- | tr -d '"\r')" node --experimental-strip-types scripts/lab-evolve.mjs >> ~/logs/lab-evolve.log 2>&1
// node --experimental-strip-types scripts/lab-evolve.mjs [--dry] [--force] [--seed] [--seed-value 42] [--owner-email x@y]
//   --seed  = jen založí populaci, když žádní agenti nejsou (jednorázově po migraci 0030; bez kontroly času). Existující agenty nikdy nepřepíše.
//   --dry   = nic nezapisuje, vypíše plán; --force = bez kontroly neděle 18 h a duplicity v týdnu.
// Zápis: lab_evolution (evaluate / clone / retire / seed s důvodem a fitness) + lab_paper_log agenta (+ souhrn '*'), pak „Shrnutí pro AI“.
// Nic se nemaže: vyřazený agent = active 0 (archiv). Pravidla existujícího agenta se nikdy nemění (nový genom = nový agent).
import {loadEnv,openDb,ownerId} from './lab-history.mjs';
import {seedPopulation,planEvolution,genomeText,agentId,MAX_ACTIVE_AGENTS} from '../lib/lab/agents.ts';

const args=process.argv.slice(2),dry=args.includes('--dry'),force=args.includes('--force'),seedOnly=args.includes('--seed'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const env=loadEnv('.auth.env','.mariadb.env','.notify.env');
const now=Date.now();
const prague=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',weekday:'short',hour:'2-digit',hour12:false}).formatToParts(new Date(now));
const wd=prague.find(p=>p.type==='weekday')?.value,hour=Number(prague.find(p=>p.type==='hour')?.value);
if(!dry&&!force&&!seedOnly&&!(wd==='Sun'&&hour===18)){console.log(`lab-evolve: v Praze není neděle 18 h (${wd} ${hour}:00) – nic nedělám`);process.exit(0)}
if(!env.MARIADB_HOST){console.error('lab-evolve: chybí .mariadb.env');process.exit(dry?0:1)}
const d=await openDb(env),owner=await ownerId(d,env,opt('--owner-email'));
if(!owner){console.log('lab-evolve: vlastník nenalezen – nic nedělám');process.exit(0)}
const uid=owner.id;
const ps=await import('../lib/lab/paper-store.ts'),as=await import('../lib/lab/agents-store.ts');
const accs=await ps.listAccounts(d,uid),agents=as.agentAccounts(accs);

// ---- založení populace (jen když žádní agenti nejsou)
if(!agents.length){
 const src={sweep:[],known:[]};
 try{const {getSweep}=await import('../lib/lab/sweep-store.ts');const {comboAt}=await import('../lib/lab/sweep.ts');const s=await getSweep(d,uid);if(s)src.sweep=s.result.robust.slice(0,6).map(i=>comboAt(i))}catch(e){console.warn('lab-evolve: sweep nejde načíst –',e.code||e.message)}
 try{const {latestKnownSummary}=await import('../lib/lab/known-store.ts');const k=await latestKnownSummary(d,uid);if(k)src.known=k.rows.filter(r=>r.key&&!r.skipped).map(r=>({combo:JSON.parse(r.key),robust:r.robust,beatsChance:r.beatsChance}))}catch(e){console.warn('lab-evolve: známé strategie nejdou načíst –',e.code||e.message)}
 const pop=seedPopulation(src,Number(opt('--seed-value')??42),MAX_ACTIVE_AGENTS);
 console.log(`lab-evolve: zakládám populaci ${pop.length} agentů (sweep ${src.sweep.length}, známé strategie ${src.known.length})`);
 for(const [i,a] of pop.entries())console.log(`  ${agentId(i+1)} · ${genomeText(a.genome)} · ${a.origin}`);
 if(dry)process.exit(0);
 for(const [i,a] of pop.entries())await as.createAgent(d,uid,now,agentId(i+1),a.genome,{gen:0,parent:null,origin:a.origin,reason:'počáteční populace – '+a.origin});
 await ps.addLog(d,uid,now,`Populace agentů založena: ${pop.length} agentů po 100 000 Kč (gen 0). Obchodují od dalšího běhu simulace.`,'*');
 try{const {refreshSummary}=await import('../lib/lab/store.ts');await refreshSummary(d,uid)}catch(e){console.error('lab-evolve: shrnutí pro AI',e.message)}
 process.exit(0);
}
if(seedOnly){console.log(`lab-evolve: populace už existuje (${agents.length} agentů) – nic nezakládám`);process.exit(0)}

// ---- týdenní evoluce
const last=await as.lastGeneration(d,uid);
if(!force&&!dry&&last.at!==null&&now-last.at<20*3600000){console.log('lab-evolve: evoluce za tento týden už proběhla');process.exit(0)}
const gen=last.gen+1;
const {liveQuotes}=await import('../lib/live-store.ts');
const quotes={};for(const [id,q] of Object.entries((await liveQuotes(d).catch(()=>({quotes:{}}))).quotes))quotes[id]={price:q.price,marketTime:q.marketTime};
const data=await as.agentsData(d,uid,quotes,now);
const evo=data.rows.map(r=>({id:r.id,active:r.active,trades:r.stats.trades,weekR:r.weekR,totalR:r.stats.totalR,avgR:r.stats.avgR,maxDdPct:r.stats.maxDrawdownPct,genome:r.genome,gen:r.meta.gen,parent:r.meta.parent}));
const plan=planEvolution(evo,{gen,allIds:data.rows.map(r=>r.id)});
console.log(`lab-evolve gen ${gen}: aktivních ${evo.filter(a=>a.active).length}, potomků ${plan.children.length}, vyřadit ${plan.retire.length}`);
for(const e of plan.evaluations)console.log(`  #${e.rank} ${e.agent} fitness ${e.fitness} – ${e.reason}`);
for(const r of plan.retire)console.log(`  ARCHIV ${r.agent}: ${r.reason}`);
for(const c of plan.children)console.log(`  NOVÝ ${c.id} ← ${c.parent}: ${genomeText(c.genome)} (${c.changes.join(', ')})`);
for(const n of plan.notes)console.log('  pozn.: '+n);
if(dry)process.exit(0);
const byId=new Map(data.rows.map(r=>[r.id,r]));
for(const e of plan.evaluations)await as.logEvolution(d,uid,{gen,at:now,agent:e.agent,parent:byId.get(e.agent)?.meta.parent??null,genome:byId.get(e.agent)?.genome??null,action:'evaluate',reason:`#${e.rank}: ${e.reason}`,fitness:e.fitness});
for(const r of plan.retire)await as.retireAgent(d,uid,now,r.agent,{gen,genome:byId.get(r.agent).genome,reason:r.reason,fitness:r.fitness});
for(const c of plan.children)await as.createAgent(d,uid,now,c.id,c.genome,{gen,parent:c.parent,origin:'evoluce',reason:c.reason});
await ps.addLog(d,uid,now,[`Evoluce agentů gen ${gen}: ${plan.children.length?'noví '+plan.children.map(c=>`${c.id} (← ${c.parent})`).join(', '):'bez nových agentů'}${plan.retire.length?'; archivováni '+plan.retire.map(r=>r.agent).join(', '):''}.`,
 `Pořadí: ${plan.evaluations.slice(0,5).map(e=>`${e.agent} ${e.fitness}`).join(', ')}${plan.evaluations.length>5?' …':''}.`,...plan.notes].join('\n'),'*');
try{const {refreshSummary}=await import('../lib/lab/store.ts');await refreshSummary(d,uid)}catch(e){console.error('lab-evolve: shrnutí pro AI',e.message)}
console.log('lab-evolve ok');
process.exit(0);
