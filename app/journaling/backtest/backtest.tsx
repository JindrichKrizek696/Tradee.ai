'use client';
// Záložka Backtest v Journalingu: strategie → pravidla → nastavení běhu → výsledek; uložené běhy a porovnání dvou.
import {useEffect,useMemo,useRef,useState} from 'react';
import {Play,Save,Trash2,FolderOpen,GitCompare,LoaderCircle} from 'lucide-react';
import {rulesIssues,type StrategyRules} from '@/lib/backtest/rules';
import {fmtNum,fmtDateTime,plural} from '@/lib/journal/format';
import {RuleEditor} from './rule-editor';
import {RunPanel,periodOf,sanitizeSettings,type RunSettings} from './run-panel';
import {Results} from './results';
import {Compare} from './compare';
import {call,fmtPct,fmtPeriod,marketsText,rulesText,sqlMs,tone,type Run,type RunRow,type Strategy} from './shared';
import './backtest.css';
const KEY='tradee.backtest';
type Loaded={sid:string;saved:StrategyRules;draft:StrategyRules};
type View={kind:'run';run:Run}|{kind:'compare';runs:[Run,Run]}|null;
function stored():{sid:string;settings:RunSettings}{try{const v=JSON.parse(localStorage.getItem(KEY)||'{}');return {sid:typeof v.sid==='string'?v.sid:'',settings:sanitizeSettings(v.settings)}}catch{return {sid:'',settings:sanitizeSettings(null)}}}
export function Backtest({dirtyRef}:{dirtyRef?:React.MutableRefObject<boolean>}){
 const [strats,setStrats]=useState<Strategy[]|null>(null),[loadErr,setLoadErr]=useState('');
 const [want,setSid]=useState(()=>stored().sid),[settings,setSettings]=useState<RunSettings>(()=>stored().settings);
 const [rules,setRules]=useState<Loaded|null>(null),[rulesErr,setRulesErr]=useState(''),[saving,setSaving]=useState<'idle'|'saving'|'saved'>('idle'),[saveErr,setSaveErr]=useState('');
 const [runs,setRuns]=useState<RunRow[]|null>(null),[runsErr,setRunsErr]=useState(''),[view,setView]=useState<View>(null),[pick,setPick]=useState<string[]>([]),[busyId,setBusyId]=useState<string|null>(null);
 const [running,setRunning]=useState(false),[elapsed,setElapsed]=useState(0),[runErr,setRunErr]=useState('');
 const cache=useRef(new Map<string,Run>()),out=useRef<HTMLDivElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;call<{strategies:Strategy[]}>('/api/strategies').then(j=>{if(alive.current)setStrats(j.strategies)}).catch((e:Error)=>{if(alive.current)setLoadErr(e.message||'Strategie se nepodařilo načíst.')});return()=>{alive.current=false}},[]);
 const active=useMemo(()=>(strats||[]).filter(s=>!s.archived),[strats]);
 // vybraná strategie musí být aktivní; jinak první
 const sid=active.some(s=>s.id===want)?want:active[0]?.id||'';
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify({sid,settings}))}catch{}},[sid,settings]);
 // pravidla a běhy vybrané strategie
 useEffect(()=>{
  if(!sid)return;
  let live=true;setRules(null);setRulesErr('');setRuns(null);setRunsErr('');setView(null);setPick([]);setRunErr('');setSaving('idle');setSaveErr('');
  call<{rules:StrategyRules}>(`/api/strategies/${encodeURIComponent(sid)}/rules`).then(j=>{if(live)setRules({sid,saved:j.rules,draft:j.rules})}).catch((e:Error)=>{if(live)setRulesErr(e.message)});
  call<{runs:RunRow[]}>('/api/backtest?strategy='+encodeURIComponent(sid)).then(j=>{if(live)setRuns(j.runs)}).catch((e:Error)=>{if(live)setRunsErr(e.message)});
  return()=>{live=false};
 },[sid]);
 const dirty=!!rules&&JSON.stringify(rules.draft)!==JSON.stringify(rules.saved);
 useEffect(()=>{if(dirtyRef)dirtyRef.current=dirty;if(!dirty)return;const f=(e:BeforeUnloadEvent)=>{e.preventDefault()};addEventListener('beforeunload',f);return()=>removeEventListener('beforeunload',f)},[dirty,dirtyRef]);
 useEffect(()=>()=>{if(dirtyRef)dirtyRef.current=false},[dirtyRef]);
 useEffect(()=>{if(!running)return;const t0=Date.now(),t=setInterval(()=>setElapsed(Math.round((Date.now()-t0)/1000)),500);return()=>clearInterval(t)},[running]);
 const issues=useMemo(()=>rules?rulesIssues(rules.draft):[],[rules]);
 const edit=(draft:StrategyRules)=>{setRules(r=>r&&{...r,draft});setSaving('idle')};
 function choose(id:string){if(id===sid)return;if(dirty&&!confirm('Pravidla mají neuložené změny. Opravdu přepnout strategii a změny zahodit?'))return;setSid(id)}
 async function save(){if(!rules)return;const s0=rules.sid;setSaving('saving');setSaveErr('');
  try{const j=await call<{rules:StrategyRules}>(`/api/strategies/${encodeURIComponent(s0)}/rules`,'PUT',{rules:rules.draft});if(!alive.current)return;setRules(r=>r&&r.sid===s0?{sid:s0,saved:j.rules,draft:JSON.stringify(r.draft)===JSON.stringify(rules.draft)?j.rules:r.draft}:r);setSaving('saved')}
  catch(e){if(alive.current){setSaving('idle');setSaveErr((e as Error).message)}}}
 const badPeriod=periodOf(settings,0),blocker=!rules?'':issues.length?'Nejdřív oprav pravidla (viz výše).':!settings.markets.length?'Vyber aspoň jeden trh.':typeof badPeriod==='string'?badPeriod:'';
 async function run(){
  const period=periodOf(settings,Date.now());
  if(!rules||blocker||running||typeof period==='string')return;
  setRunning(true);setElapsed(0);setRunErr('');
  try{const j=await call<{run:Run}>('/api/backtest','POST',{strategyId:rules.sid,markets:settings.markets,tf:settings.tf,from:period.from,to:period.to,capital:rules.draft.sizing.capital,riskPct:rules.draft.sizing.riskPct,rules:rules.draft});
   if(!alive.current)return;cache.current.set(j.run.id,j.run);
   if(j.run.strategyId===sid){setRuns(l=>[{id:j.run.id,strategyId:j.run.strategyId,created:j.run.created,params:j.run.params,summary:j.run.summary},...(l||[])].slice(0,50));setView({kind:'run',run:j.run});setPick([]);requestAnimationFrame(()=>out.current?.scrollIntoView({behavior:'smooth',block:'start'}))}}
  catch(e){if(alive.current)setRunErr((e as Error).message||'Backtest se nepodařilo spustit.')}
  finally{if(alive.current)setRunning(false)}
 }
 async function full(id:string):Promise<Run>{const c=cache.current.get(id);if(c)return c;const j=await call<{run:Run}>('/api/backtest/'+encodeURIComponent(id));cache.current.set(id,j.run);return j.run}
 async function open(id:string){setBusyId(id);setRunsErr('');try{const r=await full(id);if(alive.current){setView({kind:'run',run:r});requestAnimationFrame(()=>out.current?.scrollIntoView({behavior:'smooth',block:'start'}))}}catch(e){if(alive.current)setRunsErr((e as Error).message)}finally{if(alive.current)setBusyId(null)}}
 async function compare(){if(pick.length!==2)return;setBusyId('cmp');setRunsErr('');try{const [a,b]=await Promise.all(pick.map(full));if(alive.current){setView({kind:'compare',runs:[a,b]});requestAnimationFrame(()=>out.current?.scrollIntoView({behavior:'smooth',block:'start'}))}}catch(e){if(alive.current)setRunsErr((e as Error).message)}finally{if(alive.current)setBusyId(null)}}
 async function remove(r:RunRow){
  if(!confirm(`Smazat běh ze ${fmtDateTime(sqlMs(r.created))}?`))return;
  setBusyId(r.id);setRunsErr('');
  try{await call('/api/backtest/'+encodeURIComponent(r.id),'DELETE');if(!alive.current)return;cache.current.delete(r.id);setRuns(l=>(l||[]).filter(x=>x.id!==r.id));setPick(p=>p.filter(x=>x!==r.id));
   setView(v=>v&&(v.kind==='run'?v.run.id===r.id:v.runs.some(x=>x.id===r.id))?null:v)}
  catch(e){if(alive.current)setRunsErr((e as Error).message)}finally{if(alive.current)setBusyId(null)}
 }
 if(loadErr)return <p role="alert" className="s-notice">{loadErr}</p>;
 if(!strats)return <p className="j-muted">Načítám strategie…</p>;
 if(!active.length)return <div className="j-card j-empty"><p>Backtest testuje pravidla strategie. Zatím nemáš žádnou aktivní strategii.</p><p>Založ ji na stránce <a href="/pravidla">Pravidla a strategie</a> a pak se sem vrať.</p></div>;
 const viewId=view?.kind==='run'?view.run.id:null,idx=(id:string)=>pick.indexOf(id);
 return <div className="bt">
  <div className="j-card bt-bar">
   <label className="j-field bt-strat"><span>Strategie</span><select value={sid} onChange={e=>choose(e.target.value)}>{active.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <p className="j-muted">Nastav pravidla vstupu a výstupu, vyber trhy a období a projeď je nad historickými svíčkami. Výsledek porovnáš se svými skutečnými obchody.</p>
  </div>
  <div className="bt-grid">
   <section className="j-card bt-rcard">
    <div className="bt-thead"><h2>Pravidla</h2>
     {rules&&<span className={'bt-state'+(dirty?' dirty':'')} role="status" aria-live="polite">{saving==='saving'?'Ukládám…':dirty?'Neuložené změny':saving==='saved'?'Uloženo':''}</span>}
     {rules&&<button type="button" className="j-btn dark" disabled={!dirty||saving==='saving'} onClick={save}><Save size={14}/>Uložit pravidla</button>}</div>
    {saveErr&&<p className="jg-err" role="alert">{saveErr}</p>}
    {rulesErr?<p role="alert" className="s-notice">{rulesErr}</p>:!rules?<p className="j-muted">Načítám pravidla…</p>:<RuleEditor rules={rules.draft} onChange={edit} markets={settings.markets} issues={issues}/>}
   </section>
   <div className="bt-side">
    <section className="j-card"><h2>Nastavení běhu</h2>
     {rules&&<RunPanel s={settings} set={setSettings} capital={rules.draft.sizing.capital} risk={rules.draft.sizing.riskPct} onSizing={p=>edit({...rules.draft,sizing:{...rules.draft.sizing,...p}})}/>}
     <div className="bt-go">
      <button type="button" className="j-btn dark bt-start" disabled={!rules||!!blocker||running} onClick={run}>{running?<LoaderCircle size={16} className="bt-spin"/>:<Play size={16}/>}{running?'Počítám…':'Spustit backtest'}</button>
      {running?<span className="bt-state" role="status" aria-live="polite">Načítám svíčky a počítám {settings.markets.length} {plural(settings.markets.length,['trh','trhy','trhů'])} · {elapsed} s</span>:blocker?<span className="bt-state">{blocker}</span>:dirty?<span className="bt-state">Spustí se s aktuálními (zatím neuloženými) pravidly.</span>:null}
     </div>
     {runErr&&<p className="jg-err" role="alert">{runErr}</p>}
    </section>
    <section className="j-card bt-runs"><div className="bt-thead"><h2>Uložené běhy</h2>{pick.length===2&&<button type="button" className="j-btn" disabled={busyId==='cmp'} onClick={compare}><GitCompare size={14}/>{busyId==='cmp'?'Načítám…':'Porovnat'}</button>}</div>
     {runsErr&&<p className="jg-err" role="alert">{runsErr}</p>}
     {!runs?(!runsErr&&<p className="j-muted">Načítám…</p>):!runs.length?<p className="j-muted">Zatím žádný běh. Ukládá se každý spuštěný backtest (nejvýš 50 napříč strategiemi, nejstarší se mažou).</p>:<>
      <p className="bt-help">Zaškrtni dva běhy a porovnej je vedle sebe.</p>
      <ul className="bt-runlist">{runs.map(r=>{const s=r.summary,i=idx(r.id);return <li key={r.id} className={viewId===r.id?'on':''}>
       <label className="jg-check" title="Vybrat k porovnání"><input type="checkbox" checked={i>=0} disabled={i<0&&pick.length>=2} onChange={e=>setPick(p=>e.target.checked?[...p,r.id]:p.filter(x=>x!==r.id))} aria-label={'Porovnat běh ze '+fmtDateTime(sqlMs(r.created))}/>{i>=0&&<i className={'bt-dot '+(i?'b':'a')}/>}</label>
       <button type="button" className="bt-runmain" onClick={()=>open(r.id)} disabled={busyId===r.id}>
        <span className="bt-runtop"><b>{fmtDateTime(sqlMs(r.created))}</b><span className={tone(s.netPct)}>{fmtPct(s.netPct,1,true)}</span></span>
        <span className="bt-runmeta">{marketsText(r.params.markets)} · {r.params.tf} · {fmtPeriod(r.params.from,r.params.to)}</span>
        <span className="bt-runmeta">{s.trades} {plural(s.trades,['obchod','obchody','obchodů'])} · win rate {fmtPct(s.winRate,0)} · DD {fmtNum(s.maxDrawdownPct,1)} %</span>
        <span className="bt-runmeta rules">{rulesText(r.params.rules)}</span>
       </button>
       <span className="bt-runact"><button type="button" className="bt-icon" aria-label="Otevřít běh" disabled={busyId===r.id} onClick={()=>open(r.id)}><FolderOpen size={15}/></button><button type="button" className="bt-icon" aria-label="Smazat běh" disabled={busyId===r.id} onClick={()=>remove(r)}><Trash2 size={15}/></button></span>
      </li>})}</ul></>}
    </section>
   </div>
  </div>
  <div ref={out} className="bt-out">{view?.kind==='run'?<Results key={view.run.id} run={view.run}/>:view?.kind==='compare'?<Compare runs={view.runs} onClose={()=>setView(null)}/>:null}</div>
 </div>;
}
