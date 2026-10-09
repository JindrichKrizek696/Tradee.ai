// Vrstvy grafu trhu (obchody, zprávy, skóre, seance) nad svíčkami. Čisté funkce – testy scripts/check-chart.mjs.
// Časy jsou „časy grafu“: sekundy posunuté na pražský čas (chartTime), osa tak ukazuje místní čas.
import {chartTime} from '../journal/chart-data.ts';
import {sessionOfHour,type SessionKey} from '../journal/analytics.ts';
import {fmtR} from '../journal/format.ts';
import {fmtMoney} from '../trades.ts';
import type {Tf} from './candles.ts';
import type {ChartTrade} from './trades.ts';
export const TF_SEC:Record<Tf,number>={H1:3600,H4:14400,D1:86400};
type MarkerBase={time:number;shape:'arrowUp'|'arrowDown'|'circle'|'square';color:string;id:string;text?:string;size?:number};
export type Marker=(MarkerBase&{position:'aboveBar'|'belowBar'|'inBar'})|(MarkerBase&{position:'atPriceTop'|'atPriceBottom'|'atPriceMiddle';price:number});
// začátek pražského dne YYYY-MM-DD v čase grafu
export const dayStart=(iso:string)=>{const [y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d)/1000};
// čas → svíčka, která ho obsahuje; v mezeře (víkend, noc) nejbližší další svíčka; mimo rozsah grafu null
export function snapTo(times:number[],tfSec:number,t:number):number|null{
 if(!times.length||t<times[0]||t>=times[times.length-1]+tfSec)return null;
 let lo=0,hi=times.length-1,i=0;while(lo<=hi){const m=(lo+hi)>>1;if(times[m]<=t){i=m;lo=m+1}else hi=m-1}
 return t<times[i]+tfSec||i===times.length-1?times[i]:times[i+1];
}
// trhy kalendáře k instrumentu (EUR/USD → EUR, USD · BTC-USD → BTC · ^NDX → INDEX · AAPL → AAPL)
export function instrumentMarkets(id:string){
 if(id.includes('/'))return id.split('/');
 if(id.endsWith('-USD'))return [id.slice(0,-4)];
 if(id.startsWith('^'))return ['INDEX'];
 return [id];
}
export type NewsEvent={id:string;at:string;timeKnown:boolean;title:string;markets:string[];signal:number;global:boolean};
// zprávy se signálem ≥ 2 pro trhy instrumentu (globální události vždy) v rozsahu svíček
export function newsLayer<E extends NewsEvent>(events:E[],instrument:string,times:number[],tfSec:number){
 const mk=instrumentMarkets(instrument),out:{event:E;time:number}[]=[];
 for(const e of events){
  if(e.signal<2||!(e.global||e.markets.some(m=>mk.includes(m))))continue;
  const ms=Date.parse(e.at);if(!Number.isFinite(ms))continue;
  const time=snapTo(times,tfSec,e.timeKnown?chartTime(ms):Math.floor(chartTime(ms)/86400)*86400);
  if(time!==null)out.push({event:e,time});
 }
 return out;
}
export function newsMarkers(list:{event:NewsEvent;time:number}[],c:{strong:string;normal:string}):Marker[]{
 return list.map(({event:e,time})=>e.signal>=3?{time,position:'aboveBar',shape:'circle',color:c.strong,id:'n:'+e.id,size:1.3}:{time,position:'aboveBar',shape:'square',color:c.normal,id:'n:'+e.id,size:.7});
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
