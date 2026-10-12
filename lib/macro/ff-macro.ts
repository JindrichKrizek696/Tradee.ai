// PMI a maloobchod z exportu ForexFactory (data/ff-calendar.json). Čistá logika; kontrola: node --experimental-strip-types scripts/check-ff-macro.mjs
//
// Export nemá skutečné (actual) hodnoty, jen forecast a previous. Proto platí:
//  • U FINÁLNÍHO PMI (titul „Final … PMI“) je forecast FF = flash odhad, finální číslo se od něj liší jen málo → hodnota období
//    = forecast, basis „final≈flash“ (pouze po vydání, tj. at ≤ now).
//  • `previous` jakéhokoli pozdějšího vydání je POTVRZENÁ hodnota předchozího období → basis „previous“.
//  • forecast nevydané události je jen odhad → basis „forecast-pending“; vybere se jen, když není nic jiného, a skórování ho ignoruje.
// Výběr: nejnovější období; při shodě vyhrává potvrzené „previous“ před „final≈flash“, pak pozdější vydání.
// Období z data vydání (heuristika):
//  • PMI (flash ~20.–25., final/ISM/Ivey/procure/BusinessNZ ~1.–10.): den ≤ 15 → předchozí měsíc, jinak měsíc vydání.
//  • Maloobchod: měsíc vydání − zpoždění (EUR 2 měsíce, ostatní 1), NZD čtvrtletně − 1 čtvrtletí.
export type MacroUnit='index'|'%';
export type MacroBasis='final≈flash'|'previous'|'forecast-pending';
export type MacroValue={value:number;unit:MacroUnit;period:string;basis:MacroBasis;note:string;releasedAt:number;kind?:'m/m'|'q/q'|'y/y'};
export type CurrencyMacro={mpmi?:MacroValue;spmi?:MacroValue;retailSales?:MacroValue};
export type FFMacro={updated:string;currencies:Record<string,CurrencyMacro>};
export type FFRowLike={at:string;currency:string;title:string;forecast:string|null;previous:string|null};

export const MACRO_CURRENCIES=['USD','EUR','GBP','JPY','CHF','AUD','NZD','CAD'];
const DAY=86400000;
export const MACRO_KEEP_DAYS=120;

// Seznam [regex titulu, preference]; vyhrává nejvyšší preference, která má aspoň jednu událost.
type Def={re:RegExp;pref:number;unit:MacroUnit;kind?:'m/m'|'q/q'|'y/y';label?:string};
const MPMI:Record<string,Def[]>={
 USD:[{re:/^ISM Manufacturing PMI$/i,pref:2,unit:'index'},{re:/^(?:Final |Flash )?Manufacturing PMI$/i,pref:1,unit:'index'}],
 CAD:[{re:/^(?:Final |Flash )?Manufacturing PMI$/i,pref:2,unit:'index'},{re:/^Ivey PMI$/i,pref:0,unit:'index',label:'Ivey PMI (náhrada za výrobní PMI)'}],
 NZD:[{re:/^Business ?NZ Manufacturing (?:PMI|Index)$/i,pref:1,unit:'index'}],
};
const SPMI:Record<string,Def[]>={
 USD:[{re:/^ISM (?:Non-Manufacturing|Services) PMI$/i,pref:2,unit:'index'},{re:/^(?:Final |Flash )?Services PMI$/i,pref:1,unit:'index'}],
 NZD:[{re:/^Business ?NZ Services (?:PMI|Index)$/i,pref:1,unit:'index'}],
};
const GENERIC_M:Def[]=[{re:/^(?:Final |Flash )?Manufacturing PMI$/i,pref:1,unit:'index'}];
const GENERIC_S:Def[]=[{re:/^(?:Final |Flash )?Services PMI$/i,pref:1,unit:'index'}];
const RETAIL:Record<string,Def[]>={};
const retailDefs=(c:string):Def[]=>RETAIL[c]??[
 {re:/^Retail Sales m\/m$/i,pref:4,unit:'%',kind:'m/m'},{re:/^Retail Sales q\/q$/i,pref:3,unit:'%',kind:'q/q'},
 {re:/^Retail Sales y\/y$/i,pref:2,unit:'%',kind:'y/y'},
 ...(c==='AUD'?[{re:/^Household Spending m\/m$/i,pref:1,unit:'%' as MacroUnit,kind:'m/m' as const,label:'Household Spending'}]:[]),
];

/** Číslo z textu FF („49.8“, „0.2%“, „-0.6%“); jinak null. */
export function parseNum(s:string|null|undefined):number|null{
 if(!s)return null;
 const m=/^\s*([+\-−]?\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(s);
 return m?Number(m[1].replace('−','-').replace(',','.')):null;
}

const MONTH=['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];
const cz=(n:number,unit:MacroUnit)=>n.toLocaleString('cs-CZ',{minimumFractionDigits:1,maximumFractionDigits:2})+(unit==='%'?' %':'');
// Období jako pořadové číslo (měsíc: rok*12+m−1, čtvrtletí: rok*4+q−1) a jeho zápis.
const monthStr=(o:number)=>`${Math.floor(o/12)}-${String(o%12+1).padStart(2,'0')}`;
const quarterStr=(o:number)=>`${Math.floor(o/4)} Q${o%4+1}`;
const periodName=(o:number,q:boolean)=>q?`${o%4+1}. čtvrtletí ${Math.floor(o/4)}`:`${MONTH[o%12]} ${Math.floor(o/12)}`;

function pick(defs:Def[],c:string,rows:FFRowLike[]){
 const hit=(r:FFRowLike)=>defs.find(d=>d.re.test(r.title));
 const by=new Map<number,{def:Def;r:FFRowLike}[]>();
 for(const r of rows){if(r.currency!==c)continue;const d=hit(r);if(d){(by.get(d.pref)??by.set(d.pref,[]).get(d.pref)!).push({def:d,r})}}
 const top=Math.max(...by.keys());
 return Number.isFinite(top)?by.get(top)!.sort((a,b)=>a.r.at.localeCompare(b.r.at)):[];
}

type Cand={v:number;period:number;rank:number;at:number;basis:MacroBasis;def:Def;title:string};

function derive(defs:Def[],c:string,rows:FFRowLike[],now:number,retail:boolean):MacroValue|undefined{
 const evs=pick(defs,c,rows);if(!evs.length)return undefined;
 const quarterly=evs[0].def.kind==='q/q';
 const cands:Cand[]=[];
 for(const {def,r} of evs){
  const t=Date.parse(r.at);if(!Number.isFinite(t))continue;
  const dt=new Date(t),y=dt.getUTCFullYear(),m=dt.getUTCMonth(),d=dt.getUTCDate();
  let p:number;
  if(retail)p=quarterly?y*4+Math.floor(m/3)-1:y*12+m-(c==='EUR'?2:1);
  else p=y*12+m-(d<=15?1:0);
  const step=1,released=t<=now,isFinal=/^Final /i.test(r.title),fc=parseNum(r.forecast),pv=parseNum(r.previous);
  if(isFinal&&released&&fc!==null)cands.push({v:fc,period:p,rank:1,at:t,basis:'final≈flash',def,title:r.title});
  if(pv!==null)cands.push({v:pv,period:p-step,rank:2,at:t,basis:'previous',def,title:r.title});
  if(!released&&fc!==null)cands.push({v:fc,period:p,rank:0,at:t,basis:'forecast-pending',def,title:r.title});
 }
 if(!cands.length)return undefined;
 const confirmed=cands.filter(x=>x.basis!=='forecast-pending'),pool=confirmed.length?confirmed:cands;
 pool.sort((a,b)=>b.period-a.period||b.rank-a.rank||b.at-a.at);
 const w=pool[0],unit=w.def.unit,lab=w.def.label?w.def.label+': ':'';
 const when=new Date(w.at),dm=`${when.getUTCDate()}. ${when.getUTCMonth()+1}.`;
 const note=lab+(w.basis==='final≈flash'?`finální ${periodName(w.period,quarterly)} ≈ flash ${cz(w.v,unit)} (ForexFactory)`
  :w.basis==='previous'?`poslední zveřejněná hodnota ${cz(w.v,unit)} – uvedena u vydání ${dm}`
  :`odhad ${cz(w.v,unit)} před vydáním ${dm} (ForexFactory)`);
 return {value:w.v,unit,period:quarterly?quarterStr(w.period):monthStr(w.period),basis:w.basis,note,releasedAt:w.at,...(w.def.kind?{kind:w.def.kind}:{})};
}

/** PMI (výroba, služby) a maloobchod pro 8 měn z řádků FF; chybějící řada se vynechá. */
export function deriveMacro(rows:FFRowLike[],now:number):FFMacro{
 const recent=rows.filter(r=>Date.parse(r.at)>=now-MACRO_KEEP_DAYS*DAY);
 const currencies:Record<string,CurrencyMacro>={};
 for(const c of MACRO_CURRENCIES){
  const o:CurrencyMacro={};
  const m=derive(MPMI[c]??GENERIC_M,c,recent,now,false),s=derive(SPMI[c]??GENERIC_S,c,recent,now,false),r=derive(retailDefs(c),c,recent,now,true);
  if(m)o.mpmi=m;if(s)o.spmi=s;if(r)o.retailSales=r;
  currencies[c]=o;
 }
 return {updated:new Date(now).toISOString().replace(/\.\d+Z$/,'Z'),currencies};
}
