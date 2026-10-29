// Časová pásma grafu: převod UTC ↔ místní čas pásma (DST přes Intl), klíče obchodního dne a týdne v New Yorku a formát popisků osy.
// Čisté funkce bez DOM – testy scripts/check-chart-workspace.mjs.
export const CHART_TZS=['Europe/Prague','UTC','Europe/London','America/New_York','Asia/Tokyo'] as const;
export type ChartTz=typeof CHART_TZS[number];
export const TZ_LABELS:Record<ChartTz,string>={'Europe/Prague':'Praha','UTC':'UTC','Europe/London':'Londýn','America/New_York':'New York','Asia/Tokyo':'Tokio'};
export const isChartTz=(v:unknown):v is ChartTz=>typeof v==='string'&&(CHART_TZS as readonly string[]).includes(v);
const DAY=86400000,HOUR=3600000;
const fmts=new Map<string,Intl.DateTimeFormat>();
function parts(tz:string){
 let f=fmts.get(tz);
 if(!f){f=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});fmts.set(tz,f)}
 return f;
}
// „nástěnné hodiny“ pásma jako ms (místní datum a čas zapsané jako UTC); UTC = beze změny
export function wallMs(ms:number,tz:string):number{
 if(tz==='UTC')return ms;
 const p:Record<string,number>={};
 for(const x of parts(tz).formatToParts(new Date(ms)))if(x.type!=='literal')p[x.type]=Number(x.value);
 return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second)+ms%1000;
}
// posun pásma proti UTC v ms (Praha v zimě +1 h, v létě +2 h)
export const tzOffset=(ms:number,tz:string)=>wallMs(ms,tz)-ms;
// místní datum a čas v pásmu → UTC ms; u neexistujícího času (přeskok DST) posun vpřed, u dvojího času první výskyt
export function zonedToUtc(y:number,m:number,d:number,h:number,mi:number,tz:string):number{
 const wall=Date.UTC(y,m-1,d,h,mi);
 let t=wall-tzOffset(wall,tz);
 t=wall-tzOffset(t,tz);
 return t;
}
// obchodní den v New Yorku: začíná v 17:00 NY (FX rollover), pátek 17:00 → neděle 17:00 je víkend; klíč = počet dní od epochy
export const NY='America/New_York';
export const nyTradingDay=(ms:number)=>Math.floor((wallMs(ms,NY)+7*HOUR)/DAY);
// kalendářní den v NY (od půlnoci)
export const nyDay=(ms:number)=>Math.floor(wallMs(ms,NY)/DAY);
// obchodní týden v NY: začíná v neděli 17:00 NY (klíč = číslo týdne od pondělí 5. 1. 1970)
export const nyTradingWeek=(ms:number)=>Math.floor((nyTradingDay(ms)+3)/7);
// popisky osy a kříže v pásmu (čas ms UTC)
const two=(n:number)=>String(n).padStart(2,'0');
export function tzLabel(ms:number,tz:string,kind:'time'|'date'|'datetime'|'month'|'year'){
 const w=new Date(wallMs(ms,tz)),d=w.getUTCDate(),m=w.getUTCMonth()+1,y=w.getUTCFullYear(),hm=two(w.getUTCHours())+':'+two(w.getUTCMinutes());
 if(kind==='time')return hm;
 if(kind==='year')return String(y);
 if(kind==='month')return ['led','úno','bře','dub','kvě','čvn','čvc','srp','zář','říj','lis','pro'][m-1]+' '+y;
 if(kind==='date')return d+'. '+m+'.';
 return d+'. '+m+'. '+y+' '+hm;
}
