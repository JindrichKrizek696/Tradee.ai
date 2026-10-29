'use client';
// Kalendář × historie (migrace 0040): plánovaný vs skutečný čas, odvozená skutečnost s revizemi, historie odhadu FF,
// stav zdroje (nedostupné / zastaralé), filtry dopadu a „jen moje“ (vlaječky, otevřené pozice) a historie ukazatele s grafem.
import {useEffect,useMemo,useState} from 'react';
import {History,X,AlertTriangle} from 'lucide-react';
import type {CalendarEvent} from '@/lib/calendar';
import {conceptOf,type FFRow} from '@/lib/calendar-ff';
import {deriveActuals,planUpsert,seriesPoints,feedState,readExtra,positionMarkets,IMPACTS,impactLabels,SAME_EVENT_MS,type HistEvent,type HistChange,type FeedStatus,type ExtraFilters} from '@/lib/calendar-hist';
import {BandChart} from './band-chart';
import './analysis-detail.css';
const DAY=86400000,PREFS_KEY='tradee.calendar.extra';
const dt=(ms:number,zone:string)=>new Date(ms).toLocaleString('cs-CZ',{timeZone:zone,day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const dd=(ms:number,zone:string)=>new Date(ms).toLocaleDateString('cs-CZ',{timeZone:zone,day:'numeric',month:'numeric',year:'2-digit'});

export type HistData={available:boolean;events:HistEvent[];changes:HistChange[];status:FeedStatus|null};
/** Historie pro okno kalendáře (jednou po otevření); bez DB nebo migrace zůstane available:false. */
export function useCalendarHist(events:CalendarEvent[]){
 const [h,setH]=useState<HistData|null>(null);
 const from=events.length?Date.parse(events[0].at)-DAY:0,to=events.length?Date.parse(events.at(-1)!.at)+DAY:0;
 useEffect(()=>{if(!from)return;let live=true;fetch(`/api/calendar?from=${from}&to=${to}`,{cache:'no-store'}).then(r=>(r.ok?r.json():null) as Promise<HistData|null>).then(j=>{if(live)setH(j??{available:false,events:[],changes:[],status:null})}).catch(()=>{if(live)setH({available:false,events:[],changes:[],status:null})});return()=>{live=false}},[from,to]);
 return h;
}
/** Událost historie k události kalendáře: přesný čas FF, jinak stejná řada do ±72 h (čas se posunul po sestavení aplikace). */
export function histFor(e:CalendarEvent,h:HistData|null):HistEvent|null{
 if(!e.ff||!h?.events.length)return null;const t=Date.parse(e.ff.at);let best:HistEvent|null=null;
 for(const x of h.events)if(x.currency===e.ff.currency&&x.title===e.ff.title){if(x.at===t||x.scheduledAt===t)return x;if(Math.abs(x.at-t)<=SAME_EVENT_MS&&(!best||Math.abs(x.at-t)<Math.abs(best.at-t)))best=x}
 return best;
}

export function FeedBanner({h,generatedAt,now,zone}:{h:HistData|null;generatedAt:string|null;now:number;zone:string}){
 const st=feedState(h?.status??null,generatedAt?Date.parse(generatedAt):null,now);
 if(st==='ok')return null;
 const last=Math.max(h?.status?.okAt??0,generatedAt?Date.parse(generatedAt):0);
 return <p className="s-notice ad-feed" role="status"><AlertTriangle size={15} aria-hidden/>{st==='unavailable'?'Odhady ForexFactory jsou teď nedostupné':'Odhady ForexFactory jsou zastaralé'} – zobrazujeme poslední data{last?' z '+dt(last,zone):''}.{st==='unavailable'&&h?.status?.error?' ('+h.status.error.slice(0,80)+')':''}</p>;
}

/** Filtry dopadu / „jen moje“ / události jen z FF: localStorage hned, účet (calendar_prefs) po načtení. */
export function useExtraFilters(){
 const [f,setF]=useState<ExtraFilters>(()=>{try{return readExtra(localStorage.getItem(PREFS_KEY))}catch{return readExtra(null)}});
 useEffect(()=>{let live=true;fetch('/api/calendar/prefs',{cache:'no-store'}).then(r=>(r.ok?r.json():null) as Promise<{prefs:ExtraFilters|null}|null>).then(j=>{if(live&&j?.prefs){setF(j.prefs);try{localStorage.setItem(PREFS_KEY,JSON.stringify(j.prefs))}catch{}}}).catch(()=>{});return()=>{live=false}},[]);
 const update=(next:ExtraFilters)=>{setF(next);try{localStorage.setItem(PREFS_KEY,JSON.stringify(next))}catch{}fetch('/api/calendar/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefs:next})}).catch(()=>{})};
 return [f,update] as const;
}
/** Trhy otevřených pozic (MT i ruční) pro filtr „moje pozice“. */
export function usePositionMarkets(){
 const [m,setM]=useState<Set<string>>(new Set());
 useEffect(()=>{let live=true;fetch('/api/positions/open',{cache:'no-store'}).then(r=>(r.ok?r.json():null) as Promise<{positions?:{instrument:string|null}[]}|null>).then(j=>{if(live&&j?.positions)setM(positionMarkets(j.positions.map(p=>p.instrument)))}).catch(()=>{});return()=>{live=false}},[]);
 return m;
}
export function ExtraFilterRow({f,update,positions}:{f:ExtraFilters;update:(f:ExtraFilters)=>void;positions:number}){
 const w=f.mine==='watch'||f.mine==='either',p=f.mine==='positions'||f.mine==='either',set=(a:boolean,b:boolean)=>update({...f,mine:a&&b?'either':a?'watch':b?'positions':'all'});
 const chip=(on:boolean,label:React.ReactNode,click:()=>void,key:string,title?:string)=><button key={key} type="button" title={title} className={'c-chip'+(on?' on':'')} aria-pressed={on} onClick={click}>{label}</button>;
 return <>
  <div className="c-frow"><span className="c-flab">Dopad</span><div className="c-fopts">{IMPACTS.map(i=>chip(f.impacts.includes(i),impactLabels[i],()=>update({...f,impacts:f.impacts.includes(i)?f.impacts.filter(x=>x!==i):IMPACTS.filter(x=>x===i||f.impacts.includes(x))}),i,'Dopad podle ForexFactory, jinak podle síly'))}</div></div>
  <div className="c-frow"><span className="c-flab">Jen moje</span><div className="c-fopts">
   {chip(f.mine==='all','Všechny trhy',()=>update({...f,mine:'all'}),'all')}
   {chip(w,'S vlaječkou',()=>set(!w,p),'watch','Trhy, které sleduješ vlaječkou')}
   {chip(p,`Otevřené pozice${positions?' ('+positions+')':''}`,()=>set(w,!p),'pos','Měny a trhy tvých otevřených pozic')}
  </div><label className="c-switch"><input type="checkbox" checked={f.ffAll} onChange={x=>update({...f,ffAll:x.target.checked})}/>i další události z ForexFactory</label></div>
 </>;
}

/** Rozšíření detailu události: plánovaný vs skutečný čas, odvozená skutečnost a revize, historie odhadu. */
export function HistDetail({e,hist,changes,zone,now,onHistory}:{e:CalendarEvent;hist:HistEvent|null;changes:HistChange[];zone:string;now:number;onHistory:()=>void}){
 const mine=hist?changes.filter(c=>c.eventId===hist.id):[],fc=mine.filter(c=>c.kind==='forecast'),tm=mine.filter(c=>c.kind==='time'),rev=mine.filter(c=>c.kind==='revision');
 const past=Date.parse(e.at)<now;
 return <div className="ad-hist">
  <div><h4>Čas</h4>{hist&&hist.scheduledAt!==hist.at?<p>plánováno <s>{dt(hist.scheduledAt,zone)}</s> → skutečně <b>{dt(hist.at,zone)}</b></p>:<p>{hist?'plánovaný čas beze změny':e.ff?'historie času zatím není':'—'}</p>}{tm.length>1&&<small>{tm.length} posunů termínu</small>}</div>
  <div><h4>Skutečnost</h4>{e.actual?<p><b>{e.actual}</b> <small>ověřeno agentem</small></p>:hist?.actual?<><p><b>{hist.actual}</b>{hist.actualFirst&&hist.actualFirst!==hist.actual&&<> <small>revidováno · první zveřejnění {hist.actualFirst}</small></>}</p><small>skutečnost odvozená z dalšího vydání{rev.length?' · '+rev.length+'× revize':''}</small></>:<p>{past?'čeká na další vydání':'zatím neznámá'}</p>}</div>
  <div><h4>Odhad</h4><p>{e.consensus||hist?.forecast||e.forecast||'—'}</p><small>{e.consensus?'konsenzus z ověřeného zdroje':'odhad ForexFactory'}{fc.length?' · změny: '+fc.map(c=>(c.old??'—')+' → '+c.new).join(', '):''}</small></div>
  {e.ff&&<div className="ad-hist-btn"><button type="button" className="c-chip on" onClick={x=>{x.stopPropagation();onHistory()}}><History size={13} aria-hidden/>Historie ukazatele</button></div>}
 </div>;
}

// Pojem z calendar-ff → klíč ověřeného údaje agenta (fundamentals.json → observations)
const OBS:Record<string,[string,string]>={cpi:['inflation','Inflace'],'core-cpi':['inflation','Inflace'],pce:['inflation','Inflace'],'core-pce':['inflation','Inflace'],nfp:['employment','Zaměstnanost'],unemployment:['employment','Zaměstnanost'],gdp:['gdp','HDP'],retail:['retailSales','Maloobchod'],'core-retail':['retailSales','Maloobchod'],'pmi-mfg':['mpmi','PMI výroba'],'ism-mfg':['mpmi','PMI výroba'],'pmi-svc':['spmi','PMI služby'],'ism-svc':['spmi','PMI služby'],rate:['rates','Sazby']};
type Obs={value:string|null;period?:string|null;sourceUrl?:string|null;checkedAt?:string|null;note?:string|null};
/** Historie ukazatele: vydání řady (DB, jinak z exportu FF v aplikaci) – graf skutečnosti a odhadu, tabulka s revizemi + ověřený údaj. */
export function IndicatorHistory({ff,ffRows,observations,zone,now,onClose}:{ff:{currency:string;title:string};ffRows:FFRow[];observations?:Record<string,Record<string,Obs>>;zone:string;now:number;onClose:()=>void}){
 const [data,setData]=useState<{events:HistEvent[];changes:HistChange[];db:boolean}|null>(null),[t0]=useState(now);
 const local=useMemo(()=>{const rows=ffRows.filter(r=>r.currency===ff.currency&&r.title===ff.title);const up=planUpsert([],rows,t0).events;const act=deriveActuals(up,t0);const m=new Map(up.map(e=>[e.id,e]));for(const e of act.events)m.set(e.id,e);return [...m.values()]},[ffRows,ff.currency,ff.title,t0]);
 useEffect(()=>{let live=true;fetch(`/api/calendar/series?currency=${encodeURIComponent(ff.currency)}&title=${encodeURIComponent(ff.title)}`,{cache:'no-store'}).then(r=>(r.ok?r.json():null) as Promise<{available:boolean;events:HistEvent[];changes:HistChange[]}|null>).then(j=>{if(!live)return;setData(j?.available&&j.events.length?{events:j.events,changes:j.changes,db:true}:{events:local,changes:[],db:false})}).catch(()=>{if(live)setData({events:local,changes:[],db:false})});return()=>{live=false}},[ff.currency,ff.title,local]);
 useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};addEventListener('keydown',k);return()=>removeEventListener('keydown',k)},[onClose]);
 const pts=data?seriesPoints(data.events):[],concept=conceptOf(ff.title),obsKey=concept?OBS[concept]:undefined,obs=obsKey?observations?.[ff.currency]?.[obsKey[0]]:undefined;
 const unit=pts.find(p=>p.unit)?.unit==='%'?' %':'';
 return <div className="ad-modal" role="dialog" aria-modal="true" aria-label={'Historie ukazatele '+ff.title} onClick={onClose}>
  <div className="ad-modal-box" onClick={e=>e.stopPropagation()}>
   <div className="ad-modal-head"><div><span className="s-kicker">HISTORIE UKAZATELE · {ff.currency}</span><h3>{ff.title}</h3></div><button type="button" className="ad-x" onClick={onClose} aria-label="Zavřít"><X size={18}/></button></div>
   {!data?<p>Načítám…</p>:<>
    {!data.db&&<p className="s-note">Historie z databáze zatím není k dispozici – zobrazena jen vydání z posledního exportu ForexFactory v aplikaci.</p>}
    {pts.length>1&&<BandChart ariaLabel={'Vydání '+ff.title} unit={unit} labels={pts.map(p=>dd(p.at,zone))} lines={[{values:pts.map(p=>p.actual),label:'Skutečnost (odvozená)',color:'#245bff',dots:true},{values:pts.map(p=>p.forecast),label:'Odhad ForexFactory',color:'#9aa3b2',dashed:true,dots:true},...(pts.some(p=>p.revised)?[{values:pts.map(p=>p.revised?p.actualFirst:null),label:'První zveřejnění (před revizí)',color:'#d97706',dots:true}]:[])]}/>}
    <table className="ad-table"><thead><tr><th>Vydání</th><th>Odhad</th><th>Skutečnost</th><th>Poznámka</th></tr></thead>
     <tbody>{[...data.events].sort((a,b)=>b.at-a.at).map(e=>{const ch=data.changes.filter(c=>c.eventId===e.id),fc=ch.filter(c=>c.kind==='forecast');return <tr key={e.id}>
      <td>{dt(e.at,zone)}{e.scheduledAt!==e.at&&<small>plán {dt(e.scheduledAt,zone)}</small>}</td>
      <td>{e.forecast??'—'}{fc.length>0&&<small>dříve {fc.map(c=>c.old??'—').join(', ')}</small>}</td>
      <td>{e.actual??(e.at<=now?'čeká na další vydání':'—')}{e.actualFirst&&e.actual&&e.actualFirst!==e.actual&&<small>první {e.actualFirst}</small>}</td>
      <td>{e.actual?(e.actualFirst&&e.actualFirst!==e.actual?'revidováno':'odvozeno z dalšího vydání'):''}</td></tr>})}</tbody></table>
    {obs?.value&&<div className="ad-obs"><h4>Ověřený údaj · {obsKey![1]}</h4><p><b>{obs.value}</b></p><small>{obs.period??''}{obs.checkedAt?' · kontrola '+dd(Date.parse(obs.checkedAt),zone):''}</small>{obs.sourceUrl&&<a className="s-source" href={obs.sourceUrl} target="_blank" rel="noreferrer">Zdroj ↗</a>}</div>}
    <p className="s-note">Skutečnost vydání = hodnota „předchozí“ uvedená u dalšího vydání téže řady (ForexFactory export skutečnost neobsahuje). Když se ta hodnota později změní, zapíše se jako revize a první zveřejnění zůstává. Odhad = odhad ForexFactory. <a href="/makro">Katalog makro řad</a></p>
   </>}
  </div>
 </div>;
}
