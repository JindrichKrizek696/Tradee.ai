// Svíčky grafu trhu (Yahoo): parsování, agregace H4, stáří cache. Čisté funkce – testy scripts/check-chart.mjs.
export type Candle=[number,number,number,number,number]; // [čas ms UTC, open, high, low, close]
export type Tf='M1'|'M5'|'M15'|'M30'|'H1'|'H2'|'H4'|'D1'|'W1'|'MN';
export const TFS:readonly Tf[]=['M1','M5','M15','M30','H1','H2','H4','D1','W1','MN'];
// zdroj svíček: Yahoo interval/range (range = plná historie, tail = jen čerstvý ocas, když je k dispozici archiv market_bars);
// base = archiv H1/D1, ze kterého se svíčky skládají; agg = jak se z báze agreguje
export type TfSource={interval:string;range:string;tail?:string;base?:'H1'|'D1';agg?:'H2'|'H4'|'W1'|'MN'};
export const TF_SOURCE:Record<Tf,TfSource>={
 M1:{interval:'1m',range:'7d'},M5:{interval:'5m',range:'60d'},M15:{interval:'15m',range:'60d'},M30:{interval:'30m',range:'60d'},
 H1:{interval:'60m',range:'700d',tail:'60d',base:'H1'},H2:{interval:'60m',range:'700d',tail:'60d',base:'H1',agg:'H2'},H4:{interval:'60m',range:'700d',tail:'60d',base:'H1',agg:'H4'},
 D1:{interval:'1d',range:'10y',tail:'1mo',base:'D1'},W1:{interval:'1d',range:'10y',tail:'1mo',base:'D1',agg:'W1'},MN:{interval:'1d',range:'10y',tail:'1mo',base:'D1',agg:'MN'},
};
export const TF_CAP:Record<Tf,number>={M1:3000,M5:3000,M15:3000,M30:3000,H1:3000,H2:3000,H4:3000,D1:3000,W1:3000,MN:3000};
export const HISTORY_FROM=Date.UTC(2020,0,1); // dlouhé TF (D1, W1, MN) nejdál do roku 2020
const H=3600000,DAY=86400000;
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
// obecná agregace: svíčky se seskupí podle klíče koše (začátek koše v ms UTC); koš = jedna svíčka z libovolného počtu vstupních, neúplný poslední koš zůstává
export function bucketAggregate(src:Candle[],key:(t:number)=>number):Candle[]{
 const out:Candle[]=[];
 for(const [t,o,h,l,c] of [...src].sort((a,b)=>a[0]-b[0])){
  const k=key(t),last=out[out.length-1];
  if(last&&last[0]===k){last[2]=Math.max(last[2],h);last[3]=Math.min(last[3],l);last[4]=c}else out.push([k,o,h,l,c]);
 }
 return out;
}
const hours=(n:number)=>(t:number)=>Math.floor(t/(n*H))*n*H;
// hodinové svíčky → 2hodinové (UTC 0/2/4/…) a 4hodinové (UTC 0/4/8/…)
export const toH2=(h1:Candle[]):Candle[]=>bucketAggregate(h1,hours(2));
export const toH4=(h1:Candle[]):Candle[]=>bucketAggregate(h1,hours(4));
// denní svíčky Yahoo mají čas otevření podle burzy (FX 22–23 h UTC předchozího dne, akcie 13–14 h UTC) → pro koše se den určí posunem o 3 h
const dayIndex=(t:number)=>Math.floor((t+3*H)/DAY);
// D1 → ISO týdny, otevření v pondělí 00:00 UTC
export const toW1=(d1:Candle[]):Candle[]=>bucketAggregate(d1,t=>{const d=dayIndex(t);return (d-((d+3)%7))*DAY});
// D1 → kalendářní měsíce, otevření prvního dne 00:00 UTC
export const toMN=(d1:Candle[]):Candle[]=>bucketAggregate(d1,t=>{const x=new Date(dayIndex(t)*DAY);return Date.UTC(x.getUTCFullYear(),x.getUTCMonth(),1)});
// archiv + čerstvý ocas: ocas přepíše archiv od svého prvního času
export function mergeTail(base:Candle[],tail:Candle[]):Candle[]{
 if(!tail.length)return base;
 return [...base.filter(c=>c[0]<tail[0][0]),...tail];
}
// ze série báze (H1 / D1) složí svíčky cílového TF
export function buildTf(tf:Tf,series:Candle[]):Candle[]{
 const agg=TF_SOURCE[tf].agg;
 return agg==='H2'?toH2(series):agg==='H4'?toH4(series):agg==='W1'?toW1(series):agg==='MN'?toMN(series):series;
}
export const STALE_MS:Record<Tf,number>={M1:60000,M5:3*60000,M15:5*60000,M30:5*60000,H1:15*60000,H2:15*60000,H4:15*60000,D1:6*H,W1:6*H,MN:6*H};
export const stale=(tf:Tf,updatedMs:number,now:number)=>!(updatedMs>0)||now-updatedMs>=STALE_MS[tf];
