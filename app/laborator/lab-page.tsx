'use client';
// Laboratoř (jen vlastník): studie signálů, tester pravidel, poznámky pro AI a jejich souhrn. API /api/laborator/* vrací 404 všem ostatním.
import {Fragment,useCallback,useEffect,useMemo,useState} from 'react';
import {ArrowLeft,AlertTriangle,Plus,Trash2,Copy,Save,Play,X,RotateCcw,ChevronDown,ChevronRight,LineChart} from 'lucide-react';
import {usePalette} from '../palette';
import {EquityChart} from '../journaling/backtest/equity-chart';
import {fmtNum} from '@/lib/journal/format';
import type {StudyResult,SignalId,SignalStat} from '@/lib/lab/study';
import {DEFAULT_LAB_RULE,DIRECTION_LABELS,LAB_COND_LABELS,type LabRule,type LabCond,type LabDirection} from '@/lib/lab/rules';
import type {LabNote,LabRuleRow} from '@/lib/lab/core';
import type {BacktestSummary} from '@/lib/backtest/metrics';
import type {EquityPoint,MarketResult} from '@/lib/backtest/engine';
import type {PaperTrade,PaperStats,PaperEquityPoint} from '@/lib/lab/paper';
import '../mt.css';
import '../journaling/backtest/backtest.css';
import './lab.css';
type Opt={id:string;label:string};type Market={id:string;name:string;group:string};
type Boot={markets:Market[];sets:Opt[];methods:Opt[]};
class HttpError extends Error{constructor(m:string,public status:number){super(m)}}
async function call<T>(url:string,method='GET',body?:unknown):Promise<T>{
 const r=await fetch(url,{method,cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw new HttpError(j.error||'Akce se nepovedla.',r.status);return j as T;
}
const pct=(v:number|null,d=2)=>v===null?'–':(v>0?'+':'')+fmtNum(v,d)+' %';
const num=(v:number|null,d=2)=>v===null?'–':fmtNum(v,d);
const sgn=(v:number|null)=>v===null?'':v>0?'pos':v<0?'neg':'';
const day=(t:number|null)=>t===null?'–':new Date(t).toLocaleDateString('cs-CZ');
const TABS=[['study','Předpovídá to cenu?'],['paper','Simulace'],['rules','Moje pravidla'],['notes','Poznámky pro AI'],['summary','Shrnutí pro AI']] as const;
type Tab=typeof TABS[number][0];

export default function LabPage(){
 usePalette();
 const [boot,setBoot]=useState<Boot|null>(null),[gone,setGone]=useState(false),[tab,setTab]=useState<Tab>('study');
 useEffect(()=>{call<Boot>('/api/laborator').then(b=>{const h=location.hash.slice(1);if(TABS.some(([k])=>k===h))setTab(h as Tab);setBoot(b);document.title='Laboratoř · Tradee'}).catch(()=>setGone(true))},[]);
 const pick=(t:Tab)=>{setTab(t);history.replaceState(null,'','#'+t)};
 if(gone)return <div className="mt-page"><main className="mt-main"><h1>404</h1><p className="mt-lead">Stránka nenalezena.</p><a className="mt-btn" href="/">Zpět do Tradee</a></main></div>;
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main lb-main">
   <h1>Laboratoř</h1>
   <p className="mt-lead">Soukromý výzkum – vidíš ho jen ty. Testy běží nad historickými denními svíčkami a vždy jen s daty, která byla v daný den opravdu známá.</p>
   <div className="mt-chips lb-tabs" role="tablist">{TABS.map(([k,l])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>pick(k)}>{l}</button>)}</div>
   {!boot?<p className="mt-empty">Načítám…</p>:tab==='study'?<Study boot={boot}/>:tab==='rules'?<Rules boot={boot}/>:tab==='notes'?<Notes/>:tab==='paper'?<Paper/>:<Summary/>}
  </main>
 </div>;
}

// ---------------- Studie
function Study({boot}:{boot:Boot}){
 const [set,setSet]=useState('fx'),[from,setFrom]=useState('2015-01-01'),[to,setTo]=useState(''),[methods,setMethods]=useState('main');
 const [res,setRes]=useState<StudyResult|null>(null),[busy,setBusy]=useState(false),[err,setErr]=useState(''),[sig,setSig]=useState<SignalId>('trend'),[h,setH]=useState(20),[market,setMarket]=useState('');
 useEffect(()=>{call<{study:StudyResult|null;params:{set:string;from:string;to:string;methods:string}|null}>('/api/laborator/study?latest=1').then(j=>{if(j.study){setRes(j.study);if(j.params){setSet(j.params.set);setFrom(j.params.from);setTo(j.params.to||'');setMethods(j.params.methods)}}}).catch(()=>{})},[]);
 async function run(fresh=false){setBusy(true);setErr('');try{const q=new URLSearchParams({set,from,to,methods});if(fresh)q.set('fresh','1');const j=await call<{study:StudyResult}>('/api/laborator/study?'+q);setRes(j.study)}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 const stat:SignalStat|undefined=useMemo(()=>{if(!res)return;const src=market?res.perMarket.find(m=>m.instrument===market)?.signals:res.aggregate;return src?.find(s=>s.id===sig)},[res,sig,market]);
 const hs=stat?.horizons.find(x=>x.h===h);
 const rows=useMemo(()=>res?res.perMarket.map(m=>({id:m.instrument,e:m.signals.find(s=>s.id===sig)?.horizons.find(x=>x.h===h)?.edge})).filter(x=>x.e&&x.e.n>0).sort((a,b)=>(b.e!.t??-99)-(a.e!.t??-99)):[],[res,sig,h]);
 return <section className="mt-card">
  <h2>Předpovídá to cenu?</h2>
  <p className="mt-lead">Pro každý signál a každou svíčku od zvoleného data: jaký byl budoucí výnos za 1, 5 a 20 obchodních dní. Koše signálu porovnává s baseline (všechny dny, kdy měl signál hodnotu).</p>
  <div className="lb-form">
   <label>Trhy<select value={set} onChange={e=>setSet(e.target.value)}>{boot.sets.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
   <label>Od<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label>Do<input type="date" value={to} onChange={e=>setTo(e.target.value)} placeholder="dnes"/></label>
   <label>Skóre Tradee<select value={methods} onChange={e=>setMethods(e.target.value)}>{boot.methods.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
   <button className="mt-btn dark" disabled={busy} onClick={()=>run()}><Play size={15}/>{busy?'Počítám…':'Spočítat'}</button>
   {res&&<button className="mt-btn" disabled={busy} onClick={()=>run(true)}>Přepočítat bez cache</button>}
  </div>
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  {!res&&!busy&&<p className="mt-empty">Studie zatím neproběhla. Výpočet nad 28 páry trvá několik sekund.</p>}
  {res&&<>
   <p className="lb-meta">Období {day(res.from)} – {day(res.to)} · {res.markets.length} trhů · spočítáno {new Date(res.computedAt).toLocaleString('cs-CZ')}</p>
   <div className="lb-row">
    <div className="mt-chips">{(['trend','season','cot','score'] as SignalId[]).map(s=><button key={s} className={sig===s?'active':''} onClick={()=>setSig(s)}>{s==='trend'?'Trend':s==='season'?'Sezonalita':s==='cot'?'COT':'Skóre'}</button>)}</div>
    <div className="mt-chips">{[1,5,20].map(x=><button key={x} className={h===x?'active':''} onClick={()=>setH(x)}>{x} {x===1?'den':'dní'}</button>)}</div>
    <select className="lb-select" value={market} onChange={e=>setMarket(e.target.value)}><option value="">Souhrn všech trhů</option>{res.perMarket.map(m=><option key={m.instrument} value={m.instrument}>{m.instrument}</option>)}</select>
   </div>
   {stat&&hs&&<>
    <p className="lb-meta">{stat.label}{stat.from!==null?` · data ${day(stat.from)} – ${day(stat.to)}`:''} · baseline n {hs.baseline.n.toLocaleString('cs-CZ')}, průměr {pct(hs.baseline.avgPct,3)}, růst {num(hs.baseline.upPct,1)} %</p>
    {hs.baseline.n===0?<p className="mt-empty">Pro tento signál v období nejsou data{sig==='cot'?' (COT historii doplní scripts/lab-cot-history.mjs)':sig==='score'?' (uložené snapshoty skóre pokrývají jen krátké období)':''}.</p>:
    <div className="lb-scroll"><table className="mt-table lb-table">
     <thead><tr><th>Koš</th><th>n</th><th>Průměr</th><th>Průměr ATR</th><th>Hit rate</th><th>Růst</th><th>vs baseline</th><th>t</th></tr></thead>
     <tbody>{hs.buckets.map(b=><tr key={b.bucket} className={b.n?'':'lb-dim'}><td>{b.label}</td><td>{b.n.toLocaleString('cs-CZ')}</td><td className={sgn(b.avgPct)}>{pct(b.avgPct,3)}</td><td className={sgn(b.avgAtr)}>{num(b.avgAtr)}</td><td>{b.hit===null?'–':num(b.hit,1)+' %'}</td><td>{b.upPct===null?'–':num(b.upPct,1)+' %'}</td><td className={sgn(b.excessPct)}>{pct(b.excessPct,3)}</td><td className={b.t!==null&&Math.abs(b.t)>=2?'lb-strong':''}>{num(b.t)}</td></tr>)}
      <tr className="lb-edge"><td>Směrová hrana<small>výnos ve směru signálu (koše ≠ 0)</small></td><td>{hs.edge.n.toLocaleString('cs-CZ')}</td><td className={sgn(hs.edge.avgPct)}>{pct(hs.edge.avgPct,3)}</td><td className={sgn(hs.edge.avgAtr)}>{num(hs.edge.avgAtr)}</td><td>{hs.edge.hit===null?'–':num(hs.edge.hit,1)+' %'}</td><td>–</td><td>–</td><td className={hs.edge.t!==null&&Math.abs(hs.edge.t)>=2?'lb-strong':''}>{num(hs.edge.t)}</td></tr></tbody>
    </table></div>}
   </>}
   {!market&&rows.length>0&&<details className="lb-details"><summary>Směrová hrana po trzích ({rows.length})</summary><div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Trh</th><th>n</th><th>Průměr</th><th>Průměr ATR</th><th>Hit rate</th><th>t</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}><td><button className="lb-link" onClick={()=>setMarket(r.id)}>{r.id}</button></td><td>{r.e!.n}</td><td className={sgn(r.e!.avgPct)}>{pct(r.e!.avgPct,3)}</td><td className={sgn(r.e!.avgAtr)}>{num(r.e!.avgAtr)}</td><td>{num(r.e!.hit,1)} %</td><td className={r.e!.t!==null&&Math.abs(r.e!.t)>=2?'lb-strong':''}>{num(r.e!.t)}</td></tr>)}</tbody></table></div></details>}
   <ul className="lb-notes">{res.notes.map((n,i)=><li key={i}>{n}</li>)}</ul>
  </>}
 </section>;
}

// ---------------- Pravidla
type TestRes={summary:BacktestSummary;equity:EquityPoint[];perMarket:MarketResult[];warnings:string[]};
const OPS:Record<LabCond['type'],string[]>={trend:['>=','<=','='],season:['>=','<=','='],cot:['>','<'],score:['>','<']};
const DEF_COND:Record<LabCond['type'],LabCond>={trend:{type:'trend',op:'>=',value:2},season:{type:'season',op:'>=',value:1},cot:{type:'cot',op:'>',value:.25},score:{type:'score',op:'>',value:20}};
function Rules({boot}:{boot:Boot}){
 const [rule,setRule]=useState<LabRule>(DEFAULT_LAB_RULE),[name,setName]=useState(''),[id,setId]=useState<string|null>(null);
 const [saved,setSaved]=useState<LabRuleRow[]>([]),[res,setRes]=useState<TestRes|null>(null),[busy,setBusy]=useState(''),[err,setErr]=useState(''),[missing,setMissing]=useState(false);
 const load=useCallback(()=>call<{rules:LabRuleRow[]}>('/api/laborator/rules').then(j=>setSaved(j.rules)).catch(e=>{if((e as HttpError).status===503)setMissing(true)}),[]);
 useEffect(()=>{load()},[load]);
 const up=(p:Partial<LabRule>)=>setRule(r=>({...r,...p}));
 const setCond=(i:number,c:LabCond)=>up({conds:rule.conds.map((x,k)=>k===i?c:x)});
 const groups=useMemo(()=>[['fx','FX páry'],['commodities','Komodity'],['index','Indexy']].map(([g,l])=>({g,l,list:boot.markets.filter(m=>m.group===g&&(g!=='index'||m.id.startsWith('^')))})),[boot]);
 const toggle=(m:string)=>up({markets:rule.markets.includes(m)?rule.markets.filter(x=>x!==m):[...rule.markets,m]});
 async function test(){setBusy('test');setErr('');try{setRes(await call<TestRes>('/api/laborator/rules/test','POST',{rule,id,name}));if(id)load()}catch(e){setErr((e as Error).message)}finally{setBusy('')}}
 async function save(){setBusy('save');setErr('');try{const j=await call<{id:string;rules:LabRuleRow[]}>('/api/laborator/rules','POST',{id,name,rule,summary:res?{...res.summary,at:new Date().toISOString()}:undefined});setId(j.id);setSaved(j.rules)}catch(e){setErr((e as Error).message)}finally{setBusy('')}}
 async function remove(rid:string){if(!confirm('Smazat uložené pravidlo?'))return;try{await call('/api/laborator/rules?id='+encodeURIComponent(rid),'DELETE');if(rid===id)setId(null);load()}catch(e){setErr((e as Error).message)}}
 const s=res?.summary;
 return <>
  <section className="mt-card">
   <h2>Moje pravidla</h2>
   <p className="mt-lead">Složení podmínek nad signály Laboratoře. Vstup na open dne po signálu, stop-loss v ATR(14), výstup po N dnech nebo na TP. Spread podle výchozích hodnot backtestu, riziko 1 % na obchod.</p>
   {missing&&<p className="mt-alert">Ukládání ještě nejde – chybí migrace databáze (0025_lab.sql). Testovat lze.</p>}
   <div className="lb-form">
    <label className="lb-grow">Název<input value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="Např. Trend +2 a COT long"/></label>
    <label>Od<input type="date" value={rule.from} onChange={e=>up({from:e.target.value})}/></label>
    <label>Do<input type="date" value={rule.to} onChange={e=>up({to:e.target.value})}/></label>
   </div>
   <h3 className="lb-h3">Podmínky (všechny zároveň)</h3>
   <div className="lb-conds">
    {rule.conds.map((c,i)=><div key={i} className="lb-cond">
     <select value={c.type} onChange={e=>setCond(i,DEF_COND[e.target.value as LabCond['type']])}>{(Object.keys(LAB_COND_LABELS) as LabCond['type'][]).map(t=><option key={t} value={t}>{LAB_COND_LABELS[t]}</option>)}</select>
     <select value={c.op} onChange={e=>setCond(i,{...c,op:e.target.value} as LabCond)}>{OPS[c.type].map(o=><option key={o} value={o}>{o==='>='?'≥':o==='<='?'≤':o}</option>)}</select>
     <input type="number" step={c.type==='cot'?.05:c.type==='score'?5:1} min={c.type==='cot'?-1:c.type==='score'?-100:-2} max={c.type==='cot'?1:c.type==='score'?100:2} value={c.value} onChange={e=>setCond(i,{...c,value:Number(e.target.value)})}/>
     <span className="lb-hint">{c.type==='trend'||c.type==='season'?'−2 … +2':c.type==='cot'?'signál −1 … +1':'skóre −100 … +100'}</span>
     <button className="mt-icon" aria-label="Odebrat podmínku" onClick={()=>up({conds:rule.conds.filter((_,k)=>k!==i)})}><X size={14}/></button>
    </div>)}
    {rule.tech.map((c,i)=><div key={'t'+i} className="lb-cond"><span>{c.type==='rsi'?`RSI(${c.period}) ${c.op} ${c.value}`:c.type==='ma'?`Close ${c.op==='above'?'nad':'pod'} ${c.kind.toUpperCase()}(${c.period})`:c.type}</span><button className="mt-icon" aria-label="Odebrat podmínku" onClick={()=>up({tech:rule.tech.filter((_,k)=>k!==i)})}><X size={14}/></button></div>)}
    <div className="lb-addrow">
     {(Object.keys(LAB_COND_LABELS) as LabCond['type'][]).map(t=><button key={t} className="mt-btn" onClick={()=>up({conds:[...rule.conds,DEF_COND[t]]})}><Plus size={14}/>{LAB_COND_LABELS[t]}</button>)}
     <button className="mt-btn" onClick={()=>up({tech:[...rule.tech,{type:'ma',kind:'sma',period:200,op:'above'}]})}><Plus size={14}/>Close nad SMA200</button>
     <button className="mt-btn" onClick={()=>up({tech:[...rule.tech,{type:'rsi',period:14,op:'<',value:30}]})}><Plus size={14}/>RSI(14) &lt; 30</button>
    </div>
   </div>
   <div className="lb-form">
    <label>Směr<select value={rule.direction} onChange={e=>up({direction:e.target.value as LabDirection})}>{(Object.keys(DIRECTION_LABELS) as LabDirection[]).map(d=><option key={d} value={d}>{DIRECTION_LABELS[d]}</option>)}</select></label>
    <label>SL (× ATR)<input type="number" step={.1} min={.1} max={20} value={rule.sl} onChange={e=>up({sl:Number(e.target.value)})}/></label>
    <label>Take profit<select value={rule.tp.type} onChange={e=>up({tp:{type:e.target.value as 'r'|'none',value:rule.tp.value||2}})}><option value="none">Žádný</option><option value="r">V násobcích R</option></select></label>
    {rule.tp.type==='r'&&<label>TP (R)<input type="number" step={.1} min={.1} max={50} value={rule.tp.value} onChange={e=>up({tp:{type:'r',value:Number(e.target.value)}})}/></label>}
    <label>Držet max. (dní)<input type="number" min={1} max={500} value={rule.hold??''} placeholder="bez limitu" onChange={e=>up({hold:e.target.value===''?null:Number(e.target.value)})}/></label>
   </div>
   <h3 className="lb-h3">Trhy ({rule.markets.length})</h3>
   {groups.map(g=><div key={g.g} className="lb-markets"><span className="lb-glabel">{g.l}</span>{g.list.map(m=><label key={m.id} className={'lb-mk'+(rule.markets.includes(m.id)?' on':'')}><input type="checkbox" checked={rule.markets.includes(m.id)} onChange={()=>toggle(m.id)}/>{m.id}</label>)}</div>)}
   <div className="lb-form lb-actions">
    <button className="mt-btn dark" disabled={!!busy} onClick={test}><Play size={15}/>{busy==='test'?'Testuji…':'Otestovat'}</button>
    <button className="mt-btn" disabled={!!busy||!name.trim()||missing} onClick={save}><Save size={15}/>{id?'Uložit změny':'Uložit pravidlo'}</button>
    {id&&<button className="mt-btn" onClick={()=>{setId(null);setName('')}}>Uložit jako nové</button>}
   </div>
   {err&&<p className="mt-alert" role="alert">{err}</p>}
  </section>
  {res&&s&&<section className="mt-card bt">
   <h2>Výsledek</h2>
   {res.warnings.length>0&&<div className="bt-warn"><AlertTriangle size={16}/><ul>{res.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}
   <dl className="bt-tiles">{([['Obchody',String(s.trades),`${s.wins} zisk · ${s.losses} ztráta`,''],['Win rate',s.winRate===null?'–':num(s.winRate,1)+' %','',''],['Průměr',s.avgR===null?'–':(s.avgR>0?'+':'')+num(s.avgR)+' R',`celkem ${num(s.totalR)} R`,sgn(s.avgR)],['Profit factor',num(s.profitFactor),'',''],['Max. drawdown',num(s.maxDrawdownPct,1)+' %',`${num(s.maxDrawdown)} z 10 000`,s.maxDrawdownPct>0?'neg':''],['Výsledek',pct(s.netPct,1),`${num(s.finalEquity,0)} konečná equity`,sgn(s.netPct)],['Nejdelší série ztrát',String(s.longestLosingStreak),'',''],['Průměrná ztráta',num(s.avgLoss),'',''] ] as [string,string,string,string][]).map(([k,v,sub,cls])=><div key={k} className="bt-tile"><dt>{k}</dt><dd className={cls}>{v}</dd><dd className="sub">{sub}</dd></div>)}</dl>
   <EquityChart series={[{label:'Equity',points:res.equity,cls:'a'}]} fmt={v=>fmtNum(v,0)} base={10000}/>
   <div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Trh</th><th>Obchody</th><th>Win rate</th><th>Průměr R</th><th>Celkem R</th></tr></thead>
    <tbody>{res.perMarket.filter(m=>m.trades).sort((a,b)=>b.totalR-a.totalR).map(m=><tr key={m.instrument}><td>{m.instrument}</td><td>{m.trades}</td><td>{num(m.winRate,1)} %</td><td className={sgn(m.avgR)}>{num(m.avgR)}</td><td className={sgn(m.totalR)}>{num(m.totalR)}</td></tr>)}</tbody></table></div>
  </section>}
  <section className="mt-card">
   <h2>Uložená pravidla</h2>
   {!saved.length?<p className="mt-empty">Zatím žádná.</p>:<div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Název</th><th>Poslední test</th><th></th></tr></thead><tbody>
    {saved.map(r=>{const x=r.summary as {trades?:number;winRate?:number|null;avgR?:number|null;profitFactor?:number|null}|null;return <tr key={r.id} className={r.id===id?'lb-sel':''}>
     <td><button className="lb-link" onClick={()=>{setRule(r.rule);setName(r.name);setId(r.id);setRes(null)}}>{r.name}</button><small>{r.rule.markets.length} trhů · od {r.rule.from}</small></td>
     <td>{x&&typeof x.trades==='number'?`${x.trades} obch. · ${num(x.winRate??null,1)} % · ${num(x.avgR??null)} R · PF ${num(x.profitFactor??null)}`:'–'}</td>
     <td className="mt-actions"><button className="mt-icon" aria-label="Smazat" onClick={()=>remove(r.id)}><Trash2 size={14}/></button></td></tr>})}
   </tbody></table></div>}
  </section>
 </>;
}

// ---------------- Poznámky
function Notes(){
 const [notes,setNotes]=useState<LabNote[]>([]),[sel,setSel]=useState<string|null>(null),[title,setTitle]=useState(''),[tags,setTags]=useState(''),[body,setBody]=useState('');
 const [err,setErr]=useState(''),[busy,setBusy]=useState(false),[missing,setMissing]=useState(false),[q,setQ]=useState('');
 useEffect(()=>{call<{notes:LabNote[]}>('/api/laborator/notes').then(j=>setNotes(j.notes)).catch(e=>{if((e as HttpError).status===503)setMissing(true);else setErr((e as Error).message)})},[]);
 const open=(n:LabNote|null)=>{setSel(n?.id??null);setTitle(n?.title??'');setTags(n?.tags.join(', ')??'');setBody(n?.body??'');setErr('')};
 async function save(){setBusy(true);setErr('');try{const payload={title,body,tags};if(sel){const j=await call<{notes:LabNote[]}>('/api/laborator/notes/'+sel,'PATCH',payload);setNotes(j.notes)}else{const j=await call<{id:string;notes:LabNote[]}>('/api/laborator/notes','POST',payload);setNotes(j.notes);setSel(j.id)}}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 async function remove(){if(!sel||!confirm('Smazat poznámku?'))return;try{const j=await call<{notes:LabNote[]}>('/api/laborator/notes/'+sel,'DELETE');setNotes(j.notes);open(null)}catch(e){setErr((e as Error).message)}}
 const list=notes.filter(n=>!q||(n.title+' '+n.body+' '+n.tags.join(' ')).toLowerCase().includes(q.toLowerCase()));
 if(missing)return <section className="mt-card"><p className="mt-alert">Poznámky ještě nejdou – chybí migrace databáze (0025_lab.sql).</p></section>;
 return <section className="mt-card">
  <h2>Poznámky pro AI</h2>
  <p className="mt-lead">Hypotézy, postřehy a zadání pro další výzkum. Markdown. Všechno se skládá do „Shrnutí pro AI“, které si Claude přečte z databáze.</p>
  <div className="lb-notesgrid">
   <aside className="lb-list">
    <button className="mt-btn dark" onClick={()=>open(null)}><Plus size={15}/>Nová poznámka</button>
    <input className="lb-search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Hledat…" aria-label="Hledat v poznámkách"/>
    {!list.length&&<p className="mt-empty">{notes.length?'Nic nenalezeno.':'Zatím žádné poznámky.'}</p>}
    {list.map(n=><button key={n.id} className={'lb-item'+(n.id===sel?' on':'')} onClick={()=>open(n)}><b>{n.title}</b><small>{new Date(n.updated).toLocaleDateString('cs-CZ')}{n.tags.length?' · '+n.tags.map(t=>'#'+t).join(' '):''}</small></button>)}
   </aside>
   <div className="lb-editor">
    <input className="lb-title" value={title} maxLength={160} onChange={e=>setTitle(e.target.value)} placeholder="Název"/>
    <input value={tags} onChange={e=>setTags(e.target.value)} placeholder="Tagy oddělené čárkou (cot, sezonalita…)"/>
    <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Text v markdownu…" rows={16}/>
    <div className="lb-form lb-actions">
     <button className="mt-btn dark" disabled={busy||!title.trim()} onClick={save}><Save size={15}/>{busy?'Ukládám…':sel?'Uložit změny':'Uložit poznámku'}</button>
     {sel&&<button className="mt-btn" onClick={remove}><Trash2 size={15}/>Smazat</button>}
    </div>
    {err&&<p className="mt-alert" role="alert">{err}</p>}
   </div>
  </div>
 </section>;
}

// ---------------- Simulace 100 000 Kč
type PaperRow=Omit<PaperTrade,'partsAtEntry'>&{partsAtEntry?:unknown;mark:{price:number;r:number;pnlCzk:number;pct:number;at:number}|null};
type PaperData={account:{startEquity:number;started:number;rulesVersion:string;active:boolean}|null;stats:PaperStats;equity:PaperEquityPoint[];open:PaperRow[];closed:PaperRow[];log:{at:number;text:string}[];rules:{version:string;text:string[]};names:Record<string,string>;now:number};
const kc=(v:number|null)=>v===null?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(Math.round(v)),0)+' Kč';
const rr=(v:number|null)=>v===null?'–':(v>0?'+':v<0?'−':'')+fmtNum(Math.abs(v),2)+' R';
const px=(v:number|null)=>v===null?'–':fmtNum(v,Math.abs(v)<10?5:Math.abs(v)<1000?3:2);
const when=(t:number|null)=>t===null?'–':new Date(t).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const EXIT:Record<string,string>={sl:'SL',tp:'TP',time:'Čas',signal:'Signál'};
const slug=(id:string)=>'/graf/'+encodeURIComponent(id.replace(/\//g,'-'));
function Paper(){
 const [d,setD]=useState<PaperData|null>(null),[err,setErr]=useState(''),[missing,setMissing]=useState(false),[openId,setOpenId]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const load=useCallback(()=>{call<PaperData>('/api/laborator/paper').then(j=>{setD(j);setErr('')}).catch(e=>{if((e as HttpError).status===503)setMissing(true);else setErr((e as Error).message)})},[]);
 useEffect(()=>{load();const t=setInterval(()=>{if(document.visibilityState==='visible')load()},5*60000);return()=>clearInterval(t)},[load]);
 async function reset(){if(!confirm('Restartovat simulaci? Smažou se všechny virtuální obchody, křivka i deník a účet začne znovu se 100 000 Kč.'))return;setBusy(true);try{await call('/api/laborator/paper','POST',{action:'reset',confirm:'RESTART'});load()}catch(e){setErr((e as Error).message)}finally{setBusy(false)}}
 const curve=useMemo(()=>{if(!d?.account)return [] as EquityPoint[];const pts=[{t:d.account.started,equity:d.account.startEquity},...d.equity.filter(p=>p.t>=d.account!.started)];if(pts.length===1)pts.push({t:Math.max(d.now,d.account.started+60000),equity:d.stats.equity});return pts},[d]);
 if(missing)return <section className="mt-card"><p className="mt-alert">Simulace ještě nejde – chybí migrace databáze (0026_lab_paper.sql).</p></section>;
 if(!d)return <section className="mt-card">{err?<p className="mt-alert" role="alert">{err}</p>:<p className="mt-empty">Načítám…</p>}</section>;
 const s=d.stats,name=(id:string)=>d.names[id]||id;
 const toggle=(id:string)=>setOpenId(o=>o===id?null:id);
 const notes=(t:PaperRow,cols:number)=>openId===t.id&&<tr className="lb-notesrow"><td colSpan={cols}><div className="lb-paper-notes"><div><h4>Proč jsem do toho šel</h4><p>{t.why}</p></div><div><h4>Výsledek</h4><p>{t.resultNote||(t.mark?`Zatím otevřeno: ${rr(t.mark.r)}, ${kc(t.mark.pnlCzk)} (${fmtNum(t.mark.pct,2)} % ceny) při ceně ${px(t.mark.price)}.`:'Zatím otevřeno, živá cena chybí.')}</p></div><a className="lb-link" href={slug(t.instrument)}><LineChart size={14}/> Graf {name(t.instrument)}</a></div></td></tr>;
 const mkt=(t:PaperRow)=><td><button className="lb-link lb-exp" aria-expanded={openId===t.id} onClick={()=>toggle(t.id)}>{openId===t.id?<ChevronDown size={14}/>:<ChevronRight size={14}/>}{name(t.instrument)}</button><small><a href={slug(t.instrument)}>graf</a> · {t.rulesVersion}</small></td>;
 return <>
  <section className="mt-card">
   <h2>Simulace 100 000 Kč</h2>
   <p className="mt-lead">Virtuální účet, který každých 15 minut obchoduje podle nejsilnějších signálů Tradee – bez zásahu, jen podle pevných pravidel. Ke každému obchodu si zapíše, proč do něj šel, jak moc si byl jistý a jak dopadl.{d.account?` Start ${when(d.account.started)}, pravidla ${d.account.rulesVersion}.`:' Spustí se při příštím běhu po živých cenách.'}</p>
   {err&&<p className="mt-alert" role="alert">{err}</p>}
   <dl className="bt-tiles">{([
    ['Equity',fmtNum(Math.round(s.equity),0)+' Kč',`start ${fmtNum(s.startEquity,0)} Kč`,''],
    ['Výnos od startu',pct(s.returnPct),`uzavřeno ${kc(s.balance-s.startEquity)}`,sgn(s.returnPct)],
    ['Otevřený P&L',kc(s.openPnl),`${s.open} ${s.open===1?'pozice':s.open>=2&&s.open<=4?'pozice':'pozic'}`,sgn(s.openPnl)],
    ['Obchody',String(s.trades),`${s.wins} v zisku`,''],
    ['Win rate',s.winRate===null?'–':num(s.winRate,1)+' %','',''],
    ['Průměr',rr(s.avgR),`celkem ${rr(s.totalR)}`,sgn(s.avgR)],
    ['Max. drawdown',num(s.maxDrawdownPct,1)+' %','z equity vč. otevřených',s.maxDrawdownPct<0?'neg':''],
   ] as [string,string,string,string][]).map(([k,v,sub,cls])=><div key={k} className="bt-tile"><dt>{k}</dt><dd className={cls}>{v}</dd><dd className="sub">{sub}</dd></div>)}</dl>
   <EquityChart series={[{label:'Equity',points:curve,cls:'a'}]} fmt={v=>fmtNum(Math.round(v),0)+' Kč'} base={s.startEquity}/>
   <details className="lb-details"><summary>Pravidla {d.rules.version} (uložená u každého obchodu)</summary><ul className="lb-notes">{d.rules.text.map(t=><li key={t}>{t}</li>)}</ul></details>
  </section>
  <section className="mt-card">
   <h2>Otevřené pozice ({d.open.length})</h2>
   {!d.open.length?<p className="mt-empty">Žádná otevřená pozice.</p>:<div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Trh</th><th>Směr</th><th>Vstup</th><th>SL</th><th>TP</th><th>Aktuální cena</th><th>P&L</th><th>Jistota</th><th>Otevřeno</th></tr></thead>
    <tbody>{d.open.map(t=><Fragment key={t.id}><tr>{mkt(t)}<td>{t.direction==='long'?'Long':'Short'}</td><td>{px(t.entry)}</td><td>{px(t.sl)}</td><td>{px(t.tp)}</td><td>{t.mark?px(t.mark.price):'–'}</td><td className={sgn(t.mark?.pnlCzk??null)}>{t.mark?<>{kc(t.mark.pnlCzk)}<small>{rr(t.mark.r)}</small></>:'–'}</td><td>{t.confidence} %</td><td>{when(t.opened)}</td></tr>{notes(t,9)}</Fragment>)}</tbody></table></div>}
  </section>
  <section className="mt-card">
   <h2>Uzavřené obchody ({d.closed.length})</h2>
   {!d.closed.length?<p className="mt-empty">Zatím žádný uzavřený obchod.</p>:<div className="lb-scroll"><table className="mt-table lb-table"><thead><tr><th>Trh</th><th>Směr</th><th>Vstup → výstup</th><th>Důvod</th><th>R</th><th>Kč</th><th>% ceny</th><th>Jistota</th><th>Otevřeno → zavřeno</th></tr></thead>
    <tbody>{d.closed.map(t=><Fragment key={t.id}><tr>{mkt(t)}<td>{t.direction==='long'?'Long':'Short'}</td><td>{px(t.entry)} → {px(t.exit)}</td><td>{EXIT[t.exitReason??'']??'–'}</td><td className={sgn(t.r)}>{rr(t.r)}</td><td className={sgn(t.pnlCzk)}>{kc(t.pnlCzk)}</td><td>{t.pct===null?'–':pct(t.pct)}</td><td>{t.confidence} %</td><td>{when(t.opened)} → {when(t.closed)}</td></tr>{notes(t,9)}</Fragment>)}</tbody></table></div>}
  </section>
  <section className="mt-card">
   <details className="lb-details"><summary>Deník simulace ({d.log.length})</summary>{!d.log.length?<p className="mt-empty">Prázdný.</p>:<ul className="lb-log">{d.log.map((l,i)=><li key={i}><time>{when(l.at)}</time> {l.text}</li>)}</ul>}</details>
   <div className="lb-form lb-actions"><button className="mt-btn" disabled={busy} onClick={reset}><RotateCcw size={15}/>{busy?'Restartuji…':'Restartovat simulaci'}</button><span className="lb-hint">P&L v Kč = R × riziko (abstrahuje od velikosti kontraktu a převodu měn). Ceny z Yahoo, bez skutečného brokera.</span></div>
  </section>
 </>;
}

// ---------------- Shrnutí pro AI
function Summary(){
 const [s,setS]=useState<{body:string;updated:string}|null>(null),[err,setErr]=useState(''),[copied,setCopied]=useState(false);
 useEffect(()=>{call<{body:string;updated:string}>('/api/laborator/summary').then(setS).catch(e=>setErr((e as Error).message))},[]);
 return <section className="mt-card">
  <h2>Shrnutí pro AI</h2>
  <p className="mt-lead">Jen pro čtení: všechny poznámky, uložená pravidla s posledním testem, poslední studie a stav simulace v jednom markdownu. Ukládá se do tabulky <code>lab_summary</code>, odkud si ho Claude přečte.</p>
  {err&&<p className="mt-alert" role="alert">{err}</p>}
  {!s&&!err&&<p className="mt-empty">Načítám…</p>}
  {s&&<><div className="lb-form"><button className="mt-btn" onClick={()=>{navigator.clipboard?.writeText(s.body).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500)}).catch(()=>{})}}><Copy size={15}/>{copied?'Zkopírováno':'Zkopírovat'}</button><span className="lb-meta">Aktualizováno {new Date(s.updated).toLocaleString('cs-CZ')}</span></div>
   <pre className="lb-pre">{s.body}</pre></>}
 </section>;
}
