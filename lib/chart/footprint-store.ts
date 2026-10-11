// Footprint z Binance (veřejné REST): klines + aggTrades, ohleduplně (≤ 10 požadavků na volání, rozestup ~100 ms, časový limit ~6 s).
// Stav svíček v DB footprint_cache: uzavřené hotové svíčky navždy, rozpracované se doplňují v dalších voláních, živá svíčka nejvýš jednou za 30 s.
import type {Db} from '../mysql.ts';
import {FP_BASE,FP_HISTORY,FP_INTERVAL,FP_LADDER,FP_TF_MS,addTrades,chooseTick,emptyState,fpSymbol,parseAggTrades,parseKlines,toCandle,type FpCandle,type FpState,type FpTf} from './footprint.ts';
export type FootprintResult={symbol:string|null;tf:FpTf;tick:number;candles:FpCandle[];pending:number;updated:number|null;stale:boolean;unsupported?:true;error?:string};
export const BINANCE='https://api.binance.com';
export const NO_DATA='Data z Binance teď nejsou k dispozici.';
const MAX_REQ=10,SPACING=100,BUDGET_MS=6000,LIVE_MS=30000,PAGE=1000;
type Http=(url:string,init?:RequestInit)=>Promise<Response>;
export class BinanceError extends Error{status:number;constructor(status:number){super('Binance HTTP '+status);this.status=status}}
// omezovač požadavků: počet, rozestup a časový rozpočet
function limiter(http:Http,clock:()=>number,sleep:(ms:number)=>Promise<void>){
 const start=clock();let used=0,last=0;
 return {
  left:()=>used<MAX_REQ&&clock()-start<BUDGET_MS,
  used:()=>used,
  async get(path:string):Promise<unknown>{
   if(used>=MAX_REQ||clock()-start>=BUDGET_MS)throw new Error('budget');
   const wait=last?SPACING-(clock()-last):0;if(wait>0)await sleep(wait);
   used++;last=clock();
   const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),Math.max(1000,BUDGET_MS-(clock()-start)));
   try{
    const r=await http(BINANCE+path,{signal:ac.signal,headers:{'User-Agent':'Tradee/1.0'}});
    if(!r.ok)throw new BinanceError(r.status);
    return await r.json();
   }finally{clearTimeout(timer)}
  },
 };
}
const parseState=(s:unknown):FpState|null=>{try{const v=JSON.parse(String(s));return v&&typeof v==='object'&&typeof v.t==='number'&&v.b&&typeof v.b==='object'?v as FpState:null}catch{return null}};
const inflight=new Map<string,Promise<FootprintResult>>();
export function getFootprint(d:Db,instrument:string,tf:FpTf,now:number,http:Http=fetch,clock:()=>number=Date.now,sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))):Promise<FootprintResult>{
 const key=instrument+'|'+tf,run=inflight.get(key);if(run)return run;
 const p=compute(d,instrument,tf,now,http,clock,sleep).finally(()=>inflight.delete(key));
 inflight.set(key,p);return p;
}
async function compute(d:Db,instrument:string,tf:FpTf,now:number,http:Http,clock:()=>number,sleep:(ms:number)=>Promise<void>):Promise<FootprintResult>{
 const symbol=fpSymbol(instrument);
 if(!symbol)return {symbol:null,tf,tick:0,candles:[],pending:0,updated:null,stale:false,unsupported:true};
 const ms=FP_TF_MS[tf],n=FP_HISTORY[tf],base=FP_BASE[symbol],since=Math.floor(now/ms)*ms-(n-1)*ms;
 const rows=(await d.prepare('SELECT candle_t,data,updated FROM footprint_cache WHERE instrument=? AND tf=? AND candle_t>=? ORDER BY candle_t').bind(instrument,tf,since).all<{candle_t:number;data:string;updated:number}>()).results;
 const states=new Map<number,FpState>(),touched=new Map<number,number>();
 let updated:number|null=null;
 for(const r of rows){const s=parseState(r.data);if(s){states.set(Number(r.candle_t),s);updated=Math.max(updated??0,Number(r.updated)||0)}}
 const api=limiter(http,clock,sleep);
 let error:string|undefined,klines:ReturnType<typeof parseKlines>=[];
 try{klines=parseKlines(await api.get(`/api/v3/klines?symbol=${symbol}&interval=${FP_INTERVAL[tf]}&limit=${n}`));if(!klines.length)throw new Error('prázdné klines')}
 catch(e){console.error('footprint klines',symbol,tf,e);error=NO_DATA}
 const liveT=klines.length?klines[klines.length-1][0]:null;
 // OHLC z klines do stavů (nové svíčky založit)
 for(const [t,o,h,l,c,v] of klines){const s=states.get(t);if(s){if(!s.done||t===liveT){s.o=o;s.h=h;s.l=l;s.c=c;s.v=v}}else states.set(t,emptyState(t,o,h,l,c,v))}
 if(!error){
  // pořadí práce: živá svíčka (nejvýš jednou za 30 s), pak nehotové uzavřené od nejnovější
  const live=liveT!==null?states.get(liveT):undefined,liveRow=rows.find(r=>Number(r.candle_t)===liveT);
  const work:FpState[]=[];
  if(live&&(!liveRow||now-Number(liveRow.updated)>=LIVE_MS))work.push(live);
  for(const [t] of [...klines].reverse())if(t!==liveT){const s=states.get(t);if(s&&!s.done)work.push(s)}
  try{
   for(const s of work){
    if(!api.left())break;
    const end=s.t+ms,isLive=s.t===liveT;
    while(api.left()){
     const path=s.next===null?`/api/v3/aggTrades?symbol=${symbol}&startTime=${s.t}&endTime=${Math.min(end,s.t+3600000)-1}&limit=${PAGE}`:`/api/v3/aggTrades?symbol=${symbol}&fromId=${s.next}&limit=${PAGE}`;
     const trades=parseAggTrades(await api.get(path)),{reachedEnd}=addTrades(s,trades,base,end);
     touched.set(s.t,now);
     if(reachedEnd){s.done=!isLive||now>=end;break}
     if(trades.length<PAGE){
      // méně než plná stránka: dotaz v čase svíčky je kompletní, u fromId jsme na čele obchodů
      if(!isLive&&(s.next===null||trades.length===0||now>=end+5000||path.includes('startTime')))s.done=true;
      break;
     }
    }
   }
  }catch(e){
   // rozpočet vyčerpán = v pořádku; chyba Binance (429/418/451/5xx) nebo sítě = zastavit, rozpracované uložit
   if(!(e instanceof Error&&e.message==='budget')){console.error('footprint trades',symbol,tf,e);error=NO_DATA}
  }
  // uložit změněné svíčky jedním dotazem; starší než historie smazat
  const changed=[...touched.keys()].map(t=>states.get(t)!).filter(Boolean);
  if(changed.length){
   await d.prepare('INSERT INTO footprint_cache(instrument,tf,candle_t,data,updated) VALUES'+changed.map(()=>'(?,?,?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE data=VALUES(data),updated=VALUES(updated)')
    .bind(...changed.flatMap(s=>[instrument,tf,s.t,JSON.stringify(s),now])).run();
   updated=now;
  }
  await d.prepare('DELETE FROM footprint_cache WHERE instrument=? AND tf=? AND candle_t<?').bind(instrument,tf,since).run();
 }
 const list=[...states.values()].filter(s=>s.t>=since).sort((a,b)=>a.t-b.t);
 const tick=chooseTick(list.slice(-60).map(s=>s.h-s.l),FP_LADDER[symbol]);
 const lastT=liveT??list[list.length-1]?.t;
 const candles=list.map(s=>toCandle(s,base,tick,s.t===lastT&&!s.done));
 return {symbol,tf,tick,candles,pending:list.filter(s=>!s.done&&s.t!==lastT).length,updated,stale:!!error,...(error?{error}:{})};
}
