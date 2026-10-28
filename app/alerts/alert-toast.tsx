'use client';
// „V aplikaci“ u cenových alertů: když je Tradee otevřené a spustí se alert, ukáže se okénko (nahoře vpravo, na mobilu nad lištou dole).
// Kontrola každých 30 s jen při viditelné stránce; ukázané události si pamatuje (localStorage), takže se neukážou znovu ani po obnovení.
// Schránka u zvonku dostane událost vždy – volba „V aplikaci“ (Nastavení → Upozornění) řídí jen okénko.
import {useCallback,useEffect,useRef,useState} from 'react';
import {Bell,X} from 'lucide-react';
import {loadEvents,readEvents,alertsChanged,type AlertEvent} from './alert-api';
import {slugOf} from '@/lib/alerts/logic';
import {marketKind} from '@/lib/market-hours';
import {toastsToShow} from '@/lib/notify/prefs';
import {useNotifyPrefs} from '../notify-settings';
const KEY='tradee-alert-toast-last',POLL=30000,SHOW_MS=15000;
const getLast=()=>{try{const v=localStorage.getItem(KEY);return v===null?null:Number(v)||0}catch{return null}};
const setLast=(n:number)=>{try{localStorage.setItem(KEY,String(n))}catch{}};
const linkOf=(instrument:string)=>marketKind(instrument)==='currency'?'/#analyzer':'/graf/'+encodeURIComponent(slugOf(instrument));
export function AlertToasts(){
 const {data}=useNotifyPrefs(),inapp=data?.prefs.alerts?.inapp??false,[toasts,setToasts]=useState<AlertEvent[]>([]),mem=useRef<number|null>(null);
 const poll=useCallback(async()=>{if(document.visibilityState!=='visible')return;
  try{const j=await loadEvents({limit:10}),last=getLast()??mem.current,r=toastsToShow(j.events,last,inapp);
   mem.current=r.last;setLast(r.last);
   if(r.show.length){setToasts(t=>[...t.filter(x=>!r.show.some(y=>y.id===x.id)),...r.show].slice(-3));alertsChanged()}}catch{}},[inapp]);
 useEffect(()=>{if(!data)return;poll();const t=setInterval(poll,POLL),v=()=>{if(document.visibilityState==='visible')poll()};document.addEventListener('visibilitychange',v);return()=>{clearInterval(t);document.removeEventListener('visibilitychange',v)}},[data,poll]);
 useEffect(()=>{if(!toasts.length)return;const t=setTimeout(()=>setToasts(l=>l.slice(1)),SHOW_MS);return()=>clearTimeout(t)},[toasts]);
 if(!toasts.length)return null;
 const close=(id:number)=>setToasts(l=>l.filter(x=>x.id!==id));
 const open=async(e:React.MouseEvent,ev:AlertEvent)=>{e.preventDefault();try{await readEvents([ev.id])}catch{}location.href=linkOf(ev.instrument)};
 return <div className="al-toasts" role="region" aria-label="Spuštěné alerty" aria-live="polite">{toasts.map(ev=><div key={ev.id} className="al-toast">
  <Bell size={16} aria-hidden/>
  <a href={linkOf(ev.instrument)} onClick={e=>open(e,ev)}><b>Alert spuštěn</b><span>{ev.label}</span><small>{ev.price.toLocaleString('cs-CZ',{maximumFractionDigits:5})} · {new Date(ev.at).toLocaleTimeString('cs-CZ',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'})}</small></a>
  <button type="button" className="al-x" aria-label="Zavřít" onClick={()=>close(ev.id)}><X size={15}/></button>
 </div>)}</div>;
}
