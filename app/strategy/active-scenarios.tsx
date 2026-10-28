'use client';
// Dlaždice „Aktivní scénáře“ na Dashboardu: otevřené scénáře (čekám / aktivní) s checklistem, platností a nejbližší zprávou.
import {useEffect,useState} from 'react';
import {Target,ChevronRight,Plus} from 'lucide-react';
import {instruments} from '@/lib/markets';
import {BIASES,effectiveStatus} from '@/lib/strategy/scenario';
import {StatusTag,dtText,type Scenario} from './plan-ui';
const NAME=new Map(instruments.map(i=>[i.id,i.name]));
export function ActiveScenarios({style}:{style?:React.CSSProperties}){
 const [list,setList]=useState<Scenario[]|null>(null),[events,setEvents]=useState<Record<string,{at:number;title:string}>>({}),[now,setNow]=useState(0),[error,setError]=useState(false);
 useEffect(()=>{let live=true;fetch('/api/scenarios?scope=open&limit=20',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json() as Promise<{scenarios:Scenario[];events:Record<string,{at:number;title:string}>;now:number}>}).then(j=>{if(live){setList(j.scenarios);setEvents(j.events);setNow(j.now)}}).catch(()=>{if(live)setError(true)});return()=>{live=false}},[]);
 const open=(list||[]).filter(s=>{const st=effectiveStatus(s,now);return st==='waiting'||st==='active'});
 return <section className="d-card sg-dash" style={style}>
  <div className="d-head"><h2><Target size={16}/> Aktivní scénáře</h2><a className="d-link" href="/scenare">Všechny <ChevronRight size={14}/></a></div>
  {!list?<p className="d-empty">{error?'Scénáře se nepodařilo načíst.':'Načítám…'}</p>:!open.length?<p className="d-empty">Žádný otevřený scénář. <a href="/scenare?novy=1">Naplánuj obchod</a></p>:
  <ul className="sg-dash-list">{open.slice(0,6).map(s=>{const v=s.snapshot?.eval,ev=events[s.id];return <li key={s.id}><a href={'/scenare#'+s.id}>
   <span className="sg-dash-name"><b>{NAME.get(s.instrument)||s.instrument}</b><span className={'sg-bias '+s.bias}>{BIASES[s.bias]}</span><StatusTag status={effectiveStatus(s,now)}/></span>
   <small>{s.hypothesis.length>90?s.hypothesis.slice(0,89)+'…':s.hypothesis}</small>
   <small className="sg-muted">{s.validUntil?'do '+dtText(s.validUntil):'bez platnosti'}{ev?` · ${ev.title}`:''}</small>
   {v&&<span className={'sg-mini '+v.verdict}>{v.verdict==='blocked'?'✗ povinná':v.verdict==='incomplete'?'? povinná':'✓ povinné'}{v.supportiveTotal?` · ${v.supportiveMet}/${v.supportiveTotal}`:''}</span>}
  </a></li>})}</ul>}
  <div className="d-foot"><span>{open.length>6?`+ ${open.length-6} dalších`:''}</span><a className="d-link" href="/scenare?novy=1"><Plus size={14}/> Nový scénář</a></div>
 </section>;
}
