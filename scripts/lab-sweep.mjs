// Laboratoř · Hledání prahů: historický sweep parametrů (lib/lab/sweep.ts) nad D1 svíčkami → lab_sweeps (jen vlastník, OWNER_EMAIL).
// node --experimental-strip-types scripts/lab-sweep.mjs [--dry] [--source db|yahoo] [--shuffles 20] [--seed 42] [--workers N] [--out soubor.json] [--cache adresář] [--owner-email x@y]
//   --workers = počet vláken (výchozí počet jader − 1, max 6; 1 = bez vláken). Výsledek nezávisí na počtu vláken.
//   VPS (je .mariadb.env): svíčky z market_bars (lib/bars/query.ts loadBars), COT z lab_cot, výsledek do lab_sweeps (posledních 10).
//   Lokálně / --source yahoo: svíčky přímo z Yahoo (denní od 2003, FX open = předchozí close jako loadBars) a COT přímo z CFTC (Socrata);
//   nic se neukládá do DB, výsledek jen do --out. --cache = uloží/čte stažená data (opakované běhy bez sítě).
//   --dry = spočítá, ale do DB nezapisuje. Běh: celý grid (7 776 kombinací) + 20× grid s náhodnými směry (hranice náhody).
// Nic z výsledku se nepouští do simulace automaticky – to dělá vlastník tlačítkem v Laboratoři.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {pairs} from '../lib/score-engine.ts';
import {cpus} from 'node:os';
import {Worker} from 'node:worker_threads';
import {prepareMarket,buildContext,runSweep,finishSweep,shuffleSeed,SWEEP_COMMODITIES,SWEEP_INDICES,SWEEP_SIZE,F,comboAt,comboKey} from '../lib/lab/sweep.ts';
import {cotForInstrument} from '../lib/lab/study.ts';

const args=process.argv.slice(2),dry=args.includes('--dry'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const load=f=>{try{return Object.fromEntries(readFileSync(new URL('../'+f,import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2')]))}catch{return {}}};
const env={...load('.auth.env'),...load('.mariadb.env')};
const source=opt('--source')||(env.MARIADB_HOST?'db':'yahoo');
const shuffles=Number(opt('--shuffles')??20),seed=Number(opt('--seed')??42),cache=opt('--cache'),now=Date.now();
const markets=[...pairs,...SWEEP_COMMODITIES,...SWEEP_INDICES];
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

let d=null,uid=null,bars={},cot={};
if(source==='db'){
 if(!env.MARIADB_HOST){console.error('lab-sweep: chybí .mariadb.env (lokálně použij --source yahoo)');process.exit(1)}
 const {createDb}=await import('../lib/mysql.ts');
 d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
 const ownerEmail=(opt('--owner-email')||process.env.OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase();
 const owner=ownerEmail?await d.prepare('SELECT id FROM members WHERE LOWER(email)=?').bind(ownerEmail).first():null;
 if(!owner){console.log('lab-sweep: vlastník nenalezen (OWNER_EMAIL / --owner-email) – nic nedělám');process.exit(0)}
 uid=owner.id;
 const {loadBars}=await import('../lib/bars/query.ts');
 for(const id of markets)bars[id]=(await loadBars(d,id,'D1',0,now+86400000)).map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c}));
 try{const {loadCot}=await import('../lib/lab/store.ts');cot=await loadCot(d)}catch(e){console.warn('lab-sweep: lab_cot nejde načíst –',e.code||e.message)}
}else{
 const file=n=>cache?cache.replace(/\/$/,'')+'/'+n:null;
 const cached=n=>{const f=file(n);return f&&existsSync(f)?JSON.parse(readFileSync(f,'utf8')):null};
 const store=(n,v)=>{const f=file(n);if(f){mkdirSync(cache,{recursive:true});writeFileSync(f,JSON.stringify(v))}};
 bars=cached('bars.json')||{};
 if(!Object.keys(bars).length){
  const {yahooSymbol}=await import('../lib/live.ts');
  const {fxCurrencies}=await import('../lib/markets.ts');
  const {parseBars,planUrl}=await import('../lib/bars/yahoo.ts');
  const {fixFxOpen}=await import('../lib/bars/query.ts');
  for(const id of markets){
   const sym=yahooSymbol(id,fxCurrencies);
   for(let a=0;;a++){try{const r=await fetch(planUrl(sym,{tf:'D1',interval:'1d',period1:Math.floor(Date.UTC(2003,0,1)/1000),period2:Math.floor(now/1000)}),{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);
     const b=parseBars(await r.json()).bars;bars[id]=(id.includes('/')?fixFxOpen(b):b).map(x=>({t:x.t,o:x.o,h:x.h,l:x.l,c:x.c}));break}catch(e){if(a>=3){console.warn('svíčky',id,e.message);bars[id]=[];break}await new Promise(r=>setTimeout(r,1500*2**a))}}
  }
  store('bars.json',bars);
 }
 cot=cached('cot.json');
 if(!cot){
  // stejné kontrakty a sloupce jako scripts/lab-cot-history.mjs (TFF leveraged pro měny, Disaggregated managed money pro komodity)
  const TFF={CAD:'090741',JPY:'097741',EUR:'099741',AUD:'232741',USD:'098662',NZD:'112741',GBP:'096742',CHF:'092741'},DIS={'GC=F':'088691','SI=F':'084691','CL=F':'067651'};
  const socrata=async(ds,codes)=>{const out=[];for(let off=0;;off+=50000){const q=new URLSearchParams({'$where':`cftc_contract_market_code in (${codes.map(c=>`'${c}'`).join(',')}) AND report_date_as_yyyy_mm_dd >= '2006-01-01T00:00:00'`,'$order':'report_date_as_yyyy_mm_dd ASC','$limit':'50000','$offset':String(off)});
   const r=await fetch(`https://publicreporting.cftc.gov/resource/${ds}.json?${q}`,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('CFTC HTTP '+r.status);const rows=await r.json();out.push(...rows);if(rows.length<50000)return out}};
  cot={};
  try{
   const add=(raw,map,grp,[l,s,sp])=>{for(const [m,code] of Object.entries(map)){const rows=raw.filter(r=>r.cftc_contract_market_code===code).map(r=>{const L=Number(r[l]),S=Number(r[s]),oi=Number(r.open_interest_all);return {date:String(r.report_date_as_yyyy_mm_dd).slice(0,10),openInterest:oi,groups:{[grp]:{long:L,short:S,spread:Number(r[sp]||0),net:L-S}}}}).filter(r=>r.openInterest>0&&Number.isFinite(r.groups[grp].net));
    if(rows.length)cot[m]={rows,group:grp,proxy:m==='USD'}}};
   add(await socrata('gpe5-46if',Object.values(TFF)),TFF,'leveraged',['lev_money_positions_long','lev_money_positions_short','lev_money_positions_spread']);
   add(await socrata('72hh-3qpy',Object.values(DIS)),DIS,'managedMoney',['m_money_positions_long_all','m_money_positions_short_all','m_money_positions_spread']);
   store('cot.json',cot);
  }catch(e){console.warn('lab-sweep: COT z CFTC nejde stáhnout –',e.message,'(sweep poběží bez COT)')}
 }
}
log(`zdroj ${source}: ${markets.filter(m=>bars[m]?.length).length}/${markets.length} trhů se svíčkami, COT ${Object.keys(cot).length} řad`);
const prepared=markets.filter(m=>bars[m]?.length>250).map(m=>prepareMarket(m,bars[m],cotForInstrument(cot,m)));
const ctx=buildContext(prepared,{to:now});
log(`příprava hotová (${prepared.length} trhů, ${prepared.filter(m=>m.cot).length} s COT), grid ${SWEEP_SIZE} kombinací × ${1+shuffles}`);
let lastLog=0;
const workers=Math.max(1,Math.min(6,Number(opt('--workers')??Math.max(1,cpus().length-1))));
const progress=(done,total,phase)=>{if(Date.now()-lastLog>10000||done===total){lastLog=Date.now();log(`${phase}: ${done}/${total} (${Math.round(done/total*100)} %)`)}};
let res;
if(workers===1)res=runSweep(ctx,{shuffles,seed,now,onProgress:progress});
else{
 // úlohy: grid po blocích + každé náhodné opakování celé; pool vláken, každé si trhy připraví ze stejných dat
 const t0=Date.now(),idx=Array.from({length:SWEEP_SIZE},(_,i)=>i),total=idx.length*(1+shuffles),chunk=Math.ceil(idx.length/workers);
 const tasks=[];for(let i=0;i<idx.length;i+=chunk)tasks.push({kind:'grid',idx:idx.slice(i,i+chunk)});
 for(let k=0;k<shuffles;k++)tasks.push({kind:'shuffle',k,seed:shuffleSeed(seed,k),idx});
 tasks.forEach((t,i)=>t.id=i);
 const parts=[],best=new Array(shuffles).fill(null);let done=0,next=0;
 log(`${workers} vláken, ${tasks.length} úloh`);
 await new Promise((resolve,reject)=>{
  let alive=0;
  const feed=w=>{if(next<tasks.length)w.postMessage(tasks[next++]);else{w.terminate();if(--alive===0)resolve()}};
  for(let k=0;k<workers;k++){
   const w=new Worker(new URL('./lab-sweep-worker.mjs',import.meta.url),{workerData:{bars,cot,markets,to:now}});alive++;
   w.on('message',m=>{
    if(m.ready)return feed(w);
    if(m.progress){done+=m.progress;progress(done,total,'výpočet');return}
    done+=m.done||0;const t=tasks[m.id];
    if(t.kind==='grid')parts.push(...m.rows);else best[t.k]=m.best;
    feed(w);
   });
   w.on('error',reject);
  }
 });
 res=finishSweep(ctx,parts,{idx,reps:shuffles,seed,best,t0,now});
}
log(`hotovo za ${(res.ms/1000).toFixed(1)} s · robustních ${res.robust.length} · hranice náhody ${res.chance?.median??'–'} R (max ${res.chance?.max??'–'})`);
for(const i of res.robust.slice(0,5)){const r=res.rows[i];console.log(`  #${i} ${comboKey(comboAt(i))} | IS ${r[F.isN]} obch. ${r[F.isAvg]} R PF ${r[F.isPf]} | OOS ${r[F.oosN]} obch. ${r[F.oosAvg]} R PF ${r[F.oosPf]} DD ${r[F.oosDd]} | okolí ${r[F.nb]}`)}
const out=opt('--out');if(out){writeFileSync(out,JSON.stringify(res));log('výsledek uložen do',out)}
if(d&&!dry){
 const {saveSweep}=await import('../lib/lab/sweep-store.ts');
 try{const id=await saveSweep(d,uid,{source,shuffles,seed},res,now);log('uloženo do lab_sweeps',id)}
 catch(e){console.error('lab-sweep: uložení selhalo –',e.code||e.message,e.code==='ER_NO_SUCH_TABLE'?'(spusť migraci 0028_lab_sweep.sql)':'');process.exit(1)}
}
process.exit(0);
