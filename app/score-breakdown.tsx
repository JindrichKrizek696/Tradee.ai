'use client';
// Karta „Přehled skóre <PÁR>“: 11 fundamentálních složek −2…+2 s vysvětlením (i). Výpočet: lib/fundamentals/breakdown.ts
import {useEffect,useId,useRef,useState} from 'react';
import {Info} from 'lucide-react';
import type {Breakdown,BreakdownRow} from '@/lib/fundamentals/breakdown';
import './score-breakdown.css';

const sign=(n:number)=>n>0?'+'+n:n<0?'−'+Math.abs(n):'0';
const tone=(n:number|null)=>n===null?'na':n>=2?'bull2':n===1?'bull1':n===0?'zero':n===-1?'bear1':'bear2';

function Row({row}:{row:BreakdownRow}){
 const [open,setOpen]=useState(false),id=useId(),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent|KeyboardEvent)=>{if(e instanceof KeyboardEvent?e.key==='Escape':!ref.current?.contains(e.target as Node))setOpen(false)};addEventListener('pointerdown',close);addEventListener('keydown',close);return()=>{removeEventListener('pointerdown',close);removeEventListener('keydown',close)}},[open]);
 return <div className="sb-row" ref={ref} onMouseLeave={()=>setOpen(false)}>
  <span className="sb-label">{row.label}
   <button type="button" className="sb-info" aria-label={'Co je '+row.label} aria-describedby={id} data-open={open||undefined} onClick={()=>setOpen(true)} onMouseEnter={()=>setOpen(true)} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}><Info size={14} aria-hidden/></button>
   <span role="tooltip" id={id} className="sb-tip" hidden={!open}><b>{row.label}</b>{row.info}<span className="sb-tip-now">{row.detail}{row.asOf?` · ${row.asOf}`:''}</span></span>
  </span>
  <span className={'sb-chip '+tone(row.score)} title={row.detail}>{row.score===null?'chybí data':sign(row.score)}</span>
 </div>;
}

export function ScoreBreakdown({b,composite}:{b:Breakdown;composite?:number|null}){
 return <section className="s-card sb-card" aria-labelledby={'sb-'+b.base+b.quote}>
  <div className="sb-head"><h2 id={'sb-'+b.base+b.quote}>Přehled skóre {b.pair}</h2><span className="s-badge">{b.available}/{b.count} složek s daty</span></div>
  <div className="sb-grid">{b.rows.map(r=><Row key={r.id} row={r}/>)}
   <div className="sb-row sb-total"><span className="sb-label">Celkové skóre</span><span className={'sb-chip '+(b.total>0?'bull2':b.total<0?'bear2':'zero')}>{sign(b.total)}</span></div>
  </div>
  <small className="sb-foot">Celkové skóre = součet dostupných složek (−2…+2, max ±{2*b.count}); chybějící se nepočítají jako nula. Kompozitní skóre Tradee{composite!==undefined&&composite!==null?` (${composite>0?'+':''}${composite.toLocaleString('cs-CZ',{maximumFractionDigits:1})})`:''} váží složky jinak (fundament 60 %, COT, trend a sezonalita), proto se čísla mohou lišit. Kladné = podpora {b.base} vůči {b.quote}.</small>
 </section>;
}
