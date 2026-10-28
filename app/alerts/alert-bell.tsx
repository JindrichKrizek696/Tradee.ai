'use client';
// Zvonek v horní liště: počet nepřečtených spuštěných alertů a schránka posledních spuštění (klik = graf trhu, označit přečtené).
import {useCallback,useEffect,useRef,useState} from 'react';
import {Bell} from 'lucide-react';
import {loadEvents,readEvents,onAlertsChanged,type AlertEvent} from './alert-api';
import {slugOf} from '@/lib/alerts/logic';
import {marketKind} from '@/lib/market-hours';
import './alerts.css';
const when=(ms:number)=>{const d=Date.now()-ms;if(d<60000)return 'právě teď';if(d<3600000)return `před ${Math.floor(d/60000)} min`;if(d<86400000)return `před ${Math.floor(d/3600000)} h`;return new Date(ms).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})};
const linkOf=(instrument:string)=>marketKind(instrument)==='currency'?'/#analyzer':'/graf/'+encodeURIComponent(slugOf(instrument));
export function AlertBell(){
 const [unread,setUnread]=useState(0),[open,setOpen]=useState(false),[events,setEvents]=useState<AlertEvent[]|null>(null),wrap=useRef<HTMLDivElement>(null);
 const count=useCallback(async()=>{if(document.visibilityState!=='visible')return;try{const j=await loadEvents({unread:true,limit:1});setUnread(j.unread)}catch{}},[]);
 useEffect(()=>{count();const t=setInterval(count,60000),v=()=>{if(document.visibilityState==='visible')count()};document.addEventListener('visibilitychange',v);const off=onAlertsChanged(count);return()=>{clearInterval(t);document.removeEventListener('visibilitychange',v);off()}},[count]);
 useEffect(()=>{if(!open)return;let live=true;loadEvents({limit:12}).then(j=>{if(live){setEvents(j.events);setUnread(j.unread)}}).catch(()=>{if(live)setEvents([])});
  const close=(e:MouseEvent)=>{if(!wrap.current?.contains(e.target as Node))setOpen(false)},esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false)};
  document.addEventListener('mousedown',close);document.addEventListener('keydown',esc);return()=>{live=false;document.removeEventListener('mousedown',close);document.removeEventListener('keydown',esc)}},[open]);
 const go=async(e:AlertEvent)=>{if(!e.read){try{await readEvents([e.id])}catch{}}location.href=linkOf(e.instrument)};
 const all=async()=>{try{await readEvents();setEvents(l=>l?.map(e=>({...e,read:true}))??l);setUnread(0)}catch{}};
 return <div className="al-bell-wrap" ref={wrap}>
  <button type="button" className="t-icon-btn al-bell" aria-expanded={open} aria-label={unread?`Alerty, ${unread} nepřečtených`:'Alerty'} title="Alerty" onClick={()=>setOpen(o=>!o)}><Bell size={17}/>{unread>0&&<span className="al-dot" aria-hidden>{unread>99?'99+':unread}</span>}</button>
  {open&&<div className="al-inbox" role="dialog" aria-label="Spuštěné alerty">
   <div className="al-inbox-head"><b>Spuštěné alerty</b>{unread>0&&<button type="button" className="al-link" onClick={all}>Označit vše jako přečtené</button>}</div>
   {events===null?<p className="al-empty">Načítám…</p>:events.length===0?<p className="al-empty">Zatím se žádný alert nespustil. Alert nastavíš v detailu trhu nebo v grafu (zvonek, pravé tlačítko myši).</p>
    :<ul>{events.map(e=><li key={e.id}><button type="button" className={'al-ev'+(e.read?'':' unread')} onClick={()=>go(e)}><b>{e.label}</b><small>{when(e.at)} · {e.price.toLocaleString('cs-CZ',{maximumFractionDigits:5})}</small></button></li>)}</ul>}
   <div className="al-inbox-foot"><a className="al-link" href="/alerty">Všechny alerty →</a></div>
  </div>}
 </div>;
}
