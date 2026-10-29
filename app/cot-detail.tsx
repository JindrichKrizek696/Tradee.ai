'use client';
// COT detail (záložka v detailu trhu): přepínání reportů Legacy / TFF / Disaggregated, kategorie, long/short/net/změna,
// COT index a percentil ve zvoleném okně 26/52/156 týdnů, graf čisté pozice s pásmy indexu 20/80, datum pozic vs zveřejnění
// a snímek do scénáře (poznámka otevřeného scénáře přes /api/scenarios).
import {Term} from './term';
import {useEffect,useState} from 'react';
import {Target} from 'lucide-react';
import type {CotContract} from '@/lib/score-engine';
import {fresh} from '@/lib/score-engine';
import {cotSeries,cotBands,cotSnapshotText,COT_WINDOWS} from '@/lib/cot-index';
import {cotPositionsLabel,cotPublishedLabel} from '@/lib/cot-dates';
import {BandChart} from './band-chart';
import './analysis-detail.css';
export type CotSource={report:string;contract:CotContract|undefined;groups:{value:string;label:string}[];note?:string};
const num=(n:number)=>n.toLocaleString('cs-CZ',{maximumFractionDigits:0});
const sgn=(n:number|null)=>n===null?'—':(n>0?'+':'')+num(n);
const tone=(n:number|null)=>!n?'':n>0?'positive':'negative';
const d=(s:string)=>new Date(s+'T00:00:00Z').toLocaleDateString('cs-CZ',{timeZone:'UTC',day:'numeric',month:'numeric',year:'2-digit'});
export const LEGACY_GROUPS=[{value:'noncommercial',label:'Non-commercials'},{value:'commercial',label:'Commercials'},{value:'nonreportable',label:'Nonreportable'}];
export const TFF_GROUPS=[{value:'leveraged',label:'Leveraged funds (do skóre)'},{value:'assetManagers',label:'Asset managers'},{value:'dealers',label:'Dealers'},{value:'other',label:'Other reportables'},{value:'nonreportable',label:'Nonreportable'}];
export const DISAGG_GROUPS=[{value:'managedMoney',label:'Managed money (do skóre)'},{value:'producers',label:'Producenti / obchodníci'},{value:'swapDealers',label:'Swap dealers'},{value:'other',label:'Other reportables'},{value:'nonreportable',label:'Nonreportable'}];

export function CotDetail({title,instrument,sources,now}:{title:string;instrument:string;sources:CotSource[];now:number}){
 const avail=sources.filter(s=>s.contract?.history.length);
 const [rep,setRep]=useState(avail[0]?.report??''),src=avail.find(s=>s.report===rep)??avail[0];
 const [group,setGroup]=useState(src?.groups[0]?.value??''),g=src?.groups.find(x=>x.value===group)??src?.groups[0];
 const [win,setWin]=useState<number>(52);
 // malé řady (desítky až stovky týdnů) – bez memoizace
 const pts=src&&g?cotSeries(src.contract,g.value):[],bands=cotBands(pts,win);
 if(!src||!g||!pts.length)return <section className="s-card"><h2>COT · {title}</h2><p>Ověřený futures kontrakt pro tento trh není dostupný.</p></section>;
 const last=pts.at(-1)!,idx=bands.at(-1)!,shown=Math.min(pts.length,Math.max(win,26)),from=pts.length-shown,c=src.contract!;
 const stale=!fresh(last.date,11,now);
 return <section className="s-card ad-cot">
  <div className="s-card-head"><div><span className="s-kicker"><Term id={src.report==='TFF'?'cot-tff':src.report==='Disaggregated'?'cot-disaggregated':'cot-legacy'}>CFTC · {src.report.toUpperCase()}</Term> · FUTURES ONLY</span><h2>{title} <span className="muted">/ {c.contract}</span></h2></div><span className={'s-badge'+(stale?' warning':'')}>{stale?'Starší report':'Týdenní report'}</span></div>
  {avail.length>1&&<div className="ad-chips" role="group" aria-label="Report">{avail.map(s=><button key={s.report} type="button" className={'c-chip'+(s.report===src.report?' on':'')} aria-pressed={s.report===src.report} onClick={()=>{setRep(s.report);setGroup(s.groups[0].value)}}>{s.report}</button>)}</div>}
  <div className="ad-chips" role="group" aria-label="Kategorie">{src.groups.map(o=><button key={o.value} type="button" className={'c-chip'+(o.value===g.value?' on':'')} aria-pressed={o.value===g.value} onClick={()=>setGroup(o.value)}>{o.label}</button>)}</div>
  <div className="ad-dates"><span>{cotPositionsLabel(last.date)}</span><span>{cotPublishedLabel(last.date)} (15:30 ET)</span><span>kontrola {new Date(c.checkedAt).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>
  <div className="ad-stats">
   <div><small>Long</small><b className="positive">{num(last.long)}</b></div>
   <div><small>Short</small><b className="negative">{num(last.short)}</b></div>
   <div><small>Net</small><b className={tone(last.net)}>{sgn(last.net)}</b></div>
   <div><small>Změna za týden</small><b className={tone(last.change)}>{sgn(last.change)}</b></div>
   <div><small><Term id="cot-index">COT index</Term></small><b>{idx.index===null?'—':Math.round(idx.index)}</b><em>0 = min, 100 = max okna</em></div>
   <div><small><Term id="percentil">Percentil</Term></small><b>{idx.percentile===null?'—':Math.round(idx.percentile)}</b><em>{idx.n} týdnů</em></div>
  </div>
  <div className="ad-chips" role="group" aria-label="Okno indexu"><span className="ad-lab">Okno</span>{COT_WINDOWS.map(w=><button key={w} type="button" className={'c-chip'+(w===win?' on':'')} aria-pressed={w===win} onClick={()=>setWin(w)}>{w} týdnů</button>)}</div>
  {idx.short&&<p className="s-note warning" role="status">K dispozici je jen {idx.n} týdenních reportů – index a percentil jsou z kratší historie než {win} týdnů.</p>}
  {idx.index!==null&&(idx.index>=90||idx.index<=10)&&<p className="s-note warning">Krajní pozice v okně. Upozornění na koncentraci, nikoli automatický signál k obratu.</p>}
  <BandChart ariaLabel={'Čistá pozice '+g.label+' s pásmy COT indexu'} labels={pts.slice(from).map(p=>d(p.date))}
   lines={[{values:pts.slice(from).map(p=>p.net),label:'Net · '+g.label,color:'#245bff'}]}
   band={{low:bands.slice(from).map(b=>b.low),high:bands.slice(from).map(b=>b.high),label:`Pásmo indexu 20–80 (klouzavé okno ${win} týdnů)`}}
   readout={i=>{const p=pts[from+i],b=bands[from+i];return <><span>pozice k {d(p.date)} · zveřejněno {d(p.published)}</span><span>Long <b>{num(p.long)}</b></span><span>Short <b>{num(p.short)}</b></span><span>Net <b>{sgn(p.net)}</b></span><span>Index <b>{b.index===null?'—':Math.round(b.index)}</b></span></>}}/>
  <details className="s-details"><summary>Posledních 8 reportů · datum pozic a zveřejnění</summary>
   <table className="ad-table"><thead><tr><th>Pozice k</th><th>Zveřejněno</th><th>Long</th><th>Short</th><th>Net</th><th>Změna</th></tr></thead>
    <tbody>{pts.slice(-8).reverse().map(p=><tr key={p.date}><td>{d(p.date)}</td><td>{d(p.published)}</td><td>{num(p.long)}</td><td>{num(p.short)}</td><td className={tone(p.net)}>{sgn(p.net)}</td><td className={tone(p.change)}>{sgn(p.change)}</td></tr>)}</tbody></table>
  </details>
  {src.note&&<p className="s-note">{src.note}</p>}
  <p className="s-note">COT index = (net − minimum) / (maximum − minimum) × 100 v posledních {win} reportech; percentil = podíl týdnů s nižší čistou pozicí. Pozice jsou k úterý, CFTC je zveřejňuje v pátek. Long/short bez spreadů.</p>
  <ScenarioSnapshot instrument={instrument} text={cotSnapshotText({market:title,report:src.report,group:g.label,contract:c.contract,p:last,idx})}/>
  <a className="s-source" href={c.sourceUrl} target="_blank" rel="noreferrer">CFTC · kontrakt {c.code} ↗</a>
 </section>;
}

type Sc={id:string;instrument:string;hypothesis:string;note:string;status:string};
/** „Přidat do scénáře“: připojí text snímku k poznámce otevřeného scénáře trhu; bez otevřeného scénáře nabídne nový. */
export function ScenarioSnapshot({instrument,text}:{instrument:string;text:string}){
 const [open,setOpen]=useState(false),[list,setList]=useState<Sc[]|null>(null),[pick,setPick]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!open||list)return;fetch('/api/scenarios?scope=open&instrument='+encodeURIComponent(instrument),{cache:'no-store'}).then(r=>(r.ok?r.json():Promise.reject()) as Promise<{scenarios:Sc[]}>).then(j=>{setList(j.scenarios);setPick(j.scenarios[0]?.id??'')}).catch(()=>{setList([]);setMsg('Scénáře se nepodařilo načíst.')})},[open,list,instrument]);
 async function add(){const s=list?.find(x=>x.id===pick);if(!s)return;const note=(s.note?s.note+'\n\n':'')+text;
  if(note.length>2000){setMsg('Poznámka scénáře by přesáhla 2000 znaků. Zkrať ji ve scénáři.');return}
  setBusy(true);try{const r=await fetch('/api/scenarios/'+encodeURIComponent(s.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({note})});const j=await r.json() as {error?:string};if(!r.ok)throw Error(j.error||'Uložení se nezdařilo.');setList(l=>l?.map(x=>x.id===s.id?{...x,note}:x)??null);setMsg('Snímek přidán do poznámky scénáře.')}catch(e){setMsg(e instanceof Error?e.message:'Uložení se nezdařilo.')}finally{setBusy(false)}}
 return <div className="ad-snap">
  {!open?<button type="button" className="al-btn" onClick={()=>setOpen(true)}><Target size={15} aria-hidden/>Přidat do scénáře</button>:
   list===null?<small>Načítám otevřené scénáře…</small>:
   list.length?<div className="ad-snap-row"><select value={pick} onChange={e=>setPick(e.target.value)} aria-label="Scénář">{list.map(s=><option key={s.id} value={s.id}>{s.hypothesis.slice(0,60)||s.id}</option>)}</select><button type="button" className="al-btn" disabled={busy} onClick={add}>Přidat snímek</button><a href={'/scenare#'+encodeURIComponent(pick)}>Otevřít scénář</a></div>:
   <small>Pro tento trh není otevřený scénář. <a href={'/scenare?novy='+encodeURIComponent(instrument)}>Založit nový scénář</a> a snímek přidat potom.</small>}
  {msg&&<small role="status">{msg}</small>}
  {open&&<small className="ad-snap-text">{text}</small>}
 </div>;
}
