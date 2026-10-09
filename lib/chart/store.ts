// Cache svíček grafu v DB (market_candles) s jednoduchým zámkem obnovy (sloupec fetching).
import type {Db} from '../mysql.ts';
import {instruments,fxCurrencies} from '../markets.ts';
import {yahooSymbol} from '../live.ts';
import {parseYahoo,toH4,stale,TF_SOURCE,TF_CAP,type Candle,type Tf} from './candles.ts';
export type CandlesResult={candles:Candle[];stale:boolean;updated:number|null;unsupported?:true;error?:string};
const UA='Mozilla/5.0',LOCK_MS=60000,NONE='Ceny teď nejsou k dispozici.';
const sql=(ms:number)=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const utc=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):0;
export function candleSymbol(instrument:string){return instruments.some(i=>i.id===instrument)?yahooSymbol(instrument,fxCurrencies):null}
export async function fetchCandles(symbol:string,tf:Tf):Promise<Candle[]>{
 const src=TF_SOURCE[tf],ac=new AbortController(),timer=setTimeout(()=>ac.abort(),10000);
 try{
  const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+`?range=${src.range}&interval=${src.interval}`,{headers:{'User-Agent':UA},signal:ac.signal});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const raw=parseYahoo(await r.json());if(!raw.length)throw new Error('prázdná odpověď');
  return (src.aggregate?toH4(raw):raw).slice(-TF_CAP[tf]);
 }finally{clearTimeout(timer)}
}
const parse=(s:unknown):Candle[]=>{try{const v=JSON.parse(String(s));return Array.isArray(v)?v:[]}catch{return []}};
export async function getCandles(d:Db,instrument:string,tf:Tf,now:number,fetcher:(symbol:string,tf:Tf)=>Promise<Candle[]>=fetchCandles):Promise<CandlesResult>{
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
