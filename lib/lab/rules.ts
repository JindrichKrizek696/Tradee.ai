// Laboratoř · „Moje pravidla“ – rychlý tester pravidel nad signály studie (čisté funkce, testy scripts/check-lab.mjs).
// Provedení obchodů dělá backtest engine (lib/backtest/engine.ts): vstup na open další svíčky, SL v ATR, TP v R / žádný,
// držení N dní (maxBars), spread podle výchozích hodnot. Signály Laboratoře se do engine předávají jako `gate`
// – vyhodnocují se na zavření signální svíčky jen z tehdy známých dat (viz lib/lab/study.ts).
import {normalizeCondition,DEFAULT_RULES,type Condition,type StrategyRules} from '../backtest/rules.ts';
import type {Side} from '../backtest/engine.ts';
import type {Signals} from './study.ts';

export type LabCond=
 |{type:'trend';op:'>='|'<='|'=';value:number} // −2…+2
 |{type:'season';op:'>='|'<='|'=';value:number} // −2…+2
 |{type:'cot';op:'>'|'<';value:number} // surový COT signál −1…+1
 |{type:'score';op:'>'|'<';value:number}; // uložené skóre −100…+100
export type LabDirection='long'|'short'|'trend'|'season'|'cot'|'score'; // trend/season/cot/score = podle znaménka signálu
export type LabRule={version:1;markets:string[];from:string;to:string;conds:LabCond[];tech:Condition[];direction:LabDirection;sl:number;tp:{type:'r'|'none';value:number};hold:number|null;riskPct:number};
export const LAB_COND_LABELS:Record<LabCond['type'],string>={trend:'Trend',season:'Sezonalita',cot:'COT signál',score:'Skóre Tradee'};
export const DIRECTION_LABELS:Record<LabDirection,string>={long:'Vždy long',short:'Vždy short',trend:'Podle trendu',season:'Podle sezonality',cot:'Podle COT',score:'Podle skóre'};
export const DEFAULT_LAB_RULE:LabRule={version:1,markets:['EUR/USD','GBP/USD','USD/JPY','AUD/USD'],from:'2015-01-01',to:'',conds:[{type:'trend',op:'>=',value:2}],tech:[],direction:'long',sl:1.5,tp:{type:'none',value:0},hold:20,riskPct:1};
export const MAX_LAB_MARKETS=30,MAX_CONDS=12;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
type O=Record<string,unknown>;
const obj=(x:unknown):O=>x&&typeof x==='object'&&!Array.isArray(x)?x as O:{};
const num=(x:unknown,def:number,min:number,max:number,int=false)=>{const n=typeof x==='number'?x:typeof x==='string'&&x.trim()!==''?Number(x):NaN;if(!Number.isFinite(n))return def;const v=Math.min(max,Math.max(min,n));return int?Math.round(v):v};
const pick=<T extends string>(x:unknown,a:readonly T[],d:T):T=>a.includes(x as T)?x as T:d;
export function normalizeLabCond(raw:unknown):LabCond|null{
 const x=obj(raw);
 switch(x.type){
  case 'trend':case 'season':return {type:x.type,op:pick(x.op,['>=','<=','='],'>='),value:num(x.value,0,-2,2,true)};
  case 'cot':return {type:'cot',op:pick(x.op,['>','<'],'>'),value:num(x.value,0,-1,1)};
  case 'score':return {type:'score',op:pick(x.op,['>','<'],'>'),value:num(x.value,0,-100,100)};
 }
 return null;
}
export function normalizeLabRule(raw:unknown,known?:Set<string>):LabRule{
 const x=obj(raw),D=DEFAULT_LAB_RULE,tp=obj(x.tp);
 const markets=[...new Set((Array.isArray(x.markets)?x.markets:D.markets).map(String))].filter(m=>!known||known.has(m)).slice(0,MAX_LAB_MARKETS);
 const hold=x.hold===null||x.hold===''||x.hold===0?null:num(x.hold,D.hold??20,1,500,true);
 return {version:1,markets,
  from:typeof x.from==='string'&&DATE.test(x.from)?x.from:D.from,to:typeof x.to==='string'&&DATE.test(x.to)?x.to:'',
  conds:(Array.isArray(x.conds)?x.conds:[]).map(normalizeLabCond).filter((c):c is LabCond=>c!==null).slice(0,MAX_CONDS),
  tech:(Array.isArray(x.tech)?x.tech:[]).map(normalizeCondition).filter((c):c is Condition=>c!==null&&!['score','strength','cot','no_news','session','hour','weekday'].includes(c.type)).slice(0,MAX_CONDS),
  direction:pick(x.direction,['long','short','trend','season','cot','score'],D.direction),
  sl:num(x.sl,D.sl,.1,20),tp:{type:pick(tp.type,['r','none'],'none'),value:num(tp.value,2,0,50)},hold,riskPct:num(x.riskPct,D.riskPct,.01,10)};
}
export function labRuleIssues(r:LabRule):string[]{
 const out:string[]=[];
 if(!r.markets.length)out.push('Vyber aspoň jeden trh.');
 if(!r.conds.length&&!r.tech.length&&['long','short'].includes(r.direction))out.push('Přidej aspoň jednu podmínku, nebo zvol směr podle signálu.');
 if(r.tp.type==='none'&&r.hold===null)out.push('Bez take profitu nastav držení (počet dní), jinak obchod skončí jen na SL.');
 if(r.tp.type==='r'&&!(r.tp.value>0))out.push('Take profit v R musí být větší než nula.');
 if(r.to&&r.to<=r.from)out.push('Období „od“ musí být před „do“.');
 return out;
}
// pravidla pro engine: SL × ATR(14), TP R / žádný, držení = maxBars (D1 = dny)
export function toStrategyRules(r:LabRule):StrategyRules{
 return {...DEFAULT_RULES,entry:r.tech,direction:r.direction==='short'?'short':'long',
  exit:{sl:{type:'atr',value:r.sl},tp:r.tp.type==='r'?{type:'r',value:r.tp.value}:{type:'none',value:0},maxBars:r.hold},
  sizing:{riskPct:r.riskPct,capital:10000},costs:{commissionPct:0,spread:{}}};
}
const cmp=(op:string,a:number,b:number)=>op==='>='?a>=b:op==='<='?a<=b:op==='='?a===b:op==='>'?a>b:a<b;
// hodnota podmínky ve svíčce i (null = data chybí → podmínka neplatí)
export function condValue(c:LabCond,s:Signals,i:number):number|null{
 return c.type==='trend'?s.trend[i]:c.type==='season'?s.season[i]:c.type==='cot'?s.cotSignal[i]:s.scoreValue[i];
}
export function labGateFor(r:LabRule,s:Signals):(i:number)=>Side|boolean{
 return i=>{
  for(const c of r.conds){const v=condValue(c,s,i);if(v===null||v===undefined||!cmp(c.op,v,c.value))return false}
  if(r.direction==='long'||r.direction==='short')return true;
  const v=r.direction==='trend'?s.trend[i]:r.direction==='season'?s.season[i]:r.direction==='cot'?s.cotSignal[i]:s.scoreValue[i];
  return v===null||v===undefined||v===0?false:v>0?'long':'short';
 };
}
