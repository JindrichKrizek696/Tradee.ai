'use client';
// Plán u obchodu v Deníku: propojení se scénářem (návrh: stejný trh a směr, platný při vstupu) nebo jen se strategií a verzí; plán vs. provedení.
import {useEffect,useState} from 'react';
import {Link2,Unlink} from 'lucide-react';
import {instruments} from '@/lib/markets';
import {BIASES,compareExecution,type Exec} from '@/lib/strategy/scenario';
import type {PlanSnapshot} from '@/lib/strategy/core';
import {call,useStrategies,dtText,StatusTag,SnapshotView,PlanPicker,levelsText,type PlanValue,type Scenario} from './plan-ui';
type Plan={scenarioId:string|null;strategyId:string|null;versionId:string|null;version:number|null;strategyName:string|null;model:string|null;snapshot:PlanSnapshot|null;updated:number};
type Data={instrument:string|null;plan:Plan|null;scenario:Scenario|null;suggestions:Scenario[]};
const NAME=new Map(instruments.map(i=>[i.id,i.name]));
function Manual({onSave,busy}:{onSave:(body:Record<string,unknown>)=>void;busy:boolean}){
 const {list}=useStrategies(true),[v,setV]=useState<PlanValue>({strategyId:null,model:null,states:{},keepVersion:false});
 if(!list)return <p className="j-muted">Načítám strategie…</p>;
 if(!list.length)return <p className="j-muted">Nemáš žádnou strategii. <a href="/strategie">Založit strategii</a></p>;
 return <div className="sg-manual"><PlanPicker strategies={list} value={v} onChange={setV}/>{v.strategyId&&<button type="button" className="j-btn" disabled={busy} onClick={()=>onSave({strategyId:v.strategyId,model:v.model,checklist:{states:v.states}})}>Uložit plán ke strategii</button>}</div>;
}
export function TradePlan({id,exec,readOnly,query=''}:{id:string;exec:Exec;readOnly?:boolean;query?:string}){
 const url='/api/journal/'+encodeURIComponent(id)+'/plan';
 const [d,setD]=useState<Data|null>(null),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[edit,setEdit]=useState(false);
 const load=()=>call<Data>(url+query).then(j=>{setD(j);setErr('')}).catch(e=>setErr((e as Error).message));
 useEffect(()=>{load()},[id]);// eslint-disable-line react-hooks/exhaustive-deps
 async function link(body:Record<string,unknown>){setBusy(true);setErr('');try{await call(url,'PUT',body);setEdit(false);await load()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 async function unlink(){if(!confirm('Odpojit plán od obchodu? Snímek checklistu se smaže.'))return;setBusy(true);try{await call(url,'DELETE');await load()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 if(!d)return err?<p className="j-muted">{err}</p>:<p className="j-muted">Načítám…</p>;
 const p=d.plan,sc=d.scenario;
 const cmp=p?compareExecution({bias:sc?.bias??null,levels:sc?.levels??null,snapshot:p.snapshot},exec):[];
 const sugg=d.suggestions.filter(s=>s.id!==p?.scenarioId);
 return <div className="sg-tplan">
  {err&&<p role="alert" className="s-notice">{err}</p>}
  {p&&!edit?<>
   <div className="sg-tplan-head">{sc?<a href={'/scenare#'+sc.id}><b>Scénář {NAME.get(sc.instrument)||sc.instrument}</b> <span className={'sg-bias '+sc.bias}>{BIASES[sc.bias]}</span></a>:<b>{p.scenarioId?'Scénář (smazaný)':'Bez scénáře'}</b>}
    <span>{p.strategyName?`${p.strategyName} · v${p.version??'?'}${p.model?' · '+p.model:''}`:'bez strategie'}</span>{sc&&<StatusTag status={sc.status}/>}
    {!readOnly&&<span className="sg-tplan-act"><button type="button" className="al-btn sm" onClick={()=>setEdit(true)}><Link2 size={13}/>Změnit</button><button type="button" className="al-btn sm" disabled={busy} onClick={unlink}><Unlink size={13}/>Odpojit</button></span>}</div>
   {sc&&<><p className="sg-hyp">{sc.hypothesis}</p><p className="j-muted">{levelsText(sc.levels)}{sc.validUntil?' · platnost do '+dtText(sc.validUntil):''}</p></>}
   {cmp.length>0&&<table className="sg-cmp"><caption>Plán vs. provedení</caption><tbody>{cmp.map(c=><tr key={c.key} className={c.ok===true?'ok':c.ok===false?'bad':''}><th>{c.label}</th><td>{c.ok===true?'✓':c.ok===false?'✗':'–'}</td><td>{c.detail}</td></tr>)}</tbody></table>}
   {p.snapshot?<SnapshotView snap={p.snapshot}/>:<p className="j-muted">Bez snímku checklistu{p.version===1&&!p.scenarioId?' (obchod převedený ze starší strategie, verze 1)':''}.</p>}
  </>:readOnly?<p className="j-muted">K obchodu není připojený plán.</p>:<>
   {sugg.length>0&&<div className="sg-sugg"><b>Navržené scénáře</b><small className="j-muted"> · stejný trh a směr, platné v době vstupu</small><ul>{sugg.map(s=><li key={s.id}><span><b>{NAME.get(s.instrument)||s.instrument}</b> <span className={'sg-bias '+s.bias}>{BIASES[s.bias]}</span> <StatusTag status={s.status}/> {s.strategyName&&<small>{s.strategyName} v{s.version}</small>}<br/><small>{s.hypothesis.slice(0,120)}</small></span><button type="button" className="j-btn" disabled={busy} onClick={()=>link({scenarioId:s.id})}>Propojit</button></li>)}</ul></div>}
   {!sugg.length&&<p className="j-muted">Žádný scénář pro {d.instrument?NAME.get(d.instrument)||d.instrument:'tento trh'} v době vstupu. Můžeš obchod přiřadit aspoň ke strategii, nebo <a href={'/scenare?novy='+encodeURIComponent(d.instrument||'1')}>založit scénář</a>.</p>}
   <details className="sg-manual-wrap"><summary>Přiřadit jen ke strategii (s checklistem)</summary><Manual busy={busy} onSave={link}/></details>
   {edit&&<button type="button" className="j-btn" onClick={()=>setEdit(false)}>Zrušit</button>}
  </>}
 </div>;
}
