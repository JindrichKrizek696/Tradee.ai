'use client';
// Sdílené části plánování: volání API, tří-stavový checklist, snímek plánu, výběr strategie a modelu.
import {useEffect,useState} from 'react';
import {AlertTriangle,CheckCircle2,CircleHelp} from 'lucide-react';
import {BLOCK_LABEL,ROLES,STATES,ORIGINS,decisionItems,evaluate,type CheckState,type Content,type DecisionItem,type Origin,type PlanSnapshot} from '@/lib/strategy/core';
import {STATUSES,type Status,type Bias,type Levels} from '@/lib/strategy/scenario';
import './strategy.css';
export async function call<T=Record<string,unknown>>(url:string,method='GET',body?:unknown):Promise<T>{
 const form=body instanceof FormData;
 const r=await fetch(url,{method,cache:'no-store',headers:body===undefined||form?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:form?body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(j.error||'Akce se nepovedla. Zkus to znovu.');return j as T;
}
export type StrategyItem={id:string;name:string;archived:boolean;origin:Origin;mentor:string|null;fromChecklist:boolean;latest:{id:string;version:number;changelog:string|null;created:number;updated:number;content?:Content}|null};
export function useStrategies(full=true){
 const [list,setList]=useState<StrategyItem[]|null>(null),[error,setError]=useState('');
 const load=()=>call<{strategies:StrategyItem[]}>('/api/strategies'+(full?'?full=1':'')).then(j=>{setList(j.strategies);setError('')}).catch(e=>{setList([]);setError((e as Error).message)});
 useEffect(()=>{load()},[]);// eslint-disable-line react-hooks/exhaustive-deps
 return {list,error,reload:load};
}
export const dtText=(ms:number|null)=>ms===null?'–':new Date(ms).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
export const dayText=(ms:number)=>new Date(ms).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric'});
// datetime-local ↔ ms (v časovém pásmu prohlížeče)
export const toLocalInput=(ms:number|null)=>{if(ms===null)return '';const d=new Date(ms),p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`};
export const fromLocalInput=(s:string)=>{if(!s)return null;const t=new Date(s).getTime();return Number.isFinite(t)?t:null};
export const pragueDay=(ms:number)=>new Date(ms).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'});
export type Scenario={id:string;instrument:string;bias:Bias;hypothesis:string;strategyId:string|null;versionId:string|null;version:number|null;strategyName:string|null;model:string|null;levels:Levels;validUntil:number|null;reviewAt:number|null;status:Status;snapshot:PlanSnapshot|null;note:string;chartUrl:string|null;fileId:string|null;alertId:string|null;closedAt:number|null;created:number;updated:number;trades:number};
const fmtN=(n:number|null)=>n===null?'–':n.toLocaleString('cs-CZ',{maximumFractionDigits:6});
export const levelsText=(l:Levels)=>[l.entryFrom!==null&&`vstup ${fmtN(l.entryFrom)}${l.entryTo!==null&&l.entryTo!==l.entryFrom?' – '+fmtN(l.entryTo):''}`,l.invalidation!==null&&`invalidace ${fmtN(l.invalidation)}`,l.targets.length>0&&`cíle ${l.targets.map(fmtN).join(', ')}`].filter(Boolean).join(' · ')||'bez úrovní';
export function StatusTag({status}:{status:Status}){return <span className={'sg-status '+status}>{STATUSES[status]}</span>}
export function originText(o:Origin,mentor:string|null){return o==='mentor'&&mentor?`${ORIGINS.mentor}: ${mentor}`:ORIGINS[o]}
// Tří-stavový checklist: nesplněná POVINNÁ podmínka svítí červeně a blokuje, i když je zbytek zelený; skóre podpůrných zvlášť
export function TriChecklist({items,states,onChange,compact}:{items:(DecisionItem&{state?:CheckState})[];states:Record<string,CheckState>;onChange?:(id:string,s:CheckState)=>void;compact?:boolean}){
 const st=(i:DecisionItem&{state?:CheckState})=>states[i.id]??i.state??'unknown';
 const ev=evaluate(items.map(i=>({role:i.role,state:st(i)})));
 if(!items.length)return <p className="sg-muted">Strategie zatím nemá žádné podmínky k odškrtnutí. Doplníš je v playbooku na stránce <a href="/strategie">Strategie</a>.</p>;
 const blocks=[...new Set(items.map(i=>i.block))];
 return <div className={'sg-check'+(compact?' compact':'')}>
  <div className={'sg-verdict '+ev.verdict} role="status">
   {ev.verdict==='blocked'?<><AlertTriangle size={16} aria-hidden/><b>Nesplněná povinná podmínka ({ev.requiredUnmet})</b><span>Podle strategie do obchodu nevstupuj – i když je zbytek zelený.</span></>
   :ev.verdict==='incomplete'?<><CircleHelp size={16} aria-hidden/><b>U povinné podmínky „nevím“ ({ev.requiredUnknown})</b><span>Rozhodni, než vstoupíš.</span></>
   :<><CheckCircle2 size={16} aria-hidden/><b>{ev.requiredTotal?'Povinné podmínky splněné':'Bez povinných podmínek'}</b></>}
   <span className="sg-score" title="Podíl splněných podpůrných podmínek">Podpůrné: <b>{ev.supportiveMet}/{ev.supportiveTotal}</b>{ev.score!==null&&<> · {Math.round(ev.score*100)} %</>}</span>
  </div>
  {blocks.map(b=><div key={b} className="sg-check-block"><h4>{BLOCK_LABEL[b]}</h4><ul>{items.filter(i=>i.block===b).map(i=>{const s=st(i),bad=i.role==='required'&&s==='unmet';
   return <li key={i.id} className={'sg-ci '+s+(bad?' bad':'')+(i.role==='required'?' req':'')}>
    <span className="sg-ci-text">{i.text}{i.model&&<em className="sg-chip">{i.model}</em>}<small className={'sg-role '+i.role}>{ROLES[i.role]}</small></span>
    <span className="sg-tri" role="radiogroup" aria-label={'Stav: '+i.text}>{(['met','unmet','unknown'] as CheckState[]).map(k=><button key={k} type="button" role="radio" aria-checked={s===k} className={k+(s===k?' on':'')} disabled={!onChange} onClick={()=>onChange?.(i.id,k)} title={STATES[k]}>{k==='met'?'✓':k==='unmet'?'✗':'?'}<span className="sg-sr">{STATES[k]}</span></button>)}</span>
   </li>})}</ul></div>)}
 </div>;
}
export function SnapshotView({snap,title='Checklist při rozhodnutí'}:{snap:PlanSnapshot;title?:string}){
 return <div className="sg-snap"><div className="sg-snap-head"><b>{title}</b><span>{snap.strategyName} · v{snap.version}{snap.model?' · '+snap.model:''} · {dtText(snap.at)}</span></div>
  <TriChecklist items={snap.items} states={{}} compact/>
  {(snap.chartUrl||snap.fileId||snap.note)&&<div className="sg-snap-extra">{snap.note&&<p>{snap.note}</p>}{snap.chartUrl&&<a href={snap.chartUrl} target="_blank" rel="noreferrer noopener">Graf (odkaz)</a>}{snap.fileId&&<a href={'/api/plan-files/'+snap.fileId} target="_blank" rel="noreferrer"><img src={'/api/plan-files/'+snap.fileId} alt="Screenshot k plánu" loading="lazy"/></a>}</div>}
 </div>;
}
// Výběr strategie + vstupního modelu + odškrtání; items z existujícího snímku (stejná verze), jinak z poslední verze
export type PlanValue={strategyId:string|null;model:string|null;states:Record<string,CheckState>;keepVersion:boolean};
export function PlanPicker({strategies,value,onChange,snapshot}:{strategies:StrategyItem[];value:PlanValue;onChange:(v:PlanValue)=>void;snapshot?:PlanSnapshot|null}){
 const active=strategies.filter(s=>!s.archived||s.id===value.strategyId),s=strategies.find(x=>x.id===value.strategyId),content=s?.latest?.content;
 const fromSnap=!!(snapshot&&value.keepVersion&&snapshot.strategyId===value.strategyId&&snapshot.model===value.model);
 const items:DecisionItem[]=fromSnap?snapshot!.items:content?decisionItems(content,value.model):[];
 const models=fromSnap?(content?.models.includes(snapshot!.model||'')||!snapshot!.model?content?.models??[]:[snapshot!.model!,...(content?.models??[])]):content?.models??[];
 return <div className="sg-plan">
  <div className="sg-row">
   <label className="sg-field"><span>Strategie</span><select value={value.strategyId||''} onChange={e=>onChange({strategyId:e.target.value||null,model:null,states:{},keepVersion:false})}><option value="">Bez strategie</option>{active.map(x=><option key={x.id} value={x.id}>{x.name}{x.latest?` · v${x.latest.version}`:''}</option>)}</select></label>
   {s&&models.length>0&&<label className="sg-field"><span>Vstupní model</span><select value={value.model||''} onChange={e=>onChange({...value,model:e.target.value||null,keepVersion:false})}><option value="">Jen společné podmínky</option>{models.map(m=><option key={m} value={m}>{m}</option>)}</select></label>}
  </div>
  {fromSnap&&s?.latest&&snapshot!.version!==s.latest.version&&<p className="sg-muted">Checklist je podle verze v{snapshot!.version} (aktuální je v{s.latest.version}). Změnou strategie nebo modelu přejdeš na nejnovější verzi.</p>}
  {s&&<TriChecklist items={items} states={value.states} onChange={(id,st)=>onChange({...value,states:{...value.states,[id]:st}})}/>}
 </div>;
}
// nahrání obrázku k plánu (příklad podmínky, screenshot scénáře)
export function ImageUpload({fileId,onChange,label='Screenshot'}:{fileId:string|null;onChange:(id:string|null)=>void;label?:string}){
 const [busy,setBusy]=useState(false),[err,setErr]=useState('');
 async function up(f:File){setBusy(true);setErr('');try{const fd=new FormData();fd.append('file',f);const j=await call<{file:{id:string}}>('/api/plan-files','POST',fd);onChange(j.file.id)}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 return <span className="sg-upload">{fileId?<><a href={'/api/plan-files/'+fileId} target="_blank" rel="noreferrer"><img src={'/api/plan-files/'+fileId} alt={label}/></a><button type="button" className="al-btn sm" onClick={()=>onChange(null)}>Odebrat</button></>
  :<label className="al-btn sm">{busy?'Nahrávám…':'+ '+label}<input type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)up(f)}}/></label>}{err&&<small className="sg-err">{err}</small>}</span>;
}
