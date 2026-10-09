// Svíčky grafu trhu (Yahoo): parsování, agregace H4, stáří cache. Čisté funkce – testy scripts/check-chart.mjs.
export type Candle=[number,number,number,number,number]; // [čas ms UTC, open, high, low, close]
export type Tf='H1'|'H4'|'D1';
export const TFS:readonly Tf[]=['H1','H4','D1'];
export const TF_SOURCE:Record<Tf,{interval:string;range:string;aggregate:boolean}>={H1:{interval:'60m',range:'60d',aggregate:false},H4:{interval:'60m',range:'60d',aggregate:true},D1:{interval:'1d',range:'2y',aggregate:false}};
export const TF_CAP:Record<Tf,number>={H1:1500,H4:1500,D1:600};
const H4=4*3600000;
type YahooCandles={chart?:{result?:{timestamp?:number[];indicators?:{quote?:{open?:(number|null)[];high?:(number|null)[];low?:(number|null)[];close?:(number|null)[]}[]}}[]|null}};
const ok=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
// odpověď /v8/finance/chart → svíčky; řádky s chybějící hodnotou se vynechají; nepoužitelná odpověď → []
export function parseYahoo(json:unknown):Candle[]{
 const res=(json as YahooCandles|null)?.chart?.result?.[0];if(!res)return [];
 const ts=res.timestamp||[],q=res.indicators?.quote?.[0];if(!q)return [];
 const out:Candle[]=[];
 ts.forEach((s,i)=>{const o=q.open?.[i],h=q.high?.[i],l=q.low?.[i],c=q.close?.[i];if(ok(s)&&ok(o)&&ok(h)&&ok(l)&&ok(c))out.push([s*1000,o,h,l,c])});
 return out.sort((a,b)=>a[0]-b[0]);
}
// hodinové svíčky → 4hodinové zarovnané na UTC 0/4/8/12/16/20
export function toH4(h1:Candle[]):Candle[]{
 const out:Candle[]=[];
 for(const [t,o,h,l,c] of [...h1].sort((a,b)=>a[0]-b[0])){
  const k=Math.floor(t/H4)*H4,last=out[out.length-1];
  if(last&&last[0]===k){last[2]=Math.max(last[2],h);last[3]=Math.min(last[3],l);last[4]=c}else out.push([k,o,h,l,c]);
 }
 return out;
}
export const STALE_MS:Record<Tf,number>={H1:15*60000,H4:15*60000,D1:6*3600000};
export const stale=(tf:Tf,updatedMs:number,now:number)=>!(updatedMs>0)||now-updatedMs>=STALE_MS[tf];
