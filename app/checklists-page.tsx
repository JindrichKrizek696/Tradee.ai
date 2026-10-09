'use client';
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,ArrowUp,ArrowDown,X} from 'lucide-react';
import {groups} from '@/lib/markets';
import {LIMITS} from '@/lib/checklists/core';
import {usePalette} from './palette';
import './mt.css';
import './checklists.css';
type Market={id:string;name:string;group:string};
type Item={id?:string;text:string};
type Checklist={id:string;name:string;items:{id:string;text:string}[];markets:string[]};
type Draft={id?:string;name:string;items:Item[];markets:string[]};
async function call(url:string,method:string,body?:unknown){const r=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla.');return j}
const move=<T,>(a:T[],i:number,d:number)=>{const j=i+d;if(j<0||j>=a.length)return a;const b=[...a];[b[i],b[j]]=[b[j],b[i]];return b};
function Editor({draft,markets,onSave,onCancel}:{draft:Draft;markets:Market[];onSave:(d:Draft)=>Promise<void>;onCancel:()=>void}){
 const [d,setD]=useState(draft),[q,setQ]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 const sel=new Set(d.markets),gids=Object.keys(groups).filter(g=>g!=='all'&&markets.some(m=>m.group===g));
 const shown=markets.filter(m=>(m.id+' '+m.name).toLowerCase().includes(q.trim().toLowerCase()));
 const setItem=(i:number,text:string)=>setD({...d,items:d.items.map((x,k)=>k===i?{...x,text}:x)});
 const toggle=(id:string)=>setD({...d,markets:sel.has(id)?d.markets.filter(x=>x!==id):[...d.markets,id]});
 const groupIds=(g:string)=>markets.filter(m=>m.group===g).map(m=>m.id);
 const toggleGroup=(g:string)=>{const ids=groupIds(g),all=ids.every(i=>sel.has(i));setD({...d,markets:all?d.markets.filter(x=>!ids.includes(x)):[...new Set([...d.markets,...ids])]})};
 async function save(){setBusy(true);setErr('');try{await onSave(d)}catch(e){setErr((e as Error).message);setBusy(false)}}
 return <div className="ck-editor">
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  <label>Název<input type="text" value={d.name} maxLength={LIMITS.name} onChange={e=>setD({...d,name:e.target.value})} placeholder="např. Pravidla před vstupem"/></label>
  <div><div className="ck-sub">Body ({d.items.length}/{LIMITS.items})</div>
   <div className="ck-points" style={{marginTop:6}}>{d.items.map((it,i)=><div className="ck-point" key={i}>
    <input type="text" value={it.text} maxLength={LIMITS.item} onChange={e=>setItem(i,e.target.value)} placeholder={`Bod ${i+1}`} aria-label={`Bod ${i+1}`}/>
    <button type="button" className="mt-icon" aria-label="Posunout nahoru" disabled={i===0} onClick={()=>setD({...d,items:move(d.items,i,-1)})}><ArrowUp size={14}/></button>
    <button type="button" className="mt-icon" aria-label="Posunout dolů" disabled={i===d.items.length-1} onClick={()=>setD({...d,items:move(d.items,i,1)})}><ArrowDown size={14}/></button>
    <button type="button" className="mt-icon" aria-label="Odebrat bod" onClick={()=>setD({...d,items:d.items.filter((_,k)=>k!==i)})}><X size={14}/></button>
   </div>)}</div>
   <button type="button" className="mt-btn" style={{marginTop:8}} disabled={d.items.length>=LIMITS.items} onClick={()=>setD({...d,items:[...d.items,{text:''}]})}>+ Přidat bod</button></div>
  <div><div className="ck-sub">Trhy ({d.markets.length} vybráno)</div>
   <div className="ck-groups" style={{marginTop:6}}>{gids.map(g=>{const ids=groupIds(g),on=ids.every(i=>sel.has(i));return <label key={g} className={'ck-chip'+(on?' on':'')}><input type="checkbox" checked={on} onChange={()=>toggleGroup(g)}/>{g==='fx'?'Všechny FX páry':'Všechny: '+groups[g]}</label>})}</div>
   <input className="ck-search" style={{marginTop:8}} type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Hledat trh…" aria-label="Hledat trh"/>
   <div className="ck-markets">{shown.map(m=><label key={m.id}><input type="checkbox" checked={sel.has(m.id)} onChange={()=>toggle(m.id)}/>{m.name}</label>)}{!shown.length&&<span className="mt-empty">Nic nenalezeno.</span>}</div></div>
  <div className="ck-foot"><button type="button" className="mt-btn dark" disabled={busy} onClick={save}>{busy?'Ukládám…':'Uložit'}</button><button type="button" className="mt-btn" disabled={busy} onClick={onCancel}>Zrušit</button></div>
 </div>;
}
export default function ChecklistsPage(){
 usePalette(); // barvy signálu podle nastavení uživatele (jinak výchozí)
 const [lists,setLists]=useState<Checklist[]>([]),[markets,setMarkets]=useState<Market[]>([]),[unmapped,setUnmapped]=useState<string[]>([]),[map,setMap]=useState<Record<string,string>>({});
 const [edit,setEdit]=useState<Draft|null>(null),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const names=useMemo(()=>Object.fromEntries(markets.map(m=>[m.id,m.name])),[markets]);
 async function load(){try{const [c,s]=await Promise.all(['/api/checklists','/api/checklists/symbols'].map(u=>fetch(u,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}))) as [{checklists:Checklist[];markets:Market[]},{map:Record<string,string>;unmapped:string[]}];setLists(c.checklists);setMarkets(c.markets);setMap(s.map);setUnmapped(s.unmapped);setReady(true);setError('')}catch{setError('Data se nepodařilo načíst. Obnov stránku.')}}
 useEffect(()=>{load()},[]);
 const run=(fn:()=>Promise<unknown>)=>fn().then(()=>setError('')).catch((e:Error)=>setError(e.message)).then(load);
 const save=async(d:Draft)=>{await call('/api/checklists','POST',{id:d.id,name:d.name,items:d.items.map(i=>i.id?{id:i.id,text:i.text}:{text:i.text}),markets:d.markets});setEdit(null);setError('');await load()};
 const reorder=(i:number,dir:number)=>{const o=move(lists,i,dir);if(o===lists)return;setLists(o);run(()=>call('/api/checklists','PATCH',{order:o.map(l=>l.id)}))};
 const del=(l:Checklist)=>{if(window.confirm(`Smazat checklist „${l.name}“?`))run(()=>call('/api/checklists','DELETE',{id:l.id}))};
 const assign=(symbol:string,instrument:string|null)=>run(()=>call('/api/checklists/symbols','PUT',{symbol,instrument}));
 const opts=<>{markets.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</>;
 const manual=Object.entries(map);
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main">
   <h1>Checklisty</h1>
   <p className="mt-lead">Checklist jsou tvoje pravidla před vstupem do obchodu. Přiřaď ho k trhům, na kterých platí, a při obchodování ho jen odškrtáváš. Stav zaškrtnutí se uloží k obchodu, takže pak uvidíš, jak dodržuješ plán a jak se to promítá do statistik.</p>
   {error&&<p className="mt-alert" role="alert">{error}</p>}
   {ready&&<section className="mt-card">
    <h2>Moje checklisty</h2>
    {!lists.length&&!edit&&<p className="mt-empty">Zatím nemáš žádný checklist.</p>}
    <div className="ck-list">{lists.map((l,i)=><div className="ck-item" key={l.id}>
     {edit?.id===l.id?<Editor draft={edit} markets={markets} onSave={save} onCancel={()=>setEdit(null)}/>:<>
      <div className="ck-head"><h3>{l.name}</h3><div className="ck-actions">
       <button type="button" className="mt-icon" aria-label="Posunout nahoru" disabled={i===0} onClick={()=>reorder(i,-1)}><ArrowUp size={14}/></button>
       <button type="button" className="mt-icon" aria-label="Posunout dolů" disabled={i===lists.length-1} onClick={()=>reorder(i,1)}><ArrowDown size={14}/></button>
       <button type="button" className="mt-btn" disabled={!!edit} onClick={()=>setEdit({id:l.id,name:l.name,items:l.items.map(x=>({...x})),markets:[...l.markets]})}>Upravit</button>
       <button type="button" className="mt-btn" onClick={()=>del(l)}>Smazat</button></div></div>
      <p className="ck-meta">{l.items.length} {l.items.length===1?'bod':l.items.length>=2&&l.items.length<=4?'body':'bodů'} · {l.markets.length?l.markets.slice(0,4).map(m=>names[m]||m).join(', ')+(l.markets.length>4?` +${l.markets.length-4}`:''):'žádné trhy'}</p></>}
    </div>)}</div>
    {edit&&!edit.id?<div className="ck-item ck-new"><Editor draft={edit} markets={markets} onSave={save} onCancel={()=>setEdit(null)}/></div>
     :<button type="button" className="mt-btn dark ck-new" disabled={lists.length>=LIMITS.lists||!!edit} onClick={()=>setEdit({name:'',items:[{text:''}],markets:[]})}>+ Nový checklist</button>}
    {lists.length>=LIMITS.lists&&<p className="mt-empty">Dosáhl jsi limitu {LIMITS.lists} checklistů.</p>}
   </section>}
   {ready&&(unmapped.length>0||manual.length>0)&&<section className="mt-card">
    <h2>Symboly z MetaTraderu</h2>
    {unmapped.length>0&&<><p className="mt-lead">Tyhle symboly z MetaTraderu Tradee nepoznalo. Vyber, ke kterému trhu patří, aby se použily checklisty.</p>
     {unmapped.map(s=><div className="ck-sym" key={s}><code>{s}</code><select aria-label={`Trh pro ${s}`} value="" onChange={e=>e.target.value&&assign(s,e.target.value==='-'?'':e.target.value)}><option value="">— vyber trh —</option><option value="-">— nesledovat —</option>{opts}</select></div>)}</>}
    {manual.length>0&&<><p className="mt-lead" style={{marginTop:unmapped.length?16:0}}>Ruční přiřazení</p>
     {manual.map(([s,ins])=><div className="ck-sym" key={s}><code>{s}</code><span>{ins?names[ins]||ins:'nesledovat'}</span><button type="button" className="mt-btn" style={{height:34}} onClick={()=>assign(s,null)}>Zrušit</button></div>)}</>}
   </section>}
  </main>
 </div>;
}
