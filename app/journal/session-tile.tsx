'use client';
// Limity seance: dlaždice na Dashboardu (stav připraven / aktivní / pauza / review, dnešní upozornění, zápis review) a editor limitů na stránce Pravidla.
import {useEffect,useState} from 'react';
import {Timer,ChevronRight,AlertTriangle} from 'lucide-react';
import {SESSION_STATES,SCOPES,emptyLimits,type SessionLimits,type Scope,type Warning} from '@/lib/journal/session';
import type {SessionView} from '@/lib/journal/record-store';
import './record.css';
type Data={sessions:SessionView[];warnings:Warning[];accounts:{id:string;name:string}[];strategies:{id:string;name:string}[]};
async function call(method:string,body?:unknown):Promise<Data>{
 const r=await fetch('/api/journal/session',{method,cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json().catch(()=>({})) as Data&{error?:string};if(!r.ok)throw Error(j.error||'Limity seance se nepodařilo načíst.');return j;
}
const plural=(n:number,a:string,b:string,c:string)=>n===1?a:n>=2&&n<=4?b:c;
export function SessionTile({style}:{style?:React.CSSProperties}){
 const [d,setD]=useState<Data|null>(null),[err,setErr]=useState(''),[rev,setRev]=useState<{scope:Scope;scopeId:string}|null>(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;call('GET').then(j=>{if(live)setD(j)}).catch(e=>{if(live)setErr((e as Error).message)});return()=>{live=false}},[]);
 async function review(){if(!rev)return;setBusy(true);try{setD(await call('POST',{...rev,note}));setRev(null);setNote('');setErr('')}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 const shown=(d?.sessions||[]).filter(s=>s.scope!=='all'||d!.sessions.length===1||Object.values(s.limits).some(v=>v!==null&&v!==3));
 return <section className="d-card js" style={style}>
  <div className="d-head"><h2><Timer size={16}/> Seance</h2><a className="d-link" href="/pravidla#seance">Limity <ChevronRight size={14}/></a></div>
  {!d?<p className="d-empty">{err||'Načítám…'}</p>:<>
   <ul className="js-list">{shown.map(s=><li key={s.scope+s.scopeId} className="js-item">
    <span><span className={'js-state '+s.state}>{SESSION_STATES[s.state]}</span> <b>{s.name}</b></span>
    <small>Dnes {s.counts.trades} {plural(s.counts.trades,'obchod','obchody','obchodů')}{s.limits.maxTrades?` / ${s.limits.maxTrades}`:''} · {s.counts.losses} {plural(s.counts.losses,'ztráta','ztráty','ztrát')}{s.limits.maxLosses?` / ${s.limits.maxLosses}`:''}{s.limits.maxDecisions?` · rozhodnutí ${s.counts.decisions} / ${s.limits.maxDecisions}`:''}{s.limits.endTime?` · konec ${s.limits.endTime}`:''}</small>
    {s.reasons.map(r=><small key={r}>{r}</small>)}
    {s.state==='review'&&(rev?.scope===s.scope&&rev.scopeId===s.scopeId?<div className="js-form"><textarea className="j-note" rows={3} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Co se v sérii opakovalo? Co uděláš jinak?" aria-label="Review série"/><div className="ji-acts"><button type="button" disabled={busy} onClick={review}>Uložit review</button><button type="button" onClick={()=>setRev(null)}>Zrušit</button></div></div>
     :<div className="ji-acts"><button type="button" onClick={()=>setRev({scope:s.scope,scopeId:s.scopeId})}>Udělat review</button><a className="d-link" href="#journaling">Vyhodnocení obchodů</a></div>)}
   </li>)}</ul>
   {shown.length===1&&shown[0].scope==='all'&&!Object.values(shown[0].limits).some(v=>v!==null&&v!==3)&&<p className="d-empty">Limity seance nejsou nastavené. <a href="/pravidla#seance">Nastavit</a></p>}
   {d.warnings.length>0&&<ul className="jr-warn">{d.warnings.slice(0,4).map((w,i)=><li key={i}><AlertTriangle size={14} aria-hidden/><a href={'#journal/'+encodeURIComponent(w.tradeId)}>{w.text}</a></li>)}</ul>}
   {err&&<p role="alert" className="s-notice">{err}</p>}
  </>}
 </section>;
}
const toForm=(l:SessionLimits)=>Object.fromEntries(Object.entries(l).map(([k,v])=>[k,v===null?'':String(v)])) as Record<keyof SessionLimits,string>;
const FIELDS:[keyof SessionLimits,string,string][]=[['maxTrades','Max. obchodů za den','např. 3'],['maxLosses','Max. ztrát za den','např. 2'],['maxDecisions','Max. rozhodnutí za den','obchody + vynechané'],['pauseAfterSl','Pauza po ztrátách v řadě (dnes)','např. 2'],['reviewAfterSl','Review po ztrátách v řadě','např. 5'],['newsBefore','No-trade: minut před zprávou','např. 15'],['newsAfter','No-trade: minut po zprávě','např. 30']];
export function SessionLimitsEditor(){
 const [d,setD]=useState<Data|null>(null),[err,setErr]=useState(''),[ok,setOk]=useState(''),[scope,setScope]=useState<Scope>('all'),[scopeId,setScopeId]=useState(''),[f,setF]=useState(toForm(emptyLimits())),[busy,setBusy]=useState(false);
 useEffect(()=>{call('GET').then(setD).catch(e=>setErr((e as Error).message))},[]);
 useEffect(()=>{if(!d)return;const cur=d.sessions.find(s=>s.scope===scope&&s.scopeId===(scope==='all'?'':scopeId));setF(toForm(cur?.limits??emptyLimits()))},[d,scope,scopeId]);
 const ids=scope==='account'?d?.accounts||[]:scope==='strategy'?d?.strategies||[]:[];
 useEffect(()=>{if(scope!=='all'&&!ids.some(x=>x.id===scopeId))setScopeId(ids[0]?.id||'')},[scope,ids,scopeId]);
 async function save(){setBusy(true);try{setD(await call('PUT',{scope,scopeId,limits:f}));setErr('');setOk('Uloženo')}catch(e){setErr((e as Error).message);setOk('')}finally{setBusy(false)}}
 async function remove(){setBusy(true);try{setD(await call('DELETE',{scope,scopeId}));setOk('Limity zrušeny');setErr('')}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 return <section className="mt-card" id="seance"><h2>Limity seance</h2>
  <p className="mt-lead">Kolik obchodů, ztrát a rozhodnutí za den si dovolíš, kdy seance končí a kdy si dát pauzu. Na Dashboardu pak uvidíš stav <b>připraven / aktivní / pauza / review</b>; obchod mimo limity se zapíše do disciplíny. No-trade okno kolem zpráv platí pro účet (strategie ho mají v bloku Kdy neobchodovat).</p>
  {!d?<p className="j-muted">{err||'Načítám…'}</p>:<div className="js-form">
   <div className="js-grid">
    <label className="j-field"><span>Platí pro</span><select value={scope} onChange={e=>setScope(e.target.value as Scope)}>{(Object.keys(SCOPES) as Scope[]).map(s=><option key={s} value={s}>{SCOPES[s]}</option>)}</select></label>
    {scope!=='all'&&<label className="j-field"><span>{scope==='account'?'Účet':'Strategie'}</span><select value={scopeId} onChange={e=>setScopeId(e.target.value)}>{ids.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
   </div>
   <div className="js-grid">{FIELDS.map(([k,l,ph])=><label key={k} className="j-field"><span>{l}</span><input inputMode="numeric" value={f[k]} placeholder={ph} onChange={e=>setF(x=>({...x,[k]:e.target.value}))}/></label>)}
    <label className="j-field"><span>Konec seance (Praha)</span><input type="time" value={f.endTime} onChange={e=>setF(x=>({...x,endTime:e.target.value}))}/></label>
    <label className="j-field"><span>No-trade: dopad zpráv</span><select value={f.newsMinImpact||'3'} onChange={e=>setF(x=>({...x,newsMinImpact:e.target.value}))}><option value="3">Jen silné</option><option value="2">Střední i silné</option></select></label></div>
   <div className="ji-acts"><button type="button" className="j-btn dark" disabled={busy||(scope!=='all'&&!scopeId)} onClick={save}>Uložit limity</button><button type="button" className="j-btn" disabled={busy} onClick={remove}>Zrušit limity</button>{ok&&<span className="j-muted" role="status">{ok}</span>}</div>
   {err&&<p role="alert" className="s-notice">{err}</p>}
  </div>}
 </section>;
}
