// Vyhodnocení prognóz: směr (nad/pod cenou v době vydání) proti realizované ceně na konci horizontu. Čistá funkce; test: scripts/check-forecasts.mjs.
export type Snapshot={source:string;pair:string;madeAt:string;horizonEnd:string;horizon?:string;value:number;spot:number|null;derived?:boolean};
export type SourceStat={source:string;total:number;resolved:number;pending:number;directional:number;hits:number;hitRate:number|null;mape:number|null;bias:number|null;byPair:{pair:string;n:number;hits:number;hitRate:number|null}[]};
/** priceAt(pair, 'YYYY-MM-DD') = poslední uzavření k danému dni (nebo null, když chybí). today = 'YYYY-MM-DD'. */
export function evaluate(snaps:Snapshot[],priceAt:(pair:string,date:string)=>number|null,today:string):SourceStat[]{
 const by=new Map<string,{s:SourceStat;pairs:Map<string,{n:number;hits:number}>;errs:number[];signed:number[]}>();
 for(const x of snaps){
  let e=by.get(x.source);if(!e){e={s:{source:x.source,total:0,resolved:0,pending:0,directional:0,hits:0,hitRate:null,mape:null,bias:null,byPair:[]},pairs:new Map(),errs:[],signed:[]};by.set(x.source,e)}
  e.s.total++;
  if(x.horizonEnd>today){e.s.pending++;continue}
  const real=priceAt(x.pair,x.horizonEnd);
  if(real===null||!(real>0)||!(x.value>0)){e.s.pending++;continue}
  e.s.resolved++;
  const err=(x.value/real-1)*100;e.errs.push(Math.abs(err));e.signed.push(err);
  if(x.spot!==null&&x.spot>0&&x.value!==x.spot&&real!==x.spot){
   const hit=Math.sign(x.value-x.spot)===Math.sign(real-x.spot);
   e.s.directional++;if(hit)e.s.hits++;
   const p=e.pairs.get(x.pair)??{n:0,hits:0};p.n++;if(hit)p.hits++;e.pairs.set(x.pair,p);
  }
 }
 return [...by.values()].map(({s,pairs,errs,signed})=>({...s,
  hitRate:s.directional?s.hits/s.directional:null,
  mape:errs.length?errs.reduce((a,b)=>a+b,0)/errs.length:null,
  bias:signed.length?signed.reduce((a,b)=>a+b,0)/signed.length:null,
  byPair:[...pairs].map(([pair,p])=>({pair,n:p.n,hits:p.hits,hitRate:p.n?p.hits/p.n:null})).sort((a,b)=>b.n-a.n)})).sort((a,b)=>a.source.localeCompare(b.source));
}
