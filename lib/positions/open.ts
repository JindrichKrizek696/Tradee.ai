// Otevřené MT pozice: čisté pomocné funkce (sestavení řádku, R, pruh SL–vstup–TP, stáří dat).
export type OpenPosition={id:string;accountId:string;account:string;symbol:string;instrument:string|null;side:'buy'|'sell';volume:number;openPrice:number;price:number|null;sl:number|null;tp:number|null;profit:number|null;accountCurrency:string;pnl:number|null;converted:boolean;riskMoney:number|null;risk:number|null;slInProfit:boolean;r:number|null;openTs:number;updated:number|null;stale:boolean};
export type LevelBar={sl:number|null;tp:number|null;entry:number;price:number|null};
export const STALE_MS=10*60_000;
const r2=(n:number)=>Math.round(n*100)/100;
// polohy v % osy mezi nejnižší a nejvyšší hodnotou; u sell obráceně, aby zisk byl vždy vpravo
export function levelBar(side:'buy'|'sell',open:number,price:number|null,sl:number|null,tp:number|null):LevelBar|null{
 const vals=[open,price,sl,tp].filter((v):v is number=>v!==null&&Number.isFinite(v)),min=Math.min(...vals),max=Math.max(...vals);
 if(!(max>min))return null;
 const at=(v:number)=>r2((side==='buy'?(v-min):(max-v))/(max-min)*100);
 return {sl:sl===null?null:at(sl),tp:tp===null?null:at(tp),entry:at(open),price:price===null?null:at(price)};
}
export const isStale=(updated:number|null,now:number)=>updated===null||now-updated>STALE_MS;
export const rMultiple=(profit:number|null,risk:number|null)=>profit===null||!risk||risk<=0?null:r2(profit/risk);
export function summarize(list:OpenPosition[]){
 let pnl=0,risk=0,noSl=0,converted=true;
 for(const p of list){
  if(p.pnl!==null){if(p.converted)pnl+=p.pnl;else converted=false}
  risk+=p.riskMoney||0;if(p.sl===null)noSl++;
 }
 return {count:list.length,pnl:r2(pnl),converted,risk:r2(risk),noSl};
}

export type RiskInput={side:'buy'|'sell';open:number;sl:number|null;volume:number;tickSize?:number|null;tickValue?:number|null;riskInitial?:number|null;slInitial?:number|null;volumeMax?:number|null};
const pos=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
// SL je na straně zisku (nebo na vstupu): buy sl ≥ open, sell sl ≤ open
export const slInProfit=(side:'buy'|'sell',open:number,sl:number|null)=>sl!==null&&(side==='buy'?sl>=open:sl<=open);
/** Riziko do AKTUÁLNÍHO SL v měně účtu: |open−sl| / tickSize × tickValue × aktuální objem. Bez SL → null, SL v zisku → 0. Bez tick dat se škáluje počáteční riziko (vzdálenost SL × objem); bez nich null. */
export function currentRisk(i:RiskInput):number|null{
 if(i.sl===null||!Number.isFinite(i.sl))return null;
 if(slInProfit(i.side,i.open,i.sl))return 0;
 const dist=Math.abs(i.open-i.sl);
 if(pos(i.tickSize)&&pos(i.tickValue))return r2(dist/i.tickSize*i.tickValue*i.volume);
 if(pos(i.riskInitial)&&pos(i.slInitial)&&pos(i.volumeMax)){const d0=Math.abs(i.open-i.slInitial);if(d0>0)return r2(i.riskInitial*dist/d0*i.volume/i.volumeMax)}
 return null;
}
export type RiskAccount={accountId:string;name:string;currency:string;equity:number|null;equityConv:number|null;risk:number;riskConv:number;riskPct:number|null;count:number;noSl:number;slInProfit:number;floating:number};
export type RiskTotal={equity:number|null;risk:number;riskPct:number|null;count:number;noSl:number;slInProfit:number;floating:number};
export type AccountInfo={id:string;name:string;currency:string;equity:number|null;equityConv:number|null};
const pct=(risk:number,eq:number|null)=>eq&&eq>0?r2(risk/eq*100):null;
/** Největší riziko jedné pozice v % equity jejího účtu (equity i risk v měně účtu). */
export function maxPositionRisk(list:OpenPosition[],equity:(accountId:string)=>number|null){
 let best:{id:string;symbol:string;accountId:string;riskPct:number}|null=null;
 for(const p of list){const e=equity(p.accountId);if(!p.risk||!e||e<=0)continue;const v=r2(p.risk/e*100);if(!best||v>best.riskPct)best={id:p.id,symbol:p.symbol,accountId:p.accountId,riskPct:v}}
 return best;
}
/** Souhrn otevřeného rizika po účtech (i účtů bez pozic) a celkem v měně souhrnu. */
export function riskSummary(list:OpenPosition[],accounts:AccountInfo[]){
 const rows:RiskAccount[]=accounts.map(a=>{
  const ps=list.filter(p=>p.accountId===a.id);
  const risk=r2(ps.reduce((x,p)=>x+(p.risk||0),0)),riskConv=r2(ps.reduce((x,p)=>x+(p.riskMoney||0),0));
  return {accountId:a.id,name:a.name,currency:a.currency,equity:a.equity,equityConv:a.equityConv,risk,riskConv,riskPct:pct(risk,a.equity),count:ps.length,noSl:ps.filter(p=>p.sl===null).length,slInProfit:ps.filter(p=>p.slInProfit).length,floating:r2(ps.reduce((x,p)=>x+(p.profit||0),0))};
 });
 const eqs=rows.filter(r=>r.equityConv!==null),equity=eqs.length?r2(eqs.reduce((x,r)=>x+r.equityConv!,0)):null;
 const risk=r2(rows.reduce((x,r)=>x+r.riskConv,0));
 const total:RiskTotal={equity,risk,riskPct:pct(risk,equity),count:list.length,noSl:rows.reduce((x,r)=>x+r.noSl,0),slInProfit:rows.reduce((x,r)=>x+r.slInProfit,0),floating:r2(list.reduce((x,p)=>x+(p.converted?p.pnl||0:0),0))};
 const eq=new Map(accounts.map(a=>[a.id,a.equity]));
 return {accounts:rows,total,maxPosition:maxPositionRisk(list,id=>eq.get(id)??null)};
}
