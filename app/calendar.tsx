'use client';
import type {FundamentalData} from '@/lib/fundamentals';
import {importanceLabel} from '@/lib/dashboard';
const time=(s:string)=>new Date(s).toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
export function CalendarPage({events,now}:{events:FundamentalData['events'];now:number}){
 const sorted=[...events].sort((a,b)=>a.at.localeCompare(b.at));
 const groups=new Map<string,typeof sorted>();
 for(const e of sorted){const key=new Date(e.at).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',weekday:'long',day:'numeric',month:'long',year:'numeric'});if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(e)}
 return <div>
  <div className="t-page-head"><div><h1>Kalendář</h1><p>Makro události z ověřených zdrojů · čas v Praze</p></div><span className="t-val">{sorted.length} událostí</span></div>
  {sorted.length?[...groups].map(([d,list])=><section key={d} className="t-card t-day"><h3>{d}</h3>{list.map(e=>{const [cls,label]=importanceLabel(e.importance),past=Date.parse(e.at)<now;return <article key={e.id} className={'t-event'+(past?' t-past':'')}><span className="t-time">{e.timeKnown?time(e.at):'čas neověřen'}</span><div><b>{e.title}<span className="t-ccy">{e.currency}</span></b><p>{e.watch}</p><div className="t-exp"><span>Očekávání<b>{e.consensus??'Neověřeno'}</b></span><span>Výsledek<b>{e.actual??'Dosud neověřeno'}</b></span></div></div><span className={'t-badge '+cls}>{label}</span></article>})}</section>):<div className="t-card t-empty">V podkladech zatím nejsou žádné události.</div>}
 </div>;
}
