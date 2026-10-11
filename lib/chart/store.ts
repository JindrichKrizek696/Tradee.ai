// Cache svíček grafu v DB (market_candles) s jednoduchým zámkem obnovy (sloupec fetching).
import type {Db} from '../mysql.ts';
import {instruments,fxCurrencies} from '../markets.ts';
import {yahooSymbol} from '../live.ts';
import {parseYahoo,mergeTail,buildTf,fixFxDailyOpen,stale,TF_SOURCE,TF_CAP,HISTORY_FROM,type Candle,type Tf} from './candles.ts';
import {loadBars} from '../bars/query.ts';
export type CandlesResult={candles:Candle[];stale:boolean;updated:number|null;unsupported?:true;error?:string};
const DAY=86400000,H1_DAYS=729,UA='Mozilla/5.0',LOCK_MS=60000,NONE='Ceny teď nejsou k dispozici.';
const sql=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const utc=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):0;
export function candleSymbol(instrument:string){return instruments.some(i=>i.id===instrument)?yahooSymbol(instrument,fxCurrencies):null}
async function yahoo(symbol:string,interval:string,range:string):Promise<Candle[]>{
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),10000);
 try{
  const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+`?range=${range}&interval=${interval}`,{headers:{'User-Agent':UA},signal:ac.signal});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return parseYahoo(await r.json());
 }finally{clearTimeout(timer)}
}
// archiv market_bars (H1 poslední 2 roky, D1 od 2020); chyba archivu = jako prázdný archiv
async function archive(ctx:ArchiveCtx|undefined,base:'H1'|'D1',now:number):Promise<Candle[]>{
 if(!ctx)return [];
 try{
  const from=base==='H1'?now-H1_DAYS*DAY:HISTORY_FROM;
  return (await loadBars(ctx.db as never,ctx.instrument,base,from,now+DAY)).map(b=>[b.t,b.o,b.h,b.l,b.c] as Candle);
 }catch(e){console.error('candles archive',ctx.instrument,base,e);return []}
}
export type ArchiveCtx={db:Db;instrument:string};
export async function fetchCandles(symbol:string,tf:Tf,ctx?:ArchiveCtx,now=Date.now()):Promise<Candle[]>{
 const src=TF_SOURCE[tf];
 const arch=src.base?await archive(ctx,src.base,now):[];
 let fresh:Candle[]=[];
 try{fresh=await yahoo(symbol,src.interval,arch.length&&src.tail?src.tail:src.range)}catch(e){if(!arch.length)throw e}
 if(!arch.length&&!fresh.length)throw new Error('prázdná odpověď');
 let series=mergeTail(arch,fresh);
 if(src.base==='D1'&&symbol.endsWith('=X'))series=fixFxDailyOpen(series);
 if(src.base==='D1')series=series.filter(c=>c[0]>=HISTORY_FROM);
 return buildTf(tf,series).slice(-TF_CAP[tf]);
}
const parse=(s:unknown):Candle[]=>{try{const v=JSON.parse(String(s));return Array.isArray(v)?v:[]}catch{return []}};
export async function getCandles(d:Db,instrument:string,tf:Tf,now:number,fetcher:(symbol:string,tf:Tf)=>Promise<Candle[]>=(sym,t)=>fetchCandles(sym,t,{db:d,instrument},now)):Promise<CandlesResult>{
 const symbol=candleSymbol(instrument);
 if(!symbol)return {candles:[],stale:false,updated:null,unsupported:true};
 const row=await d.prepare('SELECT data,updated FROM market_candles WHERE instrument=? AND tf=?').bind(instrument,tf).first<{data:string;updated:string}>();
 const cached=row?parse(row.data):[],updated=row?utc(row.updated):null;
 if(row&&updated!==null&&!stale(tf,updated,now))return {candles:cached,stale:false,updated};
 const fallback=():CandlesResult=>row&&cached.length?{candles:cached,stale:true,updated}:{candles:[],stale:true,updated:null,error:NONE};
 // zámek: jen jeden požadavek obnovuje (zámek starší než 60 s se přebije)
 if(!row)await d.prepare("INSERT IGNORE INTO market_candles(instrument,tf,data,updated,fetching) VALUES(?,?,'[]','1970-01-02 00:00:00',NULL)").bind(instrument,tf).run();
 const lock=await d.prepare('UPDATE market_candles SET fetching=? WHERE instrument=? AND tf=? AND (fetching IS NULL OR fetching<?)').bind(sql(now),instrument,tf,sql(now-LOCK_MS)).run();
 if(lock.meta.changes<1)return fallback();
 try{
  const candles=await fetcher(symbol,tf);
  await d.prepare('UPDATE market_candles SET data=?,updated=?,fetching=NULL WHERE instrument=? AND tf=?').bind(JSON.stringify(candles),sql(now),instrument,tf).run();
  return {candles,stale:false,updated:now};
 }catch(e){
  console.error('candles',instrument,tf,e);
  await d.prepare('UPDATE market_candles SET fetching=NULL WHERE instrument=? AND tf=?').bind(instrument,tf).run().catch(()=>{});
  return fallback();
 }
}
