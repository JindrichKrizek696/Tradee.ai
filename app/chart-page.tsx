'use client';
// Graf trhu na celou stránku: stejný MarketChart jako v detailu trhu, jen vysoký, s přepínačem trhu a živou cenou. Podklady (skóre, kalendář) se berou stejně jako v aplikaci.
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import initial from '@/data/fundamentals.json';
import calendarAuto from '@/data/calendar.json';
import core from '@/data/score-market.json';
import expanded from '@/data/expanded-market.json';
import savedHistory from '@/data/score-history.json';
import type {FundamentalData} from '@/lib/fundamentals';
import type {MarketData} from '@/lib/score-engine';
import {mergeCalendar,type AutoEvent} from '@/lib/calendar';
import {marketScore,instruments} from '@/lib/markets';
import type {HistoryLike} from '@/lib/dashboard';
import {usePalette} from './palette';
import {MarketChart} from './market-chart';
import {useLive,LiveChange,LiveBadge,fmtPrice} from './live';
import './mt.css';
import './markets.css';
const initialMarket={...core,prices:{...core.prices,...expanded.prices},legacy:expanded.legacy,refresh:{attemptedAt:expanded.refresh.attemptedAt,issues:[...core.refresh.issues,...expanded.refresh.issues]}} as MarketData;
const slugOf=(id:string)=>id.replace(/\//g,'-');
const list=instruments.filter(i=>i.group!=='currency');
export default function ChartPage({slug}:{slug:string}){
 usePalette();
 let key=slug;try{key=decodeURIComponent(slug)}catch{}
 const item=list.find(i=>slugOf(i.id)===key);
 const [data,setData]=useState(initial as FundamentalData),[market,setMarket]=useState(initialMarket),[history,setHistory]=useState(savedHistory as unknown as HistoryLike),[q,setQ]=useState('');
 useEffect(()=>{let live=true;fetch('/api/fundamentals',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<FundamentalData&{scoreMarket:MarketData;history:HistoryLike}>:null).then(j=>{if(live&&j){setData(j);setMarket(j.scoreMarket);setHistory(j.history)}}).catch(()=>{});return()=>{live=false}},[]);
 const quotes=useLive(),calendar=useMemo(()=>mergeCalendar(calendarAuto.events as AutoEvent[],data.events,data.sources),[data]);
 const method=item?marketScore(data,market,item.id).method:'',quote=item?quotes?.quotes[item.id]:undefined;
 const shown=useMemo(()=>{const s=q.trim().toLowerCase();return s?list.filter(i=>i.id.toLowerCase().includes(s)||i.name.toLowerCase().includes(s)):list},[q]);
 const go=(id:string)=>{location.href='/graf/'+slugOf(id)};
 return <div className="mt-page score-v2 tradee">
  <header className="mt-top" style={{maxWidth:'none'}}><a href={item?'/#analyzer':'/'} className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main" style={{maxWidth:'none',paddingBottom:24}}>
   <div className="s-heading" style={{alignItems:'flex-end',gap:12}}>
    <div><span className="s-kicker">Graf trhu</span><h1 style={{margin:'4px 0 0'}}>{item?item.name:'Trh nenalezen'}</h1>
     {item&&quote&&<div className="lv-today-head" style={{marginTop:6}}><strong>{item.group==='currency'?null:fmtPrice(quote.price)}</strong><LiveChange pct={quote.changePct}/><LiveBadge live={quotes} quote={quote}/></div>}</div>
    <div className="s-controls" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
     <input type="search" aria-label="Hledat trh" placeholder="Hledat trh…" value={q} onChange={e=>setQ(e.target.value)} style={{height:38,padding:'0 14px',border:'1px solid var(--t-border)',borderRadius:9999,background:'var(--t-surface)',color:'var(--t-fg)',font:'inherit',minWidth:0}}/>
     <select aria-label="Přepnout trh" value={item?.id||''} onChange={e=>go(e.target.value)} style={{height:38,padding:'0 12px',border:'1px solid var(--t-border)',borderRadius:9999,background:'var(--t-surface)',color:'var(--t-fg)',font:'inherit',maxWidth:'100%'}}>
      {!item&&<option value="">Vyber trh…</option>}
      {item&&!shown.some(i=>i.id===item.id)&&<option value={item.id}>{item.name}</option>}
      {shown.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
     </select>
    </div>
   </div>
   {item?<div className="mc-full"><MarketChart key={item.id} instrument={item.id} name={item.name} history={history} method={method} events={calendar} height="max(520px, calc(100vh - 260px))"/></div>:<p className="mc-empty-note">Tenhle trh nemá graf. Vyber jiný v seznamu nahoře.</p>}
  </main>
 </div>;
}
