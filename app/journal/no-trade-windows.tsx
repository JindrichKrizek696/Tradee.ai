'use client';
// Kalendář: no-trade okna kolem zpráv (ze strategií a účtů) pro sledované trhy na příštích 7 dní.
import {useEffect,useMemo,useState} from 'react';
import {Ban} from 'lucide-react';
import type {CalendarEvent} from '@/lib/calendar';
import {upcomingWindows,type NewsWindow} from '@/lib/journal/news-window';
import './record.css';
const t=(ms:number,zone:string)=>new Date(ms).toLocaleString('cs-CZ',{timeZone:zone,weekday:'short',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const hm=(ms:number,zone:string)=>new Date(ms).toLocaleTimeString('cs-CZ',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
export function NoTradeWindows({events,mine,now,zone}:{events:CalendarEvent[];mine:Set<string>;now:number;zone:string}){
 const [defs,setDefs]=useState<NewsWindow[]|null>(null);
 useEffect(()=>{let live=true;fetch('/api/journal/windows',{cache:'no-store'}).then(r=>(r.ok?r.json():{windows:[]}) as Promise<{windows:{window:NewsWindow}[]}>).then(j=>{if(live)setDefs(j.windows.map(w=>w.window))}).catch(()=>{if(live)setDefs([])});return()=>{live=false}},[]);
 const list=useMemo(()=>{
  if(!defs?.length||!mine.size)return [];
  const ev=events.filter(e=>e.timeKnown).map(e=>({at:Date.parse(e.at),title:e.title,currencies:[...new Set([...e.markets,...(e.kind==='eia-oil'||e.kind==='opec'?['OIL']:[])])],signal:e.kind==='eia-oil'||e.kind==='opec'?3:e.signal}));
  return upcomingWindows(ev,mine,defs,now).slice(0,12);
 },[defs,events,mine,now]);
 if(!list.length)return null;
 return <section className="c-windows" aria-label="No-trade okna">
  <h3><Ban size={14} aria-hidden/> No-trade okna pro sledované trhy</h3>
  <ul>{list.map(w=><li key={w.at+w.title}><time>{t(w.start,zone)}–{hm(w.end,zone)}</time><span>{w.title} ({w.currencies.join(', ')})</span><small className="j-muted">{w.sources.join(' · ')}</small></li>)}</ul>
 </section>;
}
