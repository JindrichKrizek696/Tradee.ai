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
import {matchesText} from '@/lib/market-view';
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
 const shown=useMemo(()=>list.filter(i=>matchesText(i.id+' '+i.name,q)),[q]);
 const go=(id:string)=>{location.href='/graf/'+slugOf(id)};
 // přepínač trhu: hledání + výběr (v hlavičce karty grafu, bez grafu pod nadpisem)
 const picker=<div className="mc-market" role="search" aria-label="Přepnout trh">
  <input type="search" className="mc-chip mc-market-q" aria-label="Hledat trh" placeholder="Hledat trh…" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){const hit=shown.find(i=>i.id!==item?.id)||shown[0];if(hit&&hit.id!==item?.id)go(hit.id)}}} title="Enter otevře první nalezený trh"/>
  <select className="mc-chip mc-type mc-market-sel" aria-label="Přepnout trh" value={item?.id||''} onChange={e=>go(e.target.value)}>
   {!item&&<option value="">Vyber trh…</option>}
   {item&&!shown.some(i=>i.id===item.id)&&<option value={item.id}>{item.name}</option>}
   {shown.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
  </select>
 </div>;
 return <div className="mt-page score-v2 tradee">
  <header className="mt-top mc-page-top" style={{maxWidth:'none'}}><a href={item?'/#analyzer':'/'} className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a>
   {item&&<div className="mc-page-live"><h1>{item.name}</h1>{quote&&<><strong>{fmtPrice(quote.price)}</strong><LiveChange pct={quote.changePct}/><LiveBadge live={quotes} quote={quote}/></>}</div>}
  </header>
  <main className="mt-main" style={{maxWidth:'none',paddingBottom:24}}>
   {item?<div className="mc-full"><MarketChart key={item.id} instrument={item.id} name={item.name} history={history} method={method} events={calendar} height="max(520px, calc(100vh - 190px))" headExtra={picker}/></div>
    :<section className="s-card mc-missing"><h1>Trh nenalezen</h1><p className="mc-empty-note">Tenhle trh nemá graf. Vyber jiný:</p>{picker}</section>}
  </main>
 </div>;
}
