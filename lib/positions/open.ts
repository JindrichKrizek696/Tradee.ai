// Otevřené MT pozice: čisté pomocné funkce (sestavení řádku, R, pruh SL–vstup–TP, stáří dat).
export type OpenPosition={id:string;accountId:string;account:string;symbol:string;instrument:string|null;side:'buy'|'sell';volume:number;openPrice:number;price:number|null;sl:number|null;tp:number|null;profit:number|null;accountCurrency:string;pnl:number|null;converted:boolean;riskMoney:number|null;r:number|null;openTs:number;updated:number|null;stale:boolean};
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
