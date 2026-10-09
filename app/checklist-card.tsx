'use client';
import {useEffect,useState} from 'react';
import type {Checklist,SnapshotList} from '@/lib/checklists/core';
import './checklist-card.css';
async function send(url:string,method:string,body?:unknown):Promise<any>{
 const r=await fetch(url,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 const j=await r.json().catch(()=>({})) as any;if(!r.ok)throw Error(j.error||'Akce se nepovedla. Zkus to znovu.');return j;
}
const pct=(c:number,n:number)=>n?Math.round(c/n*100):0;
// Jeden seznam bodů s ukazatelem; onToggle chybí = jen zobrazení.
export function CheckSet({name,items,onToggle,extra}:{name:string;items:{id:string;text:string;checked:boolean}[];onToggle?:(id:string)=>void;extra?:React.ReactNode}){
 const c=items.filter(i=>i.checked).length;
 return <div className="cc-set"><div className="cc-head"><h3>{name}</h3><span className="cc-count">{c} / {items.length} splněno</span>{extra}</div>
  <div className="cc-bar" role="progressbar" aria-label={`Splněno ${c} z ${items.length}`} aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={c}><i style={{width:pct(c,items.length)+'%'}}/></div>
  <ul className="cc-pts">{items.map(i=><li key={i.id} className="cc-pt"><label className={onToggle?'':'ro'}><input type="checkbox" checked={i.checked} disabled={!onToggle} onChange={()=>onToggle?.(i.id)}/><span>{i.text}</span></label></li>)}</ul></div>;
}
export function ChecklistCard({instrument}:{instrument:string}){
 const [lists,setLists]=useState<Checklist[]|null>(null),[state,setState]=useState<Record<string,string[]>>({}),[error,setError]=useState('');
 useEffect(()=>{let live=true;setLists(null);setError('');
  send('/api/checklists/state?instrument='+encodeURIComponent(instrument),'GET').then(j=>{if(live){setLists(j.checklists);setState(j.state||{})}}).catch(e=>{if(live){setLists([]);setError((e as Error).message)}});
  return()=>{live=false}},[instrument]);
 async function toggle(l:Checklist,itemId:string){
  const before=state[l.id]||[],after=before.includes(itemId)?before.filter(x=>x!==itemId):[...before,itemId];
  setState(s=>({...s,[l.id]:after}));setError('');
  try{await send('/api/checklists/state','PUT',{checklistId:l.id,instrument,checked:after})}catch(e){setState(s=>({...s,[l.id]:before}));setError((e as Error).message)}}
 async function clear(l:Checklist){
  if(!window.confirm(`Vymazat zaškrtnutí v checklistu „${l.name}“?`))return;
  const before=state[l.id]||[];setState(s=>({...s,[l.id]:[]}));setError('');
  try{await send('/api/checklists/state','DELETE',{checklistId:l.id,instrument})}catch(e){setState(s=>({...s,[l.id]:before}));setError((e as Error).message)}}
 if(lists===null)return <section className="s-card"><h2>Checklist</h2><p className="j-muted">Načítám…</p></section>;
 return <section className="s-card"><h2>Checklist</h2>
  {error&&<p role="alert" className="s-notice">{error}</p>}
  {!lists.length?<p className="j-muted">Pro tento trh nemáš checklist. <a href="/checklisty">Nastavit checklisty</a></p>
  :<div className="cc-list">{lists.map(l=>{const on=new Set(state[l.id]||[]);
   return <CheckSet key={l.id} name={l.name} items={l.items.map(i=>({...i,checked:on.has(i.id)}))} onToggle={id=>toggle(l,id)} extra={on.size>0&&<button type="button" className="cc-clear" onClick={()=>clear(l)}>Vymazat</button>}/>})}</div>}
 </section>;
}
export type {SnapshotList};
