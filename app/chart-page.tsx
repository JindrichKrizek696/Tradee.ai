'use client';
// Graf trhu na celou stránku: stejný MarketChart jako v detailu trhu, jen vysoký, s přepínačem trhu a živou cenou. Podklady (skóre, kalendář) se berou stejně jako v aplikaci.
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import initialReport from '@/data/fundamentals.json';
import ffMacro from '@/data/ff-macro.json';
import tePmi from '@/data/te-pmi.json';
import retailOfficial from '@/data/retail-official.json';
import calendarAuto from '@/data/calendar.json';
import core from '@/data/score-market.json';
import expanded from '@/data/expanded-market.json';
import type {FundamentalData} from '@/lib/fundamentals';
import type {MarketData} from '@/lib/score-engine';
import {mergeCalendar,type AutoEvent} from '@/lib/calendar';
import {marketScore,instruments,groups} from '@/lib/markets';
import type {HistoryLike} from '@/lib/dashboard';
import {usePalette} from './palette';
import {matchesText} from '@/lib/market-view';
import {MarketChart} from './market-chart';
import {useLive,LiveChange,LiveBadge,fmtPrice} from './live';
import {MobileNav} from './nav-bar';
import {useNav} from './nav-prefs';
import './mt.css';
import './markets.css';
const initialMarket={...core,prices:{...core.prices,...expanded.prices},legacy:expanded.legacy,refresh:{attemptedAt:expanded.refresh.attemptedAt,issues:[...core.refresh.issues,...expanded.refresh.issues]}} as MarketData;
const slugOf=(id:string)=>id.replace(/\//g,'-');
const list=instruments.filter(i=>i.group!=='currency');
export default function ChartPage({slug,tf}:{slug:string;tf?:string}){
 usePalette();
 const {nav}=useNav();
 let key=slug;try{key=decodeURIComponent(slug)}catch{}
 const item=list.find(i=>slugOf(i.id)===key);
 const [data,setData]=useState({...initialReport,ffMacro,tePmi,retailOfficial} as unknown as FundamentalData),[market,setMarket]=useState(initialMarket),[history,setHistory]=useState<HistoryLike>({snapshots:[]});
 useEffect(()=>{let live=true;fetch('/api/fundamentals',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<FundamentalData&{scoreMarket:MarketData;history:HistoryLike}>:null).then(j=>{if(live&&j){setData(j);setMarket(j.scoreMarket);setHistory(j.history)}}).catch(()=>{});return()=>{live=false}},[]);
 // vlastník vidí v grafu i vrstvu Simulace z Laboratoře (ostatním se data simulace nikdy nežádají)
 const [owner,setOwner]=useState(false);
 useEffect(()=>{let live=true;fetch('/api/watchlist',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{user?:{owner?:boolean}}>:null).then(j=>{if(live)setOwner(j?.user?.owner===true)}).catch(()=>{});return()=>{live=false}},[]);
 const quotes=useLive(),calendar=useMemo(()=>mergeCalendar(calendarAuto.events as AutoEvent[],data.events,data.sources),[data]);
 const method=item?marketScore(data,market,item.id).method:'',quote=item?quotes?.quotes[item.id]:undefined;
 const go=(id:string)=>{location.href='/graf/'+slugOf(id)};
 // přepínač trhu: našeptávač – píšeš a pod polem se nabízí odpovídající trhy (šipky, Enter, Esc, myš)
 const picker=<MarketPicker current={item?.id} onPick={go}/>;
 // stránka na celou výšku okna: horní lišta + karta grafu, která vyplní zbytek (bez posouvání stránky; i v samostatném okně na druhém monitoru)
 return <div className="mt-page score-v2 tradee mc-page">
  <header className="mt-top mc-page-top"><a href={item?'/#analyzer':'/'} className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a>
   {item&&<div className="mc-page-live"><h1>{item.name}</h1>{quote&&<><strong>{fmtPrice(quote.price)}</strong><LiveChange pct={quote.changePct}/><LiveBadge live={quotes} quote={quote}/></>}</div>}
  </header>
  <main className="mt-main mc-page-main">
   {item?<div className="mc-full"><MarketChart key={item.id} instrument={item.id} name={item.name} history={history} method={method} events={calendar} fill initialTf={tf} headExtra={picker} owner={owner}/></div>
    :<section className="s-card mc-missing"><h1>Trh nenalezen</h1><p className="mc-empty-note">Tenhle trh nemá graf. Vyber jiný:</p>{picker}</section>}
  </main>
  {/* na telefonu stejná lišta dole jako v aplikaci (graf patří k Analýze trhů); výška grafu s ní počítá (--bnav v CSS) */}
  <MobileNav nav={nav} view="analyzer"/>
 </div>;
}

function MarketPicker({current,onPick}:{current?:string;onPick:(id:string)=>void}){
 const [q,setQ]=useState(''),[open,setOpen]=useState(false),[act,setAct]=useState(0),box=useRef<HTMLDivElement>(null);
 const cur=list.find(i=>i.id===current);
 const hits=useMemo(()=>list.filter(i=>i.id!==current&&matchesText(i.id+' '+i.name,q)).slice(0,12),[q,current]);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(box.current&&!box.current.contains(e.target as Node))setOpen(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[open]);
 useEffect(()=>setAct(0),[q]);
 const pick=(id:string)=>{setOpen(false);setQ('');onPick(id)};
 return <div className="mc-market mc-combo" ref={box}>
  <input type="text" className="mc-chip mc-market-q" role="combobox" aria-expanded={open} aria-controls="mc-combo-list" aria-autocomplete="list" aria-activedescendant={open&&hits[act]?'mc-opt-'+act:undefined}
   aria-label="Přepnout trh" placeholder={cur?cur.name+' · hledat…':'Hledat trh…'} value={q}
   onFocus={()=>setOpen(true)} onChange={e=>{setQ(e.target.value);setOpen(true)}}
   onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setAct(a=>Math.min(a+1,hits.length-1))}else if(e.key==='ArrowUp'){e.preventDefault();setAct(a=>Math.max(a-1,0))}else if(e.key==='Enter'){e.preventDefault();if(hits[act])pick(hits[act].id)}else if(e.key==='Escape'){setOpen(false);(e.target as HTMLInputElement).blur()}}}/>
  {open&&<ul className="mc-combo-list" id="mc-combo-list" role="listbox" aria-label="Nalezené trhy">
   {hits.length?hits.map((i,n)=><li key={i.id} id={'mc-opt-'+n} role="option" aria-selected={n===act} className={n===act?'on':''} onMouseEnter={()=>setAct(n)} onMouseDown={e=>{e.preventDefault();pick(i.id)}}><b>{i.name}</b><small>{groups[i.group]||''}</small></li>)
   :<li className="none" role="option" aria-selected={false} aria-disabled="true">Nic nenalezeno</li>}
  </ul>}
 </div>;
}
