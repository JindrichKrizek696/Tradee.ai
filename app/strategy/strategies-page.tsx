'use client';
// Stránka /strategie: playbook strategií s verzemi. 8 bloků (text + podmínky s rolí, modelem a příklady), historie verzí s popisem změn.
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ArrowUp,ArrowDown,Plus,X,History,Lock} from 'lucide-react';
import {instruments,groups} from '@/lib/markets';
import {matchesText} from '@/lib/market-view';
import {BLOCKS,BLOCK_HINT,ROLES,ORIGINS,STYLES,SESSIONS,TIMEFRAMES,WEEKDAYS,LIMITS,emptyContent,conditionCount,type BlockId,type Condition,type Content,type Example,type Origin,type Role} from '@/lib/strategy/core';
import {usePalette} from '../palette';
import {call,useStrategies,dtText,originText,ImageUpload,type StrategyItem} from './plan-ui';
import '../mt.css';
import '../alerts/alerts.css';
type Version={id:string;version:number;content:Content;changelog:string|null;created:number;updated:number;usage:{trades:number;scenarios:number;skips:number};locked:boolean};
const hashId=()=>{const h=location.hash.slice(1);return /^str_[a-z0-9]+$/.test(h)?h:null};
const move=<T,>(a:T[],i:number,d:number)=>{const k=i+d;if(k<0||k>=a.length)return a;const b=[...a];[b[i],b[k]]=[b[k],b[i]];return b};
const usageText=(u:Version['usage'])=>[u.trades&&`${u.trades} obch.`,u.scenarios&&`${u.scenarios} scén.`,u.skips&&`${u.skips} vynech.`].filter(Boolean).join(', ');
function MarketsBox({value,onChange}:{value:string[];onChange:(v:string[])=>void}){
 const [q,setQ]=useState(''),sel=new Set(value),shown=instruments.filter(i=>matchesText(i.id+' '+i.name,q)).slice(0,80);
 return <div className="sg-markets"><div className="sg-chips">{value.map(id=><span key={id} className="sg-chip on">{instruments.find(i=>i.id===id)?.name||id}<button type="button" aria-label={'Odebrat '+id} onClick={()=>onChange(value.filter(x=>x!==id))}><X size={11}/></button></span>)}{!value.length&&<span className="sg-muted">Všechny trhy</span>}</div>
  <input type="search" placeholder="Přidat trh: eur, gold, nq…" value={q} onChange={e=>setQ(e.target.value)} aria-label="Hledat trh"/>
  {q.trim()&&<ul className="sg-mlist">{shown.map(i=><li key={i.id}><label><input type="checkbox" checked={sel.has(i.id)} onChange={()=>onChange(sel.has(i.id)?value.filter(x=>x!==i.id):[...value,i.id].slice(0,LIMITS.markets))}/>{i.name} <small>{groups[i.group]}</small></label></li>)}</ul>}
 </div>;
}
const toggle=<T,>(a:T[],v:T)=>a.includes(v)?a.filter(x=>x!==v):[...a,v];
function ConditionRow({c,i,n,models,onChange,onMove,onRemove}:{c:Condition;i:number;n:number;models:string[];onChange:(c:Condition)=>void;onMove:(d:number)=>void;onRemove:()=>void}){
 const [open,setOpen]=useState(false);
 const ex=(kind:Example['kind'],k:number)=>c.examples.filter(e=>e.kind===kind)[k]??{kind,text:'',fileId:null};
 // tři pevná místa (2 platné + 1 neplatný); prázdná místa zahodí až server
 const setEx=(slot:number,e:Example)=>{const s=[ex('valid',0),ex('valid',1),ex('invalid',0)];s[slot]=e;onChange({...c,examples:s})};
 return <li className={'sg-cond '+c.role}>
  <div className="sg-cond-main">
   <input type="text" value={c.text} maxLength={LIMITS.cond} placeholder={`Podmínka ${i+1}`} aria-label={`Podmínka ${i+1}`} onChange={e=>onChange({...c,text:e.target.value})}/>
   <select value={c.role} aria-label="Role podmínky" onChange={e=>onChange({...c,role:e.target.value as Role})}>{Object.entries(ROLES).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
   {models.length>0&&<select value={c.model||''} aria-label="Vstupní model" onChange={e=>onChange({...c,model:e.target.value||null})}><option value="">Všechny modely</option>{models.map(m=><option key={m} value={m}>{m}</option>)}</select>}
   <button type="button" className="al-btn sm" aria-expanded={open} onClick={()=>setOpen(!open)}>Příklady{c.examples.filter(e=>e.text.trim()||e.fileId).length?` (${c.examples.filter(e=>e.text.trim()||e.fileId).length})`:''}</button>
   <button type="button" className="sg-icon" aria-label="Nahoru" disabled={i===0} onClick={()=>onMove(-1)}><ArrowUp size={14}/></button>
   <button type="button" className="sg-icon" aria-label="Dolů" disabled={i===n-1} onClick={()=>onMove(1)}><ArrowDown size={14}/></button>
   <button type="button" className="sg-icon" aria-label="Odebrat podmínku" onClick={onRemove}><X size={14}/></button>
  </div>
  {open&&<div className="sg-examples">{([['valid',0,'Platný příklad 1'],['valid',1,'Platný příklad 2'],['invalid',0,'Neplatný příklad']] as const).map(([kind,k,l],slot)=>{const e=ex(kind,k);return <div key={kind+k} className={'sg-ex '+kind}>
   <span>{l}</span><input type="text" value={e.text} maxLength={LIMITS.example} placeholder={kind==='valid'?'Jak vypadá správně…':'Co už podmínku nesplňuje…'} onChange={x=>setEx(slot,{...e,text:x.target.value})}/>
   <ImageUpload fileId={e.fileId} label="Obrázek" onChange={id=>setEx(slot,{...e,fileId:id})}/></div>})}</div>}
 </li>;
}
function Editor({s,onSaved}:{s:StrategyItem;onSaved:()=>void}){
 const [versions,setVersions]=useState<Version[]|null>(null),[c,setC]=useState<Content>(emptyContent()),[base,setBase]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[err,setErr]=useState(''),[view,setView]=useState<Version|null>(null);
 const [name,setName]=useState(s.name),[origin,setOrigin]=useState<Origin>(s.origin),[mentor,setMentor]=useState(s.mentor||''),[model,setModel]=useState('');
 async function load(){try{const j=await call<{versions:Version[]}>('/api/strategies/'+s.id+'/versions');setVersions(j.versions);const cur=j.versions[0]?.content??emptyContent();setC(cur);setBase(JSON.stringify(cur));setErr('')}catch(e){setErr((e as Error).message)}}
 useEffect(()=>{load();setName(s.name);setOrigin(s.origin);setMentor(s.mentor||'')},[s.id]);// eslint-disable-line react-hooks/exhaustive-deps
 const latest=versions?.[0],dirty=JSON.stringify(c)!==base;
 const setBlock=(b:BlockId,f:(x:Content['blocks'][BlockId])=>Content['blocks'][BlockId])=>setC(x=>({...x,blocks:{...x.blocks,[b]:f(x.blocks[b])}}));
 const addCond=(b:BlockId)=>setBlock(b,x=>({...x,conditions:[...x.conditions,{id:'',text:'',role:b==='review'?'note':'required',model:null,examples:[]}]}));
 async function save(){setBusy(true);setErr('');setMsg('');try{
  const r=await call<{action:string;version:number}>('/api/strategies/'+s.id+'/versions','PUT',{content:c,changelog:note});
  setMsg(r.action==='create'?`Uloženo jako nová verze v${r.version}.`:r.action==='update'?`Verze v${r.version} upravena.`:'Beze změny.');setNote('');await load();onSaved()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 async function meta(body:Record<string,unknown>){setErr('');try{await call('/api/strategies','PATCH',{id:s.id,...body});onSaved()}catch(e){setErr((e as Error).message)}}
 useEffect(()=>{const f=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue=''}};addEventListener('beforeunload',f);return()=>removeEventListener('beforeunload',f)},[dirty]);
 if(!versions)return <section className="mt-card">{err?<p className="mt-alert" role="alert">{err}</p>:<p className="mt-empty">Načítám…</p>}</section>;
 return <>
  <section className="mt-card">
   <div className="sg-head"><h2>{s.name}</h2>{latest&&<span className="al-tag">v{latest.version}{latest.locked&&<> · <Lock size={10}/> použitá</>}</span>}<span className="sg-muted">{originText(s.origin,s.mentor)}{s.fromChecklist?' · převedeno z checklistu':''}</span></div>
   <div className="sg-row">
    <label className="sg-field"><span>Název</span><input type="text" value={name} maxLength={60} onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()&&name.trim()!==s.name)meta({name})}}/></label>
    <label className="sg-field"><span>Původ</span><select value={origin} onChange={e=>{const o=e.target.value as Origin;setOrigin(o);meta({origin:o,mentor})}}>{Object.entries(ORIGINS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
    {origin==='mentor'&&<label className="sg-field"><span>Mentor (nepovinné)</span><input type="text" value={mentor} maxLength={LIMITS.mentor} onChange={e=>setMentor(e.target.value)} onBlur={()=>meta({origin,mentor})}/></label>}
    <button type="button" className="al-btn sm" onClick={()=>meta({archived:!s.archived})}>{s.archived?'Obnovit':'Archivovat'}</button>
   </div>
   <div className="sg-models"><b>Vstupní modely</b><span className="sg-muted">Jedna strategie může mít víc vstupů (např. průraz / pullback), každý s vlastními podmínkami.</span>
    <div className="sg-chips">{c.models.map(m=><span key={m} className="sg-chip on">{m}<button type="button" aria-label={'Odebrat model '+m} onClick={()=>setC(x=>({...x,models:x.models.filter(y=>y!==m),blocks:Object.fromEntries(Object.entries(x.blocks).map(([k,b])=>[k,{...b,conditions:b.conditions.map(cc=>cc.model===m?{...cc,model:null}:cc)}])) as Content['blocks']}))}><X size={11}/></button></span>)}
     {c.models.length<LIMITS.models&&<form className="sg-inline" onSubmit={e=>{e.preventDefault();const m=model.trim();if(m&&!c.models.some(x=>x.toLowerCase()===m.toLowerCase())){setC(x=>({...x,models:[...x.models,m]}));setModel('')}}}><input type="text" value={model} maxLength={LIMITS.model} placeholder="Model 1, průraz…" aria-label="Nový vstupní model" onChange={e=>setModel(e.target.value)}/><button type="submit" className="al-btn sm"><Plus size={13}/>Model</button></form>}</div></div>
  </section>
  {BLOCKS.map(([b,label])=><section key={b} className="mt-card sg-block">
   <h2>{label}</h2><p className="mt-lead">{BLOCK_HINT[b]}</p>
   {b==='scope'&&<div className="sg-scope">
    <div className="sg-field"><span>Trhy</span><MarketsBox value={c.scope.markets} onChange={v=>setC(x=>({...x,scope:{...x.scope,markets:v}}))}/></div>
    <div className="sg-field"><span>Časové rámce</span><div className="sg-chips">{TIMEFRAMES.map(t=><button key={t} type="button" className={'sg-chip'+(c.scope.timeframes.includes(t)?' on':'')} aria-pressed={c.scope.timeframes.includes(t)} onClick={()=>setC(x=>({...x,scope:{...x.scope,timeframes:TIMEFRAMES.filter(y=>toggle(x.scope.timeframes,t).includes(y))}}))}>{t}</button>)}</div></div>
    <div className="sg-field"><span>Seance</span><div className="sg-chips">{Object.entries(SESSIONS).map(([k,l])=><button key={k} type="button" className={'sg-chip'+(c.scope.sessions.includes(k)?' on':'')} aria-pressed={c.scope.sessions.includes(k)} onClick={()=>setC(x=>({...x,scope:{...x.scope,sessions:Object.keys(SESSIONS).filter(y=>toggle(x.scope.sessions,k).includes(y))}}))}>{l}</button>)}</div></div>
    <label className="sg-field"><span>Styl</span><select value={c.scope.style||''} onChange={e=>setC(x=>({...x,scope:{...x.scope,style:(e.target.value||null) as Content['scope']['style']}}))}><option value="">Neuvedeno</option>{Object.entries(STYLES).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
   </div>}
   {b==='notrade'&&<div className="sg-scope">
    <div className="sg-row"><label className="sg-field"><span>Zprávy: minut před</span><input type="number" min={0} max={LIMITS.newsMin} value={c.noTrade.newsBefore??''} onChange={e=>setC(x=>({...x,noTrade:{...x.noTrade,newsBefore:e.target.value===''?null:Math.max(0,Math.min(LIMITS.newsMin,Number(e.target.value)))}}))}/></label>
     <label className="sg-field"><span>minut po</span><input type="number" min={0} max={LIMITS.newsMin} value={c.noTrade.newsAfter??''} onChange={e=>setC(x=>({...x,noTrade:{...x.noTrade,newsAfter:e.target.value===''?null:Math.max(0,Math.min(LIMITS.newsMin,Number(e.target.value)))}}))}/></label></div>
    <div className="sg-field"><span>Neobchoduji ve dnech</span><div className="sg-chips">{WEEKDAYS.map((w,k)=><button key={w} type="button" className={'sg-chip'+(c.noTrade.days.includes(k+1)?' on':'')} aria-pressed={c.noTrade.days.includes(k+1)} onClick={()=>setC(x=>({...x,noTrade:{...x.noTrade,days:toggle(x.noTrade.days,k+1).sort()}}))}>{w}</button>)}</div></div>
   </div>}
   <textarea className="sg-text" rows={3} maxLength={LIMITS.text} value={c.blocks[b].text} placeholder="Popis vlastními slovy…" aria-label={'Text bloku '+label} onChange={e=>setBlock(b,x=>({...x,text:e.target.value}))}/>
   <ul className="sg-conds">{c.blocks[b].conditions.map((cd,i,all)=><ConditionRow key={cd.id||'n'+i} c={cd} i={i} n={all.length} models={c.models} onChange={v=>setBlock(b,x=>({...x,conditions:x.conditions.map((y,k)=>k===i?v:y)}))} onMove={d=>setBlock(b,x=>({...x,conditions:move(x.conditions,i,d)}))} onRemove={()=>setBlock(b,x=>({...x,conditions:x.conditions.filter((_,k)=>k!==i)}))}/>)}</ul>
   <button type="button" className="al-btn sm" disabled={c.blocks[b].conditions.length>=LIMITS.conds||conditionCount(c)>=LIMITS.totalConds} onClick={()=>addCond(b)}><Plus size={13}/>{b==='review'?'Otázka':'Podmínka'}</button>
  </section>)}
  <section className="mt-card sg-savebar">
   {err&&<p className="mt-alert" role="alert">{err}</p>}
   {latest?.locked&&dirty&&<p className="sg-muted">Verze v{latest.version} je použitá ({usageText(latest.usage)}) – zůstane beze změny a uložení vytvoří <b>v{latest.version+1}</b>. Staré obchody a scénáře si nechají svou verzi.</p>}
   <div className="sg-row">{latest?.locked&&<label className="sg-field grow"><span>Co se mění (povinné u nové verze)</span><input type="text" value={note} maxLength={LIMITS.changelog} placeholder="např. přidaná podmínka objemu" onChange={e=>setNote(e.target.value)}/></label>}
    <button type="button" className="al-btn primary" disabled={busy||!dirty} onClick={save}>{busy?'Ukládám…':latest?.locked?'Uložit jako novou verzi':'Uložit'}</button>
    {dirty&&<button type="button" className="al-btn" onClick={()=>setC(JSON.parse(base))}>Zahodit změny</button>}
    <span className="sg-muted" role="status">{msg}</span></div>
  </section>
  <section className="mt-card"><h2><History size={16}/> Historie verzí</h2>
   <ul className="sg-versions">{versions.map(v=><li key={v.id}><b>v{v.version}</b><span>{dtText(v.created)}</span><span className="sg-vnote">{v.changelog||'–'}</span><span className="sg-muted">{v.locked?<><Lock size={11}/> {usageText(v.usage)}</>:'nepoužitá'}</span><button type="button" className="al-btn sm" onClick={()=>setView(view?.id===v.id?null:v)}>{view?.id===v.id?'Skrýt':'Zobrazit'}</button>
    {view?.id===v.id&&<div className="sg-vview">{BLOCKS.map(([k,l])=>{const bl=v.content.blocks[k];return bl.text||bl.conditions.length?<div key={k}><h4>{l}</h4>{bl.text&&<p>{bl.text}</p>}<ul>{bl.conditions.map(x=><li key={x.id}><small className={'sg-role '+x.role}>{ROLES[x.role]}</small> {x.text}{x.model&&<em className="sg-chip">{x.model}</em>}</li>)}</ul></div>:null})}</div>}</li>)}</ul>
  </section>
 </>;
}
export default function StrategiesPage(){
 usePalette();
 const {list,error,reload}=useStrategies(false),[sel,setSel]=useState<string|null>(null),[name,setName]=useState(''),[origin,setOrigin]=useState<Origin>('own'),[mentor,setMentor]=useState(''),[err,setErr]=useState('');
 useEffect(()=>{setSel(hashId());const f=()=>setSel(hashId());addEventListener('hashchange',f);return()=>removeEventListener('hashchange',f)},[]);
 const cur=useMemo(()=>list?.find(s=>s.id===sel)??null,[list,sel]);
 async function add(){setErr('');try{const j=await call<{id:string}>('/api/strategies','POST',{name,origin,mentor});setName('');setMentor('');await reload();location.hash=j.id}catch(e){setErr((e as Error).message)}}
 const active=(list||[]).filter(s=>!s.archived),arch=(list||[]).filter(s=>s.archived);
 const row=(s:StrategyItem)=><li key={s.id}><a href={'#'+s.id} className={s.id===sel?'on':''}><b>{s.name}</b><small>{s.latest?'v'+s.latest.version:'–'} · {originText(s.origin,s.mentor)}</small></a></li>;
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main sg-main">
   <h1>Strategie</h1>
   <p className="mt-lead">Playbook tvých strategií: rozsah, kontext, setup, trigger, invalidace, risk, kdy neobchodovat a otázky na review. Podmínky označ jako povinné, podpůrné nebo poznámku – podle nich pak odškrtáváš checklist u scénáře. Verze použitá u obchodu se už nemění: úprava založí novou verzi.</p>
   <p className="sg-links"><a href="/scenare">Scénáře a vynechané obchody →</a> · <a href="/pravidla">Pravidla a checklisty →</a></p>
   {error&&<p className="mt-alert" role="alert">{error}</p>}
   <div className="sg-layout">
    <aside className="mt-card sg-side">
     {!list?<p className="mt-empty">Načítám…</p>:<><ul className="sg-slist">{active.map(row)}</ul>{!active.length&&<p className="mt-empty">Zatím žádná strategie.</p>}
      {arch.length>0&&<details><summary>Archivované ({arch.length})</summary><ul className="sg-slist">{arch.map(row)}</ul></details>}</>}
     <form className="sg-new" onSubmit={e=>{e.preventDefault();if(name.trim())add()}}>
      <input type="text" value={name} maxLength={60} placeholder="Název nové strategie" aria-label="Název nové strategie" onChange={e=>setName(e.target.value)}/>
      <select value={origin} aria-label="Původ strategie" onChange={e=>setOrigin(e.target.value as Origin)}>{Object.entries(ORIGINS).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
      {origin==='mentor'&&<input type="text" value={mentor} maxLength={LIMITS.mentor} placeholder="Mentor (nepovinné)" aria-label="Mentor" onChange={e=>setMentor(e.target.value)}/>}
      <button type="submit" className="al-btn primary" disabled={!name.trim()}><Plus size={14}/>Nová strategie</button>
      {err&&<small className="sg-err">{err}</small>}
     </form>
    </aside>
    <div className="sg-content">{cur?<Editor key={cur.id} s={cur} onSaved={reload}/>:<section className="mt-card"><p className="mt-empty">Vyber strategii vlevo, nebo založ novou.</p></section>}</div>
   </div>
  </main>
 </div>;
}
