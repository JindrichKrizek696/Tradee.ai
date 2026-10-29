'use client';
// Stránka /makro: katalog makro řad, které Tradee používá (po měnách): vydavatel, jednotka, SA/NSA, frekvence, poslední hodnota
// s obdobím a datem vydání, příští vydání z kalendáře, poznámka k revizím a odkaz na původní zdroj. Jen existující data (bez placených zdrojů).
import {useEffect,useMemo,useState} from 'react';
import {ArrowLeft,CalendarDays} from 'lucide-react';
import {usePalette} from '../palette';
import {buildCatalog,CATALOG_CURRENCIES,conceptLabels,type Concept,type CatalogItem} from '@/lib/macro/catalog';
import type {HistEvent,HistChange} from '@/lib/calendar-hist';
import {mergeCalendar,type AutoEvent,type CuratedEvent} from '@/lib/calendar';
import {applyFF,matchFF,type FFRow} from '@/lib/calendar-ff';
import type {TEPmi} from '@/lib/macro/te-pmi';
import type {RetailOfficial} from '@/lib/macro/retail';
import ffCalendar from '@/data/ff-calendar.json';
import tePmi from '@/data/te-pmi.json';
import retail from '@/data/retail-official.json';
import fundamentals from '@/data/fundamentals.json';
import calendarAuto from '@/data/calendar.json';
import '../mt.css';
import '../analysis-detail.css';
const DAY=86400000;
const day=(ms:number)=>new Date(ms).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric'});
const dt=(ms:number)=>new Date(ms).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'});
const BASIS:Record<string,string>={derived:'skutečnost odvozená z dalšího vydání',previous:'hodnota předchozího období',official:'oficiální zdroj',observation:'ověřený údaj (text)'};
const CONCEPTS=Object.keys(conceptLabels) as Concept[];
export default function MacroCatalogPage(){
 usePalette();
 const [now]=useState(()=>Date.now()),[cur,setCur]=useState<string>('all'),[concept,setConcept]=useState<Concept|'all'>('all'),[q,setQ]=useState('');
 const [hist,setHist]=useState<{events:HistEvent[];changes:HistChange[]}>({events:[],changes:[]});
 useEffect(()=>{fetch(`/api/calendar?from=${now-400*DAY}&to=${now+45*DAY}`,{cache:'no-store'}).then(r=>(r.ok?r.json():null) as Promise<{available:boolean;events:HistEvent[];changes:HistChange[]}|null>).then(j=>{if(j?.available)setHist({events:j.events,changes:j.changes})}).catch(()=>{})},[now]);
 const items=useMemo(()=>{
  const rows=ffCalendar.rows as FFRow[],f=fundamentals as unknown as {events:CuratedEvent[];sources:Record<string,{url?:string}>;observations:Record<string,Record<string,{value:string|null;period?:string|null;sourceUrl?:string|null}>>};
  const cal=(m=>applyFF(m,matchFF(m,rows)))(mergeCalendar(calendarAuto.events as AutoEvent[],f.events,f.sources));
  return buildCatalog({ffRows:rows,hist:hist.events,changes:hist.changes,calendar:cal,observations:f.observations,tePmi:tePmi as unknown as TEPmi,retail:retail as unknown as RetailOfficial},now);
 },[hist,now]);
 const needle=q.trim().toLowerCase();
 const shown=items.filter(i=>(cur==='all'||i.currency===cur)&&(concept==='all'||i.concept===concept)&&(!needle||(i.label+' '+i.publisher+' '+i.change+' '+i.ffTitles.join(' ')).toLowerCase().includes(needle)));
 const chip=(on:boolean,label:string,click:()=>void,key:string)=><button key={key} type="button" className={'c-chip'+(on?' on':'')} aria-pressed={on} onClick={click}>{label}</button>;
 return <div className="mt-page">
  <header className="mt-top"><a href="/" className="mt-back"><ArrowLeft size={16}/> Zpět do Tradee</a></header>
  <main className="mt-main ad-macro">
   <h1>Katalog makro řad</h1>
   <p className="mt-lead">Řady, se kterými Tradee pracuje u každé měny: kdo je vydává, v jaké jednotce, zda jsou sezónně očištěné, jak často vycházejí, poslední známá hodnota a příští vydání z kalendáře. Meziroční a meziměsíční změny jsou samostatné položky. <a href="/#calendar"><CalendarDays size={14}/> Kalendář</a></p>
   <div className="ad-chips" role="group" aria-label="Měna">{chip(cur==='all','Všechny měny',()=>setCur('all'),'all')}{CATALOG_CURRENCIES.map(c=>chip(cur===c,c,()=>setCur(c),c))}</div>
   <div className="ad-chips" role="group" aria-label="Ukazatel">{chip(concept==='all','Vše',()=>setConcept('all'),'all')}{CONCEPTS.map(c=>chip(concept===c,conceptLabels[c],()=>setConcept(c),c))}<input className="ad-search" type="search" placeholder="Hledat řadu nebo zdroj" value={q} onChange={e=>setQ(e.target.value)} aria-label="Hledat"/></div>
   <p className="s-note">{shown.length} z {items.length} řad · {hist.events.length?`historie kalendáře: ${hist.events.length} vydání`:'historie kalendáře zatím není k dispozici – hodnoty jen z exportu ForexFactory v aplikaci a z oficiálních souborů'}</p>
   {(cur==='all'?CATALOG_CURRENCIES:[cur]).map(c=>{const list=shown.filter(i=>i.currency===c);return list.length?<section key={c} className="mt-card"><h2>{c}</h2><div className="ad-scroll"><table className="ad-table ad-cat"><thead><tr><th>Řada</th><th>Zdroj</th><th>Jednotka · SA · frekvence</th><th>Poslední hodnota</th><th>Příští vydání</th></tr></thead><tbody>{list.map(i=><Row key={i.id} i={i}/>)}</tbody></table></div></section>:null})}
   <p className="s-note">„Skutečnost odvozená z dalšího vydání“: export ForexFactory skutečné hodnoty neobsahuje, proto se bere hodnota „předchozí“ uvedená u následujícího vydání téže řady; pozdější změna se zapíše jako revize. Odhady jsou odhady ForexFactory. PMI: S&amp;P Global přes Trading Economics (veřejná stránka), kde chybí, z exportu ForexFactory.</p>
  </main>
 </div>;
}
function Row({i}:{i:CatalogItem}){
 return <tr>
  <td><b>{i.label}</b><small>{i.change}{i.note?' · '+i.note:''}</small></td>
  <td>{i.publisher}{i.via&&<small>přes {i.via}</small>}<a className="s-source" href={i.url} target="_blank" rel="noreferrer">původní zdroj ↗</a></td>
  <td>{i.unit}<small>{i.sa} · {i.freq}</small></td>
  <td>{i.last?<><b>{i.last.value}</b><small>{[i.last.period,i.last.releasedAt?'vydáno '+day(i.last.releasedAt):null].filter(Boolean).join(' · ')}</small><small>{BASIS[i.last.basis]}</small>{i.revision&&<small className="warning">{i.revision}</small>}</>:<small>zatím bez hodnoty</small>}</td>
  <td>{i.next?<><b>{dt(i.next.at)}</b>{i.next.forecast&&<small>odhad FF {i.next.forecast}</small>}</>:<small>není v kalendáři (příští 2 týdny)</small>}</td>
 </tr>;
}
