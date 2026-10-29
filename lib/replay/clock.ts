// Replay: simulační hodiny společné pro všechny časové rámce a trhy. Čisté funkce – testy scripts/check-replay.mjs.
// Pravidlo bez nahlížení do budoucna: svíčka základního rámce je vidět, až když je celá uzavřená (t + délka ≤ hodiny).
// Vyšší rámec (H4, D1, W1) se skládá jen z uzavřených svíček základního rámce; rozpracovaná svíčka vyššího rámce je označená partial.
import type {Bar} from '../bars/yahoo.ts';
import {zoned,local} from '../market-hours.ts';
export type {Bar};
export type BaseTf='H1'|'D1';
export type ReplayTf='H1'|'H4'|'D1'|'W1';
export const BASE_TFS:BaseTf[]=['H1','D1'];
export const REPLAY_TFS:ReplayTf[]=['H1','H4','D1','W1'];
export const TF_LABEL:Record<ReplayTf,string>={H1:'1 hodina',H4:'4 hodiny',D1:'1 den',W1:'1 týden'};
export const TF_MS:Record<ReplayTf,number>={H1:3600000,H4:4*3600000,D1:86400000,W1:7*86400000};
/** Kolik historie před startem replaye se načte jako kontext (bez obchodování). */
export const PREROLL_MS:Record<BaseTf,number>={H1:120*86400000,D1:3*365*86400000};
const MONDAY_OFFSET=4*86400000; // 1. 1. 1970 byl čtvrtek → týdny začínají v pondělí 00:00 UTC
/** Začátek koše vyššího rámce (UTC: H4 po 4 h od půlnoci, D1 půlnoc, W1 pondělí 00:00). */
export function bucketStart(t:number,tf:ReplayTf):number{
 if(tf==='W1')return Math.floor((t-MONDAY_OFFSET)/TF_MS.W1)*TF_MS.W1+MONDAY_OFFSET;
 return Math.floor(t/TF_MS[tf])*TF_MS[tf];
}
/** Rámec smí být jen stejný nebo vyšší než základní. */
export const tfAllowed=(base:BaseTf,tf:ReplayTf)=>TF_MS[tf]>=TF_MS[base];
export const closeOf=(b:{t:number},base:BaseTf)=>b.t+TF_MS[base];
/** Svíčky základního rámce viditelné v čase clock (celé uzavřené). */
export function visibleBars(bars:Bar[],base:BaseTf,clock:number):Bar[]{
 const ms=TF_MS[base];return bars.filter(b=>b.t+ms<=clock);
}
export type Candle=Bar&{partial:boolean};
/** Svíčky rámce tf z uzavřených svíček základního rámce. Koš se určuje podle středu základní svíčky (denní FX svíčky Yahoo začínají ve 23:00 UTC předchozího dne).
 *  Svíčka je partial, dokud její období neskončilo (konec koše > clock) – OHLC je jen z dosud uzavřených základních svíček. */
export function aggregate(bars:Bar[],base:BaseTf,tf:ReplayTf,clock:number):Candle[]{
 const vis=visibleBars(bars,base,clock).sort((a,b)=>a.t-b.t);
 if(tf===base)return vis.map(b=>({...b,partial:false}));
 const half=TF_MS[base]/2,out:Candle[]=[];
 for(const b of vis){
  const k=bucketStart(b.t+half,tf),last=out[out.length-1];
  if(last&&last.t===k){last.h=Math.max(last.h,b.h);last.l=Math.min(last.l,b.l);last.c=b.c;last.v=last.v===null&&b.v===null?null:(last.v||0)+(b.v||0)}
  else out.push({t:k,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v,partial:false});
 }
 for(const c of out)c.partial=c.t+TF_MS[tf]>clock;
 return out;
}
/** Celý viditelný stav (všechny trhy × rámce) – podklad testu „bez nahlížení do budoucna“. */
export function visibleState(bars:Record<string,Bar[]>,base:BaseTf,tfs:ReplayTf[],clock:number):Record<string,Record<string,Candle[]>>{
 const out:Record<string,Record<string,Candle[]>>={};
 for(const s of Object.keys(bars).sort()){out[s]={};for(const tf of tfs)out[s][tf]=aggregate(bars[s],base,tf,clock)}
 return out;
}
/** Konec `steps`-té svíčky po hodinách (null = data došla). bars = svíčky jednoho trhu seřazené podle času. */
export function nextClose(bars:Bar[],base:BaseTf,clock:number,steps=1):number|null{
 const ms=TF_MS[base],after=bars.filter(b=>b.t+ms>clock).sort((a,b)=>a.t-b.t);
 const b=after[Math.max(1,Math.floor(steps))-1];return b?b.t+ms:null;
}
/** Konec poslední svíčky, která se uzavře nejpozději v čase x (a po hodinách); null = žádná – posun aspoň o jednu svíčku řeší volající. */
export function closeAtOrBefore(bars:Bar[],base:BaseTf,clock:number,x:number):number|null{
 const ms=TF_MS[base];let best:number|null=null;
 for(const b of bars){const c=b.t+ms;if(c>clock&&c<=x&&(best===null||c>best))best=c}
 return best;
}
/** Konec předchozí svíčky před hodinami (o svíčku zpět); null = jsme na začátku. */
export function prevClose(bars:Bar[],base:BaseTf,clock:number,floor:number):number|null{
 const ms=TF_MS[base];let best:number|null=null;
 for(const b of bars){const c=b.t+ms;if(c<clock&&c>=floor&&(best===null||c>best))best=c}
 return best===null&&clock>floor?floor:best;
}
// ---- otevření seancí (FX): Asie = Tokio 9:00, Londýn 8:00, New York 8:00 místního času; víkendy se přeskakují
export const SESSION_OPENS={asia:{label:'Asie (Tokio 9:00)',tz:'Asia/Tokyo',min:540},london:{label:'Londýn 8:00',tz:'Europe/London',min:480},newyork:{label:'New York 8:00',tz:'America/New_York',min:480}} as const;
export type SessionId=keyof typeof SESSION_OPENS;
export const isSessionId=(v:unknown):v is SessionId=>typeof v==='string'&&v in SESSION_OPENS;
/** Nejbližší otevření seance po čase t (ostře později). */
export function nextSessionOpen(t:number,s:SessionId):number{
 const o=SESSION_OPENS[s];
 for(let i=0;i<10;i++){
  const l=local(o.tz,t+i*86400000),at=zoned(o.tz,l.y,l.mo,l.d,o.min),wd=local(o.tz,at).wd;
  if(at>t&&wd>=1&&wd<=5)return at;
 }
 return t+86400000;
}
// ---- čas pro UI
export const pragueTime=(ms:number)=>new Date(ms).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',weekday:'short',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
