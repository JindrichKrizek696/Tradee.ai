// Profily účtů (osobní / challenge / funded): pravidla, šablony, obchodní den s resetem v časové zóně a stav účtu
// (zbývající denní ztráta, drawdown statický i trailing, konzistence, cíl, obchodní dny). Čisté funkce – testy scripts/check-risk.mjs.
export type ProfileKind='personal'|'challenge'|'funded';
export const KIND_LABELS:Record<ProfileKind,string>={personal:'Osobní',challenge:'Challenge',funded:'Funded'};
export type Ref='balance'|'equity';
export type Rules={
 /** denní limit ztráty: částka nebo % (ze startovního zůstatku, nebo ze zůstatku na začátku dne); reset v čase HH:MM dané zóny */
 dailyLoss:{type:'none'|'amount'|'pct';value:number;base:'initial'|'dayStart';ref:Ref;reset:string;tz:string};
 /** max. drawdown: statický (od startu) nebo trailing (od nejvyššího zůstatku/equity, uzavřené dny nebo i během dne); lockAtStart = trailing se zastaví na startu */
 drawdown:{type:'none'|'static'|'trailing';mode:'amount'|'pct';value:number;ref:Ref;when:'eod'|'intraday';lockAtStart:boolean};
 /** konzistence: nejlepší den smí tvořit nejvýš tolik % celkového zisku */
 consistency:{on:boolean;maxSharePct:number};
 profitTarget:{type:'none'|'amount'|'pct';value:number};
 minTradingDays:number;
 /** max. riziko na obchod v % zůstatku (výchozí riziko kalkulačky a pravidlo disciplíny); null = neřeší */
 maxRiskPct:number|null;
};
export const emptyRules=():Rules=>({dailyLoss:{type:'none',value:0,base:'dayStart',ref:'equity',reset:'00:00',tz:'Europe/Prague'},drawdown:{type:'none',mode:'pct',value:0,ref:'equity',when:'eod',lockAtStart:false},consistency:{on:false,maxSharePct:40},profitTarget:{type:'none',value:0},minTradingDays:0,maxRiskPct:null});
/** Obecné šablony – hodnoty jsou jen příklad, každá firma má jiná pravidla. */
export const TEMPLATE_NOTE='Hodnoty šablony jsou jen příklad – pravidla ověř u své firmy a uprav je.';
export const TEMPLATES:{id:string;label:string;kind:ProfileKind;rules:Rules}[]=[
 {id:'empty',label:'Prázdný profil',kind:'personal',rules:emptyRules()},
 {id:'challenge_static',label:'Challenge – statický DD',kind:'challenge',rules:{...emptyRules(),dailyLoss:{type:'pct',value:5,base:'dayStart',ref:'equity',reset:'00:00',tz:'Europe/Prague'},drawdown:{type:'static',mode:'pct',value:10,ref:'equity',when:'intraday',lockAtStart:false},profitTarget:{type:'pct',value:8},minTradingDays:4,maxRiskPct:1}},
 {id:'funded_trailing',label:'Funded – trailing DD',kind:'funded',rules:{...emptyRules(),dailyLoss:{type:'pct',value:4,base:'dayStart',ref:'equity',reset:'17:00',tz:'America/New_York'},drawdown:{type:'trailing',mode:'pct',value:6,ref:'balance',when:'eod',lockAtStart:true},consistency:{on:true,maxSharePct:40},maxRiskPct:1}},
];
// ---- normalizace vstupu (API/DB → platná pravidla)
type O=Record<string,unknown>;
const obj=(x:unknown):O=>x&&typeof x==='object'&&!Array.isArray(x)?x as O:{};
const pick=<T extends string>(x:unknown,allowed:readonly T[],def:T):T=>allowed.includes(x as T)?x as T:def;
const num=(x:unknown,def:number,min:number,max:number)=>{const n=typeof x==='number'?x:typeof x==='string'&&x.trim()?Number(x.replace(',','.')):NaN;return Number.isFinite(n)?Math.min(max,Math.max(min,n)):def};
export const isTimeZone=(tz:unknown):tz is string=>{if(typeof tz!=='string'||!tz||tz.length>64)return false;try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true}catch{return false}};
const hhmm=(x:unknown,def:string)=>typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x)?x:def;
export function normalizeRules(raw:unknown):Rules{
 const x=obj(raw),D=emptyRules(),dl=obj(x.dailyLoss),dd=obj(x.drawdown),cs=obj(x.consistency),pt=obj(x.profitTarget);
 const dlType=pick(dl.type,['none','amount','pct'],'none'),ddType=pick(dd.type,['none','static','trailing'],'none'),ddMode=pick(dd.mode,['amount','pct'],'pct'),ptType=pick(pt.type,['none','amount','pct'],'none');
 return {
  dailyLoss:{type:dlType,value:num(dl.value,0,0,dlType==='pct'?100:1e12),base:pick(dl.base,['initial','dayStart'],D.dailyLoss.base),ref:pick(dl.ref,['balance','equity'],D.dailyLoss.ref),reset:hhmm(dl.reset,D.dailyLoss.reset),tz:isTimeZone(dl.tz)?dl.tz:D.dailyLoss.tz},
  drawdown:{type:ddType,mode:ddMode,value:num(dd.value,0,0,ddMode==='pct'?100:1e12),ref:pick(dd.ref,['balance','equity'],D.drawdown.ref),when:pick(dd.when,['eod','intraday'],D.drawdown.when),lockAtStart:dd.lockAtStart===true},
  consistency:{on:cs.on===true,maxSharePct:num(cs.maxSharePct,40,1,100)},
  profitTarget:{type:ptType,value:num(pt.value,0,0,ptType==='pct'?1000:1e12)},
  minTradingDays:Math.round(num(x.minTradingDays,0,0,365)),
  maxRiskPct:x.maxRiskPct===null||x.maxRiskPct===undefined||x.maxRiskPct===''?null:num(x.maxRiskPct,1,0.01,100),
 };
}
export const sameRules=(a:Rules,b:Rules)=>JSON.stringify(a)===JSON.stringify(b);
// ---- verze pravidel: platí poslední verze s datem účinnosti ≤ den
export type RuleVersion={effective:string;rules:Rules;created?:string};
export function rulesAt(versions:RuleVersion[],date:string):Rules|null{
 const ok=[...versions].filter(v=>v.effective<=date).sort((a,b)=>a.effective.localeCompare(b.effective)||String(a.created||'').localeCompare(String(b.created||'')));
 return ok.length?ok[ok.length-1].rules:versions.length?[...versions].sort((a,b)=>a.effective.localeCompare(b.effective))[0].rules:null;
}
// ---- obchodní den: hranice dne = čas resetu v zóně (např. 17:00 New York); DST řeší Intl
const FMT=new Map<string,Intl.DateTimeFormat>();
const fmtFor=(tz:string)=>{let f=FMT.get(tz);if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});FMT.set(tz,f)}return f};
function parts(ts:number,tz:string){const o:Record<string,number>={};for(const p of fmtFor(tz).formatToParts(new Date(ts)))if(p.type!=='literal')o[p.type]=Number(p.value);return {y:o.year,m:o.month,d:o.day,h:o.hour%24,mi:o.minute,s:o.second}}
/** posun zóny proti UTC v ms (Praha v létě +7 200 000) */
export function tzOffset(ts:number,tz:string){const p=parts(ts,tz);return Date.UTC(p.y,p.m-1,p.d,p.h,p.mi,p.s)-Math.floor(ts/1000)*1000}
/** místní čas v zóně → UTC ms (v DST mezeře posune dopředu) */
export function zonedToUtc(y:number,m:number,d:number,h:number,mi:number,tz:string){
 const guess=Date.UTC(y,m-1,d,h,mi),o1=tzOffset(guess,tz),t=guess-o1,o2=tzOffset(t,tz);
 return o1===o2?t:guess-o2;
}
const resetMin=(reset:string)=>{const [h,m]=reset.split(':').map(Number);return h*60+m};
const iso=(y:number,m:number,d:number)=>new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
/** obchodní den (YYYY-MM-DD) okamžiku ts: před resetem patří k předchozímu dni */
export function tradingDay(ts:number,reset:string,tz:string):string{
 const p=parts(ts,tz),before=p.h*60+p.mi<resetMin(reset);
 return iso(p.y,p.m,p.d-(before?1:0));
}
/** začátek obchodního dne (UTC ms), do kterého patří ts */
export function dayStartTs(ts:number,reset:string,tz:string):number{
 const [y,m,d]=tradingDay(ts,reset,tz).split('-').map(Number),r=resetMin(reset);
 return zonedToUtc(y,m,d,Math.floor(r/60),r%60,tz);
}
// ---- stav účtu
export type Point={ts:number;balance:number;equity:number};
export type ClosedTrade={closeTs:number;pnl:number};
export type StatusInput={rules:Rules;start:number;now:number;balance:number;equity:number|null;points:Point[];trades:ClosedTrade[]};
export type Status={
 balance:number;equity:number;
 daily:{limit:number;used:number;remaining:number;dayStart:number;dayStartBalance:number;resetAt:number}|null;
 drawdown:{limit:number;floor:number;peak:number;remaining:number;type:'static'|'trailing'}|null;
 consistency:{bestDay:number;total:number;sharePct:number|null;max:number;ok:boolean;needTotal:number|null}|null;
 target:{amount:number;progress:number;remaining:number;done:boolean}|null;
 tradingDays:{count:number;min:number;done:boolean};
 breached:string[];
};
const r2=(n:number)=>Math.round(n*100)/100;
const val=(p:Point,ref:Ref)=>ref==='equity'?p.equity:p.balance;
export function accountStatus(i:StatusInput):Status{
 const R=i.rules,equity=i.equity??i.balance,pts=[...i.points].sort((a,b)=>a.ts-b.ts),breached:string[]=[];
 const day=R.dailyLoss,dlOn=day.type!=='none'&&day.value>0;
 // denní ztráta
 let daily:Status['daily']=null;
 {
  const ds=dayStartTs(i.now,day.reset,day.tz),prev=pts.filter(p=>p.ts<ds),dsBal=prev.length?prev[prev.length-1].balance:i.start;
  if(dlOn){
   const limit=day.type==='amount'?day.value:(day.base==='initial'?i.start:dsBal)*day.value/100,cur=day.ref==='equity'?equity:i.balance,used=r2(dsBal-cur);
   const r=dayStartTs(ds+26*3600000,day.reset,day.tz);
   daily={limit:r2(limit),used,remaining:r2(limit-used),dayStart:ds,dayStartBalance:r2(dsBal),resetAt:r};
   if(daily.remaining<=0)breached.push('daily');
  }
 }
 // drawdown
 let drawdown:Status['drawdown']=null;
 const dd=R.drawdown;
 if(dd.type!=='none'&&dd.value>0){
  const limit=dd.mode==='amount'?dd.value:i.start*dd.value/100,cur=dd.ref==='equity'?equity:i.balance;
  let peak=i.start;
  if(dd.type==='trailing'){
   if(dd.when==='intraday'){for(const p of pts)peak=Math.max(peak,val(p,dd.ref));peak=Math.max(peak,cur)}
   else{
    // uzavřené obchodní dny: hodnota na konci dne (poslední bod dne); běžící den se nepočítá
    const today=tradingDay(i.now,day.reset,day.tz),last=new Map<string,number>();
    for(const p of pts){const k=tradingDay(p.ts,day.reset,day.tz);if(k<today)last.set(k,val(p,dd.ref))}
    for(const v of last.values())peak=Math.max(peak,v);
   }
  }
  let floor=peak-limit;if(dd.type==='trailing'&&dd.lockAtStart)floor=Math.min(floor,i.start);
  drawdown={limit:r2(limit),floor:r2(floor),peak:r2(peak),remaining:r2(cur-floor),type:dd.type};
  if(drawdown.remaining<=0)breached.push('drawdown');
 }
 // konzistence a obchodní dny (den podle resetu denního limitu)
 const byDay=new Map<string,number>();for(const t of i.trades){const k=tradingDay(t.closeTs,day.reset,day.tz);byDay.set(k,(byDay.get(k)||0)+t.pnl)}
 let consistency:Status['consistency']=null;
 if(R.consistency.on){
  const total=r2([...byDay.values()].reduce((a,b)=>a+b,0)),best=r2(Math.max(0,...byDay.values())),share=total>0?Math.round(best/total*1000)/10:null;
  consistency={bestDay:best,total,sharePct:share,max:R.consistency.maxSharePct,ok:share===null||share<=R.consistency.maxSharePct,needTotal:best>0?r2(best*100/R.consistency.maxSharePct):null};
 }
 let target:Status['target']=null;
 if(R.profitTarget.type!=='none'&&R.profitTarget.value>0){
  const amount=R.profitTarget.type==='amount'?R.profitTarget.value:i.start*R.profitTarget.value/100,progress=r2(i.balance-i.start);
  target={amount:r2(amount),progress,remaining:r2(Math.max(0,amount-progress)),done:progress>=amount};
 }
 const tradingDays={count:byDay.size,min:R.minTradingDays,done:byDay.size>=R.minTradingDays};
 return {balance:r2(i.balance),equity:r2(equity),daily,drawdown,consistency,target,tradingDays,breached};
}
/** Body zůstatku z uzavřených obchodů (start + kumulace) – pro účty bez snímků (T212, ruční). */
export function balancePoints(start:number,trades:ClosedTrade[]):Point[]{
 let b=start;return [...trades].sort((a,c)=>a.closeTs-c.closeTs).map(t=>{b+=t.pnl;const v=r2(b);return {ts:t.closeTs,balance:v,equity:v}});
}
// ---- profil z API
export type ProfileInput={name:string;kind:ProfileKind;currency:string;startBalance:number;startDate:string;balance:number|null;linkId:string|null;feeChallenge:number|null;feeActivation:number|null;rules:Rules;effective:string};
export const PROFILE_LIMITS={name:60,profiles:30};
export function parseProfileInput(raw:unknown,today:string,currencies:readonly string[]):{ok:true;value:ProfileInput}|{ok:false;error:string}{
 const x=obj(raw);
 const name=typeof x.name==='string'?x.name.replace(/\s+/g,' ').trim():'';
 if(!name||name.length>PROFILE_LIMITS.name)return {ok:false,error:`Název profilu musí mít 1 až ${PROFILE_LIMITS.name} znaků.`};
 if(!currencies.includes(String(x.currency)))return {ok:false,error:'Neznámá měna účtu.'};
 const sb=typeof x.startBalance==='number'?x.startBalance:Number(x.startBalance);
 if(!Number.isFinite(sb)||sb<=0||sb>1e12)return {ok:false,error:'Startovní zůstatek musí být kladné číslo.'};
 const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))?v:null;
 const startDate=date(x.startDate)??today,effective=date(x.effective)??today;
 const optNum=(v:unknown,what:string)=>{if(v===null||v===undefined||v==='')return null;const n=typeof v==='number'?v:Number(v);if(!Number.isFinite(n)||n<0||n>1e12)throw Error(what);return n};
 try{
  return {ok:true,value:{name,kind:pick(x.kind,['personal','challenge','funded'],'personal'),currency:String(x.currency),startBalance:sb,startDate,balance:optNum(x.balance,'Aktuální zůstatek musí být číslo.'),linkId:typeof x.linkId==='string'&&/^[\w:-]{1,40}$/.test(x.linkId)?x.linkId:null,feeChallenge:optNum(x.feeChallenge,'Poplatek musí být číslo.'),feeActivation:optNum(x.feeActivation,'Poplatek musí být číslo.'),rules:normalizeRules(x.rules),effective}};
 }catch(e){return {ok:false,error:(e as Error).message}}
}
