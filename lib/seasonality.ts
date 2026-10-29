// Detail sezonality: volitelný vzorek let, rozptyl (odchylka, min/max), stabilita mezi polovinami vzorku, odstranění trendu,
// pohled podle měsíců v roce a dnů v týdnu, varování při krátkém vzorku a export parametrů do CSV.
// Hodnoty jsou log výnosy v procentech (jako PriceData.months … logReturn); pro zobrazení pct() z score-engine.
// Čistá logika; kontrola: node --experimental-strip-types scripts/check-season-cot.mjs
import type {PriceData} from './score-engine.ts';
export const LOOKBACKS=[3,5,10,15,20] as const;
const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:0;
const sd=(v:number[])=>{if(v.length<2)return 0;const m=mean(v);return Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1))};
const median=(v:number[])=>{if(!v.length)return 0;const s=[...v].sort((a,b)=>a-b),k=s.length>>1;return s.length%2?s[k]:(s[k-1]+s[k])/2};
/** Průměrný měsíční log výnos každého roku (aspoň 6 měsíců), jinak průměr všech měsíců – „trend“, který detrend odečítá. */
export function yearDrift(price:PriceData|undefined):{byYear:Map<number,number>;all:number}{
 const per=new Map<number,number[]>();
 for(const m of Object.values(price?.months||{}))for(const y of m.years)(per.get(y.year)??per.set(y.year,[]).get(y.year)!).push(y.logReturn);
 const all=mean([...per.values()].flat()),byYear=new Map<number,number>();
 for(const [y,v] of per)byYear.set(y,v.length>=6?mean(v):all);
 return {byYear,all};
}
export type Half={n:number;avg:number;positive:number};
export type SeasonDetail={month:number;requested:number;n:number;years:{year:number;value:number}[];avg:number;sd:number;min:number;max:number;median:number;positive:number;negative:number;first:Half;second:Half;stable:boolean|null;detrend:boolean;warning:string|null};
export function seasonDetail(price:PriceData|undefined,month:number,lookback:number,detrend=false):SeasonDetail{
 const src=(price?.months[String(month)]?.years||[]).slice(-lookback),drift=detrend?yearDrift(price):null;
 const years=src.map(y=>({year:y.year,value:y.logReturn-(drift?drift.byYear.get(y.year)??drift.all:0)})),v=years.map(y=>y.value),n=v.length;
 const half=(a:number[]):Half=>({n:a.length,avg:mean(a),positive:a.filter(x=>x>0).length});
 const k=Math.floor(n/2),first=half(v.slice(0,k)),second=half(v.slice(n-k));
 const stable=n<4?null:first.avg!==0&&second.avg!==0&&Math.sign(first.avg)===Math.sign(second.avg);
 const warning=!n?'Historie pro tento měsíc chybí.':n<lookback?`K dispozici jen ${n} ${n<5?'roky':'let'} z požadovaných ${lookback}.${n<5?' Malý vzorek – výsledek je nespolehlivý.':''}`:n<5?`Malý vzorek (${n} roky) – výsledek je nespolehlivý.`:null;
 return {month,requested:lookback,n,years,avg:mean(v),sd:sd(v),min:n?Math.min(...v):0,max:n?Math.max(...v):0,median:median(v),positive:v.filter(x=>x>0).length,negative:v.filter(x=>x<0).length,first,second,stable,detrend,warning};
}
export const monthOfYear=(price:PriceData|undefined,lookback:number,detrend=false)=>Array.from({length:12},(_,i)=>seasonDetail(price,i+1,lookback,detrend));
export const DOW=['Po','Út','St','Čt','Pá'];
export type DowRow={dow:number;label:string;n:number;avg:number;sd:number;positive:number};
/** Dny v týdnu z denní reference: log výnos (v %) proti předchozímu obchodnímu dni, podle dne v týdnu data výnosu. */
export function dayOfWeek(path:{date:string;value:number}[]):{rows:DowRow[];days:number;from:string|null;to:string|null}{
 const b:number[][]=[[],[],[],[],[]];
 for(let i=1;i<path.length;i++){const a=path[i-1].value,c=path[i].value,d=new Date(path[i].date+'T00:00:00Z').getUTCDay();if(a>0&&c>0&&d>=1&&d<=5)b[d-1].push(100*Math.log(c/a))}
 return {rows:b.map((v,i)=>({dow:i+1,label:DOW[i],n:v.length,avg:mean(v),sd:sd(v),positive:v.filter(x=>x>0).length})),days:b.reduce((s,v)=>s+v.length,0),from:path[0]?.date??null,to:path.at(-1)?.date??null};
}
const cell=(v:unknown)=>{const s=String(v??'');return /[;"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
const r4=(n:number)=>Math.round(n*1e4)/1e4;
/** CSV (středník, desetinná tečka): parametry, statistiky zvoleného měsíce, roky vzorku, měsíce v roce a dny v týdnu. */
export function seasonCsv(o:{instrument:string;source:string;asOf:string;detail:SeasonDetail;moy:SeasonDetail[];dow:ReturnType<typeof dayOfWeek>}){
 const d=o.detail,L:(string|number)[][]=[
  ['parametr','hodnota'],['trh',o.instrument],['zdroj',o.source],['data k',o.asOf],['měsíc',d.month],['požadovaný vzorek (let)',d.requested],['použito let',d.n],['bez trendu',d.detrend?'ano':'ne'],['jednotka','log výnos v %'],
  ['průměr',r4(d.avg)],['medián',r4(d.median)],['směrodatná odchylka',r4(d.sd)],['minimum',r4(d.min)],['maximum',r4(d.max)],['kladné roky',d.positive],['záporné roky',d.negative],
  ['1. polovina vzorku průměr',r4(d.first.avg)],['2. polovina vzorku průměr',r4(d.second.avg)],['stabilní směr',d.stable===null?'nelze (málo let)':d.stable?'ano':'ne'],['varování',d.warning??''],
  [],['rok','log výnos %'],...d.years.map(y=>[y.year,r4(y.value)]),
  [],['měsíc','let','průměr','odchylka','kladné'],...o.moy.map(m=>[m.month,m.n,r4(m.avg),r4(m.sd),m.positive]),
  [],['den','dnů','průměr','odchylka','kladné'],...o.dow.rows.map(r=>[r.label,r.n,r4(r.avg),r4(r.sd),r.positive]),
 ];
 return L.map(r=>r.map(cell).join(';')).join('\n')+'\n';
}
