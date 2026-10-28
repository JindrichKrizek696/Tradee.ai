// Čerstvé ceny pro alerty: Yahoo v8 chart (interval 1m, range 1d, bez pre/post) a Binance klines pro krypto.
// Čisté parsery + stahování s vloženým fetch (testy bez sítě: scripts/check-alerts.mjs).
import type {Quote,Bar} from './logic.ts';
import {YAHOO_OVERRIDE} from '../instrument-info.ts';
export const UA='Mozilla/5.0'; // dlouhý Chrome UA Yahoo odmítá (429), krátký projde – stejně jako scripts/refresh-live.mjs
export const BINANCE:Record<string,string>={'BTC-USD':'BTCUSDT','ETH-USD':'ETHUSDT','SOL-USD':'SOLUSDT'};
const CURRENCIES=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD'];
/** Zdroj ceny pro alert; měnové indexy cenu nemají (jen skóre) → null. */
export function quoteSource(id:string):{src:'binance';symbol:string}|{src:'yahoo';symbol:string}|null{
 if(CURRENCIES.includes(id))return null;
 if(BINANCE[id])return {src:'binance',symbol:BINANCE[id]};
 if(YAHOO_OVERRIDE[id])return {src:'yahoo',symbol:YAHOO_OVERRIDE[id]};
 const m=id.match(/^([A-Z]{3})\/([A-Z]{3})$/);return {src:'yahoo',symbol:m?m[1]+m[2]+'=X':id};
}
type Y={chart?:{result?:{meta?:{regularMarketPrice?:number;chartPreviousClose?:number;previousClose?:number;regularMarketTime?:number};timestamp?:number[];indicators?:{quote?:{high?:(number|null)[];low?:(number|null)[];close?:(number|null)[]}[]}}[]|null}};
export function parseYahoo1m(json:unknown):Quote|null{
 const r=(json as Y|null)?.chart?.result?.[0];if(!r)return null;
 const m=r.meta||{},price=Number(m.regularMarketPrice),prev=Number(m.chartPreviousClose??m.previousClose),t=Number(m.regularMarketTime);
 if(!(price>0)||!(t>0))return null;
 const ts=r.timestamp||[],q=r.indicators?.quote?.[0]||{},bars:Bar[]=[];
 ts.forEach((s,i)=>{const h=q.high?.[i],l=q.low?.[i];if(typeof h==='number'&&typeof l==='number'&&h>0&&l>0)bars.push({t:s*1000,h,l})});
 return {price,prevClose:prev>0?prev:null,marketTime:t*1000,bars};
}
/** Binance klines [[openTime, o, h, l, c, …]]: 1m pro cenu a extrémy, 1d (dnešní UTC svíčka) pro otevření dne = „předchozí zavření“. */
export function parseBinance(k1m:unknown,k1d:unknown):Quote|null{
 if(!Array.isArray(k1m)||!k1m.length)return null;
 const bars:Bar[]=[];let price=NaN,t=0;
 for(const k of k1m){if(!Array.isArray(k))continue;const h=Number(k[2]),l=Number(k[3]),c=Number(k[4]),o=Number(k[0]);if(h>0&&l>0&&c>0&&o>0){bars.push({t:o,h,l});price=c;t=o}}
 if(!(price>0))return null;
 const d=Array.isArray(k1d)&&Array.isArray(k1d[k1d.length-1])?Number(k1d[k1d.length-1][1]):NaN;
 return {price,prevClose:d>0?d:null,marketTime:t,bars};
}
type F=(url:string,init?:RequestInit)=>Promise<Response>;
async function get(f:F,url:string,ms=8000){
 const ac=new AbortController(),t=setTimeout(()=>ac.abort(),ms);
 try{const r=await f(url,{headers:{'User-Agent':UA},signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}
}
/** Stáhne cenu jednoho trhu. limitMin = kolik 1m svíček z Binance (od poslední kontroly, max 120). */
export async function fetchQuote(id:string,f:F=fetch,limitMin=5):Promise<Quote|null>{
 const s=quoteSource(id);if(!s)return null;
 if(s.src==='binance'){
  const n=Math.max(2,Math.min(120,Math.ceil(limitMin)+1)),base='https://api.binance.com/api/v3/klines?symbol='+s.symbol;
  const [a,b]=await Promise.all([get(f,base+'&interval=1m&limit='+n),get(f,base+'&interval=1d&limit=1')]);
  return parseBinance(a,b);
 }
 return parseYahoo1m(await get(f,'https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(s.symbol)+'?interval=1m&range=1d&includePrePost=false'));
}
/** Stahování po dávkách s malou souběžností; chyba u trhu = null (alerty trhu se v tomto běhu přeskočí). */
export async function fetchQuotes(ids:string[],f:F=fetch,opts:{concurrency?:number;limitMin?:(id:string)=>number}={}):Promise<{quotes:Map<string,Quote|null>;errors:string[]}>{
 const quotes=new Map<string,Quote|null>(),errors:string[]=[],c=opts.concurrency??4;
 for(let i=0;i<ids.length;i+=c)await Promise.all(ids.slice(i,i+c).map(async id=>{try{const q=await fetchQuote(id,f,opts.limitMin?.(id)??5);quotes.set(id,q);if(!q)errors.push(id+': prázdná odpověď')}catch(e){quotes.set(id,null);errors.push(id+': '+((e as Error)?.name==='AbortError'?'timeout':(e as Error)?.message))}}));
 return {quotes,errors};
}
