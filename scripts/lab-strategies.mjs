// Laboratoř · Strategie: test pravidlových strategií z lab_strategy_defs (lib/lab/strat-engine.ts) → lab_strategy_runs (jen vlastník, OWNER_EMAIL).
// node --experimental-strip-types scripts/lab-strategies.mjs [--id <verzeId> | --name <název> [--all-versions]] [--diag] [--diag-json <soubor mimo repo>]
//                                                          [--dry] [--shuffles 20] [--seed 42] [--owner-email x@y]
// node --experimental-strip-types scripts/lab-strategies.mjs --import <soubor.json mimo repo> [--run]
//   Bez --id / --name se testuje POSLEDNÍ verze každé definice (--all-versions = všechny verze). --name = poslední verze daného názvu.
//   --import = vloží definice ze souboru (objekt, pole objektů nebo {defs:[…]}); podle názvu: změna obsahu proti poslední verzi = NOVÁ verze
//              (v2, v3 … jako nový řádek; staré verze a jejich běhy zůstávají), shodný obsah = beze změny, neznámý název = nová definice.
//              Soubor musí ležet MIMO repozitář; jeho obsah se nikam jinam nezapisuje ani nevypisuje (jen id, název, verze).
//   --run = po importu rovnou spustí test importovaných definic.
//   --diag = vypíše diagnostiku: trychtýř podmínek (jen id podmínky + název bloku + počty), fáze vstupu a statistiky detektorů – žádné
//            parametry ani text pravidel. Diagnostika se ukládá do výsledku běhu vždy (záložka Strategie → Diagnostika).
//   --diag-json <soubor> = zapíše diagnostiku (jen počty, id podmínek, bloky) jako JSON pro kalibraci; soubor musí ležet MIMO repozitář.
// Výpis obsahuje jen id / názvy definic a metriky – nikdy pravidla. Běží na VPS (.mariadb.env): svíčky z market_bars (D1 od 2003, H1 ~2 roky),
// COT z lab_cot (s available_at), zprávy z data/calendar.json + fundamentals (jen období, které kalendář pokrývá), DXY z archivu nebo syntetický.
import {readFileSync,existsSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,sep,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDef,defRuns} from '../lib/lab/rules-def.ts';
import {runStrategy} from '../lib/lab/strat-engine.ts';
import {syntheticDxy,DXY_WEIGHTS} from '../lib/lab/strat-blocks.ts';

const args=process.argv.slice(2),dry=args.includes('--dry'),diagOn=args.includes('--diag'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const ROOT=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
const outsideRepo=f=>{const p=resolve(f);let real=p;try{real=existsSync(p)?realpathSync(p):resolve(realpathSync(dirname(p)),basename(p))}catch{return null}return real===ROOT||real.startsWith(ROOT+sep)?null:real};
// --diag-json: cíl musí ležet mimo repozitář (diagnostika patří k definicím, ne do gitu)
const diagJson=opt('--diag-json'),diagOut=diagJson?outsideRepo(diagJson):null;
if(diagJson&&!diagOut){console.error('lab-strategies: --diag-json musí mířit MIMO repozitář (a do existující složky)');process.exit(1)}
const load=f=>{try{return Object.fromEntries(readFileSync(resolve(ROOT,f),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2')]))}catch{return {}}};
const env={...load('.auth.env'),...load('.mariadb.env')};
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const now=Date.now(),DAY=86400000;
if(!env.MARIADB_HOST){console.error('lab-strategies: chybí .mariadb.env (běží jen na VPS s databází)');process.exit(1)}
const {createDb}=await import('../lib/mysql.ts');
const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
const ownerEmail=(opt('--owner-email')||process.env.OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase();
const owner=ownerEmail?await d.prepare('SELECT id FROM members WHERE LOWER(email)=?').bind(ownerEmail).first():null;
if(!owner){console.log('lab-strategies: vlastník nenalezen (OWNER_EMAIL / --owner-email) – nic nedělám');process.exit(0)}
const uid=owner.id;
const st=await import('../lib/lab/strat-store.ts');

// ---- import definic ze souboru mimo repozitář
let onlyIds=null;
const imp=opt('--import');
if(imp){
 const file=resolve(imp);
 if(!existsSync(file)){console.error('lab-strategies: soubor neexistuje');process.exit(1)}
 const real=realpathSync(file);
 if(real===ROOT||real.startsWith(ROOT+sep)){console.error('lab-strategies: soubor s definicemi musí ležet MIMO repozitář (definice nepatří do gitu)');process.exit(1)}
 let raw;try{raw=JSON.parse(readFileSync(real,'utf8'))}catch{console.error('lab-strategies: soubor není platný JSON');process.exit(1)}
 const list=Array.isArray(raw)?raw:Array.isArray(raw?.defs)?raw.defs:[raw];
 onlyIds=[];let bad=0;
 for(const [k,x] of list.entries()){
  const v=validateDef(x);
  if(!v.ok){bad++;console.log(`definice #${k+1}: neplatná (${v.errors.length} chyb)`);for(const e of v.errors.slice(0,20))console.log('  '+e);continue}
  if(dry){console.log(`definice #${k+1}: platná · ${v.def.name} · v${v.def.version} (--dry, neukládám)`);continue}
  const r=await st.importDef(d,uid,x,now);onlyIds.push(r.id);
  console.log(`${r.changed?'uloženo':'beze změny'} ${r.id} · ${v.def.name} · v${r.version}`);
 }
 if(!args.includes('--run'))process.exit(bad?1:0);
}

// ---- test definic
const allDefs=await st.listDefs(d,uid),byName=new Map();
for(const x of allDefs)if(!byName.has(x.name)||byName.get(x.name).version<x.version)byName.set(x.name,x);
const allVersions=args.includes('--all-versions'),idArg=opt('--id'),nameArg=opt('--name');
const defs=allDefs.filter(x=>onlyIds?onlyIds.includes(x.id):idArg?x.id===idArg:nameArg?x.name===nameArg&&(allVersions||byName.get(x.name)===x):allVersions||byName.get(x.name)===x)
 .sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:a.version-b.version);
if(!defs.length){console.log('lab-strategies: žádná definice k testu');process.exit(0)}
const {loadBars}=await import('../lib/bars/query.ts');
const cache=new Map();
const bars=async(id,tf)=>{const k=id+':'+tf;if(!cache.has(k))cache.set(k,(await loadBars(d,id,tf,0,now+DAY)).map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c})));return cache.get(k)};
let cot=null,news=null;
const needCot=defs.some(x=>x.def?.conditions.some(c=>c.block==='cot_index'));
if(needCot)try{cot=await st.loadCotRows(d)}catch(e){console.warn('lab-strategies: lab_cot nejde načíst –',e.code||e.message)}
if(defs.some(x=>x.def&&(x.def.filters.news||x.def.conditions.some(c=>c.block==='news_blackout')))){
 try{const read=n=>JSON.parse(readFileSync(resolve(ROOT,'data',n),'utf8'));const f=read('fundamentals.json');
  const {newsItems,newsLookup}=await import('../lib/backtest/context.ts');news=newsLookup(newsItems(read('calendar.json').events,f.events,f.sources))}
 catch(e){console.warn('lab-strategies: kalendář nejde načíst –',e.message)}
}
const shuffles=Number(opt('--shuffles')??20),seed=Number(opt('--seed')??42);
let failed=0;const diagAll=[];
// diagnostika: jen id podmínek, názvy bloků a počty (žádné parametry ani text pravidel)
const pc=(a,b)=>b?` (${(a/b*100).toFixed(1)} %)`:'';
function printDiag(dg){
 const t=dg.total;console.log(`  diagnostika od ${dg.from||'začátku'} · svíček ${t.bars} · všechny povinné ${t.allRequired}${pc(t.allRequired,t.bars)}`);
 const groups=t.groups??[];
 const worst=[...t.conds.filter(c=>c.firstFail!==null),...groups].reduce((a,c)=>!a||c.firstFail>a.firstFail?c:a,null);
 for(const c of t.conds){
  const g=c.group?groups.find(x=>x.id===c.group):null;
  if(g&&g.members[0]===c.id)console.log(`   P ${g.id.padEnd(12)} ${'skupina NEBO'.padEnd(17)}     platí ${String(g.true).padStart(7)}${pc(g.true,t.bars)} · trychtýř ${String(g.funnel).padStart(7)} · první selhání ${String(g.firstFail).padStart(7)}${g===worst?'  ← úzké hrdlo':''} (${g.members.join(' | ')})`);
  const req=c.role==='required'&&!c.group;
  console.log(`   ${c.group?' |':req?'P':c.role==='info'?'I':'V'} ${c.id.padEnd(12)} ${c.block.padEnd(17)} ${c.tf.padEnd(3)} platí ${String(c.true).padStart(7)}${pc(c.true,t.bars)}`+(req?` · trychtýř ${String(c.funnel).padStart(7)} · první selhání ${String(c.firstFail).padStart(7)}${c===worst?'  ← úzké hrdlo':''}`:c.group?` · člen ${c.group}`:c.role==='info'?' · jen úrovně':' · volitelná')+(c.unknown?` · bez dat ${c.unknown}`:''));
  if(c.stats)console.log('       detektor: '+Object.entries(c.stats).map(([k,v])=>`${k} ${v}`).join(' · '));
 }
 const s=t.stages;
 console.log(`   fáze: povinné ${s.allRequired} → obě strany ${s.both} · pozice běží ${s.busy} · nastavení ${s.setups} → hodnocení ${s.skipRating} · R:R ${s.skipRR} · překážka ${s.skipObstacle} · chybí úroveň ${s.skipLevel} → ${dg.entryType==='limit'?'limitů':'pokusů o vstup'} ${s.placed}`);
 console.log(`         → seance ${s.blockSession} · zprávy ${s.blockNews} · plno ${s.blockFull} · limit obchodů ${s.blockTrades} · ztrátové stopky ${s.blockLoss}${dg.entryType==='limit'?` · vypršelo ${s.expired} · čeká na konci ${s.pendingAtEnd}`:''} → otevřeno ${s.opened}`);
}
for(const x of defs){
 if(!x.def){console.log(`${x.id} · ${x.name} · v${x.version}: neplatná definice (${x.errors.length} chyb) – přeskočeno`);failed++;continue}
 const def=x.def,tf=def.data,all=defRuns(def).map(r=>r.def);
 const markets=[];for(const id of def.markets)markets.push({id,bars:await bars(id,tf)});
 const ctx={cot,news,extra:{},d1:{}};
 for(const c of all.flatMap(z=>z.conditions)){
  if(c.block==='rel_strength'){const o=String(c.params.other);ctx.extra[o]??=await bars(o,tf)}
  if(c.block==='seasonality'&&tf==='H1')for(const id of def.markets)ctx.d1[id]??=await bars(id,'D1');
  if(c.block==='dxy_trend'&&!ctx.dxy){const dx=await bars('DX-Y.NYB',tf);if(dx.length)ctx.dxy=dx;else{const by={};for(const [p] of DXY_WEIGHTS)by[p]=await bars(p,tf);ctx.dxy=syntheticDxy(by)}}
 }
 log(`${x.id} · ${x.name} · v${x.version} · ${tf} · ${markets.filter(m=>m.bars.length).length}/${markets.length} trhů · variant ${all.length}`);
 let res;
 try{res=runStrategy(def,markets,ctx,{shuffles,seed,now})}catch(e){console.error(`  výpočet selhal: ${e.message}`);failed++;continue}
 for(const v of res.variants){const i=v.metrics.is,o=v.metrics.oos;
  console.log(`  ${v.name.padEnd(16)} IS ${String(i.trades).padStart(4)} obch. ${String(i.avgR??'–').padStart(7)} R PF ${i.pf??'–'} | OOS ${String(o.trades).padStart(4)} obch. ${String(o.avgR??'–').padStart(7)} R PF ${o.pf??'–'} DD ${o.maxDd} | ${v.robust?'ROBUSTNÍ':'–'}`)}
 if(diagOn&&res.variants[0].diag)printDiag(res.variants[0].diag);
 if(diagOut)diagAll.push({id:x.id,name:x.name,version:x.version,data:res.data,from:res.from,split:res.split,to:res.to,variants:res.variants.map(v=>({name:v.name,diag:v.diag,is:v.metrics.is,oos:v.metrics.oos}))});
 console.log(`  hranice náhody ${res.chance?.median??'–'} R (max ${res.chance?.max??'–'}) · ${res.splitRule} · ${(res.ms/1000).toFixed(1)} s`);
 if(!dry){try{const id=await st.saveRun(d,uid,x.id,x.version,{shuffles,seed},res,now);log('  uloženo',id)}
  catch(e){console.error('  uložení selhalo –',e.code||e.message,e.code==='ER_NO_SUCH_TABLE'?'(spusť migraci 0035_lab_strategy_defs.sql)':'');process.exit(1)}}
}
if(diagOut){writeFileSync(diagOut,JSON.stringify({computedAt:new Date(now).toISOString(),defs:diagAll},null,1));log('diagnostika zapsána mimo repozitář')}
process.exit(failed?1:0);
