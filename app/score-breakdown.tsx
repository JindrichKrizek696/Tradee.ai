'use client';
// Karta „Přehled skóre <PÁR>“ a řádky složek pro kartu skóre: 11 složek −2…+2 s vahou, příspěvkem v bodech,
// vstupními čísly, stářím, časovým oknem a zdrojem. Výpočet: lib/score/v3.ts (složky z lib/fundamentals/breakdown.ts)
import {Term} from './term';
import {SCORE_TERMS} from '@/lib/glossary';
import {useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Info} from 'lucide-react';
import type {V3Part,V3Result} from '@/lib/score/v3';
import type {PitSnapshot} from '@/lib/score/pit';
import {directionText} from '@/lib/score/pit';
import {METHOD} from '@/lib/score/method-text';
import {WhyButton,WhyPanel,PairSignals} from './score-pit';
import {applyOff,toggleOff} from '@/lib/overview-toggle';
import {useScoreOff} from './score-off-prefs';
import './score-breakdown.css';

const num=(n:number,d=1)=>{const f=10**d,r=Math.sign(n)*Math.round(Math.abs(n)*f)/f;return (r>0?'+':r<0?'−':'')+Math.abs(r).toLocaleString('cs-CZ',{maximumFractionDigits:d})};
const tone=(n:number|null)=>n===null?'na':n>=1.5?'bull2':n>0?'bull1':n===0?'zero':n>-1.5?'bear1':'bear2';
const host=(u:string)=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return u}};

/** Jedna složka skóre. `scale` = největší možný příspěvek (body) pro délku pruhu. S `onToggle` má přepínač „počítat do přehledu“; `excluded` = vypnutá. */
/** Data pro „Proč?“ u řádku: snímek (živý nebo k datu) a předchozí snímek s jiným obsahem. */
export type WhyCtx={snap:PitSnapshot;prev:PitSnapshot|null|undefined;market:string};
export function ComponentRow({p,scale,compact,excluded,onToggle,why}:{p:V3Part;scale:number;compact?:boolean;excluded?:boolean;onToggle?:()=>void;why?:WhyCtx}){
 const [open,setOpen]=useState(false),[more,setMore]=useState(false),[whyOpen,setWhyOpen]=useState(false),wp=why?.snap.parts.find(x=>x.id===p.id),id=useId(),did=useId(),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent|KeyboardEvent)=>{if(e instanceof KeyboardEvent?e.key==='Escape':!ref.current?.contains(e.target as Node))setOpen(false)};addEventListener('pointerdown',close);addEventListener('keydown',close);return()=>{removeEventListener('pointerdown',close);removeEventListener('keydown',close)}},[open]);
 const c=p.contribution,w=c===null||!scale?0:Math.min(50,Math.abs(c)/scale*50);
 const when=[p.asOfLabel,p.age].filter(Boolean).join(' · ');
 return <div className={'sb-row'+(compact?' compact':'')+(p.status!=='ok'?' off':'')+(more?' open':'')+(onToggle?' sb-toggle':'')+(excluded?' sb-excluded':'')} ref={ref} onMouseLeave={()=>setOpen(false)}>
  <div className="sb-top">
   {onToggle&&<button type="button" role="switch" aria-checked={!excluded} aria-label={'Počítat do přehledu: '+p.label} title={excluded?'Vypnuto – nepočítá se. Kliknutím zapneš.':'Počítá se. Kliknutím složku vypneš z přehledu.'} className="sb-switch" onClick={onToggle}><i aria-hidden="true"/></button>}
   <span className="sb-label">{SCORE_TERMS[p.id]?<Term id={SCORE_TERMS[p.id]}>{p.label}</Term>:p.label}
    <button type="button" className="sb-info" aria-label={'Co je '+p.label} aria-describedby={id} data-open={open||undefined} onClick={()=>setOpen(true)} onMouseEnter={()=>setOpen(true)} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}><Info size={14} aria-hidden/></button>
    {wp&&<WhyButton open={whyOpen} onToggle={()=>setWhyOpen(o=>!o)} label={p.label}/>}{excluded&&<span className="sb-offtag">nepočítá se</span>}
    <span role="tooltip" id={id} className="sb-tip" hidden={!open}><b>{p.label} · váha {p.weight} %</b>{p.reason}<span className="sb-tip-now">Okno: {p.window}</span></span>
   </span>
   <span className={'sb-chip '+tone(p.value)} title={p.status==='ok'?'Hodnota složky −2…+2'+(excluded?' (vypnuto, nepočítá se)':''):p.missingReason||''}>{p.value===null?(p.status==='stale'?'zastaralé':p.status==='ok'?'—':'chybí'):num(p.value,p.value%1?1:0)}</span>
   <strong className={'sb-pts '+(c===null?'':c>0?'positive':c<0?'negative':'')} title={excluded?'Vypnuto – nepočítá se do skóre přehledu':'Příspěvek ke skóre v bodech'}>{c===null?'—':num(c)}</strong>
   <button type="button" className="sb-more" aria-expanded={more} aria-controls={did} aria-label={(more?'Skrýt':'Zobrazit')+' podrobnosti: '+p.label} onClick={()=>setMore(m=>!m)}><ChevronDown size={16} aria-hidden/></button>
  </div>
  {whyOpen&&wp&&why&&<WhyPanel part={wp} snap={why.snap} prev={why.prev} market={why.market} onClose={()=>setWhyOpen(false)}/>}
  {more&&<div id={did} className="sb-body">
  <div className="sb-wline"><span className="sb-weight">váha {p.weight} %</span><span className="sb-bar" aria-hidden><i style={{width:w+'%',left:(c??0)>=0?'50%':undefined,right:(c??0)<0?'50%':undefined}} className={(c??0)>=0?'sb-up':'sb-down'}/></span></div>
  <p className="sb-detail">{p.status!=='ok'&&p.missingReason&&<b>{p.missingReason[0].toUpperCase()+p.missingReason.slice(1)}: </b>}{p.detail}</p>
  <p className="sb-meta">{when&&<span>{when}</span>}<span>{p.window}</span>{p.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label} · {host(s.url)} ↗</a>)}</p>
  </div>}
 </div>;
}

/** Největší možný příspěvek jedné složky (body) – měřítko pruhů. */
export const barScale=(r:Pick<V3Result,'coverage'|'parts'>)=>r.coverage?Math.max(...r.parts.map(p=>p.weight))/r.coverage*100:0;

export function ScoreBreakdown({r,pair,why}:{r:Pick<V3Result,'parts'|'score'|'coverage'|'paused'|'count'|'available'>;pair:string;why?:WhyCtx}){
 // vypnuté složky (volba uživatele pro všechny trhy) se nepočítají do Bodů ani Celkem; model a karta skóre beze změny
 const [off,setOff]=useScoreOff(),v=applyOff(r,off),scale=barScale({coverage:v.coverage,parts:r.parts}),pts=v.points;
 const offNames=v.parts.filter(p=>p.off).map(p=>p.label);
 return <section className="s-card sb-card" aria-labelledby={'sb-'+pair.replace('/','')}>
  <div className="sb-head"><h2 id={'sb-'+pair.replace('/','')}>Přehled <Term id="skore-v3">skóre</Term> {pair}</h2>
   <span className="sb-total"><small>Body</small><span className={'sb-chip '+(pts>0?'bull1':pts<0?'bear1':'zero')} title={`Prostý součet ${v.cut?'zapnutých ':''}složek −2…+2 (${v.counted} složek, rozsah ±${v.counted*2})`}>{num(pts,1)} <i>/ ±{v.counted*2}</i></span></span>
   <span className="sb-total"><small>Celkem</small><span className={'sb-chip sb-total-chip '+(v.score===null?'na':v.score>0?'bull2':v.score<0?'bear2':'zero')} title={v.cut?`Skóre −100…+100 jen ze zapnutých složek (váhy přepočtené). Plné skóre modelu (karta skóre, Analýza trhů): ${r.score===null?'pozastaveno':num(r.score)}`:'Celkové skóre −100…+100 podle vah (stejné jako karta skóre)'}>{v.score===null?(r.score!==null&&v.cut?'nic nezapnuto':'pozastaveno'):num(v.score)}</span></span>
   <span className="s-badge">{v.cut?`${v.counted}/${r.count} složek počítáno · váhy ${v.coverage} %`:`${r.available}/${r.count} složek · váhy ${r.coverage} % dostupné`}</span></div>
  {r.paused&&<p className="sb-paused" role="status">{r.paused}</p>}
  {why&&<PairSignals parts={why.snap.parts} market={pair}/>}
  {offNames.length>0&&<p className="sb-offnote" role="status"><span>Vypnuto: <b>{offNames.join(', ')}</b> – nepočítá se do Bodů ani Celkem{v.cut?', váhy zapnutých složek se přepočítaly':''}. Platí pro všechny trhy. Karta skóre a Analýza trhů počítají dál se všemi složkami{v.cut?` (plné skóre ${r.score===null?'pozastaveno':num(r.score)})`:''}.</span><button type="button" className="sb-reset" onClick={()=>setOff([])}>Zapnout vše</button></p>}
  <div className="sb-grid">{v.parts.map(p=><ComponentRow key={p.id} p={p} scale={scale} excluded={p.off} onToggle={()=>setOff(toggleOff(off,p.id))} why={why}/>)}</div>
  <small className="sb-foot">{METHOD.breakdownFoot(directionText(pair))}</small>
 </section>;
}
