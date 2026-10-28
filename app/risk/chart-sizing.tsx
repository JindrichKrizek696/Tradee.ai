'use client';
// Graf: velikost pozice v nástroji long/short pro vybraný profil účtu (štítek R:R) a řádek „Účet“ v panelu stylu pozice.
import {styleOf,type Drawing} from '@/lib/chart/drawings';
import {defaultInstrumentFor} from '@/lib/risk/instruments';
import {positionSize,sizeLine} from '@/lib/risk/size';
import {activeProfiles,rateOf,specOf,defaultRiskPct,useRisk,useProfilePref,writeProfilePref,type RiskContext} from './risk-context';
/** Text do štítku pozice: „XAUUSD: 0,5 lotu · riziko 200 USD“; bez profilu nebo instrumentu null. Riziko = částka z panelu, jinak max. riziko profilu (1 %). */
export function chartSizing(d:Drawing,ctx:RiskContext|null,pref:string,market:string):string|null{
 if(!ctx||(d.type!=='long'&&d.type!=='short')||d.a.length<3)return null;
 const ps=activeProfiles(ctx);if(!ps.length)return null;
 const p=ps.find(x=>x.id===pref)||ps[0],inst=defaultInstrumentFor(ctx.instruments,market);if(!inst)return null;
 const spec=specOf(ctx,p.id,inst.id);if(!spec)return null;
 const st=styleOf(d),fixed=st.risk!==null&&st.risk>0;
 const r=positionSize({spec,entry:d.a[0].p,stop:d.a[1].p,target:d.a[2].p,accountCcy:p.currency,balance:p.status?.balance??p.balance??p.startBalance,mode:fixed?'fixed':'pct',value:fixed?st.risk!:defaultRiskPct(p),remainingDD:p.status?.drawdown?.remaining??null,remainingDaily:p.status?.daily?.remaining??null,rate:rateOf(ctx)});
 return `${inst.id}: ${sizeLine(r,p.currency)}`;
}
/** Řádek panelu stylu pozice: výběr profilu účtu, výsledek a odkaz do kalkulačky. */
export function SizingRow({d,market}:{d:Drawing;market:string}){
 const {data}=useRisk(),pref=useProfilePref(),ps=activeProfiles(data);
 if(!data)return null;
 if(!ps.length)return <div className="mc-row"><span>Objem</span><small className="mc-hint"><a href="/ucty">Založ profil účtu</a> a pozice ukáže loty / kontrakty a riziko v penězích.</small></div>;
 const cur=ps.find(p=>p.id===pref)||ps[0],line=chartSizing(d,data,cur.id,market),inst=defaultInstrumentFor(data.instruments,market);
 const q=new URLSearchParams({trh:market,vstup:String(d.a[0].p),stop:String(d.a[1].p),cil:String(d.a[2].p)});
 return <>
  <label className="mc-row"><span>Účet</span><select value={cur.id} onChange={e=>writeProfilePref(e.target.value)}>{ps.map(p=><option key={p.id} value={p.id}>{p.name} · {p.currency}</option>)}</select></label>
  <div className="mc-row"><span>Objem</span><small className="mc-hint">{line??'Pro tento trh Tradee nezná obchodovaný instrument.'}{inst?.proxy?` (cena z ${inst.dataSymbol}, ne ${inst.id})`:''} · <a href={'/kalkulacka?'+q}>kalkulačka</a></small></div>
 </>;
}
