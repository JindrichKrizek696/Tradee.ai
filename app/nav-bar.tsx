'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {LayoutDashboard,ChartNoAxesCombined,Landmark,CalendarDays,NotebookPen,ClipboardCheck,Ellipsis} from 'lucide-react';
import {visibleViews,mobileNav,type Nav,type View} from '@/lib/nav';
import './mobile-nav.css';
export const NAV_META:Record<View,[string,typeof LayoutDashboard]>={dashboard:['Dashboard',LayoutDashboard],analyzer:['Analýza trhů',ChartNoAxesCombined],reports:['Reporty',Landmark],calendar:['Kalendář',CalendarDays],journal:['Deník',NotebookPen],journaling:['Journaling',ClipboardCheck]};
// Pilulka aktivní položky je jeden prvek, který při přepnutí přejede na novou položku (pozici a šířku měří z tlačítka .active).
function usePill(ref:React.RefObject<HTMLElement|null>,key:string){
 const [pill,setPill]=useState<{x:number;y:number;w:number;h:number;on:boolean}|null>(null);
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;
  const place=()=>{const b=el.querySelector<HTMLElement>('button.active');if(!b||!b.offsetWidth){setPill(null);return}setPill(p=>({x:b.offsetLeft,y:b.offsetTop,w:b.offsetWidth,h:b.offsetHeight,on:!!p}))};
  place();const ro=new ResizeObserver(place);ro.observe(el);return()=>ro.disconnect()},[ref,key]);
 return pill&&<span className={'t-pill'+(pill.on?' on':'')} aria-hidden="true" style={{transform:`translate(${pill.x}px,${pill.y}px)`,width:pill.w,height:pill.h}}/>;
}
const badgeLabel=(name:string,n:number)=>`${name}, ${n} ${n===1?'výzva':n<5?'výzvy':'výzev'} ke zdůvodnění`;
// Horní navigace: skryté položky se nevykreslí, jen právě otevřená (aby šlo poznat, kde jsem). Náhled na stránce Nastavení je stejná lišta bez ovládání.
// end: obsah na pravém konci ostrůvku za oddělovačem (lupa vyhledávání)
export function NavBar({nav,view,onPick,pending=0,preview,end}:{nav:Nav;view:View;onPick?:(v:View)=>void;pending?:number;preview?:boolean;end?:React.ReactNode}){
 const list=visibleViews(nav,view);
 // Pilulka aktivní položky je jeden prvek, který při přepnutí přejede na novou položku (pozici a šířku měří z tlačítka).
 const ref=useRef<HTMLElement&HTMLDivElement>(null),indicator=usePill(ref,view+'|'+list.join(','));
 const body=list.map(id=>{const [label,Icon]=NAV_META[id],badge=(id==='journaling'||(nav.merge&&id==='journal'))&&pending>0&&!preview,name=id==='journaling'?'Journaling':'Deník';
  return <button key={id} type="button" tabIndex={preview?-1:undefined} className={view===id?'active':''} aria-current={!preview&&view===id?'page':undefined} aria-label={badge?badgeLabel(name,pending):undefined} onClick={()=>onPick?.(id)}><Icon size={17}/>{label}{badge&&<span className="t-badge" aria-hidden="true">{pending>99?'99+':pending}</span>}</button>});
 return preview?<div ref={ref} className="t-nav has-pill" aria-hidden="true">{indicator}{body}</div>:<nav ref={ref} className="t-nav has-pill" aria-label="Hlavní navigace">{indicator}{body}{end&&<><span className="t-nav-sep" aria-hidden="true"/>{end}</>}</nav>;
}

// Krátké popisky pro mobilní lištu dole (na 390 px má položka ~75 px)
const SHORT:Record<View,string>={dashboard:'Přehled',analyzer:'Trhy',reports:'Reporty',calendar:'Kalendář',journal:'Deník',journaling:'Journaling'};
const typing=(t:EventTarget|null)=>{const el=t as HTMLElement|null;if(!el||!el.tagName)return false;if(el.isContentEditable||el.tagName==='TEXTAREA'||el.tagName==='SELECT')return true;return el.tagName==='INPUT'&&!/^(checkbox|radio|button|submit|reset|range|color|file|image)$/.test((el as HTMLInputElement).type)};
/** Mobilní navigace (≤ 760 px): lišta dole jako v nativních aplikacích. Max. 5 míst – když se položky nevejdou, poslední místo je „Další“
 *  s panelem zbytku. Respektuje pořadí a skrytí z Nastavení. Při psaní (otevřená klávesnice) se schová. Na desktopu ji skrývá CSS.
 *  onPick chybí (stránka grafu) → položka vede na /#view. */
export function MobileNav({nav,view,onPick,pending=0}:{nav:Nav;view?:View;onPick?:(v:View)=>void;pending?:number}){
 const {main,more}=mobileNav(nav,view),[sheet,setSheet]=useState(false),[kb,setKb]=useState(false),ref=useRef<HTMLElement>(null),sheetRef=useRef<HTMLDivElement>(null);
 const inMore=!!view&&more.includes(view),indicator=usePill(ref,(view||'')+'|'+main.join(',')+'|'+(inMore||sheet));
 const pick=(v:View)=>{setSheet(false);if(onPick){onPick(v);window.scrollTo({top:0})}else location.href='/#'+v};
 const hasBadge=(id:View)=>pending>0&&(id==='journaling'||(nav.merge&&id==='journal'));
 useEffect(()=>{const on=(e:FocusEvent)=>{if(typing(e.target)&&matchMedia('(max-width:760px)').matches)setKb(true)},off=()=>{requestAnimationFrame(()=>setKb(typing(document.activeElement)))};
  document.addEventListener('focusin',on);document.addEventListener('focusout',off);return()=>{document.removeEventListener('focusin',on);document.removeEventListener('focusout',off)}},[]);
 useEffect(()=>{if(!sheet)return;const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setSheet(false)};document.addEventListener('keydown',esc);sheetRef.current?.querySelector<HTMLElement>('button')?.focus();return()=>document.removeEventListener('keydown',esc)},[sheet]);
 const item=(id:View)=>{const Icon=NAV_META[id][1],b=hasBadge(id),name=NAV_META[id][0];
  return <button key={id} type="button" className={view===id&&!sheet?'active':''} aria-current={view===id?'page':undefined} aria-label={b?badgeLabel(name,pending):name} onClick={()=>pick(id)}><span className="t-bnav-ic"><Icon size={21} aria-hidden="true"/>{b&&<span className="t-bnav-dot" aria-hidden="true">{pending>99?'99+':pending}</span>}</span><span className="t-bnav-l" aria-hidden="true">{SHORT[id]}</span></button>};
 const moreBadge=more.some(hasBadge);
 return <>
  <nav ref={ref} className={'t-bnav has-pill'+(kb?' kb':'')} aria-label="Hlavní navigace">
   {indicator}{main.map(item)}
   {more.length>0&&<button type="button" className={inMore||sheet?'active':''} aria-haspopup="dialog" aria-expanded={sheet} aria-current={inMore?'page':undefined} aria-label={inMore?`Další, otevřeno: ${NAV_META[view!][0]}`:'Další'} onClick={()=>setSheet(s=>!s)}><span className="t-bnav-ic"><Ellipsis size={21} aria-hidden="true"/>{moreBadge&&<span className="t-bnav-dot" aria-hidden="true">{pending>99?'99+':pending}</span>}</span><span className="t-bnav-l" aria-hidden="true">Další</span></button>}
  </nav>
  {sheet&&<div className="t-sheet-back" onClick={()=>setSheet(false)}><div ref={sheetRef} className="t-sheet" role="dialog" aria-modal="true" aria-label="Další sekce" onClick={e=>e.stopPropagation()}>
   <span className="t-sheet-grip" aria-hidden="true"/>
   {more.map(id=>{const [label,Icon]=NAV_META[id],b=hasBadge(id);return <button key={id} type="button" className={'t-sheet-item'+(view===id?' on':'')} aria-current={view===id?'page':undefined} onClick={()=>pick(id)}><Icon size={20} aria-hidden="true"/><span>{label}</span>{b&&<span className="t-badge" aria-label={`${pending} ke zdůvodnění`}>{pending>99?'99+':pending}</span>}</button>})}
  </div></div>}
 </>;
}
