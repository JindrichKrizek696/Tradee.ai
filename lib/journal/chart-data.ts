// Data pro svíčkový graf obchodu (lightweight-charts). Časy v s, posunuté na pražský čas (osa ukazuje místní čas).
import type {Bar} from '../mt/protocol.ts';
import type {JournalChange} from './types.ts';
import {pragueOffsetMs} from './format.ts';
export type {Bar};
export const chartTime=(ms:number)=>Math.floor((ms+pragueOffsetMs(ms))/1000);
// čas → poslední svíčka, která začala nejpozději v něm (dřívější než první svíčka → první)
export function snapper(times:number[]){return (t:number)=>{let lo=0,hi=times.length-1,ans=times[0];while(lo<=hi){const m=(lo+hi)>>1;if(times[m]<=t){ans=times[m];lo=m+1}else hi=m-1}return ans}}
export function candles(bars:Bar[]){
 const seen=new Set<number>(),out:{time:number;open:number;high:number;low:number;close:number}[]=[];
 for(const [t,o,h,l,c] of [...bars].sort((a,b)=>a[0]-b[0])){const time=chartTime(t);if(seen.has(time))continue;seen.add(time);out.push({time,open:o,high:h,low:l,close:c})}
 return out;
}
// schodovitá čára SL nebo TP: od otevření do zavření, bez hodnoty = mezera (SL/TP nenastaven)
export function levelSteps(kind:'sl'|'tp',initial:number|null,changes:JournalChange[],openTs:number,closeTs:number,snap:(t:number)=>number){
 const pts=new Map<number,number|null>();pts.set(snap(chartTime(openTs)),initial);
 for(const c of changes)if(c.kind===kind&&c.ts>=openTs&&c.ts<=closeTs)pts.set(snap(chartTime(c.ts)),c.new_value);
 const end=snap(chartTime(closeTs));if(!pts.has(end))pts.set(end,[...pts.values()].at(-1)??null);
 return [...pts].sort((a,b)=>a[0]-b[0]).map(([time,value])=>value===null?{time}:{time,value});
}
export type ChartMarker={time:number;position:'aboveBar'|'belowBar';shape:'arrowUp'|'arrowDown';color:string;text:string};
const LABEL:Record<string,string>={open:'Vstup',add:'Přidání',partial_close:'Část. výstup',close:'Výstup'};
export function tradeMarkers(side:'buy'|'sell',changes:JournalChange[],snap:(t:number)=>number):ChartMarker[]{
 return changes.filter(c=>LABEL[c.kind]).map(c=>{const entry=c.kind==='open'||c.kind==='add',up=entry===(side==='buy');
  return {time:snap(chartTime(c.ts)),position:up?'belowBar' as const:'aboveBar' as const,shape:up?'arrowUp' as const:'arrowDown' as const,color:entry?'#2563eb':'#f59e0b',text:LABEL[c.kind]+(c.volume?' '+c.volume:'')}}).sort((a,b)=>a.time-b.time);
}
