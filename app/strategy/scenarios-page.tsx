'use client';
// Stránka /scenare: scénáře (plán obchodu) se stavem a checklistem, vynechané obchody a stav dne.
// ?novy=<trh>&bias=&ez=&ez2=&inv=&tp=&alert= = nový scénář s předvyplněním (z detailu trhu, z grafu, z alertu); #<id> = otevřít scénář.
import {SessionCheckin,EntryCheck} from '../checkins/checkins';
import {useEffect,useMemo,useState} from 'react';
import {ScoreAt} from '../score-pit';
import {ArrowLeft,Plus,Pencil,Trash2,ChartCandlestick,CalendarClock,Bell,Ban} from 'lucide-react';
import {instruments} from '@/lib/markets';
import {matchesText} from '@/lib/market-view';
import {resolveAlias} from '@/lib/instrument-info';
import {BIASES,STATUSES,SKIP_REASONS,DAY_STATUSES,effectiveStatus,canMove,type Bias,type Status,type SkipReason,type DayStatus} from '@/lib/strategy/scenario';
import type {CheckState,PlanSnapshot} from '@/lib/strategy/core';
import {conditionLabel} from '@/lib/alerts/logic';
import {usePalette} from '../palette';
import {PositionCalculator} from '../risk/position-calculator';
import {call,useStrategies,dtText,dayText,toLocalInput,fromLocalInput,pragueDay,StatusTag,TriChecklist,PlanPicker,ImageUpload,SnapshotView,levelsText,type PlanValue,type StrategyItem,type Scenario} from './plan-ui';
import '../mt.css';
import '../alerts/alerts.css';
type NoTrade={id:string;scenarioId:string|null;instrument:string|null;direction:'long'|'short'|null;reason:SkipReason;note:string;snapshot:PlanSnapshot|null;at:number};
type AlertLite=Parameters<typeof conditionLabel>[0]&{id:string;instrument:string;active:boolean;note:string|null};
const NAME=new Map(instruments.map(i=>[i.id,i.name])),nameOf=(id:string|null)=>id?NAME.get(id)||id:'–';
const slugOf=(id:string)=>id.replace(/\//g,'-');
const chartable=(id:string)=>instruments.find(i=>i.id===id)?.group!=='currency';
const until=(at:number,now:number)=>{const m=Math.round((at-now)/60000);return m<60?`za ${m} min`:m<48*60?`za ${Math.round(m/60)} h`:`za ${Math.round(m/1440)} d`};
type Draft={id?:string;instrument:string;bias:Bias;hypothesis:string;plan:PlanValue;entryFrom:string;entryTo:string;invalidation:string;targets:string;validUntil:string;reviewAt:string;note:string;chartUrl:string;fileId:string|null;alertId:string;snapshot?:PlanSnapshot|null;status?:Status};
const numStr=(n:number|null|undefined)=>n===null||n===undefined?'':String(n);
const statesOf=(s:PlanSnapshot|null|undefined)=>s?Object.fromEntries(s.items.map(i=>[i.id,i.state])) as Record<string,CheckState>:{};
function draftFrom(s:Scenario):Draft{return {id:s.id,instrument:s.instrument,bias:s.bias,hypothesis:s.hypothesis,plan:{strategyId:s.strategyId,model:s.model,states:statesOf(s.snapshot),keepVersion:true},entryFrom:numStr(s.levels.entryFrom),entryTo:numStr(s.levels.entryTo),invalidation:numStr(s.levels.invalidation),targets:s.levels.targets.join('; '),validUntil:toLocalInput(s.validUntil),reviewAt:toLocalInput(s.reviewAt),note:s.note,chartUrl:s.chartUrl||'',fileId:s.fileId,alertId:s.alertId||'',snapshot:s.snapshot,status:s.status}}
function newDraft(q:URLSearchParams):Draft{
 const inst=q.get('novy')||'',ok=instruments.some(i=>i.id===inst),b=q.get('bias');
 return {instrument:ok?inst:'EUR/USD',bias:b==='long'||b==='short'?b:'both',hypothesis:'',plan:{strategyId:null,model:null,states:{},keepVersion:false},entryFrom:q.get('ez')||'',entryTo:q.get('ez2')||'',invalidation:q.get('inv')||'',targets:q.get('tp')||'',validUntil:toLocalInput(Date.now()+24*3600e3),reviewAt:'',note:'',chartUrl:'',fileId:null,alertId:q.get('alert')||''};
}
function payload(d:Draft){
 const keep=d.plan.keepVersion&&!!d.snapshot&&d.snapshot.strategyId===d.plan.strategyId;
 return {instrument:d.instrument,bias:d.bias,hypothesis:d.hypothesis,strategyId:d.plan.strategyId,...(keep?{}:{versionId:null}),model:d.plan.model,checklist:{states:d.plan.states},
  levels:{entryFrom:d.entryFrom,entryTo:d.entryTo,invalidation:d.invalidation,targets:d.targets.split(/[;\s]+/).filter(Boolean)},
  validUntil:fromLocalInput(d.validUntil),reviewAt:fromLocalInput(d.reviewAt),note:d.note,chartUrl:d.chartUrl.trim()||null,fileId:d.fileId,alertId:d.alertId||null};
}
function MarketSelect({value,onChange}:{value:string;onChange:(id:string)=>void}){
 const [q,setQ]=useState(''),a=q.trim()?resolveAlias(q):null,hits=instruments.filter(i=>matchesText(i.id+' '+i.name,q)),t=a?hits.find(i=>i.id===a.id):undefined,list=t?[t,...hits.filter(i=>i!==t)]:hits;
 return <span className="sg-mselect"><input type="search" placeholder="Hledat trh…" aria-label="Hledat trh" value={q} onChange={e=>{setQ(e.target.value);const f=list[0];if(e.target.value.trim()&&f)onChange(f.id)}}/>
  <select value={value} aria-label="Trh" onChange={e=>onChange(e.target.value)}>{(list.length?list:instruments).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}{!list.some(i=>i.id===value)&&<option value={value}>{nameOf(value)}</option>}</select></span>;
}
function ScenarioForm({draft,strategies,onSaved,onCancel}:{draft:Draft;strategies:StrategyItem[];onSaved:(s:Scenario)=>void;onCancel:()=>void}){
 const [d,setD]=useState(draft),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[alerts,setAlerts]=useState<AlertLite[]>([]),[calc,setCalc]=useState(false);
 useEffect(()=>{let live=true;call<{alerts:AlertLite[]}>('/api/alerts?instrument='+encodeURIComponent(d.instrument)).then(j=>{if(live)setAlerts(j.alerts)}).catch(()=>{});return()=>{live=false}},[d.instrument]);
 const set=(p:Partial<Draft>)=>setD(x=>({...x,...p}));
 async function save(){setBusy(true);setErr('');try{const j=d.id?await call<{scenario:Scenario}>('/api/scenarios/'+d.id,'PATCH',payload(d)):await call<{scenario:Scenario}>('/api/scenarios','POST',payload(d));onSaved(j.scenario)}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 return <section className="mt-card sg-form" id="sg-form"><h2>{d.id?'Upravit scénář':'Nový scénář'}</h2>
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  <div className="sg-row"><label className="sg-field"><span>Trh</span><MarketSelect value={d.instrument} onChange={v=>set({instrument:v,alertId:''})}/></label>
   <div className="sg-field"><span>Směr</span><div className="mt-chips" role="radiogroup" aria-label="Směr">{(Object.keys(BIASES) as Bias[]).map(b=><button key={b} type="button" role="radio" aria-checked={d.bias===b} className={d.bias===b?'active':''} onClick={()=>set({bias:b})}>{BIASES[b]}</button>)}</div></div></div>
  <label className="sg-field"><span>Hypotéza</span><textarea rows={3} maxLength={1000} value={d.hypothesis} placeholder="Favorizuji long, pokud cena udrží zónu a potvrdí ji svíčka na H1…" onChange={e=>set({hypothesis:e.target.value})}/></label>
  <PlanPicker strategies={strategies} value={d.plan} snapshot={d.snapshot} onChange={plan=>set({plan})}/>
  <div className="sg-row">
   <label className="sg-field"><span>Zóna vstupu od</span><input inputMode="decimal" value={d.entryFrom} onChange={e=>set({entryFrom:e.target.value})}/></label>
   <label className="sg-field"><span>do</span><input inputMode="decimal" value={d.entryTo} onChange={e=>set({entryTo:e.target.value})}/></label>
   <label className="sg-field"><span>Invalidace</span><input inputMode="decimal" value={d.invalidation} onChange={e=>set({invalidation:e.target.value})}/></label>
   <label className="sg-field"><span>Cíle (oddělené ;)</span><input value={d.targets} onChange={e=>set({targets:e.target.value})}/></label>
  </div>
  {/* kalkulačka pozice (Etapa 1B) předvyplněná ze scénáře: vstup = střed zóny, stop = invalidace, cíl = první cíl; načte se až po rozbalení */}
  <details className="sg-calc" onToggle={e=>setCalc((e.target as HTMLDetailsElement).open)}><summary>Velikost pozice</summary>{calc&&(()=>{const n=(v:string)=>{const x=Number(v.replace(',','.').replace(/\s/g,''));return v.trim()&&Number.isFinite(x)?x:undefined},a=n(d.entryFrom),b=n(d.entryTo),entry=a!==undefined&&b!==undefined?(a+b)/2:a??b,stop=n(d.invalidation),target=n(d.targets.split(/[;\s]+/)[0]||'');
   return <PositionCalculator key={[d.instrument,entry,stop,target].join('|')} title={false} initial={{market:d.instrument,entry,stop,target}}/>})()}</details>
  <div className="sg-row">
   <label className="sg-field"><span>Platí do</span><input type="datetime-local" value={d.validUntil} onChange={e=>set({validUntil:e.target.value})}/></label>
   <label className="sg-field"><span>Přehodnotit</span><input type="datetime-local" value={d.reviewAt} onChange={e=>set({reviewAt:e.target.value})}/></label>
   <label className="sg-field"><span>Alert (upozornění otevře scénář)</span><select value={d.alertId} onChange={e=>set({alertId:e.target.value})}><option value="">Bez alertu</option>{alerts.map(a=><option key={a.id} value={a.id}>{conditionLabel(a,nameOf(a.instrument))}{a.note?' · '+a.note:''}{a.active?'':' (neaktivní)'}</option>)}{d.alertId&&!alerts.some(a=>a.id===d.alertId)&&<option value={d.alertId}>Propojený alert</option>}</select></label>
  </div>
  <div className="sg-row"><label className="sg-field grow"><span>Odkaz na graf (nepovinné)</span><input type="url" value={d.chartUrl} placeholder="https://…" onChange={e=>set({chartUrl:e.target.value})}/></label><ImageUpload fileId={d.fileId} onChange={fileId=>set({fileId})}/></div>
  <label className="sg-field"><span>Poznámka</span><textarea rows={2} maxLength={2000} value={d.note} onChange={e=>set({note:e.target.value})}/></label>
  {d.id&&<EntryCheck scenarioId={d.id} compact/>}
  <div className="sg-row"><button type="button" className="al-btn primary" disabled={busy} onClick={save}>{busy?'Ukládám…':d.id?'Uložit':'Vytvořit scénář'}</button><button type="button" className="al-btn" onClick={onCancel}>Zrušit</button></div>
 </section>;
}
// Vynechaný obchod: ze scénáře (převezme trh, směr a checklist) nebo samostatně
function SkipForm({scenario,strategies,onSaved,onCancel}:{scenario:Scenario|null;strategies:StrategyItem[];onSaved:()=>void;onCancel:()=>void}){
 const [reason,setReason]=useState<SkipReason|null>(null),[note,setNote]=useState(''),[inst,setInst]=useState(scenario?.instrument||''),[dir,setDir]=useState<''|'long'|'short'>(scenario&&scenario.bias!=='both'?scenario.bias:''),[states,setStates]=useState<Record<string,CheckState>>(statesOf(scenario?.snapshot)),[plan,setPlan]=useState<PlanValue>({strategyId:null,model:null,states:{},keepVersion:false}),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 async function save(){if(!reason){setErr('Vyber důvod.');return}setBusy(true);setErr('');try{
  await call('/api/no-trades','POST',scenario?{scenarioId:scenario.id,reason,note,direction:dir||null,...(scenario.snapshot?{checklist:{states}}:{})}:{reason,note,instrument:inst||null,direction:dir||null,...(plan.strategyId?{strategyId:plan.strategyId,model:plan.model,checklist:{states:plan.states}}:{})});onSaved()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 return <section className="mt-card sg-form" id="sg-skip"><h2><Ban size={16}/> Vynechaný obchod{scenario?` · ${nameOf(scenario.instrument)}`:''}</h2>
  <p className="mt-lead">Vynechat obchod je legitimní výsledek. Zapiš proč – bez P&amp;L, započítá se do dodržování plánu.</p>
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  <div className="sg-field"><span>Důvod</span><div className="sg-chips">{(Object.keys(SKIP_REASONS) as SkipReason[]).map(r=><button key={r} type="button" className={'sg-chip'+(reason===r?' on':'')} aria-pressed={reason===r} onClick={()=>setReason(r)}>{SKIP_REASONS[r]}</button>)}</div></div>
  <div className="sg-row">{!scenario&&<label className="sg-field"><span>Trh (nepovinné)</span><select value={inst} onChange={e=>setInst(e.target.value)}><option value="">–</option>{instruments.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
   <label className="sg-field"><span>Směr</span><select value={dir} onChange={e=>setDir(e.target.value as ''|'long'|'short')}><option value="">–</option><option value="long">Long</option><option value="short">Short</option></select></label></div>
  {scenario?.snapshot?<TriChecklist items={scenario.snapshot.items} states={states} onChange={(id,s)=>setStates(x=>({...x,[id]:s}))}/>:!scenario&&<PlanPicker strategies={strategies} value={plan} onChange={setPlan}/>}
  <label className="sg-field"><span>Poznámka</span><textarea rows={2} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
  <div className="sg-row"><button type="button" className="al-btn primary" disabled={busy} onClick={save}>{busy?'Ukládám…':'Zapsat vynechaný obchod'}</button><button type="button" className="al-btn" onClick={onCancel}>Zrušit</button></div>
 </section>;
}
export function DayStatusCard(){
 const today=pragueDay(Date.now()),[status,setStatus]=useState<DayStatus|null>(null),[note,setNote]=useState(''),[msg,setMsg]=useState('');
 useEffect(()=>{call<{days:{day:string;status:DayStatus;note:string}[]}>('/api/day-status?from='+today+'&to='+today).then(j=>{const d=j.days[0];if(d){setStatus(d.status);setNote(d.note)}}).catch(()=>{})},[today]);
 async function save(s:DayStatus|null,n=note){setStatus(s);setMsg('');try{await call('/api/day-status','PUT',{day:today,status:s,note:n});setMsg(s?'Uloženo':'Zrušeno')}catch(e){setMsg((e as Error).message)}}
 return <section className="mt-card sg-day"><h2>Dnešní den</h2><p className="mt-lead">Nic se nenabízí? Čekání, vynechání i pauza jsou plnohodnotný záznam v deníku.</p>
  <div className="sg-row"><div className="mt-chips" role="radiogroup" aria-label="Stav dne">{(Object.keys(DAY_STATUSES) as DayStatus[]).map(s=><button key={s} type="button" role="radio" aria-checked={status===s} className={status===s?'active':''} onClick={()=>save(status===s?null:s)}>{DAY_STATUSES[s]}</button>)}</div>
   {status&&<input type="text" className="sg-daynote" maxLength={500} value={note} placeholder="Poznámka ke dni" aria-label="Poznámka ke dni" onChange={e=>setNote(e.target.value)} onBlur={()=>save(status,note)}/>}<span className="sg-muted" role="status">{msg}</span></div></section>;
}
export default function ScenariosPage(){
 usePalette();
 const {list:strategies}=useStrategies(true);
 const [scoreOpen,setScoreOpen]=useState<string|null>(null);
 const [items,setItems]=useState<Scenario[]|null>(null),[events,setEvents]=useState<Record<string,{at:number;title:string}>>({}),[windows,setWindows]=useState<Record<string,{title:string;at:number;source:string}[]>>({}),[scope,setScope]=useState<'open'|'closed'|'all'>('open'),[error,setError]=useState(''),[msg,setMsg]=useState('');
 const [form,setForm]=useState<Draft|null>(null),[skip,setSkip]=useState<Scenario|null|false>(false),[focus,setFocus]=useState<string|null>(null),[skips,setSkips]=useState<NoTrade[]>([]),[now,setNow]=useState(()=>Date.now());
 async function load(){try{const j=await call<{scenarios:Scenario[];events:Record<string,{at:number;title:string}>;windows?:Record<string,{title:string;at:number;source:string}[]>;now:number}>('/api/scenarios?scope=all');setItems(j.scenarios);setEvents(j.events);setWindows(j.windows||{});setNow(j.now);setError('')}catch(e){setError((e as Error).message)}}
 async function loadSkips(){try{const from=pragueDay(Date.now()-30*864e5);const j=await call<{noTrades:NoTrade[]}>('/api/no-trades?from='+from);setSkips(j.noTrades)}catch{}}
 useEffect(()=>{load();loadSkips();
  const q=new URLSearchParams(location.search);if(q.get('novy')){setForm(newDraft(q));history.replaceState(null,'',location.pathname+location.hash)}
  const f=()=>{const h=location.hash.slice(1);setFocus(/^scn_/.test(h)?h:null)};f();addEventListener('hashchange',f);return()=>removeEventListener('hashchange',f)},[]);
 useEffect(()=>{if(focus&&items){const s=items.find(x=>x.id===focus);if(s){setScope(OPENISH(s,now)?'open':'closed');setTimeout(()=>document.getElementById(focus)?.scrollIntoView({behavior:'smooth',block:'center'}),50)}}},[focus,items]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(form||skip!==false)setTimeout(()=>document.getElementById(form?'sg-form':'sg-skip')?.scrollIntoView({behavior:'smooth',block:'start'}),30)},[form,skip]);
 const shown=useMemo(()=>(items||[]).filter(s=>scope==='all'||(scope==='open')===OPENISH(s,now)),[items,scope,now]);
 const counts=useMemo(()=>{const o=(items||[]).filter(s=>OPENISH(s,now)).length;return {open:o,closed:(items||[]).length-o,all:(items||[]).length}},[items,now]);
 async function move(s:Scenario,to:Status){setMsg('');try{await call('/api/scenarios/'+s.id,'PATCH',{status:to});await load()}catch(e){setMsg((e as Error).message)}}
 async function del(s:Scenario){if(!confirm(`Smazat scénář ${nameOf(s.instrument)}?`))return;try{await call('/api/scenarios/'+s.id,'DELETE');await load()}catch(e){setMsg((e as Error).message)}}
 async function delSkip(n:NoTrade){if(!confirm('Smazat vynechaný obchod?'))return;try{await call('/api/no-trades','DELETE',{id:n.id});await loadSkips()}catch(e){setMsg((e as Error).message)}}
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main sg-main">
   <div className="al-page-head"><h1>Scénáře</h1>{items&&<span className="al-tag">{counts.open} otevřených</span>}</div>
   <p className="mt-lead">Plán obchodu předem: hypotéza, strategie a verze, úrovně, platnost a checklist. Když se podmínky nesejdou, obchod vynech – i to se počítá.</p>
   <p className="sg-links"><a href="/strategie">Strategie (playbook) →</a> · <a href="/alerty">Alerty →</a></p>
   <DayStatusCard/>
   <SessionCheckin/>
   <div className="sg-row sg-actions"><button type="button" className="al-btn primary" onClick={()=>{setSkip(false);setForm(newDraft(new URLSearchParams()))}}><Plus size={15}/>Nový scénář</button><button type="button" className="al-btn" onClick={()=>{setForm(null);setSkip(null)}}><Ban size={15}/>Vynechaný obchod</button></div>
   {form&&strategies&&<ScenarioForm key={form.id||'new'} draft={form} strategies={strategies} onCancel={()=>setForm(null)} onSaved={s=>{setForm(null);load();location.hash=s.id}}/>}
   {skip!==false&&strategies&&<SkipForm key={skip?skip.id:'free'} scenario={skip} strategies={strategies} onCancel={()=>setSkip(false)} onSaved={()=>{setSkip(false);load();loadSkips();setMsg('Vynechaný obchod zapsán.')}}/>}
   <section className="mt-card">
    <div className="al-filters"><div className="mt-chips" role="radiogroup" aria-label="Stav">{([['open','Otevřené'],['closed','Uzavřené'],['all','Vše']] as const).map(([k,l])=><button key={k} type="button" role="radio" aria-checked={scope===k} className={scope===k?'active':''} onClick={()=>setScope(k)}>{l} <small>({counts[k]})</small></button>)}</div></div>
    {msg&&<p className="sg-muted" role="status">{msg}</p>}
    {error&&<p className="mt-alert" role="alert">{error}</p>}
    {!items?<p className="mt-empty">Načítám…</p>:!shown.length?<p className="mt-empty">{scope==='open'?'Žádný otevřený scénář. Založ ho tlačítkem výše, v detailu trhu nebo z grafu.':'Nic tu není.'}</p>:
    <ul className="sg-list">{shown.map(s=>{const st=effectiveStatus(s,now),ev=events[s.id],v=s.snapshot?.eval;
     return <li key={s.id} id={s.id} className={'sg-card'+(focus===s.id?' focus':'')+(v?.verdict==='blocked'?' blocked':'')}>
      <div className="sg-card-top"><b>{nameOf(s.instrument)}</b><span className={'sg-bias '+s.bias}>{BIASES[s.bias]}</span><StatusTag status={st}/>
       {v&&<span className={'sg-mini '+v.verdict} title="Checklist">{v.verdict==='blocked'?`✗ povinná nesplněna (${v.requiredUnmet})`:v.verdict==='incomplete'?`? povinná nevím (${v.requiredUnknown})`:'✓ povinné OK'}{v.supportiveTotal?` · podpůrné ${v.supportiveMet}/${v.supportiveTotal}`:''}</span>}
       {windows[s.id]?.length>0&&<span className="sg-mini blocked" title={windows[s.id].map(w=>`${w.title} · ${dtText(w.at)} · ${w.source}`).join('\n')}>⚠ no-trade okno: {windows[s.id][0].title} {dtText(windows[s.id][0].at)}</span>}
       <span className="al-item-actions">
        {chartable(s.instrument)&&<a className="al-btn sm" href={'/graf/'+encodeURIComponent(slugOf(s.instrument))}><ChartCandlestick size={14}/>Graf</a>}
        <button type="button" className="al-btn sm" onClick={()=>{setSkip(false);setForm(draftFrom(s))}}><Pencil size={14}/>Upravit</button>
        <button type="button" className="al-btn sm danger" aria-label="Smazat scénář" onClick={()=>del(s)}><Trash2 size={14}/></button>
       </span></div>
      <p className="sg-hyp">{s.hypothesis}</p>
      <div className="al-meta"><span>{s.strategyName?`${s.strategyName} · v${s.version??'?'}${s.model?' · '+s.model:''}`:'bez strategie'}</span><span>{levelsText(s.levels)}</span><span>{s.validUntil?(st==='expired'?'vypršel ':'platí do ')+dtText(s.validUntil):'bez omezení platnosti'}</span>{s.reviewAt&&<span><CalendarClock size={12}/> přehodnotit {dtText(s.reviewAt)}</span>}{ev&&<span className="sg-event">Zpráva: <b>{ev.title}</b> {until(ev.at,now)}</span>}{s.alertId&&<span><Bell size={12}/> s alertem</span>}{s.trades>0&&<span>{s.trades} {s.trades===1?'obchod':'obchody'}</span>}<span>založen {dayText(s.created)}</span></div>
      {s.note&&<p className="al-note">{s.note}</p>}
      {focus===s.id||scoreOpen===s.id?<ScoreAt market={s.instrument} t={s.created} title="Skóre při založení scénáře"/>:<button type="button" className="al-link" onClick={()=>setScoreOpen(s.id)}>Skóre při založení</button>}
      {focus===s.id&&s.snapshot&&<SnapshotView snap={s.snapshot}/>}
      {focus!==s.id&&s.snapshot&&<button type="button" className="al-link" onClick={()=>{location.hash=s.id}}>Zobrazit checklist</button>}
      {st==='active'&&<EntryCheck scenarioId={s.id} compact/>}
      <div className="sg-moves">{(['active','entered','invalidated','waiting'] as Status[]).filter(t=>t!==st&&canMove(st,t)&&!(t==='waiting'&&s.validUntil!==null&&s.validUntil<=now)).map(t=><button key={t} type="button" className="al-btn sm" onClick={()=>move(s,t)}>{t==='waiting'&&st!=='active'?'Znovu otevřít':t==='entered'?'Vstoupeno':STATUSES[t]}</button>)}
       {canMove(st,'skipped')&&st!=='skipped'&&<button type="button" className="al-btn sm" onClick={()=>{setForm(null);setSkip(s)}}><Ban size={13}/>Vynechat</button>}</div>
     </li>})}</ul>}
   </section>
   <section className="mt-card"><h2>Vynechané obchody · 30 dní</h2>
    {!skips.length?<p className="mt-empty">Zatím žádný vynechaný obchod.</p>:<ul className="sg-skips">{skips.map(n=><li key={n.id}><span>{dtText(n.at)}</span><b>{SKIP_REASONS[n.reason]}</b><span>{n.instrument?nameOf(n.instrument):'–'}{n.direction?' · '+BIASES[n.direction]:''}</span>{n.snapshot&&<span className={'sg-mini '+n.snapshot.eval.verdict}>{n.snapshot.strategyName} v{n.snapshot.version}</span>}{n.note&&<span className="sg-muted">{n.note}</span>}{n.scenarioId&&<a href={'#'+n.scenarioId}>scénář</a>}<button type="button" className="sg-icon" aria-label="Smazat" onClick={()=>delSkip(n)}><Trash2 size={13}/></button></li>)}</ul>}
   </section>
  </main>
 </div>;
}
const OPENISH=(s:{status:Status;validUntil:number|null},now:number)=>{const st=effectiveStatus(s,now);return st==='waiting'||st==='active'};
