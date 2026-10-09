'use client';
import type {JournalAccount,JournalTrade} from '@/lib/journal/types';
import {DEFAULT_FILTER,type Filter,type Period} from '@/lib/journal/stats';
const PERIODS:[Period,string][]=[['week','Tento týden'],['month','Tento měsíc'],['30d','30 dní'],['90d','90 dní'],['year','Tento rok'],['all','Vše'],['custom','Vlastní']];
type Opt=[string,string];
export function Filters({filter,onChange,trades,accounts}:{filter:Filter;onChange:(f:Filter)=>void;trades:JournalTrade[];accounts:JournalAccount[]}){
 const set=(p:Partial<Filter>)=>onChange({...filter,...p});
 const symbols=[...new Set(trades.map(t=>t.symbol))].sort(),tags=[...new Set(trades.flatMap(t=>t.tags))].sort(),hasManual=trades.some(t=>t.source==='manual');
 const sel=(label:string,value:string,on:(v:string)=>void,opts:Opt[])=><label className="j-field"><span>{label}</span><select value={value} onChange={e=>on(e.target.value)}>{opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>;
 return <div className="j-filters">
  {sel('Účet',filter.account,v=>set({account:v}),[['all','Všechny'],...accounts.map(a=>[a.id,a.name] as Opt),...(hasManual?[['manual','Ručně'] as Opt]:[])])}
  {sel('Období',filter.period,v=>set({period:v as Period}),PERIODS)}
  {filter.period==='custom'&&<><label className="j-field"><span>Od</span><input type="date" value={filter.from} onChange={e=>set({from:e.target.value})}/></label><label className="j-field"><span>Do</span><input type="date" value={filter.to} onChange={e=>set({to:e.target.value})}/></label></>}
  {sel('Pár',filter.symbol,v=>set({symbol:v}),[['all','Všechny'],...symbols.map(s=>[s,s] as Opt)])}
  {sel('Tag',filter.tag,v=>set({tag:v}),[['all','Všechny'],...tags.map(t=>[t,'#'+t] as Opt)])}
  {sel('Směr',filter.side,v=>set({side:v as Filter['side']}),[['all','Oba'],['buy','Buy'],['sell','Sell']])}
  {sel('Výsledek',filter.result,v=>set({result:v as Filter['result']}),[['all','Vše'],['win','Zisk'],['loss','Ztráta']])}
  {sel('Zdroj',filter.source,v=>set({source:v as Filter['source']}),[['all','Vše'],['mt','MetaTrader'],['manual','Ručně']])}
  {JSON.stringify(filter)!==JSON.stringify(DEFAULT_FILTER)&&<button type="button" className="j-reset" onClick={()=>onChange(DEFAULT_FILTER)}>Zrušit filtry</button>}
 </div>;
}
