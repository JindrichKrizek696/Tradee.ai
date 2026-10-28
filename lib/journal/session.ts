// Limity seance (na účet nebo strategii): max. obchodů / ztrát / rozhodnutí za den, konec seance, pauza po N stopech v řadě a review po delší sérii.
// Stav: připraven / aktivní / pauza / review. Upozornění na větší pozici po ztrátě a posun stopu dál od vstupu (věcně, bez hodnocení).
// Čisté funkce – testy scripts/check-journal-ideas.mjs.
import {pragueDate} from '../mt/trades.ts';
export type SessionLimits={maxTrades:number|null;maxLosses:number|null;maxDecisions:number|null;endTime:string|null;pauseAfterSl:number|null;reviewAfterSl:number|null;newsBefore:number|null;newsAfter:number|null;newsMinImpact:2|3};
export const emptyLimits=():SessionLimits=>({maxTrades:null,maxLosses:null,maxDecisions:null,endTime:null,pauseAfterSl:null,reviewAfterSl:null,newsBefore:null,newsAfter:null,newsMinImpact:3});
export const SESSION_STATES={ready:'Připraven',active:'Aktivní',pause:'Pauza',review:'Review'} as const;
export type SessionState=keyof typeof SESSION_STATES;
export const SCOPES={all:'Všechny účty',account:'Účet',strategy:'Strategie'} as const;
export type Scope=keyof typeof SCOPES;
const int=(v:unknown,min:number,max:number,label:string):number|null|string=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)return `${label}: celé číslo ${min}–${max}.`;return n};
export function parseLimits(raw:unknown):SessionLimits|string{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return 'Neplatné limity.';
 const o=raw as Record<string,unknown>,out=emptyLimits();
 for(const [k,label,max] of [['maxTrades','Max. obchodů',100],['maxLosses','Max. ztrát',50],['maxDecisions','Max. rozhodnutí',200],['pauseAfterSl','Pauza po SL v řadě',20],['reviewAfterSl','Review po SL v řadě',50],['newsBefore','Minut před zprávou',240],['newsAfter','Minut po zprávě',240]] as const){
  const v=int(o[k],k.startsWith('news')?0:1,max,label);if(typeof v==='string')return v;out[k]=v;
 }
 if(o.endTime!==null&&o.endTime!==undefined&&o.endTime!==''){if(typeof o.endTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(o.endTime))return 'Konec seance zadej jako HH:MM.';out.endTime=o.endTime}
 out.newsMinImpact=Number(o.newsMinImpact)===2?2:3;
 return out;
}
export const hasLimits=(l:SessionLimits)=>[l.maxTrades,l.maxLosses,l.maxDecisions,l.pauseAfterSl,l.reviewAfterSl].some(x=>x!==null)||l.endTime!==null;
export type STrade={id:string;openTs:number;closeTs:number|null;net:number|null;closeReason?:string|null};
/** Ztráta = uzavřený obchod v minusu (zavřený stop lossem nebo jinak). */
export const isLoss=(t:STrade)=>t.closeTs!==null&&(t.net??0)<0;
const hm=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const pragueHm=(ms:number)=>hm.format(ms);
/** Počet ztrát v řadě (od posledního uzavřeného obchodu zpět), volitelně jen uzavřené od `from`. Obchod v zisku řadu přeruší, nulový ne. */
export function lossStreak(trades:STrade[],from=-Infinity,to=Infinity):number{
 const closed=trades.filter(t=>t.closeTs!==null&&(t.closeTs as number)>=from&&(t.closeTs as number)<=to).sort((a,b)=>(a.closeTs as number)-(b.closeTs as number));
 let n=0;for(let i=closed.length-1;i>=0;i--){const x=closed[i].net??0;if(x<0)n++;else if(x>0)break}
 return n;
}
export type StateInput={limits:SessionLimits;trades:STrade[];decisions:number;now:number;reviewedAt:number|null;dayStart:number};
export type StateOut={state:SessionState;reasons:string[];counts:{trades:number;losses:number;decisions:number;streakToday:number;streak:number};open:number};
/**
 * Stav seance pro dnešek (pražský den od dayStart): review (série stopů napříč dny bez provedeného review) > pauza (limit dne, pauza po stopech, konec seance) > aktivní (otevřená pozice) > připraven.
 * decisions = obchody + vynechané obchody dne.
 */
export function sessionState(i:StateInput):StateOut{
 const l=i.limits,today=i.trades.filter(t=>t.openTs>=i.dayStart&&t.openTs<=i.now),closedToday=i.trades.filter(t=>t.closeTs!==null&&(t.closeTs as number)>=i.dayStart&&(t.closeTs as number)<=i.now);
 const losses=closedToday.filter(isLoss).length,streakToday=lossStreak(i.trades,i.dayStart,i.now);
 const streak=lossStreak(i.trades.filter(t=>i.reviewedAt===null||(t.closeTs??0)>i.reviewedAt),-Infinity,i.now);
 const open=i.trades.filter(t=>t.openTs<=i.now&&(t.closeTs===null||(t.closeTs as number)>i.now)).length;
 const counts={trades:today.length,losses,decisions:i.decisions,streakToday,streak},reasons:string[]=[];
 if(l.reviewAfterSl!==null&&streak>=l.reviewAfterSl)return {state:'review',reasons:[`${streak} ztrát v řadě – před dalším obchodem si udělej review.`],counts,open};
 if(l.pauseAfterSl!==null&&streakToday>=l.pauseAfterSl)reasons.push(`${streakToday} ztráty v řadě dnes (pauza od ${l.pauseAfterSl}).`);
 if(l.maxLosses!==null&&losses>=l.maxLosses)reasons.push(`Dnes ${losses} ztrát (limit ${l.maxLosses}).`);
 if(l.maxTrades!==null&&today.length>=l.maxTrades)reasons.push(`Dnes ${today.length} obchodů (limit ${l.maxTrades}).`);
 if(l.maxDecisions!==null&&i.decisions>=l.maxDecisions)reasons.push(`Dnes ${i.decisions} rozhodnutí (limit ${l.maxDecisions}).`);
 if(l.endTime!==null&&pragueHm(i.now)>=l.endTime)reasons.push(`Seance skončila v ${l.endTime}.`);
 if(reasons.length)return {state:'pause',reasons,counts,open};
 return {state:open?'active':'ready',reasons:[],counts,open};
}
/** Porušení limitů seance u obchodů dne (pro disciplínu): obchod otevřený, když už limit platil. Pravidla session_*. */
export type SessionViolation={tradeId:string;rule:'session_trades'|'session_losses'|'session_pause'|'session_end'|'session_review';detail:Record<string,unknown>};
export function sessionViolations(limits:SessionLimits,trades:STrade[],o:{dayOf?:(ms:number)=>string;reviews?:number[]}={}):SessionViolation[]{
 const dayOf=o.dayOf??pragueDate,out:SessionViolation[]=[],sorted=[...trades].sort((a,b)=>a.openTs-b.openTs||a.id.localeCompare(b.id)),reviews=[...(o.reviews||[])].sort((a,b)=>a-b);
 for(let k=0;k<sorted.length;k++){
  const t=sorted[k],day=dayOf(t.openTs),before=sorted.filter(x=>x.openTs<t.openTs&&dayOf(x.openTs)===day),closedBefore=trades.filter(x=>x.closeTs!==null&&(x.closeTs as number)<=t.openTs);
  const sameDayClosed=closedBefore.filter(x=>dayOf(x.closeTs as number)===day);
  if(limits.maxTrades!==null&&before.length>=limits.maxTrades)out.push({tradeId:t.id,rule:'session_trades',detail:{n:before.length+1,limit:limits.maxTrades}});
  const losses=sameDayClosed.filter(isLoss).length;
  if(limits.maxLosses!==null&&losses>=limits.maxLosses)out.push({tradeId:t.id,rule:'session_losses',detail:{losses,limit:limits.maxLosses}});
  const st=lossStreak(sameDayClosed);
  if(limits.pauseAfterSl!==null&&st>=limits.pauseAfterSl)out.push({tradeId:t.id,rule:'session_pause',detail:{streak:st,limit:limits.pauseAfterSl}});
  if(limits.endTime!==null&&pragueHm(t.openTs)>=limits.endTime)out.push({tradeId:t.id,rule:'session_end',detail:{at:pragueHm(t.openTs),end:limits.endTime}});
  if(limits.reviewAfterSl!==null){const lastRev=[...reviews].reverse().find(r=>r<=t.openTs)??-Infinity,s=lossStreak(closedBefore.filter(x=>(x.closeTs as number)>lastRev));if(s>=limits.reviewAfterSl)out.push({tradeId:t.id,rule:'session_review',detail:{streak:s,limit:limits.reviewAfterSl}})}
 }
 return out;
}
export const SESSION_RULE_LABELS:Record<SessionViolation['rule'],string>={session_trades:'Limit obchodů seance',session_losses:'Limit ztrát seance',session_pause:'Pauza po stopech',session_end:'Po konci seance',session_review:'Obchod před review'};
export function sessionViolationText(rule:string,d:Record<string,unknown>):string{
 switch(rule){
  case 'session_trades':return `${d.n}. obchod dne (limit seance ${d.limit}).`;
  case 'session_losses':return `Obchod po ${d.losses} ztrátách dne (limit ${d.limit}).`;
  case 'session_pause':return `Obchod během pauzy po ${d.streak} ztrátách v řadě.`;
  case 'session_end':return `Vstup v ${d.at}, seance končí v ${d.end}.`;
  case 'session_review':return `Obchod po ${d.streak} ztrátách v řadě ještě před review.`;
  default:return '';
 }
}
// ---- upozornění (bez hodnocení)
export type SizeTrade={id:string;accountId:string;openTs:number;closeTs:number|null;net:number|null;riskPct:number|null;volume:number|null;symbol:string};
export type Warning={tradeId:string;kind:'size_after_loss'|'stop_widened';text:string;detail:Record<string,unknown>};
const n2=(x:number,d=2)=>x.toLocaleString('cs-CZ',{maximumFractionDigits:d});
/** Pozice po ztrátovém obchodu (stejný účet) s riziko o víc než 10 % vyšším; bez rizika v % se porovná objem u stejného symbolu. */
export function sizeAfterLoss(trades:SizeTrade[]):Warning[]{
 const out:Warning[]=[];
 for(const t of trades){
  const prev=trades.filter(p=>p.accountId===t.accountId&&p.id!==t.id&&p.closeTs!==null&&(p.closeTs as number)<=t.openTs).sort((a,b)=>(b.closeTs as number)-(a.closeTs as number))[0];
  if(!prev||!((prev.net??0)<0))continue;
  if(prev.riskPct!==null&&t.riskPct!==null&&prev.riskPct>0){if(t.riskPct>prev.riskPct*1.1)out.push({tradeId:t.id,kind:'size_after_loss',text:`Po ztrátě vyšší riziko: ${n2(prev.riskPct)} % → ${n2(t.riskPct)} %.`,detail:{prev:prev.id,from:prev.riskPct,to:t.riskPct,unit:'%'}});continue}
  if(prev.symbol===t.symbol&&prev.volume!==null&&t.volume!==null&&prev.volume>0&&t.volume>prev.volume*1.1)out.push({tradeId:t.id,kind:'size_after_loss',text:`Po ztrátě větší objem: ${n2(prev.volume)} → ${n2(t.volume)}.`,detail:{prev:prev.id,from:prev.volume,to:t.volume,unit:'lot'}});
 }
 return out;
}
/** Posun stopu dál od vstupu (buy níž, sell výš) nebo zrušení stopu – ze záznamu změn SL. */
export function stopWidening(tradeId:string,side:'buy'|'sell',changes:{ts:number;kind:string;old:number|null;new:number|null}[]):Warning[]{
 const out:Warning[]=[];
 for(const c of [...changes].filter(c=>c.kind==='sl').sort((a,b)=>a.ts-b.ts)){
  if(c.old===null)continue;
  if(c.new===null){out.push({tradeId,kind:'stop_widened',text:`Stop zrušen (byl ${n2(c.old,5)}).`,detail:{ts:c.ts,from:c.old,to:null}});continue}
  if(side==='buy'?c.new<c.old:c.new>c.old)out.push({tradeId,kind:'stop_widened',text:`Stop posunut dál od vstupu: ${n2(c.old,5)} → ${n2(c.new,5)}.`,detail:{ts:c.ts,from:c.old,to:c.new}});
 }
 return out;
}
