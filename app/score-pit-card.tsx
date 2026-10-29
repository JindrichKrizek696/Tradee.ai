'use client';
// Karta skóre ze snímku k datu (stejné řádky složek jako živá karta, každé číslo s „Proč?“).
import {useState} from 'react';
import {cz,dayMonthTime,type PitSnapshot} from '@/lib/score/pit';
import {METHOD} from '@/lib/score/method-text';
import {ComponentRow,barScale} from './score-breakdown';
import {toV3Part,WhyButton,ScoreWhy} from './score-pit';
/** Snímek → tvar výsledku pro ScoreBreakdown. */
export function snapToResult(s:PitSnapshot){
 const parts=s.parts.map(toV3Part),available=parts.filter(p=>p.status==='ok'&&p.value!==null).length;
 return {parts,score:s.score,coverage:s.coverage??0,paused:s.score===null?'Pozastaveno – v tomto čase chyběly podklady.':null,count:parts.length,available};
}
const tone=(n:number|null)=>n===null||n===0?'neutral':n>0?'positive':'negative';
export function PitScoreCard({snap,prev,market}:{snap:PitSnapshot;prev:PitSnapshot|null|undefined;market:string}){
 const [open,setOpen]=useState(false),r=snapToResult(snap),why={snap,prev,market};
 return <section className="s-card s-score"><span className="s-kicker">{snap.method}{snap.version!==snap.method?' · '+snap.version:''} · stav k {dayMonthTime(snap.at)}</span>
  <div className="s-score-line"><strong className={tone(snap.score)}>{cz(snap.score,1)}</strong><WhyButton open={open} onToggle={()=>setOpen(o=>!o)} label="celkové skóre"/></div>
  <h2 className={tone(snap.score)}>{snap.score===null?'Pozastaveno – chybí podklady':snap.score>0?'Bullish':snap.score<0?'Bearish':'Vyrovnané'}</h2>
  <div className="s-scale"><i style={{left:50+(snap.score??0)/2+'%'}}/></div><div className="s-bar-label"><span>Bearish</span><span>Bullish</span></div>
  {open&&<ScoreWhy snap={snap} prev={prev} onClose={()=>setOpen(false)}/>}
  <div className="n-score-meta"><span>{r.available}/{r.count} složek · váhy <b>{snap.coverage??'?'} %</b> dostupné</span>{snap.reconstructed&&<span>rekonstruováno z historie</span>}</div>
  {r.paused&&<p className="sb-paused" role="status">{r.paused}</p>}
  <div className="s-score-parts"><h3>Příspěvky ke skóre</h3>{r.parts.map(p=><ComponentRow key={p.id} p={p} scale={barScale(r)} compact why={why}/>)}</div>
  <p>{snap.score===null?METHOD.paused:snap.method==='score-v3'?METHOD.card:'Technický model: signál složky × váha.'}</p>
 </section>;
}
