'use client';
import {useEffect,useMemo,useState} from 'react';
import type {JournalList} from '@/lib/journal/types';
import {readAccount,writeAccount} from './account-pref';
import {DEFAULT_FILTER,filterTrades,sanitizeFilter,type Filter} from '@/lib/journal/stats';
import {Filters} from './filters';
import {TradesTable} from './trades-table';
import {TradeDetail} from './trade-detail';
import {Journaling} from '../journaling/journaling';
import {StatsView} from './stats-view';
import {useOpenPositions,byAccount,OpenPositionsTab} from '../open-positions';
import './journal.css';
type Tab='trades'|'stats'|'open';
type Sec='review'|'backtest';
// sloučený režim: #journal/vyhodnoceni[/<obchod>] a #journal/backtest jsou záložky Journalingu
const hashSec=():Sec|null=>/^#journal\/vyhodnoceni(\/|$)/.test(location.hash)?'review':location.hash==='#journal/backtest'?'backtest':null;
// filtr a záložka se pamatují v prohlížeči (deník se renderuje jen na klientu)
function saved(key:string):{filter:Filter;tab:Tab}{try{const v=JSON.parse(localStorage.getItem(key)||'{}');return {filter:{...DEFAULT_FILTER,...(v.filter||{})},tab:v.tab==='stats'||v.tab==='open'?v.tab:'trades'}}catch{return {filter:DEFAULT_FILTER,tab:'trades'}}}
const hashId=()=>{const h=location.hash;if(!h.startsWith('#journal/')||hashSec())return null;try{return decodeURIComponent(h.slice(9))}catch{return null}};
export function Journal({viewAs,merged}:{viewAs?:{id:string;name:string};merged?:boolean}={}){
 const m=!!merged&&!viewAs,[sec,setSec]=useState<Sec|null>(()=>m?hashSec():null);
 const q=viewAs?'?as='+encodeURIComponent(viewAs.id):'',KEY=viewAs?'tradee.journal.admin':'tradee.journal';
 const [data,setData]=useState<JournalList|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState<Filter>(()=>{const f=saved(KEY).filter;return viewAs?f:{...f,account:readAccount()}}),[tab,setTab]=useState<Tab>(()=>saved(KEY).tab),[detail,setDetail]=useState<string|null>(()=>hashId()),[now]=useState(()=>Date.now());
 const {data:openData,now:openNow}=useOpenPositions(q),openCount=useMemo(()=>byAccount(openData?.positions||[],filter.account).length,[openData,filter.account]);
 async function reload(){try{const r=await fetch('/api/journal'+q,{cache:'no-store'});const j=await r.json() as JournalList&{error?:string};if(!r.ok)throw Error(j.error||'');setData(j);setError('')}catch(e){setError((e as Error).message||'Deník se nepodařilo načíst. Zkus obnovit stránku.')}}
 useEffect(()=>{reload();const on=()=>{setDetail(hashId());setSec(hashSec())};window.addEventListener('hashchange',on);
  return()=>{window.removeEventListener('hashchange',on);if(/^#journal(\/|$)/.test(location.hash))history.replaceState(null,'',location.pathname+location.search)}},[]);
 // po načtení dat zrušit části filtru, které odkazují na smazaný účet, tag nebo pár
 useEffect(()=>{if(data)setFilter(f=>{const s=sanitizeFilter(f,data.trades,data.accounts);return JSON.stringify(s)===JSON.stringify(f)?f:s})},[data]);
 // vlastní deník: účet sdílený s Dashboardem (i po vrácení neexistujícího účtu na „all“)
 useEffect(()=>{if(!viewAs)writeAccount(filter.account)},[filter.account,viewAs]);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify({filter,tab}))}catch{}},[filter,tab,KEY]);
 const trades=useMemo(()=>data?.trades||[],[data]),list=useMemo(()=>filterTrades(trades,filter,now),[trades,filter,now]);
 const allTags=useMemo(()=>[...new Set(trades.flatMap(t=>t.tags))].sort(),[trades]);
 const banner=viewAs?<p className="j-viewas" role="status">Prohlížíš deník: <b>{viewAs.name}</b> · jen pro čtení</p>:null;
 const open=(id:string)=>{location.hash='journal/'+encodeURIComponent(id)};
 const close=()=>{location.hash='journal'};
 const pick=(k:Tab|Sec)=>{if(k==='review'||k==='backtest'){if(sec!==k)location.hash=k==='review'?'journal/vyhodnoceni':'journal/backtest';return}setTab(k);if(sec)location.hash='journal'};
 const activeTab=m&&sec?sec:tab,tabs:[Tab|Sec,string][]=[['trades','Obchody'],['stats','Statistiky'],['open',openData?`Otevřené (${openCount})`:'Otevřené'],...(m?[['review','Vyhodnocení'],['backtest','Backtest']] as [Sec,string][]:[])];
 const tabBar=<div className="j-tabs" role="tablist">{tabs.map(([k,l])=><button key={k} type="button" role="tab" aria-selected={activeTab===k} className={activeTab===k?'active':''} onClick={()=>pick(k)}>{l}</button>)}</div>;
 if(m&&sec)return <div className="j-page"><div className="j-head"><h1>Deník obchodů</h1>{tabBar}</div><Journaling embed={sec}/></div>;
 if(!data)return <div className="j-page">{error?<p role="alert" className="s-notice">{error}</p>:<p className="j-muted">Načítám deník…</p>}</div>;
 if(detail){const idx=list.findIndex(t=>t.id===detail);
  return <div className="j-page">{banner}<TradeDetail key={detail} id={detail} trade={trades.find(t=>t.id===detail)} currency={data.currency} allTags={allTags} prev={idx>0?list[idx-1].id:null} next={idx>=0&&idx<list.length-1?list[idx+1].id:null} onOpen={open} onClose={close} onChanged={reload} readOnly={!!viewAs} query={q}/></div>}
 return <div className="j-page">
  {banner}<div className="j-head"><h1>Deník obchodů</h1>{tabBar}</div>
  {error&&<p role="alert" className="s-notice">{error}</p>}
  {tab==='open'?<>{(data.accounts.length>1||filter.account!=='all')&&<div className="j-filters"><label className="j-field"><span>Účet</span><select value={filter.account} onChange={e=>setFilter(f=>({...f,account:e.target.value}))}><option value="all">Všechny</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}{trades.some(t=>t.source==='manual')&&<option value="manual">Ručně</option>}</select></label></div>}<OpenPositionsTab data={openData} now={openNow} account={filter.account} onOpen={id=>open('mt:'+id)}/></>:!trades.length?<div className="j-card j-empty"><p>Zatím tu nejsou žádné obchody.</p><p>Připoj MetaTrader na stránce <a href="/mt">Propojení s MetaTraderem</a> – každý obchod se sem pak zapíše sám. Ručně zapsané obchody z kalendáře na Dashboardu se tu objeví také.</p></div>:<>
   <Filters filter={filter} onChange={setFilter} trades={trades} accounts={data.accounts}/>
   {tab==='trades'?<TradesTable trades={list} currency={data.currency} onOpen={open}/>:<StatsView trades={list} currency={data.currency}/>}
  </>}
 </div>;
}
