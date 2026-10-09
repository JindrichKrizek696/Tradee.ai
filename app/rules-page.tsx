'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUp,ArrowDown,X} from 'lucide-react';
import {LIMITS,type RuleDef,type RuleId,type RuleSettings} from '@/lib/discipline/rules';
import {usePalette} from './palette';
import ChecklistsPage from './checklists-page';
import './mt.css';
import './checklists.css';
import './rules.css';
type Item={id?:string;text:string};
type Strategy={id:string;name:string;archived:boolean};
async function call<T=unknown>(url:string,method:string,body?:unknown){const r=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla.');return j as T}
const move=<T,>(a:T[],i:number,d:number)=>{const j=i+d;if(j<0||j>=a.length)return a;const b=[...a];[b[i],b[j]]=[b[j],b[i]];return b};
function AutoRules(){
 const [defs,setDefs]=useState<RuleDef[]>([]),[s,setS]=useState<RuleSettings|null>(null),[st,setSt]=useState<'idle'|'saving'|'saved'|'err'>('idle'),[err,setErr]=useState(''),[loadErr,setLoadErr]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),seq=useRef(0),pending=useRef<RuleSettings|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;fetch('/api/rules',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json() as Promise<{rules:RuleSettings;defs:RuleDef[]}>}).then(j=>{setDefs(j.defs);setS(j.rules)}).catch(()=>setLoadErr(true));return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current);if(pending.current)fetch('/api/rules',{method:'PUT',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:pending.current})}).catch(()=>{})}},[]);
 function send(next:RuleSettings,n:number){
  pending.current=null;
  call<{rules:RuleSettings}>('/api/rules','PUT',{rules:next}).then(j=>{if(alive.current&&n===seq.current){setS(j.rules);setSt('saved')}}).catch((e:Error)=>{if(alive.current&&n===seq.current){setSt('err');setErr(e.message)}});
 }
 function change(next:RuleSettings,wait:boolean){
  setS(next);setSt('saving');setErr('');if(timer.current)clearTimeout(timer.current);const n=++seq.current;
  if(wait){pending.current=next;timer.current=setTimeout(()=>send(next,n),600)}else send(next,n);
 }
 const upd=(id:RuleId,p:Partial<{on:boolean;value:number|null}>)=>s&&change({...s,[id]:{...s[id],...p}},!('on' in p));
 return <section className="mt-card">
  <div className="rl-title"><h2>Automatická pravidla</h2><span className={'rl-status'+(st==='err'?' err':'')} role="status" aria-live="polite">{st==='saving'?'Ukládám…':st==='saved'?'Uloženo':st==='err'?'Uložení se nepovedlo.':''}</span></div>
  <p className="mt-lead">Tradee každý obchod z MetaTraderu zkontroluje proti těmto pravidlům a porušení uloží k obchodu.</p>
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  {loadErr&&<p className="mt-alert" role="alert">Pravidla se nepodařilo načíst. Obnov stránku.</p>}
  {!s&&!loadErr&&<p className="mt-empty">Načítám…</p>}
  {s&&<div className="rl-list">{defs.map(r=>{const v=s[r.id];return <div className={'rl-row'+(v.on?'':' off')} key={r.id}>
   <label className="rl-switch"><input type="checkbox" role="switch" checked={v.on} onChange={e=>upd(r.id,{on:e.target.checked})} aria-label={r.label}/><span className="rl-track"/></label>
   <div className="rl-text"><div className="rl-name">{r.label}{r.needsReason&&<span className="rl-tag">chce zdůvodnění</span>}</div><div className="rl-help">{r.help}</div></div>
   {r.unit&&<span className="rl-num"><input type="number" inputMode="decimal" min={r.min} max={r.max} step={r.unit==='%'?0.1:1} disabled={!v.on} value={v.value??''} aria-label={r.label+' – hodnota'} onChange={e=>{const n=parseFloat(e.target.value);if(Number.isFinite(n))upd(r.id,{value:n})}}/><span>{r.unit}</span></span>}
  </div>})}</div>}
 </section>;
}
function CustomRules(){
 const [items,setItems]=useState<Item[]>([]),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[err,setErr]=useState('');
 useEffect(()=>{fetch('/api/custom-rules',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json() as Promise<{rules:Item[]}>}).then(j=>{setItems(j.rules);setReady(true)}).catch(()=>setErr('Vlastní pravidla se nepodařilo načíst. Obnov stránku.'))},[]);
 const edit=(f:(a:Item[])=>Item[])=>{setItems(f);setMsg('')};
 async function save(){setBusy(true);setErr('');setMsg('');try{const j=await call<{rules:Item[]}>('/api/custom-rules','PUT',{rules:items});setItems(j.rules);setMsg('Uloženo')}catch(e){setErr((e as Error).message)}setBusy(false)}
 return <section className="mt-card">
  <h2>Vlastní pravidla</h2>
  <p className="mt-lead">Vlastní zásady, které Tradee nemůže ověřit samo. Budeš je moct odškrtávat při hodnocení obchodu.</p>
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  {!ready&&!err&&<p className="mt-empty">Načítám…</p>}
  {ready&&<>
   {!items.length&&<p className="mt-empty">Zatím nemáš žádné vlastní pravidlo.</p>}
   <div className="ck-points">{items.map((it,i)=><div className="ck-point rl-point" key={it.id||'n'+i}>
    <input type="text" value={it.text} maxLength={LIMITS.customText} onChange={e=>edit(a=>a.map((x,k)=>k===i?{...x,text:e.target.value}:x))} placeholder={`Pravidlo ${i+1}`} aria-label={`Pravidlo ${i+1}`}/>
    <button type="button" className="mt-icon" aria-label="Posunout nahoru" disabled={i===0} onClick={()=>edit(a=>move(a,i,-1))}><ArrowUp size={14}/></button>
    <button type="button" className="mt-icon" aria-label="Posunout dolů" disabled={i===items.length-1} onClick={()=>edit(a=>move(a,i,1))}><ArrowDown size={14}/></button>
    <button type="button" className="mt-icon" aria-label="Odebrat pravidlo" onClick={()=>edit(a=>a.filter((_,k)=>k!==i))}><X size={14}/></button>
   </div>)}</div>
   <div className="ck-foot rl-foot">
    <button type="button" className="mt-btn" disabled={items.length>=LIMITS.customRules} onClick={()=>edit(a=>[...a,{text:''}])}>+ Přidat pravidlo</button>
    <button type="button" className="mt-btn dark" disabled={busy} onClick={save}>{busy?'Ukládám…':'Uložit'}</button>
    <span className="rl-status" role="status" aria-live="polite">{msg}</span>
   </div>
   <p className="mt-empty">{items.length}/{LIMITS.customRules} pravidel, nejvýš {LIMITS.customText} znaků.</p></>}
 </section>;
}
function Strategies(){
 const [list,setList]=useState<Strategy[]>([]),[ready,setReady]=useState(false),[name,setName]=useState(''),[editId,setEditId]=useState<string|null>(null),[editName,setEditName]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 async function load(){try{const j=await fetch('/api/strategies',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}) as {strategies:Strategy[]};setList(j.strategies);setReady(true)}catch{setErr('Strategie se nepodařilo načíst. Obnov stránku.')}}
 useEffect(()=>{load()},[]);
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setErr('');try{await fn();await load();return true}catch(e){setErr((e as Error).message);return false}finally{setBusy(false)}};
 const add=async()=>{if(await run(()=>call('/api/strategies','POST',{name})))setName('')};
 const rename=async(id:string)=>{if(await run(()=>call('/api/strategies','PATCH',{id,name:editName})))setEditId(null)};
 const arch=(id:string,archived:boolean)=>run(()=>call('/api/strategies','PATCH',{id,archived}));
 const active=list.filter(x=>!x.archived),archived=list.filter(x=>x.archived);
 const row=(x:Strategy)=><div className="rl-strat" key={x.id}>
  {editId===x.id?<><input type="text" value={editName} maxLength={LIMITS.strategyName} autoFocus aria-label="Název strategie" onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')rename(x.id);if(e.key==='Escape')setEditId(null)}}/>
   <button type="button" className="mt-btn dark" disabled={busy} onClick={()=>rename(x.id)}>Uložit</button><button type="button" className="mt-btn" onClick={()=>setEditId(null)}>Zrušit</button></>
  :<><span className="rl-sname">{x.name}</span>
   <button type="button" className="mt-btn" disabled={busy} onClick={()=>{setEditId(x.id);setEditName(x.name)}}>Přejmenovat</button>
   <button type="button" className="mt-btn" disabled={busy} onClick={()=>arch(x.id,!x.archived)}>{x.archived?'Obnovit':'Archivovat'}</button></>}
 </div>;
 return <section className="mt-card">
  <h2>Strategie</h2>
  <p className="mt-lead">Pojmenuj strategie, které obchoduješ, a u obchodů pak uvidíš, která ti vychází. Archivovaná strategie zůstane u starých obchodů.</p>
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  {!ready&&!err&&<p className="mt-empty">Načítám…</p>}
  {ready&&<>
   {!active.length&&<p className="mt-empty">Zatím nemáš žádnou aktivní strategii.</p>}
   <div className="rl-slist">{active.map(row)}</div>
   <form className="rl-add" onSubmit={e=>{e.preventDefault();if(name.trim())add()}}>
    <input type="text" value={name} maxLength={LIMITS.strategyName} onChange={e=>setName(e.target.value)} placeholder="Název nové strategie" aria-label="Název nové strategie"/>
    <button type="submit" className="mt-btn dark" disabled={busy||!name.trim()||list.length>=LIMITS.strategies}>+ Přidat</button>
   </form>
   {list.length>=LIMITS.strategies&&<p className="mt-empty">Dosáhl jsi limitu {LIMITS.strategies} strategií.</p>}
   {archived.length>0&&<details className="rl-arch"><summary>Archivované ({archived.length})</summary><div className="rl-slist">{archived.map(row)}</div></details>}</>}
 </section>;
}
export default function RulesPage(){
 usePalette(); // barvy signálu podle nastavení uživatele (jinak výchozí)
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main">
   <h1>Pravidla a strategie</h1>
   <p className="mt-lead">Tady si nastavíš, jak chceš obchodovat. Automatická pravidla Tradee hlídá samo, vlastní pravidla a checklisty odškrtáváš ty, strategie slouží k rozdělení obchodů ve statistikách.</p>
   <AutoRules/><CustomRules/><Strategies/>
   <ChecklistsPage embedded/>
  </main>
 </div>;
}
