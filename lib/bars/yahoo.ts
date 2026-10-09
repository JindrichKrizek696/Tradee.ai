// Archiv svíček z Yahoo: parsování, validace a plán stahování (čisté funkce, testy scripts/check-bars.mjs).
export type BarTf='H1'|'D1';
export type Bar={t:number;o:number;h:number;l:number;c:number;v:number|null}; // t = otevření svíčky, ms UTC
export type FetchPlan={tf:BarTf;interval:'60m'|'1d';period1?:number;period2?:number;range?:string}; // period v sekundách
export const H1_DAYS=729,H1_CHUNK_DAYS=59,BAR_MS:Record<BarTf,number>={H1:3600000,D1:86400000};
type YQ={open?:(number|null)[];high?:(number|null)[];low?:(number|null)[];close?:(number|null)[];volume?:(number|null)[]};
type YahooChart={chart?:{result?:{timestamp?:number[];indicators?:{quote?:YQ[]}}[]|null}};
const fin=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
// OHLC musí dávat smysl: h ≥ max(o,c), l ≤ min(o,c), vše konečné
export function validBar(b:Bar):boolean{
 return [b.t,b.o,b.h,b.l,b.c].every(fin)&&b.t>0&&b.h>=Math.max(b.o,b.c)&&b.l<=Math.min(b.o,b.c);
}
// odpověď /v8/finance/chart → svíčky seřazené podle času; řádky s null/neplatné se vynechají (počet vynechaných v skipped)
export function parseBars(json:unknown):{bars:Bar[];skipped:number}{
 const res=(json as YahooChart|null)?.chart?.result?.[0];if(!res)return {bars:[],skipped:0};
 const ts=res.timestamp||[],q=res.indicators?.quote?.[0]||{},bars:Bar[]=[];let skipped=0;
 ts.forEach((s,i)=>{
  const o=q.open?.[i],h=q.high?.[i],l=q.low?.[i],c=q.close?.[i],v=q.volume?.[i];
  if(!fin(o)||!fin(h)||!fin(l)||!fin(c)){skipped++;return}
  const b:Bar={t:s*1000,o,h,l,c,v:fin(v)?v:null};
  if(validBar(b))bars.push(b);else skipped++;
 });
 bars.sort((a,b)=>a.t-b.t);
 return {bars:bars.filter((b,i)=>!i||b.t!==bars[i-1].t),skipped};
}
// plán stahování: H1 po ≤ 59 dnech (Yahoo dává 60m jen do 730 dní zpět), D1 celá historie (period1=0)
export function windows(tf:BarTf,nowMs=Date.now()):FetchPlan[]{
 const end=Math.floor(nowMs/1000);
 if(tf==='D1')return [{tf,interval:'1d',period1:0,period2:end}]; // range=max by Yahoo vrátil jen měsíční svíčky, period1=0 dá skutečné denní
 const start=end-H1_DAYS*86400,step=H1_CHUNK_DAYS*86400,out:FetchPlan[]=[];
 for(let a=start;a<end;a+=step)out.push({tf,interval:'60m',period1:a,period2:Math.min(a+step,end)});
 return out;
}
// přírůstek: od (poslední svíčka − 2 svíčky) do teď; poslední (rozpracovaná) svíčka se přepíše
export function incrementalPlan(tf:BarTf,lastT:number|null,nowMs=Date.now()):FetchPlan[]{
 if(lastT===null)return windows(tf,nowMs); // bez dat = jako backfill
 if(tf==='D1')return [{tf,interval:'1d',range:'1mo'}];
 const end=Math.floor(nowMs/1000),from=Math.max(Math.floor((lastT-2*BAR_MS.H1)/1000),end-H1_CHUNK_DAYS*86400);
 return [{tf,interval:'60m',period1:from,period2:end}];
}
export function planUrl(symbol:string,p:FetchPlan):string{
 const q=p.range?'range='+p.range:'period1='+p.period1+'&period2='+p.period2;
 return 'https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?'+q+'&interval='+p.interval+'&includePrePost=false';
}
