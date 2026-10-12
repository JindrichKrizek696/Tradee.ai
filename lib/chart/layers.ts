// Vrstvy grafu trhu (obchody, zprávy, skóre, seance) nad svíčkami. Čisté funkce – testy scripts/check-chart.mjs.
// Časy jsou „časy grafu“: sekundy posunuté na pražský čas (chartTime), osa tak ukazuje místní čas.
import {chartTime} from '../journal/chart-data.ts';
import {sessionOfHour,type SessionKey} from '../journal/analytics.ts';
import {fmtR} from '../journal/format.ts';
import {COMMODITY_MARKETS} from '../calendar.ts';
import {fmtMoney} from '../trades.ts';
import type {Tf} from './candles.ts';
import type {ChartTrade} from './trades.ts';
// TF grafu: M1–MN (footprint krypta je podmnožina M5/M15/H1); MN = 31 dní (svíčky měsíců na sebe navazují, viz snapTo)
export type ChartTf=Tf;
export const MN_SEC=31*86400;
export const TF_SEC:Record<ChartTf,number>={M1:60,M5:300,M15:900,M30:1800,H1:3600,H2:7200,H4:14400,D1:86400,W1:604800,MN:MN_SEC};
// intraday TF, na kterých se zobrazují seance (M1–H1)
export const SESSION_TFS:readonly ChartTf[]=['M1','M5','M15','M30','H1'];
type MarkerBase={time:number;shape:'arrowUp'|'arrowDown'|'circle'|'square';color:string;id:string;text?:string;size?:number};
export type Marker=(MarkerBase&{position:'aboveBar'|'belowBar'|'inBar'})|(MarkerBase&{position:'atPriceTop'|'atPriceBottom'|'atPriceMiddle';price:number});
// začátek pražského dne YYYY-MM-DD v čase grafu
export const dayStart=(iso:string)=>{const [y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d)/1000};
// čas → svíčka, která ho obsahuje; v mezeře (víkend, noc) nejbližší další svíčka; mimo rozsah grafu null
export function snapTo(times:number[],tfSec:number,t:number):number|null{
 if(!times.length||t<times[0]||t>=times[times.length-1]+tfSec)return null;
 let lo=0,hi=times.length-1,i=0;while(lo<=hi){const m=(lo+hi)>>1;if(times[m]<=t){i=m;lo=m+1}else hi=m-1}
 // měsíční svíčky na sebe navazují: končí začátkem další
 const end=tfSec>=MN_SEC&&i<times.length-1?times[i+1]:times[i]+tfSec;
 return t<end||i===times.length-1?times[i]:times[i+1];
}
// trhy kalendáře k instrumentu (EUR/USD → EUR, USD · BTC-USD → BTC · ^NDX → INDEX · AAPL → AAPL · GC=F → GOLD, USD · CL=F → OIL)
export function instrumentMarkets(id:string){
 if(id.includes('/'))return id.split('/');
 if(COMMODITY_MARKETS[id])return COMMODITY_MARKETS[id];
 if(id.endsWith('-USD'))return [id.slice(0,-4)];
 if(id.startsWith('^'))return ['INDEX'];
 return [id];
}
export type NewsEvent={id:string;at:string;timeKnown:boolean;title:string;markets:string[];signal:number;global:boolean;kind?:string};
// zprávy se signálem ≥ 2 pro trhy instrumentu (globální události vždy)
const newsFor=(instrument:string)=>{const mk=instrumentMarkets(instrument);return (e:NewsEvent)=>e.signal>=2&&(e.global||e.markets.some(m=>mk.includes(m)))};
// čas zprávy v čase grafu; bez přesného času začátek pražského dne; nečitelný čas null
export const newsTime=(e:{at:string;timeKnown:boolean})=>{const ms=Date.parse(e.at);if(!Number.isFinite(ms))return null;const t=chartTime(ms);return e.timeKnown?t:Math.floor(t/86400)*86400};
// proběhlé zprávy (do now, ms) v rozsahu svíček → svíčka, nad kterou patří značka
export function newsLayer<E extends NewsEvent>(events:E[],instrument:string,times:number[],tfSec:number,now=Infinity){
 const ok=newsFor(instrument),out:{event:E;time:number}[]=[];
 for(const e of events){
  if(!ok(e)||!(Date.parse(e.at)<=now))continue;
  const t=newsTime(e),time=t===null?null:snapTo(times,tfSec,t);
  if(time!==null)out.push({event:e,time});
 }
 return out;
}
// čas → logický index svíčky: v rozsahu svíčka, která čas obsahuje (v mezeře další), za poslední svíčkou odhad po krocích TF (budoucí víkendy a noci nezná); před první svíčkou null
export function logicalAt(times:number[],tfSec:number,t:number):number|null{
 if(!times.length||!(t>=times[0]))return null;
 const last=times.length-1;
 if(t>=times[last]+tfSec)return last+Math.floor((t-times[last])/tfSec);
 const time=snapTo(times,tfSec,t);return time===null?null:times.indexOf(time);
}
// nadcházející zprávy (po now, ms) pro pás dole v grafu, seřazené podle času
export function upcomingNews<E extends NewsEvent>(events:E[],instrument:string,times:number[],tfSec:number,now:number){
 const ok=newsFor(instrument),out:{event:E;t:number;logical:number}[]=[];
 for(const e of events){
  if(!ok(e)||!(Date.parse(e.at)>now))continue;
  const t=newsTime(e),logical=t===null?null:logicalAt(times,tfSec,t);
  if(t!==null&&logical!==null)out.push({event:e,t,logical});
 }
 return out.sort((a,b)=>a.t-b.t||a.event.id.localeCompare(b.event.id));
}
// země zprávy jako dvoupísmenný kód (vlaječky emoji Windows nevykreslí): podle titulku (USA •, ECB, RBA…), typu události, jinak podle měny; ropa, OPEC apod. null
const TITLE_COUNTRY:[RegExp,string][]=[[/^(USA|FOMC|Fed|EIA|Baker Hughes|ISM|NYSE)\b/i,'US'],[/^(ECB|Eurozón)/i,'EU'],[/^Německo/i,'DE'],[/^Francie/i,'FR'],[/^Itálie/i,'IT'],[/^Španělsko/i,'ES'],[/^(Velká Británie|Británie|UK\b|BoE\b|Bank of England)/i,'GB'],[/^(Japonsko|BoJ\b)/i,'JP'],[/^(Švýcarsko|SNB\b|Swiss National Bank)/i,'CH'],[/^(Austrálie|RBA\b)/i,'AU'],[/^(Nový Zéland|RBNZ\b)/i,'NZ'],[/^(Kanada|BoC\b)/i,'CA'],[/^(Čína|PBoC\b)/i,'CN']];
const KIND_COUNTRY:[RegExp,string][]=[[/^(us-|fomc|eia-|rig-count|nyse-|opex)/,'US'],[/^ecb/,'EU']];
export const CURRENCY_COUNTRY:Record<string,string>={USD:'US',EUR:'EU',GBP:'GB',JPY:'JP',CHF:'CH',AUD:'AU',NZD:'NZ',CAD:'CA',CNY:'CN'};
export function eventCountry(e:{title:string;kind?:string;markets:string[]}):string|null{
 const kind=e.kind||'';
 return TITLE_COUNTRY.find(([re])=>re.test(e.title))?.[1]??KIND_COUNTRY.find(([re])=>re.test(kind))?.[1]??e.markets.map(m=>CURRENCY_COUNTRY[m]).find(Boolean)??null;
}
// značky proběhlých zpráv nad svíčkou: silná červená, střední oranžová, popisek = země
export function newsMarkers(list:{event:NewsEvent;time:number}[],c:{high:string;mid:string}):Marker[]{
 return list.map(({event:e,time})=>{const country=eventCountry(e)??undefined;return e.signal>=3?{time,position:'aboveBar',shape:'circle',color:c.high,id:'n:'+e.id,size:1.2,text:country}:{time,position:'aboveBar',shape:'circle',color:c.mid,id:'n:'+e.id,size:.9,text:country}});
}
// reakce trhu po zprávě z načtených svíček: od otevření svíčky se zprávou do zavření poslední svíčky, která skončila nejpozději v čase otevření + horizont
// stav: ok · future (zpráva ještě nebyla) · pending (horizont ještě neuplynul nebo na něj nejsou svíčky – asOf = čas načtení svíček) · coarse (svíčka TF je delší než horizont) · unknown (zpráva bez přesného času → jen 1 den) · nodata (zpráva mimo svíčky)
export const REACTION_HORIZONS=[{key:'15m',sec:900,label:'15 min'},{key:'1h',sec:3600,label:'1 h'},{key:'4h',sec:14400,label:'4 h'},{key:'1d',sec:86400,label:'1 den'}] as const;
export type ReactionStatus='ok'|'future'|'pending'|'coarse'|'unknown'|'nodata';
export type Reaction={key:string;label:string;sec:number;status:ReactionStatus;from?:number;to?:number;change?:number;pct?:number;high?:number;low?:number;start?:number;end?:number};
type Ohlc={time:number;open:number;high:number;low:number;close:number};
export function newsReaction(bars:Ohlc[],e:{at:string;timeKnown:boolean},tfSec:number,now:number,asOf=now):Reaction[]{
 const future=!(Date.parse(e.at)<=now),t=newsTime(e),times=bars.map(b=>b.time);
 const start=future||t===null?null:snapTo(times,tfSec,t),i0=start===null?-1:times.indexOf(start),ready=chartTime(asOf);
 return REACTION_HORIZONS.map(({key,sec,label}):Reaction=>{
  const r={key,label,sec};
  if(future)return {...r,status:'future'};
  if(sec<tfSec)return {...r,status:'coarse'};
  if(!e.timeKnown&&sec<86400)return {...r,status:'unknown'};
  if(i0<0)return {...r,status:'nodata'};
  const begin=bars[i0].time,end=begin+sec;
  if(end>ready)return {...r,status:'pending',start:begin,end};
  let j=i0,high=bars[i0].high,low=bars[i0].low;
  while(j+1<bars.length&&bars[j+1].time+tfSec<=end){j++;high=Math.max(high,bars[j].high);low=Math.min(low,bars[j].low)}
  const from=bars[i0].open,to=bars[j].close,change=to-from;
  return {...r,status:'ok',from,to,change,pct:from?change/from*100:undefined,high,low,start:begin,end:bars[j].time+tfSec};
 });
}
// výsledek obchodu na značce výstupu: R, jinak peníze
export const tradeResult=(t:ChartTrade)=>t.r!==null?fmtR(t.r):fmtMoney(t.pnl,t.currency);
// značky obchodů: vstup ▲/▼ (u ceny vstupu), výstup kroužek s výsledkem; ruční obchody bez času jen kroužek na začátku dne
export function tradeMarkers(trades:ChartTrade[],times:number[],tfSec:number,c:{bull:string;bear:string}):Marker[]{
 const out:Marker[]=[];
 for(const t of trades){
  const tone=t.pnl>=0?c.bull:c.bear;
  if(t.openTs===null){const time=snapTo(times,tfSec,dayStart(t.date));if(time!==null)out.push({time,position:'aboveBar',shape:'circle',color:tone,id:'t:'+t.id,text:tradeResult(t)});continue}
  const inT=snapTo(times,tfSec,chartTime(t.openTs)),outT=snapTo(times,tfSec,chartTime(t.closeTs));
  if(inT!==null&&t.side){const buy=t.side==='buy';out.push(t.openPrice!==null?{time:inT,position:buy?'atPriceBottom':'atPriceTop',price:t.openPrice,shape:buy?'arrowUp':'arrowDown',color:buy?c.bull:c.bear,id:'t:'+t.id}:{time:inT,position:buy?'belowBar':'aboveBar',shape:buy?'arrowUp':'arrowDown',color:buy?c.bull:c.bear,id:'t:'+t.id})}
  if(outT!==null)out.push(t.closePrice!==null?{time:outT,position:'atPriceMiddle',price:t.closePrice,shape:'circle',color:tone,id:'t:'+t.id,text:tradeResult(t),size:.8}:{time:outT,position:t.side==='sell'?'belowBar':'aboveBar',shape:'circle',color:tone,id:'t:'+t.id,text:tradeResult(t),size:.8});
 }
 return out;
}
// lightweight-charts chce značky seřazené podle času
export const sortMarkers=(m:Marker[])=>[...m].sort((a,b)=>a.time-b.time);
// barva s průhledností (#rgb, #rrggbb, rgb()); jiné formáty beze změny
export function withAlpha(color:string,a:number){
 const c=color.trim(),h=c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
 if(h){const x=h[1].length===3?h[1].split('').map(v=>v+v).join(''):h[1],n=parseInt(x,16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`}
 const r=c.match(/^rgba?\(([^)]+)\)$/i);if(r){const [x,y,z]=r[1].split(/[\s,/]+/).filter(Boolean);return `rgba(${x},${y},${z},${a})`}
 return c;
}
// pás skóre: ke každé svíčce poslední snímek skóre známý do jejího konce (schody); před prvním snímkem mezera
export type ScorePoint={time:number;value?:number;color?:string};
export function scoreBand(series:{at:string;score:number}[],times:number[],tfSec:number,c:{bull:string;bear:string}):ScorePoint[]{
 const snaps=series.map(s=>({t:chartTime(Date.parse(s.at)),v:s.score})).filter(s=>Number.isFinite(s.t)).sort((a,b)=>a.t-b.t);
 let j=-1;
 return times.map(time=>{
  while(j+1<snaps.length&&snaps[j+1].t<time+tfSec)j++;
  if(j<0)return {time};
  const v=snaps[j].v;return {time,value:v,color:withAlpha(v>=0?c.bull:c.bear,Math.round((.25+.75*Math.min(1,Math.abs(v)/100))*100)/100)};
 });
}
// seance podle pražské hodiny začátku svíčky (stejné rozdělení jako analytika deníku); mimo seance mezera
export const SESSION_COLORS:Record<Exclude<SessionKey,'off'>,string>={asia:'#f59e0b',london:'#3b82f6',overlap:'#8b5cf6',ny:'#10b981'};
export function sessionBands(times:number[],alpha:number){
 return times.map(time=>{const k=sessionOfHour(new Date(time*1000).getUTCHours());return k==='off'?{time}:{time,value:1,color:withAlpha(SESSION_COLORS[k],alpha)}});
}
