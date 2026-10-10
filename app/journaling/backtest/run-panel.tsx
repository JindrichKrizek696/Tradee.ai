'use client';
// Nastavení běhu: trhy (jeden, víc, celá skupina), časový rámec, období, kapitál a riziko.
import {useState} from 'react';
import {instruments,groups} from '@/lib/markets';
import type {BtTf} from '@/lib/backtest/engine';
import {MAX_MARKETS} from '@/lib/backtest/request';
import {plural} from '@/lib/journal/format';
import {NumInput} from './shared';
export type Preset='3m'|'6m'|'1y'|'2y'|'max'|'custom';
export type RunSettings={markets:string[];tf:BtTf;preset:Preset;from:string;to:string};
export const PRESETS:[Preset,string][]=[['3m','3 měs.'],['6m','6 měs.'],['1y','1 rok'],['2y','2 roky'],['max','Max'],['custom','Vlastní']];
const DAYS:Record<Exclude<Preset,'custom'|'max'>,number>={'3m':91,'6m':182,'1y':365,'2y':730};
const MAX_DAYS:Record<BtTf,number>={H1:729,D1:25*365};
// měnové indexy nemají archiv svíček → v backtestu nejsou
export const MARKET_GROUPS=Object.keys(groups).filter(g=>g!=='all'&&g!=='currency').map(g=>({id:g,label:groups[g],items:instruments.filter(i=>i.group===g)}));
const KNOWN=new Set(MARKET_GROUPS.flatMap(g=>g.items.map(i=>i.id)));
export const DEFAULT_SETTINGS:RunSettings={markets:['EUR/USD'],tf:'H1',preset:'1y',from:'',to:''};
export function sanitizeSettings(v:Partial<RunSettings>|null|undefined):RunSettings{
 const d=DEFAULT_SETTINGS,m=Array.isArray(v?.markets)?v.markets.filter(x=>KNOWN.has(x)).slice(0,MAX_MARKETS):d.markets;
 return {markets:m,tf:v?.tf==='D1'?'D1':'H1',preset:PRESETS.some(p=>p[0]===v?.preset)?v!.preset as Preset:d.preset,from:typeof v?.from==='string'?v.from:'',to:typeof v?.to==='string'?v.to:''};
}
// období pro API: předvolby jako ms (do = teď), vlastní jako data (do včetně celého dne)
export function periodOf(s:RunSettings,now:number):{from:number|string;to:number|string}|string{
 if(s.preset==='custom'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s.from)||!/^\d{4}-\d{2}-\d{2}$/.test(s.to))return 'Vyplň obě data vlastního období.';
  if(s.from>s.to)return 'Začátek období musí být před koncem.';
  return {from:s.from,to:s.to};
 }
 const days=s.preset==='max'?MAX_DAYS[s.tf]:Math.min(DAYS[s.preset],MAX_DAYS[s.tf]);
 return {from:now-days*864e5,to:now};
}
export function RunPanel({s,set,capital,risk,onSizing}:{s:RunSettings;set:(s:RunSettings)=>void;capital:number;risk:number;onSizing:(p:{capital?:number;riskPct?:number})=>void}){
 const [opened]=useState(()=>new Set(MARKET_GROUPS.filter(g=>g.items.some(i=>s.markets.includes(i.id))).map(g=>g.id))); // rozbalené skupiny jen při prvním vykreslení
 const sel=new Set(s.markets),full=s.markets.length>=MAX_MARKETS;
 const toggle=(id:string)=>set({...s,markets:sel.has(id)?s.markets.filter(x=>x!==id):full?s.markets:[...s.markets,id]});
 const group=(ids:string[],on:boolean)=>set({...s,markets:on?[...s.markets,...ids.filter(x=>!sel.has(x))].slice(0,MAX_MARKETS):s.markets.filter(x=>!ids.includes(x))});
 const today=new Date().toISOString().slice(0,10);
 return <div className="bt-run">
  <div className="bt-f wide"><span>Trhy · {s.markets.length} z nejvýš {MAX_MARKETS}{s.markets.length>0&&<button type="button" className="bt-link" onClick={()=>set({...s,markets:[]})}>zrušit výběr</button>}</span>
   <div className="bt-groups">{MARKET_GROUPS.map(g=>{const ids=g.items.map(i=>i.id),n=ids.filter(x=>sel.has(x)).length,all=n===ids.length;
    return <details key={g.id} className="bt-group" open={opened.has(g.id)}>
     <summary><span>{g.label}</span><small>{n?`${n} z ${ids.length}`:`${ids.length} ${plural(ids.length,['trh','trhy','trhů'])}`}</small><button type="button" className="bt-link" disabled={!all&&s.markets.length+ids.length-n>MAX_MARKETS} onClick={e=>{e.preventDefault();group(ids,!all)}}>{all?'zrušit skupinu':'celá skupina'}</button></summary>
     <div className="jg-chips">{g.items.map(i=><button key={i.id} type="button" className={sel.has(i.id)?'on':''} aria-pressed={sel.has(i.id)} disabled={!sel.has(i.id)&&full} onClick={()=>toggle(i.id)}>{g.id==='fx'?i.id:i.name}</button>)}</div>
    </details>})}</div>
   {s.markets.length>0&&<p className="bt-picked">{s.markets.join(', ')}</p>}
  </div>
  <div className="bt-f"><span>Časový rámec</span><div className="jg-seg" role="radiogroup" aria-label="Časový rámec">{(['H1','D1'] as BtTf[]).map(t=><button key={t} type="button" role="radio" aria-checked={s.tf===t} className={s.tf===t?'on':''} onClick={()=>set({...s,tf:t})}>{t}</button>)}</div></div>
  <div className="bt-f wide"><span>Období</span><div className="jg-seg bt-presets" role="radiogroup" aria-label="Období">{PRESETS.map(([k,l])=><button key={k} type="button" role="radio" aria-checked={s.preset===k} className={s.preset===k?'on':''} onClick={()=>set({...s,preset:k})}>{l}</button>)}</div>
   {s.preset==='custom'&&<div className="bt-params"><label className="bt-f"><span>Od</span><input type="date" value={s.from} max={s.to||today} onChange={e=>set({...s,from:e.target.value})}/></label><label className="bt-f"><span>Do (včetně)</span><input type="date" value={s.to} min={s.from||undefined} max={today} onChange={e=>set({...s,to:e.target.value})}/></label></div>}
   <small className="bt-help">{s.tf==='H1'?'H1 nejvýš 2 roky zpět.':'D1 až 25 let zpět.'} Data Tradee (skóre, COT, zprávy) mají kratší historii.</small>
  </div>
  <div className="bt-params">
   <label className="bt-f"><span>Počáteční kapitál</span><span className="bt-unit"><NumInput label="Počáteční kapitál" value={capital} min={100} max={1e9} onChange={v=>{if(v!==null)onSizing({capital:v})}}/><em>USD</em></span></label>
   <label className="bt-f"><span>Riziko na obchod</span><span className="bt-unit"><NumInput label="Riziko na obchod" value={risk} min={0.01} max={100} onChange={v=>{if(v!==null)onSizing({riskPct:v})}}/><em>% účtu</em></span></label>
  </div>
  <small className="bt-help">Riziko se počítá z aktuální equity; výsledek obchodu = R × riziko. Kapitál a riziko se ukládají s pravidly.</small>
 </div>;
}
