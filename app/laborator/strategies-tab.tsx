'use client';
// Laboratoř · Strategie (jen vlastník): obecný engine pravidlových strategií – definice jsou JSON v DB (lab_strategy_defs), výsledky
// počítá scripts/lab-strategies.mjs (IS / OOS, hranice náhody, varianty). Tady: seznam, výsledky, editor JSON s validací a „Pustit do
// simulace“ (agent R01…R40 s neměnnou kopií verze). API /api/laborator/strategies vrací ostatním 404.
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Play,Save,Trash2,Plus,AlertTriangle,CheckCircle2} from 'lucide-react';
import {fmtNum} from '@/lib/journal/format';
import {parseDefJson,BLOCKS,BLOCK_IDS} from '@/lib/lab/rules-def';
import type {StrategyRunResult,RunSummary,SegMetrics} from '@/lib/lab/strat-engine';
import {EquityChart} from '../journaling/backtest/equity-chart';

type DefItem={id:string;name:string;version:number;updated:string;valid:boolean;errors:number;markets:string[];data:string|null;conditions:number;variants:number;run:{id:string;version:number;created:string;summary:RunSummary|null}|null};
type ListData={defs:DefItem[];running:{variant:string;defId:string;version:number;active:boolean}[]};
type Detail={def:{id:string;name:string;version:number;text:string;errors:string[];updated:string;outline:string[]};run:{id:string;version:number;created:string;result:StrategyRunResult}|null};
async function call<T>(url:string,method='GET',body?:unknown):Promise<T>{
 const r=await fetch(url,{method,cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json().catch(()=>({})) as {error?:string;errors?:string[]};
 if(!r.ok)throw Object.assign(new Error(j.error||'Akce se nepovedla.'),{status:r.status,errors:j.errors});return j as T;
}
const n2=(v:number|null|undefined,d=2)=>v===null||v===undefined?'–':fmtNum(v,d);
const rr=(v:number|null|undefined)=>v===null||v===undefined?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(v),2)+' R';
const sgn=(v:number|null|undefined)=>v===null||v===undefined?'':v>0?'pos':v<0?'neg':'';
const when=(s:string)=>s?new Date(s).toLocaleString('cs-CZ'):'–';
// prázdná šablona pro novou definici (obecná ukázka struktury – parametry si vlastník doplní)
const TEMPLATE=JSON.stringify({name:'Nová strategie',version:1,markets:['EUR/USD'],data:'D1',tf:{context:'W1',zone:'D1',entry:'D1'},
 conditions:[{id:'trend',block:'trend_swing',tf:'context',role:'required',params:{n:2}},{id:'ma',block:'ma',role:'optional',params:{period:50}}],
 entry:{type:'market_on_close'},stop:{from:'entry',atrK:1.5},targets:{type:'r',r:2},management:{},risk:{basePct:1},filters:{},variants:[]},null,1);
const METRIC_ROWS:[keyof SegMetrics,string,(v:number|null)=>string][]=[['trades','Obchodů',v=>v===null?'–':String(v)],['winRate','Win rate',v=>v===null?'–':fmtNum(v,1)+' %'],['avgR','Průměr R',rr],['pf','Profit factor',v=>n2(v)],['maxDd','Max. drawdown (R)',v=>n2(v)],['expectancy','Expectancy (R)',rr]];

export function StrategiesTab(){
 const [list,setList]=useState<ListData|null>(null),[err,setErr]=useState(''),[missing,setMissing]=useState(false),[sel,setSel]=useState<string|null>(null);
 const [detail,setDetail]=useState<Detail|null>(null),[edit,setEdit]=useState<string|null>(null),[editErrs,setEditErrs]=useState<string[]>([]),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 const [vi,setVi]=useState(0);
 const load=useCallback(()=>{call<ListData>('/api/laborator/strategies').then(j=>{setList(j);setErr('')}).catch(e=>{if((e as {status?:number}).status===503)setMissing(true);else setErr((e as Error).message)})},[]);
 useEffect(()=>{load()},[load]);
 const open=useCallback((id:string)=>{setSel(id);setDetail(null);setEdit(null);setEditErrs([]);setMsg('');setVi(0);
  call<Detail>('/api/laborator/strategies?id='+encodeURIComponent(id)).then(setDetail).catch(e=>setErr((e as Error).message))},[]);
 const check=(text:string)=>{const v=parseDefJson(text);setEditErrs(v.ok?[]:v.errors);return v.ok};
 async function save(){
  if(edit===null||!check(edit))return;setBusy(true);setMsg('');
  try{const r=await call<{id:string;version:number;changed:boolean}>('/api/laborator/strategies','POST',{action:'save',id:sel==='new'?null:sel,text:edit});
   setMsg(r.changed?`Uloženo jako verze ${r.version}. Výsledky se přepočítají při příštím běhu scripts/lab-strategies.mjs.`:'Beze změny obsahu.');load();open(r.id)}
  catch(e){setEditErrs((e as {errors?:string[]}).errors??[(e as Error).message])}finally{setBusy(false)}
 }
 async function simulate(){if(!sel||sel==='new')return;setBusy(true);setMsg('');
  try{const r=await call<{variant:string}>('/api/laborator/strategies','POST',{action:'simulate',id:sel});setMsg(`Agent ${r.variant} poběží v Simulaci od dalšího běhu (každých 15 min).`);load()}
  catch(e){setMsg((e as Error).message)}finally{setBusy(false)}}
 async function remove(){if(!sel||sel==='new'||!confirm('Smazat definici a její výsledky? Agenti v simulaci zůstanou (mají vlastní kopii).'))return;setBusy(true);
  try{await call('/api/laborator/strategies','POST',{action:'delete',id:sel,confirm:'SMAZAT'});setSel(null);setDetail(null);load()}catch(e){setMsg((e as Error).message)}finally{setBusy(false)}}
 const res=detail?.run?.result??null,v=res?.variants[vi]??null,stale=detail&&detail.run&&detail.run.version!==detail.def.version;
 const running=list?.running.filter(r=>r.defId===sel)??[];
 const curve=useMemo(()=>v&&v.equity.length?[{label:v.name,cls:'a' as const,points:[{t:v.equity[0][0]-1,equity:100},...v.equity.map(([t,e])=>({t,equity:e}))]}]:[],[v]);
 if(missing)return <section className="mt-card"><h2>Strategie</h2><p className="mt-alert">Tabulky strategií zatím neexistují – na VPS je potřeba spustit migraci 0035_lab_strategy_defs.sql.</p></section>;
 return <>
  <section className="mt-card">
   <h2>Strategie</h2>
   <p className="mt-lead">Obecný engine pravidlových strategií: definice je JSON v databázi (podmínky z bloků, vstup, stop, cíle, řízení, riziko, filtry, varianty). Test běží mimo web – <code>scripts/lab-strategies.mjs</code> – na D1 historii od 2003 (H1 jen asi 2 roky), bez pohledu do budoucna, s in-sample / out-of-sample a hranicí náhody.</p>
   {err&&<p className="mt-alert" role="alert">{err}</p>}
   {!list?<p className="mt-empty">Načítám…</p>:<>
    {!list.defs.length&&<p className="mt-empty">Zatím žádná definice. Vlož ji tlačítkem níže nebo importem <code>--import soubor.json</code>.</p>}
    {!!list.defs.length&&<div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Název</th><th>Verze</th><th>Data</th><th>Trhy</th><th>Podmínky</th><th>IS průměr R</th><th>OOS průměr R</th><th>OOS obchodů</th><th>Náhoda</th><th>Robustní</th><th>Spočítáno</th></tr></thead>
     <tbody>{list.defs.map(x=>{const s=x.run?.summary;return <tr key={x.id} className={x.id===sel?'lb-sel':''}>
      <td><button className="lb-link" onClick={()=>open(x.id)}>{x.name}</button>{!x.valid&&<small><AlertTriangle size={12}/> neplatná ({x.errors} chyb)</small>}</td>
      <td>v{x.version}{x.run&&x.run.version!==x.version&&<small>výsledek je z v{x.run.version}</small>}</td><td>{x.data??'–'}</td><td>{x.markets.length}</td><td>{x.conditions}{x.variants?` · ${x.variants} var.`:''}</td>
      <td className={sgn(s?.is.avgR)}>{rr(s?.is.avgR)}</td><td className={sgn(s?.oos.avgR)}>{rr(s?.oos.avgR)}</td><td>{s?.oos.trades??'–'}</td><td>{rr(s?.chance)}</td><td>{s?(s.robust?`ano (${s.robust}/${s.variants})`:'ne'):'–'}</td><td>{x.run?when(x.run.created):'zatím ne'}</td></tr>})}</tbody></table></div>}
    <div className="lb-form"><button className="mt-btn" onClick={()=>{setSel('new');setDetail(null);setEdit(TEMPLATE);setEditErrs([]);setMsg('')}}><Plus size={15}/>Nová definice</button></div>
   </>}
  </section>
  {sel&&sel!=='new'&&!detail&&<section className="mt-card"><p className="mt-empty">Načítám…</p></section>}
  {detail&&<section className="mt-card">
   <h2>{detail.def.name} · v{detail.def.version}</h2>
   {detail.def.errors.length>0&&<div className="mt-alert" role="alert"><b>Definice není platná:</b><ul>{detail.def.errors.map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
   {detail.def.outline.length>0&&<ul className="lb-notes">{detail.def.outline.map((l,i)=><li key={i}>{l}</li>)}</ul>}
   <div className="lb-form lb-actions">
    <button className="mt-btn dark" disabled={busy||!!detail.def.errors.length} onClick={simulate}><Play size={15}/>Pustit do simulace</button>
    <button className="mt-btn" onClick={()=>{setEdit(detail.def.text);setEditErrs([]);setMsg('')}}>Upravit JSON</button>
    <button className="mt-btn" disabled={busy} onClick={remove}><Trash2 size={15}/>Smazat</button>
    {running.length>0&&<span className="lb-hint">V simulaci: {running.map(r=>`${r.variant} (v${r.version}${r.active?'':', vypnutý'})`).join(', ')}</span>}
   </div>
   {msg&&<p className="lb-meta" role="status">{msg}</p>}
   {!res?<p className="mt-empty">Výsledek zatím není – spusť na VPS <code>node --experimental-strip-types scripts/lab-strategies.mjs --id {detail.def.id}</code>.</p>:<>
    <p className="lb-meta">Spočítáno {when(detail.run!.created)} pro verzi v{detail.run!.version}{stale?' (definice se od té doby změnila)':''} · {res.splitRule} · období {res.from} – {res.to}, OOS od {res.split} · {res.markets.length} trhů · {fmtNum(res.ms/1000,1)} s</p>
    {res.warnings.length>0&&<ul className="lb-notes">{res.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}
    <h3 className="lb-h3">Varianty</h3>
    <div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Varianta</th><th>IS obch.</th><th>IS průměr R</th><th>IS PF</th><th>OOS obch.</th><th>OOS win rate</th><th>OOS průměr R</th><th>OOS PF</th><th>OOS DD (R)</th><th>vs náhoda</th><th>Výnos / DD %</th><th>Robustní</th></tr></thead>
     <tbody>{res.variants.map((x,i)=>{const c=res.chance?.median??null,o=x.metrics.oos;return <tr key={x.name} className={i===vi?'lb-sel':''}>
      <td><button className="lb-link" onClick={()=>setVi(i)}>{x.name}</button></td><td>{x.metrics.is.trades}</td><td className={sgn(x.metrics.is.avgR)}>{rr(x.metrics.is.avgR)}</td><td>{n2(x.metrics.is.pf)}</td>
      <td>{o.trades}</td><td>{o.winRate===null?'–':fmtNum(o.winRate,1)+' %'}</td><td className={sgn(o.avgR)}>{rr(o.avgR)}</td><td>{n2(o.pf)}</td><td>{n2(o.maxDd)}</td>
      <td className={c!==null&&o.avgR!==null?sgn(o.avgR-c):''}>{c===null||o.avgR===null?'–':o.avgR>c?'nad':'pod'}</td><td>{n2(x.returnPct,1)} / {n2(x.maxDdPct,1)}</td><td>{x.robust?<><CheckCircle2 size={14}/> ano</>:'ne'}</td></tr>})}</tbody></table></div>
    <p className="lb-hint">Hranice náhody (medián nejlepšího OOS průměru R s náhodnými směry, {res.chance?.reps??0}×): {rr(res.chance?.median)} (max {rr(res.chance?.max)}). {res.robustRule}</p>
    {v&&<>
     <h3 className="lb-h3">{v.name}: in-sample vs out-of-sample</h3>
     <div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th></th><th>In-sample</th><th>Out-of-sample</th><th>Celkem</th></tr></thead>
      <tbody>{METRIC_ROWS.map(([k,l,f])=><tr key={k}><td>{l}</td>{(['is','oos','all'] as const).map(s=><td key={s} className={k==='avgR'||k==='expectancy'?sgn(v.metrics[s][k] as number|null):''}>{f(v.metrics[s][k] as number|null)}</td>)}</tr>)}
       {res.chance?.median!=null&&<tr className="lb-edge"><td>Hranice náhody (OOS průměr R)</td><td></td><td>{rr(res.chance.median)}</td><td></td></tr>}</tbody></table></div>
     <h3 className="lb-h3">Equity (riziko podle definice, start 100)</h3>
     {curve.length?<EquityChart series={curve} fmt={x=>fmtNum(x,1)}/>:<p className="mt-empty">Bez obchodů.</p>}
     <h3 className="lb-h3">Po trzích</h3>
     <div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Trh</th><th>IS obch.</th><th>IS průměr R</th><th>OOS obch.</th><th>OOS průměr R</th><th>OOS PF</th><th>Celkem R</th></tr></thead>
      <tbody>{v.perMarket.map(m=><tr key={m.id} className={m.all.trades?'':'lb-dim'}><td>{m.id}</td><td>{m.is.trades}</td><td className={sgn(m.is.avgR)}>{rr(m.is.avgR)}</td><td>{m.oos.trades}</td><td className={sgn(m.oos.avgR)}>{rr(m.oos.avgR)}</td><td>{n2(m.oos.pf)}</td><td className={sgn(m.all.totalR)}>{rr(m.all.totalR)}</td></tr>)}</tbody></table></div>
     <details className="lb-details"><summary>Signály a důvody bez obchodu</summary>
      <p className="lb-meta">Signálů {v.signals}. {Object.entries(v.skips).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}: ${n}`).join(' · ')||'Žádné přeskočené.'}</p>
      {Object.keys(v.unknown).length>0&&<p className="lb-meta">Bez dat (zprávy mimo pokrytí kalendáře neblokují; ostatní podmínky bez dat neplatí): {Object.entries(v.unknown).map(([k,n])=>`${BLOCKS[k as keyof typeof BLOCKS]?.label??k}: ${n}`).join(' · ')}</p>}
     </details>
    </>}
    {res.notes.length>0&&<ul className="lb-notes">{res.notes.map((x,i)=><li key={i}>{x}</li>)}</ul>}
   </>}
  </section>}
  {edit!==null&&<section className="mt-card">
   <h2>{sel==='new'?'Nová definice':'Úprava definice'} (JSON)</h2>
   <p className="lb-hint">Změna obsahu uloží novou verzi; agenti v simulaci dál běží na verzi, se kterou byli spuštěni. Bloky: {BLOCK_IDS.map(b=>`${b} – ${BLOCKS[b].label}`).join(' · ')}.</p>
   <textarea className="lb-pre" style={{width:'100%',minHeight:420}} spellCheck={false} value={edit} onChange={e=>{setEdit(e.target.value);if(editErrs.length)check(e.target.value)}} aria-label="Definice strategie (JSON)"/>
   {editErrs.length>0&&<div className="mt-alert" role="alert"><b>Chyby ({editErrs.length}):</b><ul>{editErrs.map((e,i)=><li key={i}>{e}</li>)}</ul></div>}
   <div className="lb-form"><button className="mt-btn" onClick={()=>{if(check(edit))setMsg('Definice je platná.')}}>Zkontrolovat</button><button className="mt-btn dark" disabled={busy} onClick={save}><Save size={15}/>{busy?'Ukládám…':'Uložit'}</button><button className="mt-btn" onClick={()=>{setEdit(null);setEditErrs([]);if(sel==='new')setSel(null)}}>Zavřít</button></div>
   {msg&&<p className="lb-meta" role="status">{msg}</p>}
  </section>}
 </>;
}
