'use client';
import {useEffect,useRef,useState} from 'react';
import type {Checklist} from '@/lib/checklists/core';
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
 const cur=useRef<Record<string,string[]>>({}),chain=useRef<Promise<unknown>>(Promise.resolve());
 const put=(s:Record<string,string[]>)=>{cur.current=s;setState(s)};
 const reload=()=>send('/api/checklists/state?instrument='+encodeURIComponent(instrument),'GET').then(j=>{put(j.state||{})}).catch(()=>{});
 useEffect(()=>{let live=true;setLists(null);setError('');
  send('/api/checklists/state?instrument='+encodeURIComponent(instrument),'GET').then(j=>{if(live){setLists(j.checklists);put(j.state||{})}}).catch(e=>{if(live){setLists([]);setError((e as Error).message)}});
  return()=>{live=false}},[instrument]);
 // požadavky se posílají postupně, aby starší nepřepsal novější; při chybě se stav načte ze serveru
 const queue=(req:()=>Promise<unknown>)=>{chain.current=chain.current.then(async()=>{try{await req()}catch(e){setError((e as Error).message);await reload()}})};
 function toggle(l:Checklist,itemId:string){
  const before=cur.current[l.id]||[],after=before.includes(itemId)?before.filter(x=>x!==itemId):[...before,itemId];
  put({...cur.current,[l.id]:after});setError('');
  queue(()=>send('/api/checklists/state','PUT',{checklistId:l.id,instrument,checked:after}))}
 function clear(l:Checklist){
  if(!window.confirm(`Vymazat zaškrtnutí v checklistu „${l.name}“?`))return;
  put({...cur.current,[l.id]:[]});setError('');
  queue(()=>send('/api/checklists/state','DELETE',{checklistId:l.id,instrument}))}
 if(lists===null)return <section className="s-card"><h2>Checklist</h2><p className="j-muted">Načítám…</p></section>;
 return <section className="s-card"><h2>Checklist</h2>
  {error&&<p role="alert" className="s-notice">{error}</p>}
  {!lists.length?<p className="j-muted">Pro tento trh nemáš checklist. <a href="/checklisty">Nastavit checklisty</a></p>
  :<div className="cc-list">{lists.map(l=>{const on=new Set(state[l.id]||[]);
   return <CheckSet key={l.id} name={l.name} items={l.items.map(i=>({...i,checked:on.has(i.id)}))} onToggle={id=>toggle(l,id)} extra={l.items.some(i=>on.has(i.id))&&<button type="button" className="cc-clear" onClick={()=>clear(l)}>Vymazat</button>}/>})}</div>}
 </section>;
}
