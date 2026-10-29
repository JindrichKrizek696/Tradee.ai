'use client';
// Stránka /pruvodce: úvodní dotazník s živým náhledem toho, co se nastaví. Použít / přeskočit / vrátit; jde otevřít znovu z Nastavení.
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,Check,RotateCcw,SkipForward,Save} from 'lucide-react';
import {MARKET_GROUPS,STYLES,TIMES,ACCOUNTS,TOOLS,ONB_TIMEFRAMES,ZONES,DASH_PANELS,JOURNAL_FIELDS,emptyAnswers,buildPreview,validateAnswers,type Answers,type Current,type OnbStatus,type Prefs} from '@/lib/onboarding/core';
import {flagLabels} from '@/lib/markets';
import {NavBar} from '../nav-bar';
import {usePalette} from '../palette';
import {storePrefs} from './workspace';
import '../mt.css';
import '../nastaveni.css';
import './onboarding.css';
type Market={id:string;name:string;group:string};
type Data={status:OnbStatus|'unavailable';answers:Answers|null;prefs:Prefs;canRevert:boolean;strategyId:string|null;current?:Current;markets?:Market[]};
async function call<T>(method:string,body?:unknown):Promise<T>{const r=await fetch('/api/onboarding',{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as T&{error?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla. Zkus to znovu.');return j}
function Multi<T extends string>({label,options,value,onChange}:{label:string;options:Record<T,string>;value:T[];onChange:(v:T[])=>void}){
 return <fieldset className="ob-q"><legend>{label}</legend><div className="ob-chips">{(Object.keys(options) as T[]).map(k=>{const on=value.includes(k);return <button key={k} type="button" aria-pressed={on} className={on?'on':''} onClick={()=>onChange(on?value.filter(x=>x!==k):[...value,k])}>{on&&<Check size={14} aria-hidden="true"/>}{options[k]}</button>})}</div></fieldset>;
}
function One<T extends string>({label,options,value,onChange}:{label:string;options:Record<T,string>;value:T|null;onChange:(v:T|null)=>void}){
 return <fieldset className="ob-q"><legend>{label}</legend><div className="ob-chips" role="radiogroup" aria-label={label}>{(Object.keys(options) as T[]).map(k=><button key={k} type="button" role="radio" aria-checked={value===k} className={value===k?'on':''} onClick={()=>onChange(value===k?null:k)}>{options[k]}</button>)}</div></fieldset>;
}
export default function OnboardingPage(){
 usePalette();
 const [data,setData]=useState<Data|null>(null),[a,setA]=useState<Answers>(()=>emptyAnswers()),[risk,setRisk]=useState(''),[mkStrategy,setMkStrategy]=useState(false),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[done,setDone]=useState<{kind:'applied'|'skipped'|'reverted'|'saved';strategyId?:string|null}|null>(null);
 const load=()=>call<Data>('GET').then(j=>{setData(j);const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;const base=j.answers??emptyAnswers(ZONES.includes(tz as typeof ZONES[number])?tz:'Europe/Prague');setA(base);setRisk(base.riskPct===null?'':String(base.riskPct).replace('.',','))}).catch(e=>setErr((e as Error).message));
 useEffect(()=>{load()},[]);
 const set=(p:Partial<Answers>)=>{setA(x=>({...x,...p}));setDone(null)};
 const answers=useMemo(()=>({...a,riskPct:risk.trim()===''?null:Number(risk.replace(',','.'))}),[a,risk]);
 const valid=validateAnswers(answers),names=useMemo(()=>Object.fromEntries((data?.markets||[]).map(m=>[m.id,m.name])),[data]);
 const preview=useMemo(()=>data?.current&&typeof valid!=='string'?buildPreview(valid,data.current,(data.markets||[]).map(m=>m.id)):null,[data,valid]);
 async function act(kind:'applied'|'skipped'|'reverted'|'saved'){
  if(kind!=='reverted'&&typeof valid==='string'){setErr(valid);return}
  setBusy(true);setErr('');
  try{
   if(kind==='saved')await call('PUT',{answers:valid});
   else if(kind==='skipped')await call('POST',{action:'skip',answers:valid});
   else if(kind==='reverted'){if(!confirm('Vrátit navigaci, panely Dashboardu, pole deníku a vlaječky do stavu před průvodcem?'))return;await call('POST',{action:'revert'})}
   else{const j=await call<{strategyId:string|null}>('POST',{action:'apply',answers:valid,createStrategy:mkStrategy});setDone({kind,strategyId:j.strategyId});try{localStorage.removeItem('tradee.nav')}catch{}if(preview)storePrefs(preview.prefs);await load();return}
   if(kind==='reverted')try{localStorage.removeItem('tradee.nav');localStorage.removeItem('tradee.prefs')}catch{}
   setDone({kind});await load();
  }catch(e){setErr((e as Error).message)}finally{setBusy(false)}
 }
 const top=<header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>;
 if(data?.status==='unavailable')return <div className="mt-page">{top}<main className="mt-main"><h1>Průvodce nastavením</h1><section className="mt-card"><p className="mt-empty">Průvodce ještě není na serveru zapnutý. Dej prosím vědět správci.</p></section></main></div>;
 const dashName=Object.fromEntries(DASH_PANELS.map(([id,l])=>[id,l])),jfName=Object.fromEntries(JOURNAL_FIELDS.map(([id,l])=>[id,l]));
 return <div className="mt-page">{top}
  <main className="mt-main ob-main">
   <h1>Průvodce nastavením</h1>
   <p className="mt-lead">Pár otázek a Tradee si přizpůsobí navigaci, Dashboard, deník a vlaječky. Vpravo vidíš, co přesně se změní – nic se neuloží, dokud nedáš „Použít“. Vše jde kdykoli vrátit nebo upravit v Nastavení.</p>
   {err&&<p className="mt-alert" role="alert">{err}</p>}
   {done&&<p className="ob-done" role="status">{done.kind==='applied'?<>Nastaveno. {done.strategyId&&<a href={'/strategie#'+done.strategyId}>Otevřít prázdnou strategii →</a>} {preview?.profile&&<a href="/ucty?navrh=1">Založit profil účtu podle odpovědí →</a>} <a href="/">Do Dashboardu →</a></>:done.kind==='skipped'?<>Průvodce přeskočen. Najdeš ho kdykoli v Nastavení. <a href="/">Do Dashboardu →</a></>:done.kind==='reverted'?'Vráceno do stavu před průvodcem.':'Odpovědi uložené, můžeš pokračovat později.'}</p>}
   {!data?<p className="mt-empty">Načítám…</p>:<div className="ob-grid">
    <section className="mt-card ob-form" aria-label="Otázky">
     <Multi label="Jaké trhy obchoduješ?" options={MARKET_GROUPS} value={a.markets} onChange={v=>set({markets:v})}/>
     <One label="Styl obchodování" options={STYLES} value={a.style} onChange={v=>set({style:v})}/>
     <One label="Kolik času denně obchodování věnuješ?" options={TIMES} value={a.time} onChange={v=>set({time:v})}/>
     <Multi label="Časové rámce, na kterých se rozhoduješ" options={Object.fromEntries(ONB_TIMEFRAMES.map(t=>[t,t])) as Record<string,string>} value={a.timeframes} onChange={v=>set({timeframes:v})}/>
     <div className="pc-grid ob-row">
      <label className="pc-field"><span>Časová zóna</span><select value={a.tz} onChange={e=>set({tz:e.target.value})}>{[...new Set([a.tz,...ZONES])].map(z=><option key={z} value={z}>{z}</option>)}</select></label>
      <label className="pc-field"><span>Broker <small>(nepovinné)</small></span><input value={a.broker} maxLength={60} onChange={e=>set({broker:e.target.value})} placeholder="např. IC Markets, FTMO…"/></label>
     </div>
     <One label="Typ účtu" options={ACCOUNTS} value={a.account} onChange={v=>set({account:v})}/>
     <Multi label="Nástroje, které používáš" options={TOOLS} value={a.tools} onChange={v=>set({tools:v})}/>
     <div className="pc-grid ob-row"><label className="pc-field pc-narrow"><span>Riziko na obchod <small>(nepovinné)</small></span><span className="ob-num"><input inputMode="decimal" value={risk} onChange={e=>{setRisk(e.target.value);setDone(null)}} placeholder="nevyplněno" aria-describedby="ob-risk-h"/><i>%</i></span></label>
      <p id="ob-risk-h" className="ob-hint">Žádnou výchozí hodnotu nedoplníme. Když pole necháš prázdné, kalkulačka se na riziko zeptá u každého výpočtu.</p></div>
    </section>
    <section className="mt-card ob-preview" aria-label="Náhled změn" aria-live="polite">
     <h2>Co se nastaví</h2>
     {typeof valid==='string'?<p className="mt-alert">{valid}</p>:!preview?<p className="mt-empty">Náhled se načítá…</p>:<>
      <h3>Vlaječky</h3>
      {preview.watch.length?<ul className="ob-list">{preview.watch.map(w=><li key={w.instrument}><b>{names[w.instrument]||w.instrument}</b> → {flagLabels[w.to]}</li>)}</ul>:<p className="ob-muted">{a.markets.length?'Vybrané trhy už vlaječku mají – nic se nepřepíše.':'Vyber trhy a ukážu, co budu sledovat.'}</p>}
      <h3>Navigace</h3>
      {preview.navChanged?<div className="nv-stage ob-nav"><NavBar nav={preview.nav} view="dashboard" preview/></div>:<p className="ob-muted">Beze změny.</p>}
      {preview.nav.merge&&!data.current?.nav.merge&&<p className="ob-muted">Deník a Journaling se sloučí do jedné položky.</p>}
      <h3>Dashboard</h3>
      <p className="ob-muted">{preview.prefs.dash.off.length?'Schovám: '+preview.prefs.dash.off.map(id=>dashName[id]).join(', ')+'.':'Všechny panely zůstanou zobrazené.'}</p>
      <h3>Záznam obchodu v deníku</h3>
      <p className="ob-muted">{preview.prefs.journal.off.length?'Sbalím: '+preview.prefs.journal.off.map(id=>jfName[id]).join(', ')+' (data zůstanou, pole jde rozbalit).':'Všechna pole zůstanou zobrazená.'}</p>
      <h3>Startovní strategie</h3>
      <label className="ob-check"><input type="checkbox" checked={mkStrategy} onChange={e=>setMkStrategy(e.target.checked)}/> Založit prázdnou strategii „{preview.strategy.name}“</label>
      <p className="ob-muted">Vyplní se jen rozsah ({[preview.strategy.content.scope.markets.map(m=>names[m]||m).join(', ')||'bez trhů',preview.strategy.content.scope.timeframes.join(', ')||'bez časových rámců'].join(' · ')}). Setup, trigger, invalidace a ostatní bloky zůstanou prázdné – napíšeš je sám.</p>
      <h3>Profil účtu</h3>
      {preview.profile?<p className="ob-muted">Návrh: <b>{preview.profile.name}</b> · reset dne v zóně {preview.profile.tz} · riziko na obchod {preview.profile.maxRiskPct===null?'nevyplněno':preview.profile.maxRiskPct.toLocaleString('cs-CZ')+' %'}. Založíš ho po použití na stránce Účty (zůstatek a pravidla doplníš).</p>:<p className="ob-muted">Vyber typ účtu a připravím návrh profilu.</p>}
      {preview.notes.length>0&&<ul className="ob-notes">{preview.notes.map(n=><li key={n}>{n}</li>)}</ul>}
     </>}
    </section>
   </div>}
   {data&&<div className="mt-actions ob-actions">
    <button type="button" className="mt-btn ob-primary" disabled={busy||typeof valid==='string'} onClick={()=>act('applied')}><Check size={15}/> Použít</button>
    <button type="button" className="mt-btn" disabled={busy} onClick={()=>act('saved')}><Save size={15}/> Uložit rozpracované</button>
    <button type="button" className="mt-btn" disabled={busy} onClick={()=>act('skipped')}><SkipForward size={15}/> Přeskočit</button>
    {data.canRevert&&<button type="button" className="mt-btn" disabled={busy} onClick={()=>act('reverted')}><RotateCcw size={15}/> Vrátit předchozí nastavení</button>}
   </div>}
  </main>
 </div>;
}
