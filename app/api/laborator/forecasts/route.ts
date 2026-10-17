// Laboratoř · Prognózy (jen vlastník): přesnost prognóz TE a ING = směr proti ceně v době vydání a chyba proti ceně na konci horizontu.
// Snímky píše scripts/refresh-forecasts.mjs do forecast_snapshots (migrace 0029); realizovaná cena = poslední denní uzavření ≤ konec horizontu (market_bars D1).
import {db} from '@/lib/server';
import {labUser,labFailed,LAB_HEADERS} from '@/lib/lab/http';
import {loadBars} from '@/lib/bars/query';
import {evaluate,type Snapshot} from '@/lib/forecasts/eval';
type Row={source:string;pair:string;horizon:string;made_at:string;horizon_end:string;value:number;spot_at_made:number|null;derived:number};
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 let rows:Row[];
 try{rows=(await d.prepare('SELECT source,pair,horizon,made_at,horizon_end,value,spot_at_made,derived FROM forecast_snapshots ORDER BY made_at DESC LIMIT 60000').all<Row>()).results}
 catch(e){if(/forecast_snapshots/.test(String((e as Error).message))||(e as {code?:string}).code==='ER_NO_SUCH_TABLE')return Response.json({missing:true,stats:[],snapshots:0,today:new Date().toISOString().slice(0,10)},{headers:LAB_HEADERS});throw e}
 const today=new Date().toISOString().slice(0,10),str=(v:unknown)=>String(v).slice(0,10);
 const snaps:Snapshot[]=rows.map(r=>({source:r.source,pair:r.pair,horizon:r.horizon,madeAt:str(r.made_at),horizonEnd:str(r.horizon_end),value:Number(r.value),spot:r.spot_at_made===null?null:Number(r.spot_at_made),derived:!!r.derived}));
 // ceny jen pro páry, které mají některý horizont už za sebou
 const due=snaps.filter(s=>s.horizonEnd<=today),byPair=new Map<string,string>();
 for(const s of due){const m=byPair.get(s.pair);if(!m||s.horizonEnd>m)byPair.set(s.pair,s.horizonEnd)}
 const closes=new Map<string,[number,number][]>();
 for(const [pair,last] of byPair){
  const from=Math.min(...due.filter(s=>s.pair===pair).map(s=>Date.parse(s.horizonEnd)))-10*86400000;
  const bars=await loadBars(d,pair,'D1',from,Date.parse(last)+2*86400000).catch(()=>[]);
  closes.set(pair,bars.map(b=>[b.t,b.c] as [number,number]));
 }
 const priceAt=(pair:string,date:string)=>{const a=closes.get(pair);if(!a)return null;const lim=Date.parse(date)+86400000;let v:number|null=null;for(const [t,c] of a){if(t<lim)v=c;else break}return v};
 return Response.json({stats:evaluate(snaps,priceAt,today),snapshots:snaps.length,today},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
