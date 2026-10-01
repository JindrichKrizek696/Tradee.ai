'use client';
import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {SlidersHorizontal} from 'lucide-react';
import {pairs} from '@/lib/score-engine';
import {categories,marketLabels,signalLabels,defaultFilters,filterEvents,flaggedMarkets,readFilters,relative,sourceUrl,type CalendarEvent,type Category,type Filters,type Signal} from '@/lib/calendar';
const KEY='tradee.calendar.filters',TZ='Europe/Prague';
const time=(s:string)=>new Date(s).toLocaleTimeString('cs-CZ',{timeZone:TZ,hour:'2-digit',minute:'2-digit'});
const dayName=(s:string)=>new Date(s).toLocaleDateString('cs-CZ',{timeZone:TZ,weekday:'long',day:'numeric',month:'long'});
const stamp=(s:string)=>new Date(s).toLocaleString('cs-CZ',{timeZone:TZ,day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const toggle=<T,>(list:T[],v:T)=>list.includes(v)?list.filter(x=>x!==v):[...list,v];

export function SignalBars({signal}:{signal:Signal}){return <span className={'c-sig c-s'+signal} aria-hidden="true"><i/><i/><i/></span>}

export function EventRow({e,now,mine,open,onToggle,compact}:{e:CalendarEvent;now:number;mine:Set<string>;open?:boolean;onToggle?:()=>void;compact?:boolean}){
 const past=Date.parse(e.at)<now,watched=e.markets.some(m=>mine.has(m));
 return <div className={'c-row'+(past?' c-past':'')+(open?' c-open':'')+(compact?' c-compact':'')} role={onToggle?'button':undefined} tabIndex={onToggle?0:undefined} aria-expanded={onToggle?!!open:undefined} onClick={onToggle} onKeyDown={k=>{if(onToggle&&(k.key==='Enter'||k.key===' ')){k.preventDefault();onToggle()}}}>
  <span className="c-strength" title={signalLabels[e.signal]}><SignalBars signal={e.signal}/>{!compact&&signalLabels[e.signal]}</span>
  <span className="c-when"><b>{e.timeKnown?time(e.at):'—'}</b><small>{compact?new Date(e.at).toLocaleDateString('cs-CZ',{timeZone:TZ,day:'numeric',month:'numeric'})+' · ':''}{relative(e.at,now)}</small></span>
  <span className="c-title">{e.title}</span>
  {!compact&&<span className="c-tags">{e.global&&<span className="c-tag c-all">VŠE</span>}{e.markets.map(m=><span key={m} className="c-tag">{marketLabels[m]??m}</span>)}{watched&&<span className="c-tag c-mine">sleduješ</span>}</span>}
  {compact?e.global&&<span className="c-tag c-all">VŠE</span>:<span className={'c-ver'+(e.verified?'':' c-no')} title={e.verified?'Ověřeno agentem':'Zatím jen termín z oficiálního kalendáře'}>{e.verified?'✓':'○'}</span>}
 </div>;
}

function EventDetail({e,flags,now}:{e:CalendarEvent;flags:Record<string,string>;now:number}){
 const affected=pairs.filter(p=>p.split('/').some(c=>e.markets.includes(c)));
 const followed=affected.filter(p=>flags[p]&&flags[p]!=='none');
 return <div className="c-detail">
  <div><h4>Na co se dívat</h4><p>{e.watch||'Agent zatím nedoplnil.'}</p>{affected.length>0&&<small>Dotčené páry: {affected.slice(0,8).join(', ')}{affected.length>8?' …':''}{followed.length>0&&<> · sleduješ: <b>{followed.join(', ')}</b></>}</small>}</div>
  <div><h4>Očekávání · předchozí</h4><p><b>{e.consensus||'zatím neznámé'}</b></p><small>předchozí: {e.previous||'—'}</small><h4>Výsledek</h4><p>{e.actual||(Date.parse(e.at)<now?'čeká na ověření':'zatím neznámý')}</p></div>
  <div><h4>Zdroj</h4>{e.source&&sourceUrl(e.source)?<a href={e.source} target="_blank" rel="noreferrer" onClick={x=>x.stopPropagation()}>{sourceUrl(e.source)}</a>:<p>—</p>}<small>{e.verified?'ověřeno agentem'+(e.verifiedAt?' '+stamp(e.verifiedAt):''):'jen termín z oficiálního kalendáře'}{!e.timeKnown&&' · přesný čas neověřen'}</small></div>
 </div>;
}

export function CalendarPage({events,now,flags,generatedAt}:{events:CalendarEvent[];now:number;flags:Record<string,string>;generatedAt:string}){
 // Kalendář se vykreslí až po přepnutí pohledu v prohlížeči, localStorage je tedy dostupné hned.
 const [f,setF]=useState<Filters>(()=>{let raw:string|null=null;try{raw=localStorage.getItem(KEY)}catch{}return readFilters(raw)}),[open,setOpen]=useState<string|null>(null),[panel,setPanel]=useState(false),nowLine=useRef<HTMLDivElement>(null),scrolled=useRef(false);
 const update=(next:Filters)=>{setF(next);try{localStorage.setItem(KEY,JSON.stringify(next))}catch{}};
 const mine=useMemo(()=>flaggedMarkets(flags),[flags]);
 const shown=useMemo(()=>filterEvents(events,f,now),[events,f,now]);
 const firstFuture=shown.find(e=>Date.parse(e.at)>=now)?.id;
 // Při otevření skoč na čáru „teď“ – nahoře je jinak týden proběhlých událostí.
 useEffect(()=>{if(!scrolled.current&&nowLine.current){scrolled.current=true;nowLine.current.scrollIntoView({block:'start'})}},[firstFuture]);
 const days=new Map<string,CalendarEvent[]>();
 for(const e of shown){const k=dayName(e.at);if(!days.has(k))days.set(k,[]);days.get(k)!.push(e)}
 const today=dayName(new Date(now).toISOString());
 const chip=(on:boolean,label:string,click:()=>void,key:string)=><button key={key} type="button" className={'c-chip'+(on?' on':'')} aria-pressed={on} onClick={click}>{label}</button>;
 return <div className="c-page">
  <div className="t-page-head c-head"><div><h1>Kalendář</h1><p>Čas v Praze · {events.length} událostí · zobrazeno {shown.length}</p></div><span className="t-val">aktualizováno {stamp(generatedAt)}</span></div>
  <button type="button" className="c-filter-toggle" aria-expanded={panel} onClick={()=>setPanel(!panel)}><SlidersHorizontal size={16}/>Filtry</button>
  <div className={'c-filters'+(panel?' open':'')}>
   <div><span className="c-flab">Skupiny</span>{(Object.keys(categories) as Category[]).map(c=>chip(f.categories.includes(c),categories[c],()=>update({...f,categories:toggle(f.categories,c)}),c))}</div>
   <div><span className="c-flab">Trhy</span>{Object.keys(marketLabels).map(m=>chip(f.markets.includes(m),marketLabels[m],()=>update({...f,markets:toggle(f.markets,m)}),m))}</div>
   <div><span className="c-flab">Síla</span>{([[1,'vše'],[2,'střední+'],[3,'jen silná']] as [Signal,string][]).map(([s,l])=>chip(f.minSignal===s,l,()=>update({...f,minSignal:s}),'s'+s))}
    <label className="c-switch"><input type="checkbox" checked={f.showGlobal} onChange={x=>update({...f,showGlobal:x.target.checked})}/>vždy ukázat <span className="c-tag c-all">VŠE</span></label>
    <label className="c-switch"><input type="checkbox" checked={f.hidePast} onChange={x=>update({...f,hidePast:x.target.checked})}/>skrýt proběhlé</label></div>
  </div>
  {shown.length?<div className="c-list">{[...days].map(([d,list])=><Fragment key={d}>
   <div className="c-day">{d}{d===today?' · dnes':''}</div>
   {list.map(e=><Fragment key={e.id}>
    {e.id===firstFuture&&<div className="c-now" ref={nowLine}><span>teď {time(new Date(now).toISOString())}</span></div>}
    <EventRow e={e} now={now} mine={mine} open={open===e.id} onToggle={()=>setOpen(open===e.id?null:e.id)}/>
    {open===e.id&&<EventDetail e={e} flags={flags} now={now}/>}
   </Fragment>)}
  </Fragment>)}</div>:<div className="t-card c-empty"><p>Filtrům neodpovídá žádná událost.</p><button type="button" className="c-chip on" onClick={()=>update(defaultFilters)}>Zrušit filtry</button></div>}
  <p className="c-note"><span className="c-ver">✓</span> ověřeno agentem · <span className="c-ver c-no">○</span> zatím jen termín z oficiálního kalendáře · <span className="c-tag c-all">VŠE</span> hýbe všemi trhy · <span className="c-tag c-mine">sleduješ</span> týká se trhu s tvou vlaječkou</p>
 </div>;
}
