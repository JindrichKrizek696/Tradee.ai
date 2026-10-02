'use client';
import {useMemo,useState} from 'react';
import {LayoutGrid,List,Search} from 'lucide-react';
import {Picker} from '../score-analyzer';
import {groups,flagLabels} from '@/lib/markets';
import {topSignals,heatmapGroups,sortItems,filterItems,type MarketItem,type ScoreFilter,type SortKey} from '@/lib/market-view';
import type {Palette} from '@/lib/palettes';
import {TopSignals} from './top-signals';
import {Heatmap} from './heatmap';
import {MarketTable} from './market-table';
const VIEW_KEY='tradee.markets.view';
const readView=()=>{try{return localStorage.getItem(VIEW_KEY)==='table'?'table':'heatmap'}catch{return 'heatmap'}};

export function MarketsView({items,checkedAt,palette,flags,flagsReady,onFlag,open}:{items:MarketItem[];checkedAt:string;palette:Palette;flags:Record<string,string>;flagsReady:boolean;onFlag:(id:string,flag:string)=>void;open:(id:string)=>void}){
 // Seznam trhů se vykreslí až po přepnutí pohledu v prohlížeči, localStorage je dostupné hned.
 const [view,setViewState]=useState<'heatmap'|'table'>(readView),[group,setGroup]=useState('all'),[query,setQuery]=useState(''),[score,setScore]=useState<ScoreFilter>('all'),[flag,setFlag]=useState('all'),[sort,setSort]=useState<{key:SortKey;dir:1|-1}>({key:'score',dir:-1});
 const setView=(v:'heatmap'|'table')=>{setViewState(v);try{localStorage.setItem(VIEW_KEY,v)}catch{}};
 const inGroup=useMemo(()=>items.filter(i=>group==='all'||i.group===group),[items,group]);
 const top=useMemo(()=>topSignals(inGroup),[inGroup]);
 const heat=useMemo(()=>heatmapGroups(inGroup,groups),[inGroup]);
 const rows=useMemo(()=>sortItems(filterItems(inGroup,{query,score,flag},flags),sort.key,sort.dir),[inGroup,query,score,flag,flags,sort]);
 const onSort=(k:SortKey)=>setSort(s=>s.key===k?{key:k,dir:s.dir>0?-1:1}:{key:k,dir:k==='name'?1:-1});
 const stamp=new Date(checkedAt).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
 return <div className="m-page">
  <div className="m-head-bar">
   <h1>Analýza trhů</h1><span className="m-stamp">kontrola podkladů {stamp}</span>
   <label className="m-search"><Search size={15}/><input aria-label="Hledat trh" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Hledat trh…"/></label>
   <div className="m-switch" role="tablist" aria-label="Zobrazení"><button type="button" role="tab" aria-selected={view==='heatmap'} className={view==='heatmap'?'on':''} onClick={()=>setView('heatmap')}><LayoutGrid size={15}/>Heatmapa</button><button type="button" role="tab" aria-selected={view==='table'} className={view==='table'?'on':''} onClick={()=>setView('table')}><List size={15}/>Tabulka</button></div>
  </div>
  <div className="m-groups">{Object.entries(groups).map(([g,label])=><button key={g} type="button" className={g===group?'on':''} onClick={()=>setGroup(g)}>{label}<small>{g==='all'?items.length:items.filter(i=>i.group===g).length}</small></button>)}{view==='table'&&<div className="m-filters"><Picker label="Filtrovat skóre" value={score} onChange={v=>setScore(v as ScoreFilter)} items={[{value:'all',label:'Všechna skóre'},{value:'positive',label:'Bullish · nad 0'},{value:'negative',label:'Bearish · pod 0'},{value:'strong',label:'Výrazné · |40| a více'},{value:'missing',label:'Bez platného skóre'}]}/><Picker label="Filtrovat vlaječky" value={flag} onChange={setFlag} items={[{value:'all',label:'Všechny vlaječky'},...Object.entries(flagLabels).map(([value,label])=>({value,label}))]}/></div>}</div>
  {view==='heatmap'&&<TopSignals bull={top.bull} bear={top.bear} open={open}/>}
  {view==='heatmap'?<Heatmap groups={heat} query={query} palette={palette} flags={flags} flagsReady={flagsReady} onFlag={onFlag} open={open}/>:<>
   <MarketTable items={rows} sort={sort} onSort={onSort} groupLabels={groups} flags={flags} flagsReady={flagsReady} onFlag={onFlag} open={open}/>
  </>}
  <p className="m-legend"><i className="bull"/>bullish <i className="bear"/>bearish · sytost = síla signálu · <i className="none"/>bez platného skóre · tečka = tvoje vlaječka. FX kompozit kombinuje fundament, COT, trend a sezónu; akcie, indexy a krypto mají technický model.</p>
 </div>;
}
