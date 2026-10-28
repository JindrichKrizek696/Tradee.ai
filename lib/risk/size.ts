// Kalkulačka velikosti pozice: jediný sdílený výpočet pro graf (long/short), stránku /kalkulacka, Deník i budoucí scénáře.
// Čisté funkce bez DB – testy scripts/check-risk.mjs.
// Ztráta na 1 lot/kontrakt = (|vstup − stop| / tick) × hodnota ticku (v měně kotace) + náklady (komise tam i zpět + spread v ceně),
// přepočtená kurzem měna kotace → měna účtu. Objem se zaokrouhluje DOLŮ na krok objemu; pod minimálním objemem obchod nejde.
import type {SizeUnit} from './instruments.ts';
export type RiskMode='pct'|'pct_dd'|'fixed';
export const RISK_MODE_LABELS:Record<RiskMode,string>={pct:'% zůstatku',pct_dd:'% zbývajícího drawdownu',fixed:'pevná částka'};
export type SizeSpec={tickSize:number;tickValue:number;quote:string;lotStep:number;minLot:number;unit:SizeUnit;pip:number|null;commission?:number;spread?:number};
/** kurz: kolik jednotek `to` za 1 jednotku `from`; null = kurz neznáme */
export type RateFn=(from:string,to:string)=>number|null;
export type SizeInput={
 spec:SizeSpec;entry:number;stop:number;target?:number|null;
 accountCcy:string;balance:number|null;
 mode:RiskMode;value:number;
 /** zbývající drawdown účtu (pro režim pct_dd) */
 remainingDD?:number|null;
 /** zbývající denní ztráta – jen pro varování */
 remainingDaily?:number|null;
 rate:RateFn;
};
export type SizeOk={ok:true;side:'long'|'short';units:number;rawUnits:number;unit:SizeUnit;budget:number;moneyAtRisk:number;lossPerUnit:number;costPerUnit:number;riskPerUnit:number;stopDistance:number;stopTicks:number;tickValueAcc:number;pipValueAcc:number|null;rate:number;rr:number|null;reward:number|null;warnings:string[]};
export type SizeErr={ok:false;code:'input'|'fx'|'balance'|'dd'|'min_lot';reason:string;rawUnits?:number;riskAtMin?:number};
export type SizeResult=SizeOk|SizeErr;
const fin=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const r2=(n:number)=>Math.round(n*100)/100;
/** počet desetinných míst kroku (0.01 → 2, 1 → 0, 0.001 → 3) */
export const stepDecimals=(step:number)=>{const s=String(step);if(s.includes('e-'))return Number(s.split('e-')[1]);const i=s.indexOf('.');return i<0?0:s.length-i-1};
/** zaokrouhlení DOLŮ na krok objemu (tolerance na plovoucí čárku: 0.29999999 → 0.3 jen když je to opravdu 0.3) */
export function floorToStep(x:number,step:number):number{
 if(!(x>0)||!(step>0))return 0;
 const d=stepDecimals(step),n=Math.floor(x/step+1e-9);
 return Number((n*step).toFixed(d));
}
const fmt=(n:number,max=4)=>n.toLocaleString('cs-CZ',{maximumFractionDigits:max});
/** Velikost pozice. Chyba vrací důvod česky („nelze spočítat: …“). */
export function positionSize(i:SizeInput):SizeResult{
 const s=i.spec;
 if(!fin(i.entry)||!fin(i.stop)||i.entry<=0||i.stop<=0)return {ok:false,code:'input',reason:'Zadej vstup a stop loss.'};
 if(i.entry===i.stop)return {ok:false,code:'input',reason:'Stop loss musí být jinde než vstup.'};
 if(!fin(i.value)||i.value<=0)return {ok:false,code:'input',reason:'Zadej riziko větší než nula.'};
 if(!(s.tickSize>0)||!(s.tickValue>0)||!(s.lotStep>0)||!(s.minLot>0))return {ok:false,code:'input',reason:'Instrument nemá vyplněný tick, hodnotu ticku nebo krok objemu.'};
 const rate=s.quote===i.accountCcy?1:i.rate(s.quote,i.accountCcy);
 if(rate===null||!fin(rate)||rate<=0)return {ok:false,code:'fx',reason:`Nelze spočítat: chybí kurz ${s.quote} → ${i.accountCcy}.`};
 const side=i.stop<i.entry?'long':'short',stopDistance=Math.abs(i.entry-i.stop),stopTicks=Math.round(stopDistance/s.tickSize*1e6)/1e6;
 const perPrice=s.tickValue/s.tickSize; // hodnota pohybu ceny o 1 za lot (měna kotace)
 const lossPerUnit=stopTicks*s.tickValue*rate,costPerUnit=((s.commission||0)+(s.spread||0)*perPrice)*rate,riskPerUnit=lossPerUnit+costPerUnit;
 let budget:number;
 if(i.mode==='fixed')budget=i.value;
 else if(i.mode==='pct'){if(!fin(i.balance)||i.balance<=0)return {ok:false,code:'balance',reason:'Nelze spočítat: účet nemá zůstatek. Doplň ho v profilu účtu.'};budget=i.balance*i.value/100}
 else{if(i.remainingDD===null||i.remainingDD===undefined||!fin(i.remainingDD))return {ok:false,code:'dd',reason:'Nelze spočítat: profil účtu nemá nastavený maximální drawdown.'};
  if(i.remainingDD<=0)return {ok:false,code:'dd',reason:'Drawdown účtu je vyčerpaný – žádné další riziko.'};budget=i.remainingDD*i.value/100}
 const rawUnits=budget/riskPerUnit,units=floorToStep(rawUnits,s.lotStep);
 if(units<s.minLot-1e-12)return {ok:false,code:'min_lot',reason:`Nelze obchodovat: na riziko ${fmt(r2(budget),2)} ${i.accountCcy} vychází ${fmt(rawUnits)} a minimum je ${fmt(s.minLot)}.`,rawUnits,riskAtMin:r2(s.minLot*riskPerUnit)};
 const warnings:string[]=[];
 let rr:number|null=null,reward:number|null=null;
 if(fin(i.target)&&i.target>0){
  const dir=side==='long'?1:-1;
  if(dir*(i.target-i.entry)>0){rr=Math.round(Math.abs(i.target-i.entry)/stopDistance*100)/100;reward=r2(Math.abs(i.target-i.entry)/s.tickSize*s.tickValue*rate*units-costPerUnit*units)}
  else warnings.push('Cíl je na špatné straně vstupu.');
 }
 const moneyAtRisk=r2(units*riskPerUnit);
 if(fin(i.remainingDaily)&&moneyAtRisk>i.remainingDaily)warnings.push(i.remainingDaily<=0?'Denní limit ztráty je vyčerpaný.':`Riziko je větší než zbývající denní ztráta (${fmt(r2(i.remainingDaily),2)} ${i.accountCcy}).`);
 if(fin(i.remainingDD)&&moneyAtRisk>i.remainingDD)warnings.push('Riziko je větší než zbývající drawdown.');
 return {ok:true,side,units,rawUnits,unit:s.unit,budget:r2(budget),moneyAtRisk,lossPerUnit:r2(lossPerUnit),costPerUnit:r2(costPerUnit),riskPerUnit:r2(riskPerUnit),stopDistance,stopTicks,tickValueAcc:Math.round(s.tickValue*rate*1e6)/1e6,pipValueAcc:s.pip?r2(s.pip*perPrice*rate):null,rate,rr,reward,warnings};
}
// ---- přepočet měn: živé kurzy FX párů Tradee („EUR/USD“ → cena), záložně ECB (kolik jednotek měny za 1 EUR)
export function makeRate(quotes:Record<string,number>,ecbPerEur:Record<string,number>={}):RateFn{
 const q=(a:string,b:string):number|null=>{
  const d=quotes[a+'/'+b];if(fin(d)&&d>0)return d;
  const inv=quotes[b+'/'+a];if(fin(inv)&&inv>0)return 1/inv;
  return null;
 };
 const ecb=(c:string)=>c==='EUR'?1:fin(ecbPerEur[c])&&ecbPerEur[c]>0?ecbPerEur[c]:null;
 return (from,to)=>{
  if(from===to)return 1;
  const direct=q(from,to);if(direct!==null)return direct;
  for(const via of ['USD','EUR']){if(via===from||via===to)continue;const a=q(from,via),b=q(via,to);if(a!==null&&b!==null)return a*b}
  const ef=ecb(from),et=ecb(to);return ef!==null&&et!==null?et/ef:null;
 };
}
/** text výsledku pro graf: „0,5 lotu · riziko 200 USD“ */
export function sizeLine(r:SizeResult,ccy:string):string{
 if(!r.ok)return r.reason;
 const [one,few,many]=r.unit==='lot'?['lot','loty','lotů']:r.unit==='kontrakt'?['kontrakt','kontrakty','kontraktů']:['ks','ks','ks'];
 const word=Number.isInteger(r.units)?(r.units===1?one:r.units>=2&&r.units<=4?few:many):(r.unit==='lot'?'lotu':r.unit==='kontrakt'?'kontraktu':'ks');
 return `${fmt(r.units)} ${word} · riziko ${fmt(r.moneyAtRisk,2)} ${ccy}`;
}
