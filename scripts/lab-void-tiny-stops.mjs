// Laboratoř · Simulace: jednorázové zneplatnění obchodů se stopem pod minimem (|vstup − SL| < max(k_spread × výchozí spread trhu,
// k_atr × ATR14 vstupního TF), lib/lab/strat-engine.ts minStopAt / minStopDist; agenti R… s koeficienty ze své zmrazené definice, ostatní
// varianty D1 a výchozí 3 / 0,25). Oprava nesmyslných R (stop zlomek pipu od vstupu → R v desítkách). Mechanika jako
// scripts/lab-void-closed-market.mjs (migrace 0032 void_reason): neplatný obchod se nepočítá do zůstatku, statistik, křivky ani fitness.
// Idempotentní: bere jen obchody s void_reason IS NULL. Výchozí --dry (nic nezapisuje), zápis jen s --apply.
//   node --experimental-strip-types scripts/lab-void-tiny-stops.mjs [--dry] [--apply] [--owner-email x@y] [--variant R03] [--no-equity] [--fixture soubor.json]
// --apply: uzavřené neplatné → void_reason (P&L zůstane v DB pro kontrolu); otevřené → zavřou se teď jako neplatné (bez ceny, R ani P&L);
//   křivka lab_paper_equity: od slotu uzavření neplatného obchodu se odečte jeho P&L (sloupec equity = uzavřený zůstatek). --no-equity = křivku nechat.
// --fixture = syntetická data bez DB ({defs:{R01:def},bars:{"EUR/USD:H1":[[t,o,h,l,c]…]},trades:[{id,variant,instrument,opened,closed,entry,sl,pnlCzk}]}, časy ISO), vždy jen --dry.
import {readFileSync} from 'node:fs';
import {tinyStopPlan} from '../lib/lab/void.ts';
import {minStopAt} from '../lib/lab/strat-engine.ts';

const args=process.argv.slice(2),apply=args.includes('--apply'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const now=Date.now(),SLOT=15*60000,DAY=86400000;
const iso=t=>t===null?'–':new Date(t).toISOString().slice(0,16).replace('T',' ');
const fixture=opt('--fixture'),onlyVar=opt('--variant');
// okno svíček před vstupem: dost na ATR14 i vyššího vstupního TF (H1 → 150 dní, D1 → 800 dní)
const WINDOW={H1:150*DAY,D1:800*DAY};
let trades,defs={},d=null,uid=null,barsOf;
if(fixture){
 if(apply){console.error('lab-void-tiny: --fixture jen bez --apply');process.exit(1)}
 const j=JSON.parse(readFileSync(fixture,'utf8'));
 defs=j.defs??{};
 trades=j.trades.map(t=>({...t,opened:Date.parse(t.opened),closed:t.closed?Date.parse(t.closed):null,voidReason:t.voidReason??null}));
 barsOf=async(id,tf)=>(j.bars?.[id+':'+tf]??[]).map(([t,o,h,l,c])=>({t:typeof t==='string'?Date.parse(t):t,o,h,l,c}));
}else{
 const {loadEnv,openDb,ownerId}=await import('./lab-history.mjs');
 const env=loadEnv('.auth.env','.mariadb.env');
 if(!env.MARIADB_HOST){console.error('lab-void-tiny: chybí .mariadb.env (lokálně použij --fixture)');process.exit(1)}
 d=await openDb(env);const owner=await ownerId(d,env,opt('--owner-email'));
 if(!owner){console.error('lab-void-tiny: vlastník nenalezen (OWNER_EMAIL / --owner-email)');process.exit(1)}
 uid=owner.id;
 const {fromSql,listAccounts}=await import('../lib/lab/paper-store.ts');
 for(const a of await listAccounts(d,uid))if(a.rule)defs[a.variant]=a.rule.def;
 trades=(await d.prepare('SELECT id,variant,instrument,opened,closed,entry,sl,exit_reason,pnl_czk,void_reason FROM lab_paper_trades WHERE user_id=? AND void_reason IS NULL').bind(uid).all()).results
  .map(r=>({id:r.id,variant:r.variant,instrument:r.instrument,opened:fromSql(r.opened),closed:fromSql(r.closed),entry:Number(r.entry),sl:Number(r.sl),exitReason:r.exit_reason,pnlCzk:r.pnl_czk===null?null:Number(r.pnl_czk),voidReason:r.void_reason}));
 const {loadBars}=await import('../lib/bars/query.ts');
 barsOf=async(id,tf,from,to)=>(await loadBars(d,id,tf,from,to)).map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c}));
}
if(onlyVar)trades=trades.filter(t=>t.variant===onlyVar);
// svíčky po trzích a TF jednou (okno od nejstaršího vstupu)
const need=new Map();for(const t of trades){const tf=defs[t.variant]?.data??'D1',k=t.instrument+':'+tf;need.set(k,Math.min(need.get(k)??Infinity,t.opened))}
const cache=new Map();for(const [k,from] of need){const i=k.lastIndexOf(':'),id=k.slice(0,i),tf=k.slice(i+1);cache.set(k,await barsOf(id,tf,from-WINDOW[tf],now+DAY))}
let missing=0;
const withMin=trades.map(t=>{const def=defs[t.variant]??null,tf=def?.data??'D1',bars=cache.get(t.instrument+':'+tf)??[];
 const minDist=bars.length?minStopAt(def,t.instrument,bars.filter(b=>b.t>=t.opened-WINDOW[tf]),t.opened,t.entry):null;if(minDist===null)missing++;return {...t,minDist}});
const plan=tinyStopPlan(withMin);
const px=v=>v>=100?v.toFixed(3):v.toFixed(5);
console.log(`lab-void-tiny ${apply?'APPLY':'DRY'} ${new Date(now).toISOString()} · platných obchodů ${trades.filter(t=>!t.voidReason).length}, bez svíček pro minimum ${missing}, stop pod minimem ${plan.length} (otevřených ${plan.filter(a=>a.wasOpen).length})`);
for(const a of plan)console.log(`${a.variant.padEnd(4)} ${a.instrument.padEnd(9)} ${iso(a.opened)} → ${a.wasOpen?'OTEVŘENÝ (zavře se jako neplatný)':iso(a.closed)}  stop ${px(a.dist)} < min ${px(a.minDist)}  ${a.pnlCzk===null?'':(a.pnlCzk>=0?'+':'')+a.pnlCzk+' Kč  '}[${a.id}]`);
const byVar={};for(const a of plan){const v=byVar[a.variant]??={n:0,pnl:0};v.n++;v.pnl+=a.pnlCzk??0}
for(const [v,x] of Object.entries(byVar).sort())console.log(`souhrn ${v}: ${x.n} obchodů, z P&L se odečte ${Math.round(x.pnl*100)/100} Kč`);
if(!apply||!d){if(!fixture)console.log('\n(dry – nic nezapsáno; zápis: --apply)');process.exit(0)}

const {toSql,addLog}=await import('../lib/lab/paper-store.ts');
let done=0,eq=0;
for(const a of plan){
 const r=a.wasOpen
  ?await d.prepare('UPDATE lab_paper_trades SET void_reason=?,closed=?,exit_price=NULL,exit_reason=NULL,r=NULL,pnl_czk=NULL,pct=NULL,result_note=? WHERE id=? AND user_id=? AND void_reason IS NULL AND closed IS NULL')
    .bind(a.reason,toSql(now,true),'Neplatný – stop pod minimem (blíž než minimální vzdálenost podle spreadu / ATR), zavřen bez P&L.',a.id,uid).run()
  :await d.prepare('UPDATE lab_paper_trades SET void_reason=? WHERE id=? AND user_id=? AND void_reason IS NULL').bind(a.reason,a.id,uid).run();
 if(!r.meta.changes)continue;done++;
 // křivka: uzavřený zůstatek od slotu uzavření bez P&L neplatného obchodu (jen když se void opravdu zapsal → opakovaný běh neodečte dvakrát)
 if(!a.wasOpen&&a.pnlCzk&&!args.includes('--no-equity')){
  const e=await d.prepare('UPDATE lab_paper_equity SET equity=equity-? WHERE user_id=? AND variant=? AND at>=?').bind(a.pnlCzk,uid,a.variant,toSql(Math.floor(a.closed/SLOT)*SLOT)).run();eq+=e.meta.changes;
 }
}
for(const [v,x] of Object.entries(byVar))await addLog(d,uid,now,`Zneplatněno ${x.n} obchodů se stopem pod minimem (oprava minimální vzdálenosti stopu) – nepočítají se do zůstatku ani statistik.`,v);
try{const {refreshSummary}=await import('../lib/lab/store.ts');await refreshSummary(d,uid)}catch(e){console.error('lab-void-tiny: shrnutí pro AI',e.message)}
console.log(`lab-void-tiny hotovo: zneplatněno ${done}, upravených snímků křivky ${eq}`);
process.exit(0);
