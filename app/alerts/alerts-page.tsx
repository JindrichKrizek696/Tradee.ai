'use client';
// Stránka /alerty: seznam alertů (aktivní / spuštěné / vypršelé / pozastavené), filtr, úprava, pauza, smazání a historie spuštění.
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,Bell,ChartCandlestick,History,Pause,Pencil,Play,Plus,Trash2} from 'lucide-react';
import {instruments} from '@/lib/markets';
import {matchesText} from '@/lib/market-view';
import {resolveAlias,suggestAliases} from '@/lib/instrument-info';
import {conditionLabel,statusOf,STATUS_LABEL,slugOf,MAX_ACTIVE,type Status} from '@/lib/alerts/logic';
import {useLive} from '../live';
import {usePalette} from '../palette';
import {AlertForm} from './alert-form';
import {AlertToasts} from './alert-toast';
import {AlertNotifyCard} from '../notify-settings';
import {useAlerts,saveAlert,removeAlert,loadEvents,readEvents,onAlertsChanged,type ClientAlert,type AlertEvent} from './alert-api';
import '../mt.css';
import './alerts.css';
const NAME=new Map(instruments.map(i=>[i.id,i.name])),GROUP=new Map(instruments.map(i=>[i.id,i.group]));
const nameOf=(id:string)=>NAME.get(id)||id;
const dt=(ms:number)=>new Date(ms).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
const day=(ms:number)=>new Date(ms).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric'});
const repeatText=(m:number|null)=>m===null?'jednorázový':m<60?`opakuje se, odstup ${m} min`:`opakuje se, odstup ${m/60} h`;
const chText=(c:string[])=>c.length===2?'push + e-mail':c[0]==='push'?'push':'e-mail';
const mark=(v:boolean|null)=>v===null?<em>–</em>:v?<span className="al-ok">✓</span>:<span className="al-fail">✗</span>;
// Jen tři filtry (na mobilu se víc nevejde): aktivní, vypršelé (= spuštěné nebo prošlé) a vše
type Filter='active'|'done'|'all';
const FILTERS:[Filter,string][]=[['active','Aktivní'],['done','Vypršelé'],['all','Vše']];
const inFilter=(st:Status,f:Filter)=>f==='all'||(f==='active'?st==='active':st==='triggered'||st==='expired');
const chartable=(id:string)=>GROUP.get(id)!=='currency';
// výběr trhu pro nový alert: hledání i přes aliasy (nq, us100, gold, xauusd…), cíl aliasu první
const pickList=(q:string)=>{const h=instruments.filter(i=>matchesText(i.id+' '+i.name,q)),a=q.trim()?resolveAlias(q):null,t=a?h.find(i=>i.id===a.id):undefined;return t?[t,...h.filter(i=>i!==t)]:h};
export default function AlertsPage(){
 usePalette();
 const {data,error}=useAlerts(),live=useLive(),[now,setNow]=useState(()=>Date.now());
 const [filter,setFilter]=useState<Filter>('active'),[q,setQ]=useState(''),[edit,setEdit]=useState<{alert?:ClientAlert;instrument:string}|null>(null);
 const [pick,setPick]=useState(instruments.find(i=>i.group==='fx')?.id||instruments[0].id),[open,setOpen]=useState<string|null>(null),[msg,setMsg]=useState('');
 const [events,setEvents]=useState<AlertEvent[]|null>(null),[unread,setUnread]=useState(0),[pq,setPq]=useState('');
 const opts=useMemo(()=>pickList(pq),[pq]),pal=pq.trim()?resolveAlias(pq):null,psug=opts.length?[]:suggestAliases(pq);
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(t)},[]);
 useEffect(()=>{const load=()=>loadEvents({limit:100}).then(j=>{setEvents(j.events);setUnread(j.unread)}).catch(()=>setEvents([]));load();return onAlertsChanged(load)},[]);
 const list=useMemo(()=>{const f=q.trim().toLowerCase();return (data?.alerts||[]).filter(a=>inFilter(statusOf(a,now),filter)&&(!f||(nameOf(a.instrument)+' '+a.instrument+' '+conditionLabel(a,nameOf(a.instrument))+' '+(a.note||'')).toLowerCase().includes(f)))},[data,filter,q,now]);
 const counts=useMemo(()=>{const c:Record<string,number>={all:0,active:0,triggered:0,expired:0,paused:0};for(const a of data?.alerts||[]){c.all++;const st=statusOf(a,now);c[st]++;if(st==='triggered'||st==='expired')c.done=(c.done||0)+1}return c},[data,now]);
 const byAlert=useMemo(()=>{const m=new Map<string,AlertEvent[]>();for(const e of events||[]){const l=m.get(e.alertId)||[];l.push(e);m.set(e.alertId,l)}return m},[events]);
 const toggle=async(a:ClientAlert)=>{setMsg('');try{const r=await saveAlert({active:!a.active},a.id);if(r.warnings.length)setMsg(r.warnings.join(' '))}catch(e){setMsg((e as Error).message)}};
 const del=async(a:ClientAlert)=>{if(!confirm('Smazat alert „'+conditionLabel(a,nameOf(a.instrument))+'“?'))return;try{await removeAlert(a.id)}catch(e){setMsg((e as Error).message)}};
 const q2=(id:string)=>live?.quotes[id];
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main">
   <div className="al-page-head"><h1>Alerty</h1>{data&&<span className="al-tag">{data.active} / {data.limit||MAX_ACTIVE} aktivních</span>}</div>
   <p className="mt-lead">Upozornění na cenu (nad, pod, dotyk), denní změnu v % a skóre Tradee. Ceny se kontrolují každou minutu, jen když je trh otevřený (krypto nonstop); skóre při jeho obnově. Push a e-mail podle nastavení alertu a volby níže.</p>
   <AlertNotifyCard/>
   <section className="mt-card">
    <h2>Nový alert</h2>
    <div className="al-new"><input type="search" aria-label="Najít trh" placeholder="Najít trh: nq, gold, us500…" value={pq} onChange={e=>{setPq(e.target.value);const f=pickList(e.target.value)[0];if(f)setPick(f.id)}}/><select aria-label="Trh" value={pick} onChange={e=>setPick(e.target.value)}>{(opts.length?opts:instruments).map(i=><option key={i.id} value={i.id}>{i.name}{i.group==='currency'?' (jen skóre)':''}</option>)}</select>
     <button type="button" className="al-btn primary" onClick={()=>setEdit({instrument:pick})}><Plus size={15} aria-hidden/>Nový alert</button></div>
    {pal?.hint&&<p className="mt-lead" role="status" style={{marginTop:8}}>{pal.hint}</p>}
    {pq.trim()&&!opts.length&&<p className="mt-lead" role="status" style={{marginTop:8}}>Nic nenalezeno{psug.length?<> – možná {psug.map((s,n)=><span key={s.key}>{n?', ':''}<button type="button" className="al-link" onClick={()=>{setPq(s.key);setPick(s.id)}}>{s.key} → {s.label}</button></span>)}</>:'.'}</p>}
    {data&&!data.pushAvailable&&<p className="mt-lead" style={{marginTop:10}}>Push nemáš zapnutý na žádném zařízení – alerty dorazí e-mailem. Zapneš ho výše v kartě „Kam posílat alerty“.</p>}
   </section>
   <section className="mt-card">
    <h2>Moje alerty</h2>
    <div className="al-filters"><div className="mt-chips" role="radiogroup" aria-label="Stav">{FILTERS.map(([k,l])=><button key={k} type="button" role="radio" aria-checked={filter===k} className={filter===k?'active':''} onClick={()=>setFilter(k)}>{l} {counts[k]?<small>({counts[k]})</small>:null}</button>)}</div>
     <input type="search" placeholder="Hledat trh nebo poznámku…" aria-label="Hledat" value={q} onChange={e=>setQ(e.target.value)}/></div>
    {msg&&<p className="al-warn" role="status" style={{listStyle:'none',paddingLeft:12}}>{msg}</p>}
    {error&&!data?<p className="p-error">Alerty se nepodařilo načíst. Zkus obnovit stránku.</p>:!data?<p className="mt-empty">Načítám…</p>:list.length===0?<p className="mt-empty">{filter==='active'?'Žádný aktivní alert. Nastav ho výše, v detailu trhu (tlačítko Alert) nebo přímo v grafu.':'Nic tu není.'}</p>:
    <ul className="al-list">{list.map(a=>{const st=statusOf(a,now),evs=byAlert.get(a.id)||[];return <li key={a.id} className={'al-item'+(st==='active'?'':' off')}>
     <div className="al-item-top"><Bell size={15} aria-hidden/><b>{conditionLabel(a,nameOf(a.instrument))}</b><span className={'al-tag '+st}>{STATUS_LABEL[st]}</span>
      <span className="al-item-actions">
       {chartable(a.instrument)&&<a className="al-btn sm" href={'/graf/'+encodeURIComponent(slugOf(a.instrument))}><ChartCandlestick size={14} aria-hidden/>Graf</a>}
       <button type="button" className="al-btn sm" onClick={()=>setEdit({alert:a,instrument:a.instrument})}><Pencil size={14} aria-hidden/>Upravit</button>
       <button type="button" className="al-btn sm" onClick={()=>toggle(a)}>{a.active?<><Pause size={14} aria-hidden/>Pozastavit</>:<><Play size={14} aria-hidden/>{st==='triggered'?'Znovu zapnout':'Obnovit'}</>}</button>
       <button type="button" className="al-btn sm danger" aria-label="Smazat alert" onClick={()=>del(a)}><Trash2 size={14} aria-hidden/></button>
      </span></div>
     {a.note&&<p className="al-note">{a.note}</p>}
     <div className="al-meta"><span>{repeatText(a.cooldownMin)}</span><span>{chText(a.channels)}</span><span>{a.expiresAt?'vyprší '+day(a.expiresAt):'bez vypršení'}</span><span>vytvořen {day(a.created)}</span>{a.lastTriggered&&<span>naposledy spuštěn {dt(a.lastTriggered)}</span>}{evs.length>0&&<button type="button" className="al-link" aria-expanded={open===a.id} onClick={()=>setOpen(o=>o===a.id?null:a.id)}><History size={12} aria-hidden/> historie ({evs.length})</button>}</div>
     {open===a.id&&<ul className="al-hist">{evs.map(e=><li key={e.id}><span>{dt(e.at)}</span><span>{e.price.toLocaleString('cs-CZ',{maximumFractionDigits:5})}</span><span>push {mark(e.push)}</span><span>e-mail {mark(e.mail)}</span></li>)}</ul>}
    </li>})}</ul>}
   </section>
   <section className="mt-card" id="historie">
    <div className="al-page-head"><h2 style={{flex:1}}>Historie spuštění</h2>{unread>0&&<button type="button" className="al-btn sm" onClick={()=>readEvents().catch(()=>{})}>Označit vše jako přečtené ({unread})</button>}</div>
    {events===null?<p className="mt-empty">Načítám…</p>:events.length===0?<p className="mt-empty">Zatím se žádný alert nespustil.</p>:
    <table className="mt-table"><thead><tr><th>Čas</th><th>Alert</th><th>Hodnota</th><th>Push</th><th>E-mail</th></tr></thead><tbody>{events.map(e=><tr key={e.id} style={e.read?undefined:{fontWeight:600}}><td>{dt(e.at)}</td><td>{e.label}</td><td>{e.price.toLocaleString('cs-CZ',{maximumFractionDigits:5})}</td><td>{mark(e.push)}</td><td>{mark(e.mail)}</td></tr>)}</tbody></table>}
   </section>
  </main>
  <AlertToasts/>
  {edit&&<AlertForm key={edit.alert?.id||edit.instrument} instrument={edit.instrument} name={nameOf(edit.instrument)} alert={edit.alert} price={q2(edit.instrument)?.price??null} changePct={q2(edit.instrument)?.changePct??null} pushAvailable={data?.pushAvailable} onClose={()=>setEdit(null)} onSaved={(_a,w)=>setMsg(w.length?w.join(' '):'')}/>}
 </div>;
}
