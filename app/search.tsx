'use client';
import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Search,X,LayoutDashboard,ChartNoAxesCombined,Landmark,CalendarDays,NotebookPen,ClipboardCheck,FlaskConical,StickyNote,User,Settings,ListChecks,ShieldCheck,Shield,Link2,Moon,Sun,RefreshCw,LogOut,CandlestickChart,CornerDownLeft,type LucideIcon,Bell,Wallet,Calculator} from 'lucide-react';
import {rank,score,highlight,currencyWords,resolveAlias,aliasWords,suggestAliases,type Searchable} from '@/lib/search';
import {dataSource} from '@/lib/instrument-info';
import {categories,marketLabels,signalLabels,relative,type CalendarEvent} from '@/lib/calendar';
import {groups} from '@/lib/markets';
import {RULES} from '@/lib/discipline/rules';
import type {Row} from '@/lib/dashboard';
import type {View} from '@/lib/nav';
import type {JournalList,JournalTrade} from '@/lib/journal/types';
import type {NoteMeta} from '@/lib/notebook/core';
import {useTheme} from './theme';
import {useCalendarTz} from './calendar';
import {requestOpen} from './open-request';
import {dropPush} from './notify-settings';
import './search.css';

type Group='page'|'market'|'action'|'event'|'trade'|'note'|'rule'|'checklist'|'setting';
const GROUP_LABEL:Record<Group,string>={page:'Stránky',market:'Trhy',action:'Akce',event:'Kalendář',trade:'Deník',note:'Poznámky',rule:'Pravidla a strategie',checklist:'Checklisty',setting:'Nastavení a profil'};
const LIMIT:Partial<Record<Group,number>>={market:6,trade:6,event:5,note:5};
const BY_DATE=new Set<Group>(['trade','event','note']);
type Item=Searchable&{id:string;group:Group;icon:LucideIcon;badge?:string;tone?:'up'|'down';run:()=>void};
type Remote={trades:JournalTrade[];currency:string;notes:NoteMeta[];strategies:{id:string;name:string;archived:boolean}[];custom:{text:string}[];checklists:{id:string;name:string}[];failed:boolean};

const RECENT='tradee.search.recent';
const readRecent=():string[]=>{try{const v=JSON.parse(localStorage.getItem(RECENT)||'[]');return Array.isArray(v)?v.filter((x):x is string=>typeof x==='string').slice(0,6):[]}catch{return []}};
const pushRecent=(id:string)=>{try{localStorage.setItem(RECENT,JSON.stringify([id,...readRecent().filter(x=>x!==id)].slice(0,6)))}catch{}};
// stejný hash by hashchange nevyvolal (např. znovu stejný obchod) → vyvolat ručně
const goHash=(h:string)=>{if(location.hash==='#'+h)dispatchEvent(new HashChangeEvent('hashchange'));else location.hash=h};
const csDate=(d:string)=>{const [y,m,day]=d.slice(0,10).split('-');return y&&m&&day?`${Number(day)}. ${Number(m)}. ${y}`:d};
const money=(n:number,cur:string)=>(n>0?'+':'')+n.toLocaleString('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2})+(cur?' '+cur:'');
const fmtScore=(n:number)=>(n>0?'+':'')+n.toLocaleString('cs-CZ',{maximumFractionDigits:1});
const tone=(n:number|null|undefined)=>n?n>0?'up' as const:'down' as const:undefined;
const shortcut=()=>/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent)?'⌘K':'Ctrl K';
export const useShortcutLabel=()=>useSyncExternalStore(()=>()=>{},shortcut,()=>'Ctrl K');

async function loadRemote():Promise<Remote>{
 const get=async<T,>(u:string)=>{const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw Error(u);return await r.json() as T};
 const res=await Promise.allSettled([get<JournalList>('/api/journal'),get<{notes:NoteMeta[]}>('/api/notebook'),get<{strategies:Remote['strategies']}>('/api/strategies'),get<{rules:Remote['custom']}>('/api/custom-rules'),get<{checklists:Remote['checklists']}>('/api/checklists')] as const);
 const [j,n,s,c,k]=res.map(x=>x.status==='fulfilled'?x.value:null) as [JournalList|null,{notes:NoteMeta[]}|null,{strategies:Remote['strategies']}|null,{rules:Remote['custom']}|null,{checklists:Remote['checklists']}|null];
 return {trades:j?.trades||[],currency:j?.currency||'',notes:n?.notes||[],strategies:s?.strategies||[],custom:c?.rules||[],checklists:k?.checklists||[],failed:res.every(x=>x.status==='rejected')};
}

/** Lupa na pravém konci ostrůvku navigace: otevře vyhledávání (stejně jako Ctrl+K nebo „/“). */
// mobile: varianta pro horní lištu na telefonu (ostrůvek navigace je tam schovaný, navigace je dole)
export function SearchButton({mobile}:{mobile?:boolean}){
 const k=useShortcutLabel();
 return <button type="button" className={mobile?'t-icon-btn t-search-m':'t-search'} onClick={()=>dispatchEvent(new Event('tradee:search'))} aria-label="Hledat v Tradee" aria-keyshortcuts="Control+K Meta+K" title={`Hledat (${k})`}><Search size={17}/></button>;
}

type Props={rows:Row[];calendar:CalendarEvent[];now:number;admin:boolean;owner:boolean;merge:boolean;setView:(v:View)=>void;openMarket:(id:string)=>void;onRefresh:()=>void};
/** Vyhledávání v celém Tradee: stránky, trhy, akce, kalendář, deník, poznámky, pravidla, checklisty, nastavení. */
export function SearchPalette(p:Props){
 const [open,setOpen]=useState(false),[remote,setRemote]=useState<Remote|null>(null),[loading,setLoading]=useState(false),loadedAt=useRef(0),back=useRef<HTMLElement|null>(null),openRef=useRef(false);
 // deník, poznámky a pravidla se stáhnou až při otevření (a znovu, když jsou starší než 2 min)
 const show=()=>{if(openRef.current)return;openRef.current=true;back.current=document.activeElement as HTMLElement|null;setOpen(true);
  if(Date.now()-loadedAt.current>120000){loadedAt.current=Date.now();setLoading(true);loadRemote().then(setRemote,()=>{}).finally(()=>setLoading(false))}};
 const hide=(restore=true)=>{openRef.current=false;setOpen(false);if(restore)back.current?.focus?.()};
 const showRef=useRef(show),hideRef=useRef(hide);
 useEffect(()=>{showRef.current=show;hideRef.current=hide});
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if((e.key==='k'||e.key==='K')&&(e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey){e.preventDefault();if(openRef.current)hideRef.current();else showRef.current();return}
   if(e.key==='/'&&!openRef.current&&!e.ctrlKey&&!e.metaKey&&!e.altKey){const t=e.target as HTMLElement|null;if(t?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable=false])'))return;e.preventDefault();showRef.current()}
  };
  const btn=()=>showRef.current();
  addEventListener('keydown',key);addEventListener('tradee:search',btn);return()=>{removeEventListener('keydown',key);removeEventListener('tradee:search',btn)}},[]);
 // stránka pod oknem se neposouvá
 useEffect(()=>{if(!open)return;const el=document.documentElement,prev=el.style.overflow;el.style.overflow='hidden';return()=>{el.style.overflow=prev}},[open]);
 return open?<Dialog {...p} remote={remote} loading={loading} close={hide}/>:null;
}

function Dialog({rows,calendar,now,admin,owner,merge,setView,openMarket,onRefresh,remote,loading,close}:Props&{remote:Remote|null;loading:boolean;close:(restore?:boolean)=>void}){
 const [q,setQ]=useState(''),[active,setActive]=useState(0),input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
 const {theme,toggle}=useTheme(),{zone}=useCalendarTz();
 const all=useMemo(()=>{
  const view=(v:View,h:string=v)=>()=>{setView(v);goHash(h)},href=(u:string)=>()=>{location.href=u};
  const logout=()=>{const f=document.createElement('form');f.method='post';f.action='/auth/logout';document.body.appendChild(f);dropPush().finally(()=>f.submit())};
  const sub=merge?'Deník':'Journaling';
  const items:Item[]=[
   {id:'v:dashboard',group:'page',icon:LayoutDashboard,title:'Dashboard',keywords:'přehled domů úvod start',boost:4,run:view('dashboard')},
   {id:'v:analyzer',group:'page',icon:ChartNoAxesCombined,title:'Analýza trhů',keywords:'trhy skóre heatmapa signály analyzér',boost:4,run:view('analyzer')},
   {id:'v:reports',group:'page',icon:Landmark,title:'Reporty',keywords:'cot report makro data',boost:4,run:view('reports')},
   {id:'v:calendar',group:'page',icon:CalendarDays,title:'Kalendář',subtitle:'Ekonomické události',keywords:'makro zprávy události centrální banky',boost:4,run:view('calendar')},
   {id:'v:journal',group:'page',icon:NotebookPen,title:'Deník',subtitle:'Obchody',keywords:'obchody trades historie',boost:4,run:view('journal')},
   {id:'v:journaling',group:'page',icon:ClipboardCheck,title:merge?'Vyhodnocení':'Journaling',subtitle:merge?'Deník':'Vyhodnocení obchodů',keywords:'journaling disciplína vyhodnocení porušení',boost:4,run:merge?view('journal','journal/vyhodnoceni'):view('journaling')},
   {id:'v:backtest',group:'page',icon:FlaskConical,title:'Backtest',subtitle:sub,keywords:'testování strategie historie',boost:3,run:merge?view('journal','journal/backtest'):view('journaling','journaling/backtest')},
   {id:'v:notes',group:'page',icon:StickyNote,title:'Poznámky',subtitle:sub,keywords:'sešit notebook zápisky papíry',boost:3,run:merge?view('journal','journal/poznamky'):view('journaling','journaling/poznamky')},
   {id:'p:pravidla',group:'page',icon:ShieldCheck,title:'Pravidla a strategie',keywords:'disciplína risk riziko',boost:3,run:href('/pravidla')},
   {id:'p:ucty',group:'page',icon:Wallet,title:'Účty a riziko',subtitle:'Profily účtů',keywords:'účet challenge funded prop drawdown denní ztráta limit konzistence poplatek',boost:3,run:href('/ucty')},
   {id:'p:kalkulacka',group:'page',icon:Calculator,title:'Kalkulačka pozice',keywords:'loty lot kontrakty velikost pozice riziko position size',boost:3,run:href('/kalkulacka')},
   {id:'p:alerty',group:'page',icon:Bell,title:'Alerty',subtitle:'Cenové alerty',keywords:'alert upozornění notifikace hlídání ceny cena skóre zvonek',boost:3,run:href('/alerty')},
   {id:'p:checklisty',group:'page',icon:ListChecks,title:'Checklisty',keywords:'kontrolní seznam před vstupem',boost:3,run:href('/checklisty')},
   {id:'p:mt',group:'page',icon:Link2,title:'Propojení s MetaTraderem',keywords:'mt4 mt5 ea expert advisor účet broker',boost:3,run:href('/mt')},
   ...(owner?[{id:'p:lab',group:'page' as const,icon:FlaskConical,title:'Laboratoř',keywords:'agenti strategie evoluce',boost:3,run:href('/laborator')}]:[]),
   ...(admin?[{id:'p:admin',group:'page' as const,icon:Shield,title:'Administrace',keywords:'uživatelé členové waitlist přístup',boost:3,run:href('/admin')}]:[]),
   {id:'s:profil',group:'setting',icon:User,title:'Profil',keywords:'jméno oslovení fotka avatar o mně účet',boost:3,run:href('/profil')},
   {id:'s:fotka',group:'setting',icon:User,title:'Profilová fotka',subtitle:'Profil',keywords:'avatar obrázek',run:href('/profil#fotka')},
   {id:'s:nastaveni',group:'setting',icon:Settings,title:'Nastavení',boost:3,run:href('/nastaveni')},
   {id:'s:navigace',group:'setting',icon:Settings,title:'Navigace',subtitle:'Nastavení',keywords:'lišta menu pořadí schovat sloučit',run:href('/nastaveni#navigace')},
   {id:'s:vzhled',group:'setting',icon:Settings,title:'Vzhled a barvy signálu',subtitle:'Nastavení',keywords:'motiv tmavý světlý paleta',run:href('/nastaveni#vzhled')},
   {id:'s:upozorneni',group:'setting',icon:Settings,title:'Upozornění',subtitle:'Nastavení',keywords:'notifikace push oznámení',run:href('/nastaveni#upozorneni')},
   {id:'s:mena',group:'setting',icon:Settings,title:'Měna souhrnu',subtitle:'Nastavení',keywords:'usd eur czk přepočet kurz',run:href('/nastaveni#mena')},
   {id:'s:barvy',group:'setting',icon:Settings,title:'Barvy kreseb',subtitle:'Nastavení',keywords:'graf kreslení',run:href('/nastaveni#barvy')},
   {id:'a:theme',group:'action',icon:theme==='dark'?Sun:Moon,title:theme==='dark'?'Přepnout na světlý motiv':'Přepnout na tmavý motiv',keywords:'motiv téma tmavý světlý dark light režim',run:toggle},
   {id:'a:refresh',group:'action',icon:RefreshCw,title:'Obnovit podklady',keywords:'aktualizovat data skóre refresh',run:onRefresh},
   {id:'a:logout',group:'action',icon:LogOut,title:'Odhlásit se',keywords:'logout odejít',run:logout},
  ];
  for(const r of rows)items.push({id:'m:'+r.id,group:'market',icon:CandlestickChart,title:r.name,subtitle:(groups[r.group]||r.group)+(r.name!==r.id&&!r.name.includes(r.id)?' · '+r.id.replace(/^\^/,''):'')+(dataSource(r.id)?' · data: '+dataSource(r.id)!.short:''),keywords:r.id+' '+currencyWords(r.id)+' '+aliasWords(r.id),boost:2,badge:r.r.score===null?'—':fmtScore(r.r.score),tone:tone(r.r.score),run:()=>openMarket(r.id)});
  // nadcházející události první (nejbližší nahoře), proběhlé za nimi od nejnovější
  const soon=(e:CalendarEvent)=>Date.parse(e.at)>=now-3600000;
  const evs=[...calendar].sort((a,b)=>soon(a)!==soon(b)?(soon(a)?-1:1):soon(a)?a.at.localeCompare(b.at):b.at.localeCompare(a.at));
  for(const e of evs){const when=new Date(e.at).toLocaleString('cs-CZ',{timeZone:zone,weekday:'short',day:'numeric',month:'numeric',...(e.timeKnown?{hour:'2-digit',minute:'2-digit'} as const:{})}),mk=e.markets.map(m=>marketLabels[m]??m);
   items.push({id:'e:'+e.id,group:'event',icon:CalendarDays,title:e.title,subtitle:[when,signalLabels[e.signal],mk.join(', ')].filter(Boolean).join(' · '),keywords:categories[e.category]+' '+e.markets.join(' ')+' '+currencyWords(e.markets.join(' ')),badge:relative(e.at,now),run:()=>{requestOpen('event',e.id);setView('calendar');goHash('calendar')}})}
  if(remote){
   for(const t of [...remote.trades].sort((a,b)=>b.closeTs-a.closeTs)){const side=t.side==='buy'?'Buy':t.side==='sell'?'Sell':'';
    items.push({id:'t:'+t.id,group:'trade',icon:NotebookPen,title:(t.symbol+' '+side).trim(),subtitle:csDate(t.date)+(t.account?' · '+t.account:''),keywords:[t.date,csDate(t.date),t.instrument||'',t.side==='buy'?'long nákup':t.side==='sell'?'short prodej':'',t.tags.join(' '),t.note||'',currencyWords(t.symbol)].join(' '),badge:money(t.pnl,remote.currency),tone:tone(t.pnl),run:()=>{setView('journal');goHash('journal/'+encodeURIComponent(t.id))}})}
   for(const n of remote.notes)items.push({id:'n:'+n.id,group:'note',icon:StickyNote,title:n.title||'Bez názvu',subtitle:n.excerpt?.slice(0,90)||undefined,keywords:n.instrument||'',run:()=>{requestOpen('note',n.id);if(merge)view('journal','journal/poznamky')();else view('journaling','journaling/poznamky')()}});
   for(const s of remote.strategies)items.push({id:'st:'+s.id,group:'rule',icon:ShieldCheck,title:s.name,subtitle:s.archived?'Strategie · archivovaná':'Strategie',run:href('/pravidla')});
   remote.custom.forEach((c,i)=>items.push({id:'cr:'+i,group:'rule',icon:ShieldCheck,title:c.text.length>80?c.text.slice(0,79)+'…':c.text,subtitle:'Vlastní pravidlo',keywords:c.text,run:href('/pravidla')}));
   for(const c of remote.checklists)items.push({id:'cl:'+c.id,group:'checklist',icon:ListChecks,title:c.name,subtitle:'Checklist',run:href('/checklisty')});
  }
  for(const r of RULES)items.push({id:'r:'+r.id,group:'rule',icon:ShieldCheck,title:r.label,subtitle:'Pravidlo disciplíny',keywords:r.help,run:href('/pravidla')});
  return items;
 },[rows,calendar,now,zone,admin,owner,merge,setView,openMarket,onRefresh,remote,theme,toggle]);

 const results=useMemo(()=>{
  if(!q.trim()){
   const byId=new Map(all.map(i=>[i.id,i])),recent=readRecent().map(id=>byId.get(id)).filter((x):x is Item=>!!x);
   const quick=all.filter(i=>i.group==='page'&&!recent.includes(i)).slice(0,6);
   return [{label:'Naposledy',items:recent},{label:'Rychlé skoky',items:quick}].filter(g=>g.items.length);
  }
  const out:{label:string;items:Item[];top:number}[]=[],al=resolveAlias(q),target=al?all.find(i=>i.id==='m:'+al.id):undefined;
  for(const g of Object.keys(GROUP_LABEL) as Group[]){let r=rank(all.filter(i=>i.group===g),q,LIMIT[g]??4,BY_DATE.has(g));if(g==='market'&&target)r=[target,...r.filter(i=>i!==target)].slice(0,LIMIT.market);if(r.length)out.push({label:GROUP_LABEL[g],items:r,top:g==='market'&&target?1000:score(r[0],q)})}
  return out.sort((a,b)=>b.top-a.top);
 },[q,all]);
 const flat=useMemo(()=>results.flatMap(g=>g.items),[results]),act=Math.min(active,Math.max(0,flat.length-1));
 // NQ/ES/DXY: Tradee má jen index – řekneme to; prázdný výsledek: nabídnout nejbližší aliasy
 const hint=q.trim()?resolveAlias(q)?.hint:undefined,suggest=useMemo(()=>flat.length||!q.trim()?[]:suggestAliases(q),[flat.length,q]);
 useEffect(()=>{list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'})},[act,q]);
 const run=(it:Item)=>{pushRecent(it.id);close(false);it.run()};
 const key=(e:React.KeyboardEvent)=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(flat.length)setActive((act+(e.key==='ArrowDown'?1:-1)+flat.length)%flat.length)}
  else if(e.key==='Enter'){e.preventDefault();if(flat[act])run(flat[act])}
  else if(e.key==='Escape'){e.preventDefault();close()}
  else if(e.key==='Tab')e.preventDefault();
 };
 const hl=(t:string)=>highlight(t,q).map((x,i)=>x.hit?<mark key={i}>{x.t}</mark>:x.t);
 let n=-1;
 return <div className="sr-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
  <div className="sr-dialog" role="dialog" aria-modal="true" aria-label="Hledat v Tradee">
   <div className="sr-input">
    <Search size={19} aria-hidden="true"/>
    <input ref={input} autoFocus value={q} onChange={e=>{setQ(e.target.value);setActive(0)}} onKeyDown={key} placeholder="Hledej trh, stránku, událost, obchod, poznámku…" role="combobox" aria-expanded={flat.length>0} aria-controls="sr-list" aria-autocomplete="list" aria-activedescendant={flat[act]?'sr-'+act:undefined} autoComplete="off" spellCheck={false}/>
    {q&&<button type="button" className="sr-clear" aria-label="Vymazat hledání" onClick={()=>{setQ('');setActive(0);input.current?.focus()}}><X size={15}/></button>}
    <kbd className="sr-esc">Esc</kbd>
   </div>
   {hint&&<p className="sr-hint" role="status">{hint}</p>}
   <div className="sr-list" id="sr-list" role="listbox" aria-label="Výsledky hledání" ref={list}>
    {results.map(g=><div key={g.label} role="group" aria-label={g.label}>
     <div className="sr-group" aria-hidden="true">{g.label}</div>
     {g.items.map(it=>{n++;const i=n,Icon=it.icon;return <div key={it.id} id={'sr-'+i} role="option" aria-selected={i===act} className={'sr-item'+(i===act?' on':'')} onMouseMove={()=>{if(i!==act)setActive(i)}} onClick={()=>run(it)}>
      <span className={'sr-ic g-'+it.group}><Icon size={16}/></span>
      <span className="sr-txt"><b>{q?hl(it.title):it.title}</b>{it.subtitle&&<small>{it.subtitle}</small>}</span>
      {it.badge&&<span className={'sr-badge'+(it.tone?' '+it.tone:'')}>{it.badge}</span>}
      <CornerDownLeft className="sr-enter" size={15} aria-hidden="true"/>
     </div>})}
    </div>)}
    {!flat.length&&<div className="sr-empty"><b>Nic jsme nenašli pro „{q.trim()}“</b>{suggest.length>0&&<span className="sr-suggest">Možná jsi myslel: {suggest.map(s=><button key={s.key} type="button" onClick={()=>{setQ(s.key);setActive(0);input.current?.focus()}}>{s.key}<small> → {s.label}</small></button>)}</span>}<span>Zkus název trhu (eurusd, zlato, nas100, us500, xauusd), stránku, událost (CPI, ECB) nebo datum obchodu (17. 10.).</span></div>}
   </div>
   <div className="sr-foot">
    <span><kbd>↑</kbd><kbd>↓</kbd> vybrat</span><span><kbd>Enter</kbd> otevřít</span><span><kbd>Esc</kbd> zavřít</span>
    <span className="sr-state" role="status">{loading?'Načítám deník a poznámky…':remote?.failed?'Deník, poznámky a vlastní pravidla teď nejdou načíst.':''}</span>
   </div>
  </div>
 </div>;
}
