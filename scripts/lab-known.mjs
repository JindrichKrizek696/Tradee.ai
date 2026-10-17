// Laboratoř · Známé strategie: historický test klasických strategií (lib/lab/known.ts) stejným enginem, náklady a IS/OOS jako
// „Hledání prahů“, s hranicí náhody po rodinách → tabulka lab_known (migrace 0030, jen vlastník OWNER_EMAIL, drží se posledních 10).
// node --experimental-strip-types scripts/lab-known.mjs [--dry] [--source db|yahoo] [--shuffles 20] [--seed 42] [--out soubor.json] [--cache adresář] [--owner-email x@y]
//   VPS (je .mariadb.env): svíčky z market_bars, COT z lab_cot, sazby z FRED; výsledek do lab_known.
//   Lokálně / --source yahoo: svíčky z Yahoo, COT z CFTC, sazby z FRED; nic se neukládá, výsledek jen do --out.
//   Carry se přeskočí (a řekne proč), když FRED sazby nejdou stáhnout; COT extrémy, když chybí COT historie.
// Úložiště: vlastní tabulka lab_known (ne lab_sweeps – ta drží jen posledních 10 sweepů a výsledek má jiný tvar).
import {writeFileSync} from 'node:fs';
import {pairs} from '../lib/score-engine.ts';
import {prepareMarket,buildContext,SWEEP_COMMODITIES,SWEEP_INDICES} from '../lib/lab/sweep.ts';
import {cotForInstrument} from '../lib/lab/study.ts';
import {knownSignals,runKnown,rateSeries,cotPctForInstrument,knownKey,KNOWN_SIZE} from '../lib/lab/known.ts';
import {loadEnv,openDb,ownerId,loadHistory,loadRates} from './lab-history.mjs';

const args=process.argv.slice(2),dry=args.includes('--dry'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const env=loadEnv('.auth.env','.mariadb.env');
const source=opt('--source')||(env.MARIADB_HOST?'db':'yahoo');
const shuffles=Number(opt('--shuffles')??20),seed=Number(opt('--seed')??42),cache=opt('--cache'),now=Date.now();
const markets=[...pairs,...SWEEP_COMMODITIES,...SWEEP_INDICES];
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);

let d=null,uid=null;
if(source==='db'){
 if(!env.MARIADB_HOST){console.error('lab-known: chybí .mariadb.env (lokálně použij --source yahoo)');process.exit(1)}
 d=await openDb(env);const o=await ownerId(d,env,opt('--owner-email'));
 if(!o){console.log('lab-known: vlastník nenalezen (OWNER_EMAIL / --owner-email) – nic nedělám');process.exit(0)}
 uid=o.id;
}
const {bars,cot}=await loadHistory({source,markets,d,cache,now,log});
const rates=await loadRates({cache});
const rateSrc=Object.fromEntries(Object.entries(rates.rows).map(([k,v])=>[k,rateSeries(v)]));
log(`zdroj ${source}: ${markets.filter(m=>bars[m]?.length).length}/${markets.length} trhů, COT ${Object.keys(cot).length} řad, sazby ${Object.keys(rates.rows).length}/8${rates.missing.length?' (chybí '+rates.missing.join(', ')+')':''}`);
const prepared=markets.filter(m=>bars[m]?.length>250).map(m=>prepareMarket(m,bars[m],cotForInstrument(cot,m)));
const ctx=buildContext(prepared,{to:now});
const cotPct=Object.fromEntries(ctx.markets.map(m=>[m.id,cotPctForInstrument(cot,m.id)]));
const skip={};
if(rates.missing.length)skip.carry=`Carry přeskočeno: z FRED nejdou stáhnout sazby ${rates.missing.join(', ')}.`;
if(!Object.values(cotPct).some(Boolean))skip.cot='COT extrémy přeskočeny: chybí historie COT (lab_cot / CFTC).';
const t0=Date.now();let last=0;
const res=runKnown(ctx,{sig:(f,v)=>ctx.markets.map(m=>knownSignals(f,v,{t:m.t,h:m.h,l:m.l,c:m.c},{id:m.id,cotPct:cotPct[m.id],rates:rateSrc}))},
 {shuffles,seed,now,skip,rates:Object.entries(rates.rows).map(([ccy,r])=>({ccy,from:r[0]?.date??null,to:r[r.length-1]?.date??null})),
  onProgress:(x,t)=>{if(Date.now()-last>10000||x===t){last=Date.now();log(`výpočet ${x}/${t}`)}}});
log(`hotovo za ${((Date.now()-t0)/1000).toFixed(1)} s · ${KNOWN_SIZE} kombinací × ${1+shuffles}`);
for(const f of res.families){
 if(f.skipped){console.log(`  ${f.label}: ${f.skipped}`);continue}
 const r=f.best===null?null:res.rows.find(x=>x.i===f.best);
 console.log(`  ${f.label}: ${r?`${knownKey(r.combo)} | IS ${r.is.trades} obch. ${r.is.avgR} R PF ${r.is.pf} | OOS ${r.oos.trades} obch. ${r.oos.avgR} R PF ${r.oos.pf} DD ${r.oos.maxDd} R | ${r.robust?'robustní':'NE robustní'} | náhoda ${f.chance.median} R → ${r.beatsChance?'NAD náhodou':'pod náhodou'}`:'bez obchodů'}`);
}
const out=opt('--out');if(out){writeFileSync(out,JSON.stringify(res));log('výsledek uložen do',out)}
if(d&&!dry){
 const {saveKnown}=await import('../lib/lab/known-store.ts');
 try{const id=await saveKnown(d,uid,{source,shuffles,seed},res,now);log('uloženo do lab_known',id)}
 catch(e){console.error('lab-known: uložení selhalo –',e.code||e.message,e.code==='ER_NO_SUCH_TABLE'?'(spusť migraci 0030_lab_agents.sql)':'');process.exit(1)}
}
process.exit(0);
