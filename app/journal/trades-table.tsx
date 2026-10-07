'use client';
import {useEffect,useState} from 'react';
import {FileText,Image as ImageIcon} from 'lucide-react';
import type {JournalTrade} from '@/lib/journal/types';
import {sortTrades,type SortKey} from '@/lib/journal/stats';
import {fmtMoney} from '@/lib/trades';
import {fmtHold,fmtR,fmtDateTime,fmtDate} from '@/lib/journal/format';
const COLS:[SortKey,string][]=[['closeTs','Zavřeno'],['account','Účet'],['symbol','Pár'],['side','Směr'],['volume','Objem'],['pnl','Výsledek'],['r','R'],['holdMs','Držení']];
const PAGE=50;
export function TradesTable({trades,currency,onOpen}:{trades:JournalTrade[];currency:string;onOpen:(id:string)=>void}){
 const [sort,setSort]=useState<{key:SortKey;dir:1|-1}>({key:'closeTs',dir:-1}),[page,setPage]=useState(0);
 useEffect(()=>setPage(0),[trades,sort]);
 if(!trades.length)return <p className="j-muted">Filtru neodpovídá žádný obchod.</p>;
 const rows=sortTrades(trades,sort.key,sort.dir),pages=Math.ceil(rows.length/PAGE),p=Math.min(page,pages-1),shown=rows.slice(p*PAGE,p*PAGE+PAGE);
 return <div className="j-card j-tablecard">
  <table className="j-table">
   <thead><tr>{COLS.map(([k,l])=><th key={k} aria-sort={sort.key===k?(sort.dir>0?'ascending':'descending'):undefined}><button type="button" onClick={()=>setSort(s=>({key:k,dir:s.key===k?(s.dir>0?-1:1):-1}))}>{l}{sort.key===k?(sort.dir>0?' ↑':' ↓'):''}</button></th>)}<th>Tagy</th><th><span className="sr-only">Poznámka, zdroj</span></th></tr></thead>
   <tbody>{shown.map(t=><tr key={t.id} tabIndex={0} onClick={()=>onOpen(t.id)} onKeyDown={e=>{if(e.key==='Enter')onOpen(t.id)}}>
    <td data-l="Zavřeno">{t.source==='mt'?fmtDateTime(t.closeTs):fmtDate(t.date)}</td>
    <td data-l="Účet">{t.account}</td>
    <td data-l="Pár"><b>{t.symbol}</b></td>
    <td data-l="Směr">{t.side?<span className={'j-side '+t.side}>{t.side==='buy'?'Buy':'Sell'}</span>:'–'}</td>
    <td data-l="Objem">{t.volume??'–'}</td>
    <td data-l="Výsledek" className={t.pnl>0?'pos':t.pnl<0?'neg':''} title={t.converted?undefined:'Kurz pro přepočet chybí – částka je v měně účtu'}>{fmtMoney(t.pnl,t.converted?currency:t.accountCurrency||currency)}</td>
    <td data-l="R">{fmtR(t.r)}</td>
    <td data-l="Držení">{fmtHold(t.holdMs)}</td>
    <td data-l="Tagy">{t.tags.map(x=><span key={x} className="j-chip">#{x}</span>)}</td>
    <td className="j-icons">{t.hasNote&&<FileText size={14} aria-label="Má poznámku"/>}{t.files>0&&<ImageIcon size={14} aria-label="Má screenshot"/>}<span className={'j-src '+t.source}>{t.source==='mt'?'MT':'Ručně'}</span></td>
   </tr>)}</tbody>
  </table>
  {pages>1&&<div className="j-pager"><button type="button" disabled={p===0} onClick={()=>setPage(p-1)}>← Předchozí</button><span>{p+1} / {pages}</span><button type="button" disabled={p>=pages-1} onClick={()=>setPage(p+1)}>Další →</button></div>}
 </div>;
}
