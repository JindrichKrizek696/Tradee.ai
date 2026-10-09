// Journaling: výpočty přehledu disciplíny. Čisté funkce bez DB – testy scripts/check-journaling.mjs.
import type {JournalTrade} from '../journal/types.ts';
export type ReviewLite={rating:number|null;strategyId:string|null;emotions:string[]};
export type ViolationLite={rule:string;needsReason:boolean;reasoned:boolean};
export type CustomBroken=string[];
export type StrategyRow={id:string|null;name:string;trades:number;winRate:number;pnl:number;avgRating:number|null};
export type Overview={discipline:number|null;judged:number;clean:number;top:{rule:string;count:number}|null;avgRating:number|null;toReview:number;needReason:number;byStrategy:StrategyRow[]};
const avg=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
export function overview(trades:JournalTrade[],reviews:Record<string,ReviewLite>,violations:Record<string,ViolationLite[]>,custom:Record<string,CustomBroken>,strategies:{id:string;name:string}[]):Overview{
 const has=(m:object,k:string)=>Object.hasOwn(m,k);
 const names=new Map(strategies.map(s=>[s.id,s.name]));
 let judged=0,clean=0,toReview=0,needReason=0;
 const counts=new Map<string,number>(),ratings:number[]=[];
 const groups=new Map<string|null,JournalTrade[]>();
 for(const t of trades){
  const rev=has(reviews,t.id)?reviews[t.id]:null,vs=has(violations,t.id)?violations[t.id]:[],cb=has(custom,t.id)?custom[t.id]:[];
  if(!rev||rev.rating===null)toReview++;else ratings.push(rev.rating);
  for(const v of vs)if(v.needsReason&&!v.reasoned)needReason++;
  if(t.source==='mt'||rev){
   judged++;
   if(!vs.length&&!cb.length)clean++;
   for(const v of vs)counts.set(v.rule,(counts.get(v.rule)||0)+1);
   for(const c of cb)counts.set('custom:'+c,(counts.get('custom:'+c)||0)+1);
  }
  const sid=rev?.strategyId&&names.has(rev.strategyId)?rev.strategyId:null;
  (groups.get(sid)||groups.set(sid,[]).get(sid)!).push(t);
 }
 let top:Overview['top']=null;
 for(const [rule,count] of counts)if(!top||count>top.count||(count===top.count&&rule<top.rule))top={rule,count};
 const byStrategy:StrategyRow[]=[...groups].map(([id,ts])=>({id,name:id===null?'Bez strategie':names.get(id)!,trades:ts.length,winRate:Math.round(ts.filter(t=>t.pnl>0).length/ts.length*100),pnl:ts.reduce((a,t)=>a+t.pnl,0),avgRating:avg(ts.map(t=>has(reviews,t.id)?reviews[t.id].rating:null).filter((x):x is number=>x!==null))}));
 byStrategy.sort((a,b)=>(a.id===null?1:0)-(b.id===null?1:0)||b.trades-a.trades||a.name.localeCompare(b.name,'cs'));
 return {discipline:judged?Math.round(clean/judged*100):null,judged,clean,top,avgRating:avg(ratings),toReview,needReason,byStrategy};
}
// rozdíl v procentních bodech, null když chybí jedna z hodnot
export const trend=(cur:number|null,prev:number|null):number|null=>cur===null||prev===null?null:cur-prev;
