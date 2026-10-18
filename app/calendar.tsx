'use client';
import {Fragment,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Globe2,RotateCcw,SlidersHorizontal} from 'lucide-react';
import {pairs} from '@/lib/score-engine';
import {categories,marketLabels,marketGroups,signalLabels,defaultFilters,filterEvents,flaggedMarkets,readFilters,relative,sourceUrl,TIMEZONES,DEFAULT_TZ,isTz,resolveTz,tzOffset,type CalendarEvent,type Category,type Filters,type Signal} from '@/lib/calendar';
import {forecastLine} from '@/lib/calendar-ff';
import {useOpenRequest} from './open-request';
const KEY='tradee.calendar.filters',TZ_KEY='tradee.calendar.tz';
const time=(s:string,tz:string)=>new Date(s).toLocaleTimeString('cs-CZ',{timeZone:tz,hour:'2-digit',minute:'2-digit'});
const dayName=(s:string,tz:string)=>new Date(s).toLocaleDateString('cs-CZ',{timeZone:tz,weekday:'long',day:'numeric',month:'long'});
const stamp=(s:string,tz:string)=>new Date(s).toLocaleString('cs-CZ',{timeZone:tz,day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const toggle=<T,>(list:T[],v:T)=>list.includes(v)?list.filter(x=>x!==v):[...list,v];
const filterKey=(x:Filters)=>JSON.stringify([[...x.categories].sort(),[...x.markets].sort(),[...x.signals].sort(),x.showGlobal,x.hidePast]);

// Časové pásmo kalendáře: volba se pamatuje v prohlížeči a platí i pro události na dashboardu.
let tzPick:string|null=null;
const readTz=():string=>{if(tzPick)return tzPick;try{const v=localStorage.getItem(TZ_KEY);return isTz(v)?v:DEFAULT_TZ}catch{return DEFAULT_TZ}};
const subTz=(f:()=>void)=>{addEventListener('tradee:tz',f);return()=>removeEventListener('tradee:tz',f)};
const pickTz=(v:string)=>{tzPick=v;try{localStorage.setItem(TZ_KEY,v)}catch{}dispatchEvent(new Event('tradee:tz'))};
export function useCalendarTz(){const pick=useSyncExternalStore(subTz,readTz,()=>DEFAULT_TZ);return {pick,zone:resolveTz(pick)}}

export function SignalBars({signal}:{signal:Signal}){return <span className={'c-sig c-s'+signal} aria-hidden="true"><i/><i/><i/></span>}
// Štítek události, která hýbe všemi trhy (není to tlačítko).
export const AllTag=()=><span className="c-tag c-all" title="Hýbe všemi trhy"><Globe2 size={11} aria-hidden="true"/>VŠE</span>;

export function EventRow({e,now,mine,open,onToggle,compact}:{e:CalendarEvent;now:number;mine:Set<string>;open?:boolean;onToggle?:()=>void;compact?:boolean}){
 const {zone}=useCalendarTz(),past=Date.parse(e.at)<now,watched=e.markets.some(m=>mine.has(m));
 return <div data-ev={e.id} className={'c-row'+(past?' c-past':'')+(open?' c-open':'')+(compact?' c-compact':'')} role={onToggle?'button':undefined} tabIndex={onToggle?0:undefined} aria-expanded={onToggle?!!open:undefined} onClick={onToggle} onKeyDown={k=>{if(onToggle&&(k.key==='Enter'||k.key===' ')){k.preventDefault();onToggle()}}}>
  <span className="c-strength" title={signalLabels[e.signal]}><SignalBars signal={e.signal}/>{!compact&&signalLabels[e.signal]}</span>
  <span className="c-when"><b>{e.timeKnown?time(e.at,zone):'—'}</b><small>{compact?new Date(e.at).toLocaleDateString('cs-CZ',{timeZone:zone,day:'numeric',month:'numeric'})+' · ':''}{relative(e.at,now)}</small></span>
  <span className="c-title">{e.title}{forecastLine(e)&&<small className="c-fc">{forecastLine(e)}</small>}</span>
  {!compact&&<span className="c-tags">{e.global&&<AllTag/>}{e.markets.map(m=><span key={m} className="c-tag">{marketLabels[m]??m}</span>)}{watched&&<span className="c-tag c-mine">sleduješ</span>}</span>}
  {compact?e.global&&<AllTag/>:<span className={'c-ver'+(e.verified?'':' c-no')} title={e.verified?'Ověřeno agentem':'Zatím jen termín z oficiálního kalendáře'}>{e.verified?'✓':'○'}</span>}
 </div>;
}

function EventDetail({e,flags,now,zone}:{e:CalendarEvent;flags:Record<string,string>;now:number;zone:string}){
 const affected=pairs.filter(p=>p.split('/').some(c=>e.markets.includes(c)));
 const followed=affected.filter(p=>flags[p]&&flags[p]!=='none');
 return <div className="c-detail">
  <div><h4>Na co se dívat</h4><p>{e.watch||'Agent zatím nedoplnil.'}</p>{affected.length>0&&<small>Dotčené páry: {affected.slice(0,8).join(', ')}{affected.length>8?' …':''}{followed.length>0&&<> · sleduješ: <b>{followed.join(', ')}</b></>}</small>}</div>
  <div><h4>Očekávání · předchozí</h4><p><b>{e.consensus||e.forecast||'zatím neznámé'}</b></p><small>předchozí: {e.previous||'—'}{!e.consensus&&e.forecast&&' · odhad ForexFactory'}</small><h4>Výsledek</h4><p>{e.actual||(Date.parse(e.at)<now?'čeká na ověření':'zatím neznámý')}</p></div>
  <div><h4>Zdroj</h4>{e.source&&sourceUrl(e.source)?<a href={e.source} target="_blank" rel="noreferrer" onClick={x=>x.stopPropagation()}>{sourceUrl(e.source)}</a>:<p>—</p>}<small>{e.verified?'ověřeno agentem'+(e.verifiedAt?' '+stamp(e.verifiedAt,zone):''):'jen termín z oficiálního kalendáře'}{!e.timeKnown&&' · přesný čas neověřen'}</small></div>
 </div>;
}

export function CalendarPage({events,now,flags,generatedAt}:{events:CalendarEvent[];now:number;flags:Record<string,string>;generatedAt:string}){
 // Kalendář se vykreslí až po přepnutí pohledu v prohlížeči, localStorage je tedy dostupné hned.
 const [f,setF]=useState<Filters>(()=>{let raw:string|null=null;try{raw=localStorage.getItem(KEY)}catch{}return readFilters(raw)}),[open,setOpen]=useState<string|null>(null),[panel,setPanel]=useState(false),nowLine=useRef<HTMLDivElement>(null),scrolled=useRef(false),filters=useRef<HTMLDivElement>(null),[stuck,setStuck]=useState(false),[pin,setPin]=useState<string|null>(null);
 // událost vybraná ve vyhledávání: rozbalit, ukázat i přes filtry a odjet na ni (místo čáry „teď“)
 useOpenRequest('event',id=>{scrolled.current=true;setPin(id);setOpen(id)});
 useEffect(()=>{if(!pin)return;const t=setTimeout(()=>{const el=document.querySelector<HTMLElement>(`[data-ev="${CSS.escape(pin)}"]`);if(!el)return;el.scrollIntoView({block:'center',behavior:'smooth'});el.classList.add('c-flash');setTimeout(()=>el.classList.remove('c-flash'),2200)},60);return()=>clearTimeout(t)},[pin]);
 const {pick,zone}=useCalendarTz();
 // přilepené filtry dostanou nad sebou kryt s pozadím stránky (calendar.css), aby nad nimi neprojížděly události
 useEffect(()=>{const on=()=>{const el=filters.current,s=el&&getComputedStyle(el);setStuck(!!s&&s.position==='sticky'&&el!.getBoundingClientRect().top<=parseFloat(s.top)+.5)};on();addEventListener('scroll',on,{passive:true});addEventListener('resize',on);return()=>{removeEventListener('scroll',on);removeEventListener('resize',on)}},[]);
 const update=(next:Filters)=>{setF(next);try{localStorage.setItem(KEY,JSON.stringify(next))}catch{}};
 const mine=useMemo(()=>flaggedMarkets(flags),[flags]);
 const shown=useMemo(()=>{const s=filterEvents(events,f,now);return !pin||s.some(e=>e.id===pin)?s:events.filter(e=>e.id===pin||s.includes(e))},[events,f,now,pin]);
 const firstFuture=shown.find(e=>Date.parse(e.at)>=now);
 // Při otevření skoč na čáru „teď“ – nahoře je jinak týden proběhlých událostí.
 useEffect(()=>{if(!scrolled.current&&nowLine.current){scrolled.current=true;nowLine.current.scrollIntoView({block:'start'})}},[firstFuture?.id]);
 const days=new Map<string,CalendarEvent[]>();
 for(const e of shown){const k=dayName(e.at,zone);if(!days.has(k))days.set(k,[]);days.get(k)!.push(e)}
 const today=dayName(new Date(now).toISOString(),zone),nextDay=firstFuture?dayName(firstFuture.at,zone):null;
 // Čára „teď“ stojí u první budoucí události, jen když je dnes. Jinak patří za dnešní proběhlé události,
 // a když dnes žádná není, vloží se samostatný řádek „dnes“ (aby „teď“ nevisel pod hlavičkou jiného dne).
 const nowInside=nextDay===today;
 const nowMark=<div className="c-now" ref={nowLine}><span>teď {time(new Date(now).toISOString(),zone)}</span></div>;
 const quiet=<>{nowMark}<div className="c-quiet">Dnes už podle filtrů žádná další událost{firstFuture?' · další '+relative(firstFuture.at,now):''}</div></>;
 const todayBlock=<><div className="c-day c-today">{today} · dnes</div>{quiet}</>;
 const chip=(on:boolean,label:React.ReactNode,click:()=>void,key:string)=><button key={key} type="button" className={'c-chip'+(on?' on':'')} aria-pressed={on} onClick={click}>{label}</button>;
 const allCats=Object.keys(categories) as Category[],allMarkets=Object.keys(marketLabels);
 const all=(on:boolean,set:(on:boolean)=>void)=><button type="button" className="c-fall" onClick={()=>set(!on)}>{on?'zrušit vše':'vybrat vše'}</button>;
 return <div className="c-page">
  <div className="t-page-head c-head">
   <div><h1>Kalendář</h1><p>{events.length} událostí · aktualizováno {stamp(generatedAt,zone)}</p></div>
   <label className="c-tz"><Globe2 size={15} aria-hidden="true"/>Časové pásmo<select value={pick} onChange={x=>pickTz(x.target.value)}>{TIMEZONES.map(([id,l])=><option key={id} value={id}>{l} ({tzOffset(id,now)})</option>)}</select></label>
  </div>
  <button type="button" className="c-filter-toggle" aria-expanded={panel} onClick={()=>setPanel(!panel)}><SlidersHorizontal size={16}/>Filtry</button>
  <div ref={filters} className={'c-filters'+(panel?' open':'')+(stuck?' stuck':'')}>
   <div className="c-frow"><span className="c-flab">Síla</span><div className="c-fopts">{([1,2,3] as Signal[]).map(s=>chip(f.signals.includes(s),<><SignalBars signal={s}/>{signalLabels[s]}</>,()=>update({...f,signals:toggle(f.signals,s)}),'s'+s))}</div></div>
   <div className="c-frow"><span className="c-flab">Skupiny</span><div className="c-fopts">{allCats.map(c=>chip(f.categories.includes(c),categories[c],()=>update({...f,categories:toggle(f.categories,c)}),c))}</div>{all(f.categories.length===allCats.length,on=>update({...f,categories:on?allCats:[]}))}</div>
   <div className="c-frow"><span className="c-flab">Trhy</span><div className="c-fopts">{marketGroups.map(([g,ms])=><span key={g} className="c-fgroup"><small>{g}</small>{ms.map(m=>chip(f.markets.includes(m),marketLabels[m],()=>update({...f,markets:toggle(f.markets,m)}),m))}</span>)}</div>{all(f.markets.length===allMarkets.length,on=>update({...f,markets:on?allMarkets:[]}))}</div>
   <div className="c-frow c-fbar">
    <label className="c-switch"><input type="checkbox" checked={f.showGlobal} onChange={x=>update({...f,showGlobal:x.target.checked})}/>vždy ukázat <AllTag/></label>
    <label className="c-switch"><input type="checkbox" checked={f.hidePast} onChange={x=>update({...f,hidePast:x.target.checked})}/>skrýt proběhlé</label>
    <span className="c-fcount">zobrazeno <b>{shown.length}</b> z {events.length}</span>
    {filterKey(f)!==filterKey(defaultFilters)&&<button type="button" className="c-reset" onClick={()=>update(defaultFilters)}><RotateCcw size={13}/>Výchozí filtry</button>}
   </div>
  </div>
  {shown.length?<div className="c-list">{[...days].map(([d,list])=><Fragment key={d}>
   {!nowInside&&d===nextDay&&!days.has(today)&&todayBlock}
   <div className={'c-day'+(d===today?' c-today':'')}>{d}{d===today?' · dnes':''}</div>
   {list.map(e=><Fragment key={e.id}>
    {nowInside&&e.id===firstFuture!.id&&nowMark}
    <EventRow e={e} now={now} mine={mine} open={open===e.id} onToggle={()=>setOpen(open===e.id?null:e.id)}/>
    {open===e.id&&<EventDetail e={e} flags={flags} now={now} zone={zone}/>}
   </Fragment>)}
   {!nowInside&&d===today&&quiet}
  </Fragment>)}{!firstFuture&&!days.has(today)&&todayBlock}</div>:<div className="t-card c-empty"><p>Filtrům neodpovídá žádná událost.</p><button type="button" className="c-chip on" onClick={()=>update(defaultFilters)}>Zrušit filtry</button></div>}
  <p className="c-note"><span className="c-ver">✓</span> ověřeno agentem · <span className="c-ver c-no">○</span> zatím jen termín z oficiálního kalendáře · <AllTag/> hýbe všemi trhy · <span className="c-tag c-mine">sleduješ</span> týká se trhu s tvou vlaječkou · Odhady: ForexFactory</p>
 </div>;
}
