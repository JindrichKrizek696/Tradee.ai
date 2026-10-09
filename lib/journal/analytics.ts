// Analytika deníku: kdy a jak obchoduju (seance, typ trhu, heatmapa, doba držení, postřehy). Čisté funkce – testy scripts/check-analytics.mjs.
import {pragueDate} from '../mt/trades.ts';
import {pragueHour} from './stats.ts';
import {fmtMoney} from '../trades.ts';
import {fmtNum} from './format.ts';
import type {JournalTrade} from './types.ts';
const r2=(n:number)=>Math.round(n*100)/100;
export const MIN_GROUP=5;
export const WEEKDAYS=['Po','Út','St','Čt','Pá','So','Ne'] as const;
const WEEKDAYS_PL=['Pondělky','Úterky','Středy','Čtvrtky','Pátky','Soboty','Neděle'];
export type Bucket={key:string;label:string;hint?:string;count:number;winRate:number|null;total:number;avgR:number|null};
function bucketOf(key:string,label:string,list:JournalTrade[],hint?:string):Bucket{
 const rs=list.filter(t=>t.r!==null),w=list.filter(t=>t.pnl>0).length;
 return {key,label,hint,count:list.length,winRate:list.length?r2(100*w/list.length):null,total:r2(list.reduce((s,t)=>s+t.pnl,0)),avgR:rs.length?r2(rs.reduce((s,t)=>s+(t.r as number),0)/rs.length):null};
}
// den v týdnu (0 = pondělí) podle pražského data vstupu
export const weekdayOf=(ts:number)=>(new Date(pragueDate(ts)+'T12:00:00Z').getUTCDay()+6)%7;
// ---- seance: nepřekrývající se rozdělení pražské hodiny vstupu (DST řeší Europe/Prague)
export type SessionKey='asia'|'london'|'overlap'|'ny'|'off';
export const SESSIONS:{key:SessionKey;label:string;hint:string;from:number;to:number}[]=[
 {key:'asia',label:'Asie',hint:'00:00–08:00',from:0,to:8},
 {key:'london',label:'Londýn',hint:'08:00–13:00',from:8,to:13},
 {key:'overlap',label:'Překryv Londýn + NY',hint:'13:00–17:00',from:13,to:17},
 {key:'ny',label:'New York',hint:'17:00–22:00',from:17,to:22},
 {key:'off',label:'Mimo seance',hint:'22:00–24:00',from:22,to:24}];
export const sessionOfHour=(h:number):SessionKey=>(SESSIONS.find(s=>h>=s.from&&h<s.to)||SESSIONS[4]).key;
export const sessionOf=(openTs:number):SessionKey=>sessionOfHour(pragueHour(openTs));
export const withEntry=(trades:JournalTrade[])=>trades.filter(t=>t.openTs!==null);
export const noEntryCount=(trades:JournalTrade[])=>trades.length-withEntry(trades).length;
export function bySession(trades:JournalTrade[]):Bucket[]{
 const m=new Map<SessionKey,JournalTrade[]>(SESSIONS.map(s=>[s.key,[]]));
 for(const t of withEntry(trades))m.get(sessionOf(t.openTs as number))!.push(t);
 return SESSIONS.map(s=>bucketOf(s.key,s.label,m.get(s.key)!,s.hint));
}
// ---- typ trhu
export type MarketType='fx'|'index'|'stock'|'crypto'|'commodity'|'other';
export const MARKET_TYPES:{key:MarketType;label:string}[]=[{key:'fx',label:'FX páry'},{key:'index',label:'Akciové indexy'},{key:'stock',label:'Akcie'},{key:'crypto',label:'Krypto'},{key:'commodity',label:'Komodity'},{key:'other',label:'Ostatní'}];
const CURRENCIES=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD'];
const COMMODITY=/^(XAU|XAG|XPT|XPD|XTI|XBR|XNG)|WTI|BRENT|USOIL|UKOIL|NGAS|NATGAS|COPPER|GOLD|SILVER/;
// id trhu Tradee (z mapSymbol) → typ; nemapované symboly: komodity podle názvu, jinak Ostatní
export function marketTypeOf(instrument:string|null|undefined,symbol=''):MarketType{
 if(instrument){
  if(instrument.includes('/')||CURRENCIES.includes(instrument))return 'fx';
  if(instrument.startsWith('^'))return 'index';
  if(instrument.endsWith('-USD'))return 'crypto';
  return 'stock';
 }
 return COMMODITY.test(String(symbol).trim().toUpperCase().replace(/^[#.]+/,''))?'commodity':'other';
}
export function byMarketType(trades:JournalTrade[]):Bucket[]{
 const m=new Map<MarketType,JournalTrade[]>(MARKET_TYPES.map(x=>[x.key,[]]));
 for(const t of trades)m.get(marketTypeOf(t.instrument,t.symbol))!.push(t);
 return MARKET_TYPES.filter(x=>m.get(x.key)!.length).map(x=>bucketOf(x.key,x.label,m.get(x.key)!));
}
// ---- heatmapa den × hodina vstupu
export type HeatCell={count:number;total:number};
export function heatmap(trades:JournalTrade[]){
 const cells:HeatCell[][]=Array.from({length:7},()=>Array.from({length:24},()=>({count:0,total:0})));
 for(const t of withEntry(trades)){const c=cells[weekdayOf(t.openTs as number)][pragueHour(t.openTs as number)];c.count++;c.total=r2(c.total+t.pnl)}
 let maxCount=0,maxAbs=0;for(const row of cells)for(const c of row){maxCount=Math.max(maxCount,c.count);maxAbs=Math.max(maxAbs,Math.abs(c.total))}
 return {cells,maxCount,maxAbs};
}
// ---- doba držení
export const HOLD_BUCKETS:[number,string][]=[[15*60000,'< 15 min'],[3600000,'15–60 min'],[4*3600000,'1–4 h'],[24*3600000,'4–24 h'],[Infinity,'> 1 den']];
export const median=(v:number[])=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:Math.round((s[m-1]+s[m])/2)};
const avg=(v:number[])=>v.length?Math.round(v.reduce((s,x)=>s+x,0)/v.length):null;
export type HoldSide={count:number;avgMs:number|null;medianMs:number|null};
export function holdStats(trades:JournalTrade[]){
 const held=trades.filter(t=>t.holdMs!==null),side=(l:JournalTrade[]):HoldSide=>{const v=l.map(t=>t.holdMs as number);return {count:v.length,avgMs:avg(v),medianMs:median(v)}};
 const lists=HOLD_BUCKETS.map(()=>[] as JournalTrade[]);
 for(const t of held)lists[HOLD_BUCKETS.findIndex(([lim])=>(t.holdMs as number)<lim)].push(t);
 return {winners:side(held.filter(t=>t.pnl>0)),losers:side(held.filter(t=>t.pnl<0)),buckets:HOLD_BUCKETS.map(([,label],i)=>({label,count:lists[i].length,total:r2(lists[i].reduce((s,t)=>s+t.pnl,0))}))};
}
// ---- postřehy
// den × 4hodinový blok (0–4, 4–8 …); pro nejhorší blok
export function weekdayBlocks(trades:JournalTrade[]){
 const m=new Map<string,{wd:number;block:number;count:number;total:number}>();
 for(const t of withEntry(trades)){const wd=weekdayOf(t.openTs as number),block=Math.floor(pragueHour(t.openTs as number)/4),k=wd+':'+block,g=m.get(k)||{wd,block,count:0,total:0};g.count++;g.total=r2(g.total+t.pnl);m.set(k,g)}
 return [...m.values()];
}
export function insights(trades:JournalTrade[],currency='USD'):string[]{
 const money=(n:number)=>fmtMoney(n,currency),out:string[]=[];
 const sess=bySession(trades).filter(b=>b.count>=MIN_GROUP);
 const bestS=[...sess].sort((a,b)=>b.total-a.total)[0],worstS=[...sess].sort((a,b)=>a.total-b.total)[0];
 if(bestS&&bestS.total>0)out.push(`Nejlépe ti jde ${bestS.label} (${money(bestS.total)}, ${fmtNum(Math.round(bestS.winRate as number))} %).`);
 const h=holdStats(trades);
 if(h.winners.count>=MIN_GROUP&&h.losers.count>=MIN_GROUP&&h.winners.avgMs&&h.losers.avgMs&&h.losers.avgMs>=1.5*h.winners.avgMs)out.push(`Ztrátové obchody držíš ${fmtNum(Math.round(h.losers.avgMs/h.winners.avgMs*10)/10,1)}× déle než ziskové.`);
 const blk=weekdayBlocks(trades).filter(b=>b.count>=MIN_GROUP).sort((a,b)=>a.total-b.total)[0];
 if(blk&&blk.total<0)out.push(`${WEEKDAYS_PL[blk.wd]} ${String(blk.block*4).padStart(2,'0')}:00–${String(blk.block*4+4).padStart(2,'0')}:00 jsou ve ztrátě (${money(blk.total)}).`);
 const mk=byMarketType(trades).filter(b=>b.count>=MIN_GROUP&&b.key!=='other'),bestM=[...mk].sort((a,b)=>b.total-a.total)[0];
 if(bestM&&bestM.total>0&&mk.length>1)out.push(`Nejlépe vychází ${bestM.label} (${money(bestM.total)}, ${fmtNum(Math.round(bestM.winRate as number))} %).`);
 if(worstS&&worstS.total<0&&(!bestS||worstS.key!==bestS.key))out.push(`Nejhůř ti jde ${worstS.label} (${money(worstS.total)}).`);
 return out.slice(0,4);
}
