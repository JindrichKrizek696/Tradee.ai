// Seance v grafu s časovým pásmem a letním časem: Asie (Tokio), Londýn, New York, killzóny Londýna a NY (podle času NY) a boxy high/low seance.
// Každá seance je definovaná v místním čase svého trhu, takže posun DST (USA o 2–3 týdny jinak než Evropa) sedí. Čisté funkce – testy scripts/check-chart-workspace.mjs.
import {wallMs,zonedToUtc} from './tz.ts';
export const SESSION_IDS=['asia','london','ny','lkz','nykz','lbox','nybox'] as const;
export type SessionId=typeof SESSION_IDS[number];
export type SessionPreset={id:SessionId;label:string;tz:string;from:[number,number];to:[number,number];kind:'band'|'box';color:string;hint:string};
export const SESSION_PRESETS:Record<SessionId,SessionPreset>={
 asia:{id:'asia',label:'Asie',tz:'Asia/Tokyo',from:[9,0],to:[18,0],kind:'band',color:'#f59e0b',hint:'Tokio 09:00–18:00 (bez letního času)'},
 london:{id:'london',label:'Londýn',tz:'Europe/London',from:[8,0],to:[17,0],kind:'band',color:'#3b82f6',hint:'Londýn 08:00–17:00 místního času'},
 ny:{id:'ny',label:'New York',tz:'America/New_York',from:[8,0],to:[17,0],kind:'band',color:'#10b981',hint:'New York 08:00–17:00 místního času'},
 lkz:{id:'lkz',label:'Londýn killzóna',tz:'America/New_York',from:[2,0],to:[5,0],kind:'band',color:'#6366f1',hint:'02:00–05:00 času NY'},
 nykz:{id:'nykz',label:'NY killzóna',tz:'America/New_York',from:[7,0],to:[10,0],kind:'band',color:'#0d9488',hint:'07:00–10:00 času NY'},
 lbox:{id:'lbox',label:'Box Londýna',tz:'Europe/London',from:[8,0],to:[17,0],kind:'box',color:'#3b82f6',hint:'high/low londýnské seance'},
 nybox:{id:'nybox',label:'Box New Yorku',tz:'America/New_York',from:[8,0],to:[17,0],kind:'box',color:'#10b981',hint:'high/low newyorské seance'},
};
export const isSessionId=(v:unknown):v is SessionId=>typeof v==='string'&&(SESSION_IDS as readonly string[]).includes(v);
export const SESSION_DEFAULT:SessionId[]=['asia','london','ny'];
export type Window={id:SessionId;start:number;end:number};
const DAY=86400000;
// okna seance (UTC ms) překrývající [from, to); víkendové dny (so, ne místního času) se vynechají
export function sessionWindows(id:SessionId,from:number,to:number):Window[]{
 const p=SESSION_PRESETS[id],out:Window[]=[];
 const d0=Math.floor(wallMs(from,p.tz)/DAY)-1,d1=Math.floor(wallMs(to,p.tz)/DAY)+1;
 for(let d=d0;d<=d1;d++){
  const date=new Date(d*DAY),wd=date.getUTCDay();if(wd===0||wd===6)continue;
  const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,dd=date.getUTCDate();
  const start=zonedToUtc(y,m,dd,p.from[0],p.from[1],p.tz);
  let end=zonedToUtc(y,m,dd,p.to[0],p.to[1],p.tz);if(end<=start)end+=DAY;
  if(end>from&&start<to)out.push({id,start,end});
 }
 return out;
}
// box seance: nejvyšší a nejnižší cena svíček, které v okně začínají (svíčky {t: ms UTC}); bez svíček null
export type SessionBox=Window&{hi:number;lo:number;n:number};
export function sessionBox(w:Window,bars:{t:number;h:number;l:number}[]):SessionBox|null{
 let hi=-Infinity,lo=Infinity,n=0;
 for(const b of bars)if(b.t>=w.start&&b.t<w.end){if(b.h>hi)hi=b.h;if(b.l<lo)lo=b.l;n++}
 return n?{...w,hi,lo,n}:null;
}
// do které seance svíčka patří (začátek svíčky v okně)
export const inWindow=(t:number,w:Window)=>t>=w.start&&t<w.end;
