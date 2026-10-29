// Indikátory grafu (sada 1) jako vrstvy s uloženými parametry: SMA, EMA, RSI, ATR, VWAP (denní, reset v 17:00 NY), anchored VWAP, PDH/PDL a denní/týdenní open (NY).
// Každý výpočet vrací stav: ok · nodata (nedostatek dat) · novolume (trh nemá objem). Čisté funkce – testy scripts/check-chart-workspace.mjs.
import {nyDay,nyTradingDay,nyTradingWeek} from './tz.ts';
// svíčka pro indikátory: t = začátek svíčky v ms UTC
export type IBar={t:number;o:number;h:number;l:number;c:number;v?:number};
export type Series=(number|null)[];
export type Result={status:'ok';values:Series}|{status:'nodata';need:number}|{status:'novolume'};
const ok=(values:Series):Result=>({status:'ok',values});
export function sma(values:number[],n:number):Series{
 const out:Series=new Array(values.length).fill(null);let sum=0;
 for(let i=0;i<values.length;i++){sum+=values[i];if(i>=n)sum-=values[i-n];if(i>=n-1)out[i]=sum/n}
 return out;
}
// EMA: první hodnota = SMA prvních n, dál k = 2 / (n + 1)
export function ema(values:number[],n:number):Series{
 const out:Series=new Array(values.length).fill(null);if(values.length<n)return out;
 const k=2/(n+1);let e=values.slice(0,n).reduce((a,b)=>a+b,0)/n;out[n-1]=e;
 for(let i=n;i<values.length;i++){e=values[i]*k+e*(1-k);out[i]=e}
 return out;
}
// RSI (Wilder): první průměr zisků/ztrát = prostý průměr n změn, dál vyhlazení (n − 1)/n; beze ztrát = 100
export function rsi(closes:number[],n:number):Series{
 const out:Series=new Array(closes.length).fill(null);if(closes.length<=n)return out;
 let g=0,l=0;
 for(let i=1;i<=n;i++){const d=closes[i]-closes[i-1];if(d>0)g+=d;else l-=d}
 g/=n;l/=n;const val=()=>l===0?(g===0?50:100):100-100/(1+g/l);out[n]=val();
 for(let i=n+1;i<closes.length;i++){const d=closes[i]-closes[i-1];g=(g*(n-1)+(d>0?d:0))/n;l=(l*(n-1)+(d<0?-d:0))/n;out[i]=val()}
 return out;
}
// ATR (Wilder): TR = max(h − l, |h − c₋₁|, |l − c₋₁|), první ATR = průměr prvních n TR
export function atr(bars:IBar[],n:number):Series{
 const out:Series=new Array(bars.length).fill(null);if(bars.length<n)return out;
 const tr=bars.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-bars[i-1].c),Math.abs(b.l-bars[i-1].c)):b.h-b.l);
 let a=tr.slice(0,n).reduce((x,y)=>x+y,0)/n;out[n-1]=a;
 for(let i=n;i<bars.length;i++){a=(a*(n-1)+tr[i])/n;out[i]=a}
 return out;
}
// objem: aspoň polovina svíček s kladným objemem (FX kříže a měnové indexy ho nemají)
export const hasVolume=(bars:IBar[])=>bars.length>0&&bars.filter(b=>(b.v??0)>0).length/bars.length>=.5;
const tp=(b:IBar)=>(b.h+b.l+b.c)/3;
// VWAP s resetem na začátku obchodního dne (17:00 NY); svíčka bez objemu se nezapočítá
export function vwap(bars:IBar[]):Result{
 if(!bars.length)return {status:'nodata',need:1};
 if(!hasVolume(bars))return {status:'novolume'};
 const out:Series=[];let day=NaN,pv=0,vv=0;
 for(const b of bars){const d=nyTradingDay(b.t);if(d!==day){day=d;pv=0;vv=0}const v=b.v??0;if(v>0){pv+=tp(b)*v;vv+=v}out.push(vv>0?pv/vv:null)}
 return ok(out);
}
// anchored VWAP od svíčky, která obsahuje čas kotvy (ms UTC); kotva mimo svíčky = nedostatek dat
export function anchoredVwap(bars:IBar[],anchor:number):Result{
 if(!hasVolume(bars))return bars.length?{status:'novolume'}:{status:'nodata',need:1};
 let i0=-1;for(let i=0;i<bars.length;i++){if(bars[i].t<=anchor)i0=i;else break}
 if(i0<0||anchor>bars[bars.length-1].t+7*86400000)return {status:'nodata',need:1};
 const out:Series=new Array(bars.length).fill(null);let pv=0,vv=0;
 for(let i=i0;i<bars.length;i++){const v=bars[i].v??0;if(v>0){pv+=tp(bars[i])*v;vv+=v}out[i]=vv>0?pv/vv:null}
 return ok(out);
}
// PDH / PDL: high a low předchozího obchodního dne (17:00 NY → 17:00 NY) u každé svíčky; první den bez hodnoty
export function pdhl(bars:IBar[]):{status:'ok';high:Series;low:Series}|{status:'nodata';need:number}{
 const days:number[]=[],hi=new Map<number,number>(),lo=new Map<number,number>();
 for(const b of bars){const d=nyTradingDay(b.t);if(!hi.has(d)){days.push(d);hi.set(d,b.h);lo.set(d,b.l)}else{hi.set(d,Math.max(hi.get(d)!,b.h));lo.set(d,Math.min(lo.get(d)!,b.l))}}
 if(days.length<2)return {status:'nodata',need:2};
 const prev=new Map<number,number>();days.forEach((d,i)=>{if(i)prev.set(d,days[i-1])});
 const high:Series=[],low:Series=[];
 for(const b of bars){const p=prev.get(nyTradingDay(b.t));high.push(p===undefined?null:hi.get(p)!);low.push(p===undefined?null:lo.get(p)!)}
 return {status:'ok',high,low};
}
// denní open (NY půlnoc, nebo 17:00 NY) a týdenní open (neděle 17:00 NY): open první svíčky období, kreslí se do konce období
export function periodOpen(bars:IBar[],key:(t:number)=>number):Series{
 const out:Series=[];let k=NaN,o:number|null=null;
 for(const b of bars){const x=key(b.t);if(x!==k){k=x;o=b.o}out.push(o)}
 return out;
}
export const dailyOpen=(bars:IBar[],at:0|17=0)=>periodOpen(bars,at===17?nyTradingDay:nyDay);
export const weeklyOpen=(bars:IBar[])=>periodOpen(bars,nyTradingWeek);
// nastavení indikátorů (uložené v záložce / rozvržení)
export type Studies={sma:{on:boolean;n:number};ema:{on:boolean;n:number};rsi:{on:boolean;n:number};atr:{on:boolean;n:number};vwap:{on:boolean};avwap:{on:boolean;at:number|null};pdhl:{on:boolean};dwo:{on:boolean;at:0|17}};
export const STUDIES_DEFAULT:Studies={sma:{on:false,n:20},ema:{on:false,n:50},rsi:{on:false,n:14},atr:{on:false,n:14},vwap:{on:false},avwap:{on:false,at:null},pdhl:{on:false},dwo:{on:false,at:0}};
const per=(v:unknown,d:number)=>Number.isInteger(v)&&(v as number)>=2&&(v as number)<=500?v as number:d;
export function readStudies(v:unknown):Studies{
 const o=(v&&typeof v==='object'&&!Array.isArray(v)?v:{}) as Record<string,Record<string,unknown>|undefined>,D=STUDIES_DEFAULT,on=(k:keyof Studies)=>o[k]?.on===true;
 const at=o.avwap?.at;
 return {sma:{on:on('sma'),n:per(o.sma?.n,D.sma.n)},ema:{on:on('ema'),n:per(o.ema?.n,D.ema.n)},rsi:{on:on('rsi'),n:per(o.rsi?.n,D.rsi.n)},atr:{on:on('atr'),n:per(o.atr?.n,D.atr.n)},vwap:{on:on('vwap')},
  avwap:{on:on('avwap'),at:typeof at==='number'&&Number.isFinite(at)&&at>0?at:null},pdhl:{on:on('pdhl')},dwo:{on:on('dwo'),at:o.dwo?.at===17?17:0}};
}
// stav indikátoru pro legendu
export function studyStatus(r:{status:string;need?:number}):string{
 return r.status==='novolume'?'nedostupné – trh nemá objem':r.status==='nodata'?'nedostatek dat':'';
}
// nedostatek dat u periodických indikátorů: méně svíček než perioda (+1 u RSI)
export function periodic(values:Series,need:number,len:number):Result{return len<need?{status:'nodata',need}:ok(values)}
