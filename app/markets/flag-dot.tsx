'use client';
import {useEffect,useRef,useState} from 'react';
import {flagLabels} from '@/lib/markets';
// Tečka vlaječky; klik otevře menu se čtyřmi volbami. Klik nikdy nepropadne do řádku/dlaždice (detail).
export function FlagDot({id,flag,disabled,onPick}:{id:string;flag:string;disabled:boolean;onPick:(id:string,flag:string)=>void}){
 const [open,setOpen]=useState(false),ref=useRef<HTMLSpanElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[open]);
 return <span className="m-flag" ref={ref} onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
  <button type="button" className={'m-dot flag-'+flag} disabled={disabled} aria-label={'Vlaječka '+id+': '+flagLabels[flag]} aria-expanded={open} title={flagLabels[flag]} onClick={()=>setOpen(!open)}><i/></button>
  {open&&<span className="m-flag-menu" role="menu">{Object.entries(flagLabels).map(([value,label])=><button key={value} type="button" role="menuitemradio" aria-checked={value===flag} className={value===flag?'on':''} onClick={()=>{setOpen(false);onPick(id,value)}}><i className={'flag-'+value}/>{label}</button>)}</span>}
 </span>;
}
