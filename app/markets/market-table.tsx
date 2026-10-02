'use client';
import type {MarketItem,SortKey} from '@/lib/market-view';
import {FlagDot} from './flag-dot';
import {ScoreBar,TrendMark,fmtScore} from './parts';
export function MarketTable({items,sort,onSort,groupLabels,flags,flagsReady,onFlag,open}:{items:MarketItem[];sort:{key:SortKey;dir:1|-1};onSort:(k:SortKey)=>void;groupLabels:Record<string,string>;flags:Record<string,string>;flagsReady:boolean;onFlag:(id:string,flag:string)=>void;open:(id:string)=>void}){
 const head=(k:SortKey,label:string)=><button type="button" className={'m-sort'+(sort.key===k?' on':'')} onClick={()=>onSort(k)} aria-sort={sort.key===k?(sort.dir>0?'ascending':'descending'):undefined}>{label}{sort.key===k?(sort.dir>0?' ↑':' ↓'):''}</button>;
 return <div className="m-table" role="table">
  <div className="m-row m-head" role="row">{head('name','Trh')}{head('score','Skóre')}<span>−100 · bearish ← → bullish · +100</span><span>Trend</span>{head('coverage','Data')}<span>Vlaječka</span></div>
  {items.map(i=><div key={i.id} className="m-row" role="row" tabIndex={0} onClick={()=>open(i.id)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();open(i.id)}}}>
   <span className="m-name"><b>{i.name}</b><small>{groupLabels[i.group]}</small></span>
   <b className={'m-score '+(i.score===null||i.score===0?'':i.score>0?'positive':'negative')}>{fmtScore(i.score)}</b>
   <ScoreBar score={i.score}/><TrendMark trend={i.trend}/><span className="m-cov">{i.coverage} %</span>
   <FlagDot id={i.id} flag={flags[i.id]||'none'} disabled={!flagsReady} onPick={onFlag}/>
  </div>)}
  {!items.length&&<p className="m-none">Filtrům neodpovídá žádný trh.</p>}
 </div>;
}
