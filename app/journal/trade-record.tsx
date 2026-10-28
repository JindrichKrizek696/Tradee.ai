'use client';
// Záznam obchodu (etapa 1C): režim, plánované vs. provedené riziko, R z původního rizika, cenový / účetní BE, rozpad nákladů, změny SL/TP s důvodem, upozornění a no-trade okna.
import {useEffect,useState} from 'react';
import {AlertTriangle,Trash2} from 'lucide-react';
import type {RecordView} from '@/lib/journal/record-store';
import {MODES,type Mode} from '@/lib/journal/metrics';
import {COST_KEYS,type CostKey} from '@/lib/journal/accounting';
import {PROCESS_QUESTIONS,PROCESS_ANSWERS,processScore} from '@/lib/journal/process';
import {fmtMoney} from '@/lib/trades';
import {fmtNum,fmtR,fmtDateTime} from '@/lib/journal/format';
import './record.css';
async function send(url:string,method:string,body?:unknown):Promise<RecordView>{
 const r=await fetch(url,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json().catch(()=>({})) as RecordView&{error?:string};if(!r.ok)throw Error(j.error||'Uložení se nepovedlo. Zkus to znovu.');return j;
}
const numOrNull=(s:string)=>{const t=s.trim().replace(',','.');if(!t)return null;const n=Number(t);return Number.isFinite(n)?n:NaN};
export function useRecord(id:string,query=''){
 const url='/api/journal/'+encodeURIComponent(id)+'/record';
 const [rec,setRec]=useState<RecordView|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;fetch(url+query,{cache:'no-store'}).then(async r=>{const j=await r.json() as RecordView&{error?:string};if(!r.ok)throw Error(j.error||'Záznam obchodu se nepodařilo načíst.');if(live)setRec(j)}).catch(e=>{if(live)setError((e as Error).message)});return()=>{live=false}},[url,query]);
 return {rec,setRec,error,setError,url};
}
export function TradeRecord({id,readOnly,query='',currency,onChanged}:{id:string;readOnly:boolean;query?:string;currency:string;onChanged?:()=>void}){
 const {rec,setRec,error,setError,url}=useRecord(id,query);
 const [risk,setRisk]=useState({money:'',pct:''}),[costs,setCosts]=useState<Record<CostKey,string>>({spread:'',commission:'',swap:'',slippage:'',fee:''}),[editCosts,setEditCosts]=useState(false),[busy,setBusy]=useState(false);
 const [chg,setChg]=useState({kind:'sl',ts:'',old:'',nw:'',reason:''}),[reasons,setReasons]=useState<Record<string,string>>({});
 useEffect(()=>{if(!rec)return;setRisk({money:rec.plannedRisk===null?'':String(rec.plannedRisk),pct:rec.plannedRiskPct===null?'':String(rec.plannedRiskPct)});setCosts(Object.fromEntries(COST_KEYS.map(([k])=>[k,rec.manualCosts[k]===undefined||rec.manualCosts[k]===null?'':String(rec.manualCosts[k])])) as Record<CostKey,string>);setReasons(Object.fromEntries(rec.changes.map(c=>[c.source+c.kind+c.ts+(c.id??''),c.reason])))},[rec]);
 async function act(method:string,body:unknown){setBusy(true);try{setRec(await send(url,method,body));setError('');onChanged?.()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 if(!rec)return <section className="j-card"><h2>Záznam obchodu</h2><p className="j-muted">{error||'Načítám…'}</p></section>;
 const cur=rec.currency||currency,money=(v:number|null)=>v===null?'–':fmtMoney(v,cur);
 const saveRisk=()=>{const m=numOrNull(risk.money),p=numOrNull(risk.pct);if(Number.isNaN(m)||Number.isNaN(p)){setError('Riziko zadej jako číslo.');return}if(m===rec.plannedRisk&&p===rec.plannedRiskPct)return;act('PUT',{plannedRisk:m,plannedRiskPct:p})};
 const saveCosts=()=>{const o:Record<string,number|null>={};for(const [k] of COST_KEYS){const v=numOrNull(costs[k]);if(Number.isNaN(v)){setError('Náklady zadej jako čísla (náklad záporně).');return}o[k]=v}act('PUT',{costs:o}).then(()=>setEditCosts(false))};
 const addChange=()=>{const ts=Date.parse(chg.ts);if(!Number.isFinite(ts)){setError('Vyplň čas změny.');return}act('POST',{kind:chg.kind,ts,old:chg.old,new:chg.nw,reason:chg.reason}).then(()=>setChg({kind:chg.kind,ts:'',old:'',nw:'',reason:''}))};
 const ps=processScore(rec.process.answers);
 return <section className="j-card jr">
  <div className="jr-head"><h2>Záznam obchodu</h2>
   <label className="j-field"><span>Režim</span><select value={rec.mode} disabled={readOnly||busy} onChange={e=>act('PUT',{mode:e.target.value as Mode})}>{(Object.keys(MODES) as Mode[]).map(m=><option key={m} value={m}>{MODES[m]}</option>)}</select></label>
  </div>
  {error&&<p role="alert" className="s-notice">{error}</p>}
  {(rec.warnings.length>0||rec.collisions.length>0)&&<ul className="jr-warn">{rec.warnings.map((w,i)=><li key={'w'+i}><AlertTriangle size={14} aria-hidden/>{w.text}</li>)}{rec.collisions.map((c,i)=><li key={'c'+i}><AlertTriangle size={14} aria-hidden/>Vstup v no-trade okně: {c.title} ({fmtDateTime(c.at)}) · {c.source}</li>)}</ul>}
  <dl className="j-dl">
   <div><dt>Účet</dt><dd>{rec.account}{rec.platform==='t212'?' · T212':''}</dd></div>
   <div><dt>Strategie / vstupní model</dt><dd>{rec.plan?.strategyName?`${rec.plan.strategyName}${rec.plan.version?' v'+rec.plan.version:''}${rec.plan.model?' · '+rec.plan.model:''}`:'bez plánu'}</dd></div>
   <div><dt>Riziko provedené (první stop)</dt><dd>{rec.executedRisk===null?'bez stopu':money(-rec.executedRisk)+(rec.executedRiskPct!==null?` · ${fmtNum(rec.executedRiskPct,2)} %`:'')}</dd></div>
   <div><dt>R z původního rizika</dt><dd title="R = čistý výsledek ÷ původní plánované riziko (plán, jinak první stop). Posunutý stop R nemění.">{rec.r===null?(rec.rLabel||'–'):fmtR(rec.r)}{rec.riskBasis&&<small className="jr-sub"> · {rec.riskBasis==='plan'?'z plánu':'z prvního stopu'}</small>}</dd></div>
   {rec.be.label&&<div><dt>Break-even</dt><dd><span className={'jr-be '+rec.be.kind}>{rec.be.label}</span>{rec.be.kind==='price'&&rec.be.net!==null?` · čistý ${money(rec.be.net)}`:''}</dd></div>}
   {rec.gross!==null&&<div><dt>Hrubý / čistý výsledek</dt><dd>{money(rec.gross)} / {money(rec.net)}</dd></div>}
   {ps!==null&&<div><dt>Proces</dt><dd>{ps} %{rec.process.rating?` · ${rec.process.rating}/5`:''}</dd></div>}
   {rec.ideaId&&<div><dt>Nápad</dt><dd><a href={'#journal'} onClick={()=>{setTimeout(()=>dispatchEvent(new CustomEvent('tradee:journal-idea',{detail:rec.ideaId})),0)}}>{rec.ideaId.startsWith('auto:')?'automaticky seskupený':rec.ideaId.startsWith('sc:')?'ze scénáře':'ruční'} → záložka Nápady</a></dd></div>}
  </dl>
  <div className="jr-block"><h3>Plánované riziko</h3>
   {readOnly?<p className="j-muted">{rec.plannedRisk!==null?money(-rec.plannedRisk):'–'}{rec.plannedRiskPct!==null?` · ${fmtNum(rec.plannedRiskPct,2)} %`:''}</p>:<div className="jr-row">
    <label className="j-field"><span>Částka ({cur||'měna účtu'})</span><input inputMode="decimal" value={risk.money} onChange={e=>setRisk(r=>({...r,money:e.target.value}))} onBlur={saveRisk} placeholder="např. 100"/></label>
    <label className="j-field"><span>% účtu</span><input inputMode="decimal" value={risk.pct} onChange={e=>setRisk(r=>({...r,pct:e.target.value}))} onBlur={saveRisk} placeholder="např. 0,5"/></label>
    <small className="j-muted">Plánované riziko má přednost před prvním stopem. Bez obou je R neznámé.</small></div>}
  </div>
  <div className="jr-block"><h3>Náklady</h3>
   <table className="jr-costs"><tbody>{rec.costLines.lines.map(l=><tr key={l.key}><th>{l.label}</th><td>{l.value===null?<span className="j-muted">neznámé</span>:money(l.value)}</td></tr>)}<tr className="jr-total"><th>Celkem známé</th><td>{money(rec.costLines.total)}</td></tr></tbody></table>
   {(rec.slippagePoints!==null||rec.spreadPoints!==null)&&<small className="j-muted">Z EA: slippage {rec.slippagePoints===null?'–':fmtNum(rec.slippagePoints,1)+' b.'} · spread při vstupu {rec.spreadPoints===null?'–':fmtNum(rec.spreadPoints,1)+' b.'}</small>}
   {!readOnly&&(editCosts?<div className="jr-row">{COST_KEYS.map(([k,l])=><label key={k} className="j-field"><span>{l}</span><input inputMode="decimal" value={costs[k]} onChange={e=>setCosts(c=>({...c,[k]:e.target.value}))} placeholder="auto"/></label>)}<button type="button" className="j-btn dark" disabled={busy} onClick={saveCosts}>Uložit náklady</button><button type="button" className="j-btn" onClick={()=>setEditCosts(false)}>Zrušit</button></div>:<button type="button" className="j-btn" onClick={()=>setEditCosts(true)}>Doplnit náklady</button>)}
  </div>
  <div className="jr-block"><h3>Změny SL / TP</h3>
   {rec.changes.length?<ol className="jr-changes">{rec.changes.map(c=>{const k=c.source+c.kind+c.ts+(c.id??'');return <li key={k}><time>{fmtDateTime(c.ts)}</time><b>{c.kind==='sl'?'SL':'TP'}</b><span>{c.old===null?'–':fmtNum(c.old)} → {c.new===null?'zrušen':fmtNum(c.new)}</span><span className="j-src">{c.source==='mt'?'EA':'ručně'}</span>
    {readOnly?<em>{c.reason}</em>:<input className="jr-reason" maxLength={300} value={reasons[k]??''} placeholder="Důvod změny" aria-label="Důvod změny" onChange={e=>setReasons(r=>({...r,[k]:e.target.value}))} onBlur={()=>{if((reasons[k]??'')===c.reason)return;if(c.source==='mt')act('POST',{source:'mt',kind:c.kind,ts:c.ts,reason:reasons[k]??''});else act('POST',{changeId:c.id,reason:reasons[k]??''})}}/>}
    {!readOnly&&c.source==='manual'&&<button type="button" className="jr-x" aria-label="Smazat změnu" onClick={()=>act('DELETE',{changeId:c.id})}><Trash2 size={13}/></button>}</li>})}</ol>:<p className="j-muted">{rec.source==='mt'&&rec.platform!=='t212'?'EA zatím neposlal žádnou změnu SL / TP.':'Zatím bez záznamu změn – zapiš je ručně.'}</p>}
   {!readOnly&&<div className="jr-row">
    <label className="j-field"><span>Druh</span><select value={chg.kind} onChange={e=>setChg(c=>({...c,kind:e.target.value}))}><option value="sl">SL</option><option value="tp">TP</option></select></label>
    <label className="j-field"><span>Čas</span><input type="datetime-local" value={chg.ts} onChange={e=>setChg(c=>({...c,ts:e.target.value}))}/></label>
    <label className="j-field"><span>Z</span><input inputMode="decimal" value={chg.old} onChange={e=>setChg(c=>({...c,old:e.target.value}))}/></label>
    <label className="j-field"><span>Na</span><input inputMode="decimal" value={chg.nw} onChange={e=>setChg(c=>({...c,nw:e.target.value}))}/></label>
    <label className="j-field jr-grow"><span>Důvod</span><input maxLength={300} value={chg.reason} onChange={e=>setChg(c=>({...c,reason:e.target.value}))}/></label>
    <button type="button" className="j-btn" disabled={busy} onClick={addChange}>Zapsat změnu</button></div>}
  </div>
  {Object.keys(rec.process.answers).length>0&&<div className="jr-block"><h3>Hodnocení procesu</h3><ul className="jr-proc">{PROCESS_QUESTIONS.map(q=><li key={q.id}><span>{q.text}</span><b>{rec.process.answers[q.id]?PROCESS_ANSWERS[rec.process.answers[q.id]]:'–'}</b></li>)}</ul></div>}
 </section>;
}
