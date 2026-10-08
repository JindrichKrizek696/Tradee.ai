'use client';
import {useEffect,useMemo,useState} from 'react';
import type {JournalList} from '@/lib/journal/types';
import {DEFAULT_FILTER,filterTrades,sanitizeFilter,type Filter} from '@/lib/journal/stats';
import {Filters} from './filters';
import {TradesTable} from './trades-table';
import {TradeDetail} from './trade-detail';
import {StatsView} from './stats-view';
import './journal.css';
type Tab='trades'|'stats';
// filtr a záložka se pamatují v prohlížeči (deník se renderuje jen na klientu)
function saved(key:string):{filter:Filter;tab:Tab}{try{const v=JSON.parse(localStorage.getItem(key)||'{}');return {filter:{...DEFAULT_FILTER,...(v.filter||{})},tab:v.tab==='stats'?'stats':'trades'}}catch{return {filter:DEFAULT_FILTER,tab:'trades'}}}
const hashId=()=>{const h=location.hash;if(!h.startsWith('#journal/'))return null;try{return decodeURIComponent(h.slice(9))}catch{return null}};
export function Journal({viewAs}:{viewAs?:{id:string;name:string}}={}){
 const q=viewAs?'?as='+encodeURIComponent(viewAs.id):'',KEY=viewAs?'tradee.journal.admin':'tradee.journal';
 const [data,setData]=useState<JournalList|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState<Filter>(()=>saved(KEY).filter),[tab,setTab]=useState<Tab>(()=>saved(KEY).tab),[detail,setDetail]=useState<string|null>(()=>hashId()),[now]=useState(()=>Date.now());
 async function reload(){try{const r=await fetch('/api/journal'+q,{cache:'no-store'});const j=await r.json() as JournalList&{error?:string};if(!r.ok)throw Error(j.error||'');setData(j);setError('')}catch(e){setError((e as Error).message||'Deník se nepodařilo načíst. Zkus obnovit stránku.')}}
 useEffect(()=>{reload();const on=()=>setDetail(hashId());window.addEventListener('hashchange',on);
  return()=>{window.removeEventListener('hashchange',on);if(location.hash.startsWith('#journal'))history.replaceState(null,'',location.pathname+location.search)}},[]);
 // po načtení dat zrušit části filtru, které odkazují na smazaný účet, tag nebo pár
 useEffect(()=>{if(data)setFilter(f=>{const s=sanitizeFilter(f,data.trades,data.accounts);return JSON.stringify(s)===JSON.stringify(f)?f:s})},[data]);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify({filter,tab}))}catch{}},[filter,tab,KEY]);
 const trades=useMemo(()=>data?.trades||[],[data]),list=useMemo(()=>filterTrades(trades,filter,now),[trades,filter,now]);
 const allTags=useMemo(()=>[...new Set(trades.flatMap(t=>t.tags))].sort(),[trades]);
 const banner=viewAs?<p className="j-viewas" role="status">Prohlížíš deník: <b>{viewAs.name}</b> · jen pro čtení</p>:null;
 const open=(id:string)=>{location.hash='journal/'+encodeURIComponent(id)};
 const close=()=>{location.hash='journal'};
 if(!data)return <div className="j-page">{error?<p role="alert" className="s-notice">{error}</p>:<p className="j-muted">Načítám deník…</p>}</div>;
 if(detail){const idx=list.findIndex(t=>t.id===detail);
  return <div className="j-page">{banner}<TradeDetail key={detail} id={detail} trade={trades.find(t=>t.id===detail)} currency={data.currency} allTags={allTags} prev={idx>0?list[idx-1].id:null} next={idx>=0&&idx<list.length-1?list[idx+1].id:null} onOpen={open} onClose={close} onChanged={reload} readOnly={!!viewAs} query={q}/></div>}
 return <div className="j-page">
  {banner}<div className="j-head"><h1>Deník obchodů</h1><div className="j-tabs" role="tablist">{([['trades','Obchody'],['stats','Statistiky']] as [Tab,string][]).map(([k,l])=><button key={k} type="button" role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>)}</div></div>
  {error&&<p role="alert" className="s-notice">{error}</p>}
  {!trades.length?<div className="j-card j-empty"><p>Zatím tu nejsou žádné obchody.</p><p>Připoj MetaTrader na stránce <a href="/mt">Propojení s MetaTraderem</a> – každý obchod se sem pak zapíše sám. Ručně zapsané obchody z kalendáře na Dashboardu se tu objeví také.</p></div>:<>
   <Filters filter={filter} onChange={setFilter} trades={trades} accounts={data.accounts}/>
   {tab==='trades'?<TradesTable trades={list} currency={data.currency} onOpen={open}/>:<StatsView trades={list} currency={data.currency}/>}
  </>}
 </div>;
}
