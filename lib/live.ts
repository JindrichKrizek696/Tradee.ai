// Živé ceny trhů (Yahoo, 15 min): symboly, parsování, síla měn, „dnešní" body, stav. Čisté funkce – testy scripts/check-live.mjs.
export type LivePoint=[number,number]; // [čas ms UTC, cena]
export type LiveQuote={price:number;prevClose:number;changePct:number;high:number|null;low:number|null;marketTime:number;updated:number;points:LivePoint[]};
export type ParsedChart={price:number;prevClose:number;marketTime:number;points:LivePoint[]};
export type LiveState='live'|'delayed'|'closed';
const r4=(n:number)=>Math.round(n*1e4)/1e4;
// FX pár → Yahoo (EURUSD=X); měnové indexy Yahoo nemá (null); ostatní beze změny
export function yahooSymbol(id:string,currencies:readonly string[]):string|null{
 if(currencies.includes(id))return null;
 const m=id.match(/^([A-Z]{3})\/([A-Z]{3})$/);return m?m[1]+m[2]+'=X':id;
}
export const changePct=(price:number,prev:number)=>prev>0&&Number.isFinite(price)?r4((price/prev-1)*100):0;
type YahooChart={chart?:{result?:{meta?:{regularMarketPrice?:number;chartPreviousClose?:number;previousClose?:number;regularMarketTime?:number};timestamp?:number[];indicators?:{quote?:{close?:(number|null)[]}[]}}[]|null}};
// odpověď /v8/finance/chart → cena, předchozí zavření, čas a body (null vynechá); nepoužitelná odpověď → null
export function parseChart(json:unknown):ParsedChart|null{
 const res=(json as YahooChart|null)?.chart?.result?.[0];if(!res)return null;
 const m=res.meta||{},price=Number(m.regularMarketPrice),prev=Number(m.chartPreviousClose??m.previousClose),t=Number(m.regularMarketTime);
 if(!(price>0)||!(prev>0)||!(t>0))return null;
 const ts=res.timestamp||[],cl=res.indicators?.quote?.[0]?.close||[],points:LivePoint[]=[];
 ts.forEach((s,i)=>{const c=cl[i];if(typeof c==='number'&&Number.isFinite(c)&&c>0)points.push([s*1000,c])});
 return {price,prevClose:prev,marketTime:t*1000,points};
}
const pragueDay=(ms:number)=>new Date(ms).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'});
// „dnešní" body = stejný pražský den jako nejnovější bod (u akcií před otevřením tedy včerejší seance)
export function sessionPoints(points:LivePoint[]):LivePoint[]{
 if(!points.length)return [];
 const sorted=[...points].sort((a,b)=>a[0]-b[0]),d=pragueDay(sorted[sorted.length-1][0]);
 return sorted.filter(p=>pragueDay(p[0])===d);
}
// síla měny dnes: průměr % změn proti ostatním (A/B roste → A sílí, B slábne); chybějící páry se vynechají
export function currencyChange(cur:string,pairs:Record<string,{changePct:number}>):number|null{
 const v:number[]=[];
 for(const [id,q] of Object.entries(pairs)){const [a,b]=id.split('/');if(a===cur)v.push(q.changePct);else if(b===cur)v.push(-q.changePct)}
 return v.length?r4(v.reduce((s,x)=>s+x,0)/v.length):null;
}
// průběh indexu měny (100 = předchozí zavření): jen časy (po 15 min), kde mají body všechny páry měny
export function currencySeries(cur:string,pairs:Record<string,{prevClose:number;points:LivePoint[]}>):LivePoint[]{
 const mine=Object.entries(pairs).filter(([id])=>id.split('/').includes(cur));if(!mine.length)return [];
 const Q=15*60000,maps=mine.map(([id,q])=>{const sign=id.startsWith(cur+'/')?1:-1,m=new Map<number,number>();for(const [t,p] of q.points)m.set(Math.round(t/Q)*Q,sign*(p/q.prevClose-1)*100);return m});
 const times=[...maps[0].keys()].filter(t=>maps.every(m=>m.has(t))).sort((a,b)=>a-b);
 return times.map(t=>[t,r4(100*(1+maps.reduce((s,m)=>s+(m.get(t) as number),0)/maps.length/100))] as LivePoint);
}
export function liveState(updated:number|null,marketTime:number|null,now:number):LiveState{
 if(!updated||now-updated>45*60000)return 'delayed';
 if(!marketTime||now-marketTime>30*60000)return 'closed';
 return 'live';
}
// SVG path mini grafu v rámečku w×h (čas na ose x)
export function sparkPath(points:LivePoint[],w:number,h:number):string{
 if(points.length<2)return '';
 const ps=points.map(p=>p[1]),lo=Math.min(...ps),hi=Math.max(...ps),span=hi-lo,t0=points[0][0],dt=(points[points.length-1][0]-t0)||1;
 return points.map((p,i)=>(i?'L':'M')+((p[0]-t0)/dt*w).toFixed(1)+' '+(span?h-(p[1]-lo)/span*h:h).toFixed(1)).join(' ');
}
