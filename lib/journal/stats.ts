// Filtry a statistiky deníku (počítá se v prohlížeči z celého seznamu obchodů).
import {pragueDate} from '../mt/trades.ts';
import type {JournalTrade,JournalAccount} from './types.ts';
export type Period='week'|'month'|'30d'|'90d'|'year'|'all'|'custom';
export type Filter={account:string;period:Period;from:string;to:string;symbol:string;tag:string;side:'all'|'buy'|'sell';result:'all'|'win'|'loss';source:'all'|'mt'|'manual'};
export const DEFAULT_FILTER:Filter={account:'all',period:'all',from:'',to:'',symbol:'all',tag:'all',side:'all',result:'all',source:'all'};
const DAY=86400000,r2=(n:number)=>Math.round(n*100)/100;
// rozsah dat (RRRR-MM-DD, včetně krajů) podle pražského kalendáře
export function periodRange(f:Filter,now:number):[string,string]{
 const today=pragueDate(now);
 if(f.period==='week'){const wd=(new Date(today+'T12:00:00Z').getUTCDay()+6)%7;return [pragueDate(Date.parse(today+'T12:00:00Z')-wd*DAY),today]}
 if(f.period==='month')return [today.slice(0,8)+'01',today];
 if(f.period==='year')return [today.slice(0,5)+'01-01',today];
 if(f.period==='30d')return [pragueDate(now-29*DAY),today];
 if(f.period==='90d')return [pragueDate(now-89*DAY),today];
 if(f.period==='custom')return [f.from||'0000-00-00',f.to||'9999-99-99'];
 return ['0000-00-00','9999-99-99'];
}
export function filterTrades(trades:JournalTrade[],f:Filter,now:number){
 const [from,to]=periodRange(f,now);
 return trades.filter(t=>t.date>=from&&t.date<=to&&(f.account==='all'||t.accountId===f.account)&&(f.symbol==='all'||t.symbol===f.symbol)&&(f.tag==='all'||t.tags.includes(f.tag))&&(f.side==='all'||t.side===f.side)&&(f.result==='all'||(f.result==='win'?t.pnl>0:t.pnl<0))&&(f.source==='all'||t.source===f.source));
}
// uložený filtr může odkazovat na smazaný účet, tag nebo pár → zrušit jen tu část
export function sanitizeFilter(f:Filter,trades:JournalTrade[],accounts:JournalAccount[]):Filter{
 const out={...DEFAULT_FILTER,...f};
 if(out.account!=='all'&&out.account!=='manual'&&!accounts.some(a=>a.id===out.account))out.account='all';
 if(out.account==='manual'&&!trades.some(t=>t.source==='manual'))out.account='all';
 if(out.tag!=='all'&&!trades.some(t=>t.tags.includes(out.tag)))out.tag='all';
 if(out.symbol!=='all'&&!trades.some(t=>t.symbol===out.symbol))out.symbol='all';
 return out;
}
export type SortKey='closeTs'|'account'|'symbol'|'side'|'volume'|'pnl'|'r'|'holdMs';
// prázdné hodnoty (ruční obchody bez R…) vždy na konci
export function sortTrades(list:JournalTrade[],key:SortKey,dir:1|-1){
 return [...list].sort((a,b)=>{const x=a[key],y=b[key];if(x===y)return b.closeTs-a.closeTs||a.id.localeCompare(b.id);if(x===null)return 1;if(y===null)return -1;return (typeof x==='string'?x.localeCompare(String(y),'cs'):(x as number)-(y as number))*dir});
}
const byClose=(a:JournalTrade,b:JournalTrade)=>a.closeTs-b.closeTs||a.id.localeCompare(b.id);
export function equityCurve(trades:JournalTrade[]){let s=0;return [...trades].sort(byClose).map(t=>({ts:t.closeTs,value:r2(s+=t.pnl)}))}
// největší pokles od maxima kumulovaného výsledku (začíná se od nuly)
export function maxDrawdown(curve:{value:number}[]){let peak=0,dd=0;for(const p of curve){peak=Math.max(peak,p.value);dd=Math.max(dd,peak-p.value)}return r2(dd)}
export function streaks(trades:JournalTrade[]){let w=0,l=0,mw=0,ml=0;for(const t of [...trades].sort(byClose)){if(t.pnl>0){w++;l=0}else if(t.pnl<0){l++;w=0}mw=Math.max(mw,w);ml=Math.max(ml,l)}return {maxWinStreak:mw,maxLossStreak:ml}}
// aktuální série od posledního obchodu (nulové obchody se přeskakují)
export function currentStreak(trades:JournalTrade[]):{kind:'win'|'loss'|null;count:number}{
 const s=[...trades].sort(byClose).filter(t=>t.pnl!==0);if(!s.length)return {kind:null,count:0};
 const kind=s[s.length-1].pnl>0?'win' as const:'loss' as const;let count=0;
 for(let i=s.length-1;i>=0&&(s[i].pnl>0)===(kind==='win');i--)count++;
 return {kind,count};
}
export type Summary={count:number;wins:number;losses:number;winRate:number|null;total:number;grossWin:number;grossLoss:number;profitFactor:number|null;expectancy:number|null;avgWin:number|null;avgLoss:number|null;best:number|null;worst:number|null;expectancyR:number|null;rCount:number;noRisk:number;avgHoldMs:number|null;maxWinStreak:number;maxLossStreak:number;maxDrawdown:number};
export function summary(trades:JournalTrade[]):Summary{
 const n=trades.length,wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),gw=wins.reduce((s,t)=>s+t.pnl,0),gl=-losses.reduce((s,t)=>s+t.pnl,0);
 const withR=trades.filter(t=>t.r!==null),mt=trades.filter(t=>t.source==='mt'),held=trades.filter(t=>t.holdMs!==null);
 let best:number|null=null,worst:number|null=null;for(const t of trades){if(best===null||t.pnl>best)best=t.pnl;if(worst===null||t.pnl<worst)worst=t.pnl}
 return {count:n,wins:wins.length,losses:losses.length,winRate:n?r2(100*wins.length/n):null,total:r2(gw-gl),grossWin:r2(gw),grossLoss:r2(gl),profitFactor:gl>0?r2(gw/gl):null,expectancy:n?r2((gw-gl)/n):null,avgWin:wins.length?r2(gw/wins.length):null,avgLoss:losses.length?r2(-gl/losses.length):null,best:best===null?null:r2(best),worst:worst===null?null:r2(worst),
  expectancyR:withR.length?r2(withR.reduce((s,t)=>s+(t.r as number),0)/withR.length):null,rCount:withR.length,noRisk:mt.filter(t=>t.r===null).length,avgHoldMs:held.length?Math.round(held.reduce((s,t)=>s+(t.holdMs as number),0)/held.length):null,...streaks(trades),maxDrawdown:maxDrawdown(equityCurve(trades))};
}
const hourFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',hour:'2-digit',hourCycle:'h23'});
export const pragueHour=(ms:number)=>Number(hourFmt.format(ms));
export type BreakdownBy='tag'|'symbol'|'side'|'weekday'|'hour'|'hold';
export type Group={key:string;label:string;count:number;winRate:number;total:number;expectancyR:number|null};
const WEEKDAYS=['Po','Út','St','Čt','Pá','So','Ne'];
const HOLD:[number,string][]=[[15*60000,'< 15 min'],[3600000,'15 min – 1 h'],[4*3600000,'1–4 h'],[24*3600000,'4–24 h'],[7*DAY,'1–7 d'],[Infinity,'> 7 d']];
function keysOf(t:JournalTrade,by:BreakdownBy):[string,string][]{
 if(by==='tag')return t.tags.length?t.tags.map(x=>[x,'#'+x]):[['','bez tagu']];
 if(by==='symbol')return [[t.symbol,t.symbol]];
 if(by==='side')return t.side?[[t.side,t.side==='buy'?'Buy':'Sell']]:[];
 if(by==='weekday'){const d=t.openTs!==null?pragueDate(t.openTs):t.date,i=(new Date(d+'T12:00:00Z').getUTCDay()+6)%7;return [[String(i),WEEKDAYS[i]]]}
 if(by==='hour'){if(t.openTs===null)return [];const h=String(pragueHour(t.openTs)).padStart(2,'0');return [[h,h+':00']]}
 if(t.holdMs===null)return [];
 const i=HOLD.findIndex(([lim])=>(t.holdMs as number)<lim);return [[String(i),HOLD[i][1]]];
}
export function breakdown(trades:JournalTrade[],by:BreakdownBy):Group[]{
 const m=new Map<string,{label:string;list:JournalTrade[]}>();
 for(const t of trades)for(const [k,label] of keysOf(t,by)){const g=m.get(k)||{label,list:[]};g.list.push(t);m.set(k,g)}
 const out=[...m].map(([key,{label,list}])=>{const w=list.filter(t=>t.pnl>0).length,rs=list.filter(t=>t.r!==null);return {key,label,count:list.length,winRate:r2(100*w/list.length),total:r2(list.reduce((s,t)=>s+t.pnl,0)),expectancyR:rs.length?r2(rs.reduce((s,t)=>s+(t.r as number),0)/rs.length):null}});
 return by==='weekday'||by==='hour'||by==='hold'?out.sort((a,b)=>Number(a.key)-Number(b.key)):out.sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'cs'));
}
