'use client';
// Metriky Statistik: u každé vzorec (tooltip), období, filtry a N; kliknutím seznam obchodů, ze kterých se počítá. Živé / sim / replay se nemíchají; export CSV.
import {useState} from 'react';
import {Download,Info} from 'lucide-react';
import type {JournalTrade} from '@/lib/journal/types';
import {metrics,byMode,modesIn,tradesCsv,MODES,type Mode,type Metric} from '@/lib/journal/metrics';
import {periodRange,rangeLabel,type Filter} from '@/lib/journal/stats';
import {pragueDate} from '@/lib/mt/trades';
import {fmtMoney} from '@/lib/trades';
import {fmtNum,fmtR,fmtDateTime,fmtDate} from '@/lib/journal/format';
import './record.css';
const PERIOD:Record<string,string>={week:'tento týden',month:'tento měsíc',prevmonth:'minulý měsíc','30d':'30 dní','90d':'90 dní',year:'letos',all:'celá historie'};
export function filterText(f:Filter,now:number){
 const [a,b]=periodRange(f,now),p=f.period==='custom'?rangeLabel(a,b,pragueDate(now)):PERIOD[f.period]||f.period,parts:string[]=[];
 if(f.account!=='all')parts.push('účet');if(f.symbol!=='all')parts.push(f.symbol);if(f.tag!=='all')parts.push('#'+f.tag);if(f.side!=='all')parts.push(f.side==='buy'?'Buy':'Sell');if(f.result!=='all')parts.push(f.result==='win'?'zisk':'ztráta');if(f.source!=='all')parts.push(f.source==='mt'?'MetaTrader':'ručně');
 return {period:p,filters:parts.length?parts.join(', '):'bez dalších filtrů'};
}
export function MetricsPanel({trades,currency,filter,now,onOpen}:{trades:JournalTrade[];currency:string;filter:Filter;now:number;onOpen:(id:string)=>void}){
 const modes=modesIn(trades),mixed=(filter.mode??'all')==='all'&&modes.length>1;
 const [pick,setPick]=useState<Mode>('live'),[sel,setSel]=useState<string|null>(null);
 const mode:Mode|'all'=mixed?(modes.includes(pick)?pick:modes[0]):(filter.mode??'all') as Mode|'all';
 const list=byMode(trades,mode),ms=metrics(list),ft=filterText(filter,now);
 const fmt=(m:Metric)=>m.value===null?'–':m.unit==='money'?fmtMoney(m.value,currency):m.unit==='R'?fmtR(m.value):m.unit==='%'?fmtNum(m.value,1)+' %':fmtNum(m.value,2);
 const cur=ms.find(m=>m.key===sel),byId=new Map(list.map(t=>[t.id,t]));
 function exportCsv(){const blob=new Blob(['﻿'+tradesCsv(list)],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`tradee-obchody-${mode}-${pragueDate(now)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
 return <section className="j-card">
  <div className="j-bhead"><h2>Metriky</h2>{mixed&&<div className="j-tabs small" role="tablist" aria-label="Režim">{modes.map(m=><button key={m} type="button" role="tab" aria-selected={mode===m} className={mode===m?'active':''} onClick={()=>{setPick(m);setSel(null)}}>{MODES[m]}</button>)}</div>}</div>
  <p className="jm-meta"><span>Období: <b>{ft.period}</b></span><span>Filtry: <b>{ft.filters}</b></span><span>Režim: <b>{mode==='all'?'všechny':MODES[mode]}</b></span><span>N = <b>{list.length}</b></span><button type="button" className="j-btn" onClick={exportCsv}><Download size={13}/> Export CSV</button></p>
  {mixed&&<p className="j-muted">Obchody ve filtru jsou z více režimů – metriky je nemíchají, přepni režim nahoře nebo ve filtru.</p>}
  <div className="jm-cards">{ms.map(m=><button key={m.key} type="button" className={'jm-card'+(sel===m.key?' on':'')} title={m.formula} aria-pressed={sel===m.key} onClick={()=>setSel(sel===m.key?null:m.key)}>
   <span>{m.label}<Info size={12} aria-hidden/></span><b className={m.unit==='money'||m.unit==='R'?(m.value??0)>0?'pos':(m.value??0)<0?'neg':'':''}>{fmt(m)}</b><small>N = {m.n} · {m.ids.length?'zobrazit obchody':'bez obchodů'}</small></button>)}</div>
  {cur&&<div className="jm-list"><p className="j-muted"><b>{cur.label}</b>: {cur.formula}</p>{cur.ids.slice(0,100).map(id=>{const t=byId.get(id);return t?<button key={id} type="button" onClick={()=>onOpen(id)}><span>{t.source==='mt'?fmtDateTime(t.closeTs):fmtDate(t.date)}</span><b>{t.symbol}</b><span className={t.pnl>0?'pos':t.pnl<0?'neg':''}>{fmtMoney(t.pnl,currency)}</span><span>{t.r===null?'neznámé R':fmtR(t.r)}</span></button>:null})}{cur.ids.length>100&&<small className="j-muted">… a dalších {cur.ids.length-100}</small>}</div>}
 </section>;
}
