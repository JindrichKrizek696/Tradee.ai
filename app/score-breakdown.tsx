'use client';
// Karta „Přehled skóre <PÁR>“ a řádky složek pro kartu skóre: 11 složek −2…+2 s vahou, příspěvkem v bodech,
// vstupními čísly, stářím, časovým oknem a zdrojem. Výpočet: lib/score/v3.ts (složky z lib/fundamentals/breakdown.ts)
import {useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Info} from 'lucide-react';
import type {V3Part,V3Result} from '@/lib/score/v3';
import './score-breakdown.css';

const num=(n:number,d=1)=>{const f=10**d,r=Math.sign(n)*Math.round(Math.abs(n)*f)/f;return (r>0?'+':r<0?'−':'')+Math.abs(r).toLocaleString('cs-CZ',{maximumFractionDigits:d})};
const tone=(n:number|null)=>n===null?'na':n>=1.5?'bull2':n>0?'bull1':n===0?'zero':n>-1.5?'bear1':'bear2';
const host=(u:string)=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return u}};

/** Jedna složka skóre. `scale` = největší možný příspěvek (body) pro délku pruhu. */
export function ComponentRow({p,scale,compact}:{p:V3Part;scale:number;compact?:boolean}){
 const [open,setOpen]=useState(false),[more,setMore]=useState(false),id=useId(),did=useId(),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent|KeyboardEvent)=>{if(e instanceof KeyboardEvent?e.key==='Escape':!ref.current?.contains(e.target as Node))setOpen(false)};addEventListener('pointerdown',close);addEventListener('keydown',close);return()=>{removeEventListener('pointerdown',close);removeEventListener('keydown',close)}},[open]);
 const c=p.contribution,w=c===null||!scale?0:Math.min(50,Math.abs(c)/scale*50);
 const when=[p.asOfLabel,p.age].filter(Boolean).join(' · ');
 return <div className={'sb-row'+(compact?' compact':'')+(p.status!=='ok'?' off':'')} ref={ref} onMouseLeave={()=>setOpen(false)}>
  <div className="sb-top">
   <span className="sb-label">{p.label}
    <button type="button" className="sb-info" aria-label={'Co je '+p.label} aria-describedby={id} data-open={open||undefined} onClick={()=>setOpen(true)} onMouseEnter={()=>setOpen(true)} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}><Info size={14} aria-hidden/></button>
    <span role="tooltip" id={id} className="sb-tip" hidden={!open}><b>{p.label} · váha {p.weight} %</b>{p.reason}<span className="sb-tip-now">Okno: {p.window}</span></span>
   </span>
   <span className={'sb-chip '+tone(p.value)} title={p.status==='ok'?'Hodnota složky −2…+2':p.missingReason||''}>{p.value===null?(p.status==='stale'?'zastaralé':'chybí'):num(p.value,p.value%1?1:0)}</span>
   <strong className={'sb-pts '+(c===null?'':c>0?'positive':c<0?'negative':'')} title="Příspěvek ke skóre v bodech">{c===null?'—':num(c)}</strong>
   <button type="button" className="sb-more" aria-expanded={more} aria-controls={did} aria-label={(more?'Skrýt':'Zobrazit')+' podrobnosti: '+p.label} onClick={()=>setMore(m=>!m)}><ChevronDown size={16} aria-hidden/></button>
  </div>
  {more&&<div id={did} className="sb-body">
  <div className="sb-wline"><span className="sb-weight">váha {p.weight} %</span><span className="sb-bar" aria-hidden><i style={{width:w+'%',left:(c??0)>=0?'50%':undefined,right:(c??0)<0?'50%':undefined}} className={(c??0)>=0?'sb-up':'sb-down'}/></span></div>
  <p className="sb-detail">{p.status!=='ok'&&p.missingReason&&<b>{p.missingReason[0].toUpperCase()+p.missingReason.slice(1)}: </b>}{p.detail}</p>
  <p className="sb-meta">{when&&<span>{when}</span>}<span>{p.window}</span>{p.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label} · {host(s.url)} ↗</a>)}</p>
  </div>}
 </div>;
}

/** Největší možný příspěvek jedné složky (body) – měřítko pruhů. */
export const barScale=(r:Pick<V3Result,'coverage'|'parts'>)=>r.coverage?Math.max(...r.parts.map(p=>p.weight))/r.coverage*100:0;

export function ScoreBreakdown({r,pair}:{r:V3Result;pair:string}){
 const scale=barScale(r),[base,quote]=pair.split('/');
 return <section className="s-card sb-card" aria-labelledby={'sb-'+pair.replace('/','')}>
  <div className="sb-head"><h2 id={'sb-'+pair.replace('/','')}>Přehled skóre {pair}</h2>
   <span className={'sb-chip sb-total-chip '+(r.score===null?'na':r.score>0?'bull2':r.score<0?'bear2':'zero')} title="Celkové skóre −100…+100 (stejné jako karta skóre)">{r.score===null?'pozastaveno':num(r.score)}</span>
   <span className="s-badge">{r.available}/{r.count} složek · váhy {r.coverage} % dostupné</span></div>
  {r.paused&&<p className="sb-paused" role="status">{r.paused}</p>}
  <div className="sb-grid">{r.parts.map(p=><ComponentRow key={p.id} p={p} scale={scale}/>)}</div>
  <small className="sb-foot">Skóre = Σ(váha × složka / 2) / součet vah dostupných složek × 100, rozsah −100…+100. Příspěvek v bodech je podíl složky na tomto čísle; součet příspěvků = skóre. Chybějící nebo zastaralé složky se nepočítají a váhy ostatních se přepočtou; pod {60} % dostupných vah je skóre pozastaveno. Kladné = podpora {quote?`${base} vůči ${quote}`:`${base} vůči ostatním měnám`}.</small>
 </section>;
}
