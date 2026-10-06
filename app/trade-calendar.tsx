'use client';
import {Fragment,useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,Plus,Trash2,X,NotebookPen} from 'lucide-react';
import {instruments} from '@/lib/markets';
import {monthGrid,monthStats,fmtUsd,type Trade} from '@/lib/trades';
export const months=['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
export const todayIso=(now:number)=>new Date(now).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'});
const cls=(n:number)=>n>0?'up':n<0?'down':'';
export const plural=(n:number)=>n===1?'obchod':n<5?'obchody':'obchodů';
// Obchody uživatele sdílí kalendář i osobní souhrn měsíce na dashboardu.
export function useTrades(){
 const [trades,setTrades]=useState<Trade[]>([]),[error,setError]=useState(''),[ready,setReady]=useState(false);
 async function load(){try{const r=await fetch('/api/trades',{cache:'no-store'});if(!r.ok)throw Error();setTrades((await r.json() as {trades:Trade[]}).trades);setReady(true);setError('')}catch{setError('Obchody se nepodařilo načíst. Zkus obnovit stránku.')}}
 useEffect(()=>{load()},[]);
 return {trades,error,ready,load};
}
export function TradeCalendar({now,trades,ready,loadError,reload}:{now:number;trades:Trade[];ready:boolean;loadError:string;reload:()=>Promise<void>}){
 const today=todayIso(now);
 const [ym,setYm]=useState(()=>({y:Number(today.slice(0,4)),m:Number(today.slice(5,7))}));
 const [actionError,setError]=useState(''),[adding,setAdding]=useState(false),[selected,setSelected]=useState<string|null>(null),[saving,setSaving]=useState(false);
 const [form,setForm]=useState({date:today,instrument:'',pnl:'',note:''});
 const error=actionError||loadError;
 async function submit(e:React.FormEvent){e.preventDefault();setSaving(true);try{const pnl=Number(form.pnl.replace(/\s/g,'').replace(',','.'));if(!Number.isFinite(pnl))throw Error('Výsledek musí být číslo, např. 128.30 nebo -45.');const r=await fetch('/api/trades',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,pnl})});const j=await r.json() as {error?:string};if(!r.ok)throw Error(j.error||'Obchod se nepodařilo uložit.');setForm(f=>({...f,pnl:'',note:''}));setAdding(false);setSelected(form.date);setError('');await reload()}catch(err){setError(err instanceof Error?err.message:'Obchod se nepodařilo uložit.')}finally{setSaving(false)}}
 async function remove(id:string){if(!window.confirm('Smazat tento obchod?'))return;try{const r=await fetch('/api/trades',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});if(!r.ok)throw Error();setError('');await reload()}catch{setError('Obchod se nepodařilo smazat.')}}
 const weeks=monthGrid(ym.y,ym.m,trades,today),stats=monthStats(trades,ym.y,ym.m);
 const prev=()=>setYm(v=>v.m===1?{y:v.y-1,m:12}:{y:v.y,m:v.m-1}),next=()=>setYm(v=>v.m===12?{y:v.y+1,m:1}:{y:v.y,m:v.m+1});
 const dayTrades=selected?trades.filter(t=>t.date===selected).sort((a,b)=>a.created.localeCompare(b.created)):[];
 return <section className="d-card d-trades">
  <div className="d-head"><div className="d-title"><span className="d-ico"><NotebookPen size={16}/></span><h2>Kalendář obchodů</h2>{stats.count>0&&<span className={'d-pill '+cls(stats.total)}>{fmtUsd(stats.total)} · {stats.count} {plural(stats.count)}</span>}</div><div className="d-tools"><div className="t-monthnav"><button type="button" onClick={prev} aria-label="Předchozí měsíc"><ChevronLeft size={16}/></button><b>{months[ym.m-1]} {ym.y}</b><button type="button" onClick={next} aria-label="Další měsíc"><ChevronRight size={16}/></button></div><button type="button" className="t-btn primary" onClick={()=>{setAdding(a=>!a);setForm(f=>({...f,date:selected||today}))}}><Plus size={15}/> Přidat obchod</button></div></div>
  {error&&<p className="d-alert" role="alert">{error}</p>}
  {adding&&<form className="t-tradeform" onSubmit={submit}>
   <label>Datum<input type="date" required value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
   <label>Trh<input list="t-instruments" required maxLength={40} placeholder="EUR/USD" value={form.instrument} onChange={e=>setForm({...form,instrument:e.target.value})}/><datalist id="t-instruments">{instruments.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</datalist></label>
   <label>Výsledek v $<input required inputMode="decimal" placeholder="+128.30 nebo -45" value={form.pnl} onChange={e=>setForm({...form,pnl:e.target.value})}/></label>
   <label className="t-wide">Poznámka<input maxLength={500} placeholder="Setup, důvod vstupu, poučení…" value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label>
   <div className="t-formactions"><button type="submit" className="t-btn primary" disabled={saving}>{saving?'Ukládám…':'Uložit obchod'}</button><button type="button" className="t-btn" onClick={()=>setAdding(false)}>Zrušit</button></div>
  </form>}
  <div className="t-cal" role="grid" aria-label={'Kalendář obchodů '+months[ym.m-1]+' '+ym.y}>
   {['Po','Út','St','Čt','Pá','So','Ne','Týden'].map(d=><div key={d} className="t-cal-h">{d}</div>)}
   {weeks.map((w,i)=><Fragment key={i}>{w.days.map(d=><button key={d.date} type="button" className={'t-cal-d'+(d.inMonth?'':' out')+(d.isToday?' today':'')+(d.count?' '+cls(d.pnl):'')+(selected===d.date?' sel':'')} onClick={()=>setSelected(s=>s===d.date?null:d.date)} aria-label={d.date+(d.count?', '+fmtUsd(d.pnl)+', '+d.count+' '+plural(d.count):'')}><span>{d.day}</span>{d.count>0&&<><b>{fmtUsd(d.pnl)}</b><small>{d.count} {plural(d.count)}</small></>}</button>)}<div className={'t-cal-w'+(w.count?' '+cls(w.total):'')}><span>Týden</span><b>{w.count?fmtUsd(w.total):'—'}</b><small>{w.count?w.count+' '+plural(w.count):''}</small></div></Fragment>)}
  </div>
  {selected&&<div className="t-daylist"><div className="d-head"><h3>{new Date(selected+'T12:00:00Z').toLocaleDateString('cs-CZ',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</h3><button type="button" className="t-icon-btn small" onClick={()=>setSelected(null)} aria-label="Zavřít"><X size={14}/></button></div>{dayTrades.length?<table className="t-table"><tbody>{dayTrades.map(t=><tr key={t.id}><td><b>{t.instrument}</b></td><td className={cls(t.pnl)}><b>{fmtUsd(t.pnl)}</b></td><td className="t-note">{t.note}</td><td style={{width:36}}><button type="button" className="t-icon-btn small" onClick={()=>remove(t.id)} aria-label="Smazat obchod"><Trash2 size={14}/></button></td></tr>)}</tbody></table>:<div className="d-empty">V tento den nemáš žádný obchod. Přidej ho tlačítkem výše.</div>}</div>}
  {!ready&&!error&&<div className="d-empty">Načítám obchody…</div>}
  {ready&&!trades.length&&!adding&&<div className="d-empty">Zatím žádné obchody. Klikni na Přidat obchod a zapiš první.</div>}
 </section>;
}
