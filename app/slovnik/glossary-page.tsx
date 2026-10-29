'use client';
// Stránka /slovnik: všechny pojmy Tradee po skupinách, hledání bez diakritiky, kotvy #id (odkazy z <Term> a z vyhledávání).
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,Search,X} from 'lucide-react';
import {GLOSSARY,GROUPS,filterTerms,getTerm,type TermGroup} from '@/lib/glossary';
import {usePalette} from '../palette';
import '../mt.css';
import './glossary.css';
export default function GlossaryPage(){
 usePalette();
 const [q,setQ]=useState(''),[hit,setHit]=useState<string|null>(null);
 useEffect(()=>{const go=()=>{const id=decodeURIComponent(location.hash.slice(1));if(!getTerm(id))return;setQ('');setHit(id);setTimeout(()=>{const el=document.getElementById(id);el?.scrollIntoView({block:'center'});el?.focus({preventScroll:true})},50)};go();addEventListener('hashchange',go);return()=>removeEventListener('hashchange',go)},[]);
 const list=useMemo(()=>filterTerms(q),[q]);
 const groups=(Object.keys(GROUPS) as TermGroup[]).map(g=>[g,list.filter(t=>t.group===g)] as const).filter(([,ts])=>ts.length);
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main gl-main">
   <h1>Slovník pojmů</h1>
   <p className="mt-lead">Každý pojem, který v Tradee potkáš, jednou větou a s krátkým příkladem. V aplikaci jsou pojmy podtržené tečkami – najetím nebo klepnutím se ukáže vysvětlení.</p>
   <div className="gl-search"><Search size={17} aria-hidden="true"/><input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Hledej pojem, např. drawdown, FVG, COT…" aria-label="Hledat ve slovníku"/>{q&&<button type="button" className="gl-clear" aria-label="Vymazat hledání" onClick={()=>setQ('')}><X size={15}/></button>}</div>
   <p className="gl-count" role="status" aria-live="polite">{q?`${list.length} z ${GLOSSARY.length} pojmů`:`${GLOSSARY.length} pojmů`}</p>
   {!list.length&&<section className="mt-card"><p className="mt-empty">Pojem „{q}“ ve slovníku zatím není.</p></section>}
   {!q&&<nav className="gl-toc" aria-label="Skupiny pojmů">{groups.map(([g])=><a key={g} href={'#sk-'+g}>{GROUPS[g]}</a>)}</nav>}
   {groups.map(([g,ts])=><section key={g} className="mt-card gl-group" aria-labelledby={'sk-'+g}>
    <h2 id={'sk-'+g}>{GROUPS[g]}</h2>
    <dl>{ts.map(t=><div key={t.id} id={t.id} tabIndex={-1} className={'gl-term'+(hit===t.id?' hit':'')}>
     <dt>{t.term}{t.aliases?.length?<small> · {t.aliases.join(', ')}</small>:null}</dt>
     <dd><p>{t.def}</p><p className="gl-ex"><b>Příklad:</b> {t.example}</p>{t.see?.length?<p className="gl-see">Souvisí: {t.see.map((s,i)=><span key={s}>{i?', ':''}<a href={'#'+s}>{getTerm(s)?.term||s}</a></span>)}</p>:null}</dd>
    </div>)}</dl>
   </section>)}
  </main>
 </div>;
}
