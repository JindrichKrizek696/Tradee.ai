// Okno a timeframe svíček pro graf obchodu. Server je posílá EA v /api/mt/state (barsWanted), EA jen zavolá CopyRates.
import type {Timeframe} from './protocol.ts';
const TF:[Timeframe,number][]=[['M1',60],['M5',300],['M15',900],['M30',1800],['H1',3600],['H4',14400],['D1',86400]];
export const MAX_WINDOW_BARS=600;
// okraj před vstupem i po výstupu = 20 % délky obchodu, aspoň 30 min; nejmenší TF, při kterém je v okně ≤ 600 svíček
export function barsWindow(openMs:number,closeMs:number):{tf:Timeframe;from:number;to:number}{
 const dur=Math.max(0,closeMs-openMs),pad=Math.max(dur*0.2,30*60000),from=openMs-pad,to=closeMs+pad;
 const [tf]=TF.find(([,s])=>(to-from)/(s*1000)<=MAX_WINDOW_BARS)||TF[TF.length-1];
 return {tf,from:Math.floor(from/1000),to:Math.ceil(to/1000)};
}
// řádek pro EA: "pozice|symbol|tf|od|do" (s UTC); symbol se znaky, které by rozbily jednoduchý parser v EA, se vynechá
export function wantedLine(position:string,symbol:string,openMs:number,closeMs:number):string|null{
 if(!/^[^|"\]\\\u0000-\u001f]{1,32}$/.test(symbol))return null;
 const w=barsWindow(openMs,closeMs);
 return [position,symbol,w.tf,w.from,w.to].join('|');
}
