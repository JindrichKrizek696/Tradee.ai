'use client';
// <Term id="r">R</Term>: pojem z lib/glossary.ts podtržený tečkami; najetí, fokus nebo klepnutí (mobil) ukáže definici a příklad.
// Esc nebo klepnutí mimo zavře. Neznámé id vykreslí jen text (test scripts/check-glossary.mjs hlídá, že se to nestane).
import {useEffect,useId,useRef,useState} from 'react';
import {getTerm} from '@/lib/glossary';
import './term.css';
export function Term({id,children}:{id:string;children?:React.ReactNode}){
 const t=getTerm(id),[open,setOpen]=useState(false),[pinned,setPinned]=useState(false),ref=useRef<HTMLSpanElement>(null),pid=useId();
 useEffect(()=>{if(!open)return;
  const out=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node)){setOpen(false);setPinned(false)}};
  const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);setPinned(false)}};
  addEventListener('pointerdown',out);addEventListener('keydown',esc);return()=>{removeEventListener('pointerdown',out);removeEventListener('keydown',esc)}},[open]);
 if(!t)return <>{children}</>;
 return <span className="tm" ref={ref} onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>{if(!pinned)setOpen(false)}}>
  <button type="button" className="tm-btn" aria-expanded={open} aria-controls={pid} aria-label={`${typeof children==='string'?children:t.term} – vysvětlení pojmu`}
   onClick={e=>{e.stopPropagation();const next=!(open&&pinned);setOpen(next);setPinned(next)}} onFocus={()=>setOpen(true)} onBlur={e=>{if(!pinned&&!ref.current?.contains(e.relatedTarget as Node))setOpen(false)}}>{children??t.term}</button>
  <span id={pid} role="tooltip" className="tm-pop" hidden={!open}>
   <b>{t.term}</b><span>{t.def}</span><span className="tm-ex"><i>Příklad:</i> {t.example}</span>
   <a href={'/slovnik#'+t.id} className="tm-link">Ve slovníku →</a>
  </span>
 </span>;
}
