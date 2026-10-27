// Laboratoř · Simulace: jednorázové zneplatnění obchodů otevřených nebo zavřených při zavřeném trhu (lib/lab/void.ts voidPlan, lib/market-hours.ts isMarketOpen).
// Po migraci 0032_lab_void.sql. Idempotentní: bere jen obchody s void_reason IS NULL. Výchozí --dry (nic nezapisuje), zápis jen s --apply.
//   node --experimental-strip-types scripts/lab-void-closed-market.mjs [--dry] [--apply] [--owner-email x@y] [--no-equity] [--fixture soubor.json]
// --apply: uzavřené neplatné → jen void_reason (P&L zůstane v DB pro kontrolu, nikde se nepočítá); otevřené neplatné → zavřou se teď jako neplatné
//   (bez ceny, R ani P&L) a uvolní místo; křivka lab_paper_equity: od slotu uzavření neplatného obchodu se odečte jeho P&L (jen sloupec equity =
//   uzavřený zůstatek; historický open_pnl mohl obsahovat i neplatné otevřené pozice a přepočítat nejde – bez živých cen z té doby). --no-equity = křivku nechat.
// --fixture = syntetická data bez DB ({trades:[{id,variant,instrument,opened,closed,exitReason,pnlCzk}]}, časy ISO), vždy jen --dry.
import {readFileSync} from 'node:fs';
import {voidPlan} from '../lib/lab/void.ts';

const args=process.argv.slice(2),apply=args.includes('--apply'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const now=Date.now(),SLOT=15*60000;
const iso=t=>t===null?'–':new Date(t).toISOString().slice(0,16).replace('T',' ');
const fixture=opt('--fixture');
let trades,d=null,uid=null;
if(fixture){
 if(apply){console.error('lab-void: --fixture jen bez --apply');process.exit(1)}
 const j=JSON.parse(readFileSync(fixture,'utf8'));
 trades=j.trades.map(t=>({...t,opened:Date.parse(t.opened),closed:t.closed?Date.parse(t.closed):null,voidReason:t.voidReason??null}));
}else{
 const {loadEnv,openDb,ownerId}=await import('./lab-history.mjs');
 const env=loadEnv('.auth.env','.mariadb.env');
 if(!env.MARIADB_HOST){console.error('lab-void: chybí .mariadb.env (lokálně použij --fixture)');process.exit(1)}
 d=await openDb(env);const owner=await ownerId(d,env,opt('--owner-email'));
 if(!owner){console.error('lab-void: vlastník nenalezen (OWNER_EMAIL / --owner-email)');process.exit(1)}
 uid=owner.id;
 const {fromSql}=await import('../lib/lab/paper-store.ts');
 trades=(await d.prepare('SELECT id,variant,instrument,opened,closed,exit_reason,pnl_czk,void_reason FROM lab_paper_trades WHERE user_id=?').bind(uid).all()).results
  .map(r=>({id:r.id,variant:r.variant,instrument:r.instrument,opened:fromSql(r.opened),closed:fromSql(r.closed),exitReason:r.exit_reason,pnlCzk:r.pnl_czk===null?null:Number(r.pnl_czk),voidReason:r.void_reason}));
}
const plan=voidPlan(trades);
console.log(`lab-void ${apply?'APPLY':'DRY'} ${new Date(now).toISOString()} · obchodů ${trades.length}, už neplatných ${trades.filter(t=>t.voidReason).length}, nově neplatných ${plan.length} (otevřených ${plan.filter(a=>a.wasOpen).length})`);
for(const a of plan)console.log(`${a.variant.padEnd(4)} ${a.instrument.padEnd(9)} ${iso(a.opened)} → ${a.wasOpen?'OTEVŘENÝ (zavře se jako neplatný)':iso(a.closed)}  ${a.pnlCzk===null?'':(a.pnlCzk>=0?'+':'')+a.pnlCzk+' Kč  '}${a.reason}  [${a.id}]`);
const byVar={};for(const a of plan){const v=byVar[a.variant]??={n:0,pnl:0};v.n++;v.pnl+=a.pnlCzk??0}
for(const [v,x] of Object.entries(byVar).sort())console.log(`souhrn ${v}: ${x.n} obchodů, z P&L se odečte ${Math.round(x.pnl*100)/100} Kč`);
if(!apply||!d){if(!fixture)console.log('\n(dry – nic nezapsáno; zápis: --apply)');process.exit(0)}

const {toSql,addLog}=await import('../lib/lab/paper-store.ts');
let done=0,eq=0;
for(const a of plan){
 const r=a.wasOpen
  ?await d.prepare('UPDATE lab_paper_trades SET void_reason=?,closed=?,exit_price=NULL,exit_reason=NULL,r=NULL,pnl_czk=NULL,pct=NULL,result_note=? WHERE id=? AND user_id=? AND void_reason IS NULL AND closed IS NULL')
    .bind(a.reason,toSql(now,true),`Neplatný – ${a.reason}: obchod otevřen při zavřeném trhu, zavřen bez P&L (oprava obchodních hodin).`,a.id,uid).run()
  :await d.prepare('UPDATE lab_paper_trades SET void_reason=? WHERE id=? AND user_id=? AND void_reason IS NULL').bind(a.reason,a.id,uid).run();
 if(!r.meta.changes)continue;done++;
 // křivka: uzavřený zůstatek od slotu uzavření bez P&L neplatného obchodu (jen když se void opravdu zapsal → opakovaný běh neodečte dvakrát)
 if(!a.wasOpen&&a.pnlCzk&&!args.includes('--no-equity')){
  const e=await d.prepare('UPDATE lab_paper_equity SET equity=equity-? WHERE user_id=? AND variant=? AND at>=?').bind(a.pnlCzk,uid,a.variant,toSql(Math.floor(a.closed/SLOT)*SLOT)).run();eq+=e.meta.changes;
 }
}
for(const [v,x] of Object.entries(byVar))await addLog(d,uid,now,`Zneplatněno ${x.n} obchodů otevřených / zavřených při zavřeném trhu (oprava obchodních hodin) – nepočítají se do zůstatku ani statistik.`,v);
try{const {refreshSummary}=await import('../lib/lab/store.ts');await refreshSummary(d,uid)}catch(e){console.error('lab-void: shrnutí pro AI',e.message)}
console.log(`lab-void hotovo: zneplatněno ${done}, upravených snímků křivky ${eq}`);
process.exit(0);
