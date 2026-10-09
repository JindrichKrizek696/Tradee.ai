// Čtení archivu svíček pro backtesty. loadBars = jeden dotaz po primárním klíči; toH4 = čistá agregace H1 → H4.
import type {Bar,BarTf} from './yahoo.ts';
type Reader={prepare(sql:string):{bind(...p:unknown[]):{all<T=Record<string,unknown>>():Promise<{results:T[]}>}}};
export async function loadBars(d:Reader,instrument:string,tf:BarTf,fromMs:number,toMs:number):Promise<Bar[]>{
 const r=await d.prepare('SELECT t,o,h,l,c,v FROM market_bars WHERE instrument=? AND tf=? AND t>=? AND t<? ORDER BY t').bind(instrument,tf,fromMs,toMs).all<Bar>();
 return r.results.map(x=>({t:Number(x.t),o:x.o,h:x.h,l:x.l,c:x.c,v:x.v===null||x.v===undefined?null:x.v}));
}
// H1 → H4: svíčky seskupené do 4h košů zarovnaných na UTC (00,04,08,…); koš je jedna svíčka z libovolného počtu H1 (neúplné koše zůstávají)
export function toH4(rows:Bar[]):Bar[]{
 const H4=4*3600000,out:Bar[]=[];
 for(const b of [...rows].sort((a,b)=>a.t-b.t)){
  const k=Math.floor(b.t/H4)*H4,last=out[out.length-1];
  if(last&&last.t===k){last.h=Math.max(last.h,b.h);last.l=Math.min(last.l,b.l);last.c=b.c;last.v=last.v===null&&b.v===null?null:(last.v||0)+(b.v||0)}
  else out.push({t:k,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v});
 }
 return out;
}
