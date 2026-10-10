'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {LayoutDashboard,ChartNoAxesCombined,Landmark,CalendarDays,NotebookPen,ClipboardCheck} from 'lucide-react';
import type {Nav,View} from '@/lib/nav';
export const NAV_META:Record<View,[string,typeof LayoutDashboard]>={dashboard:['Dashboard',LayoutDashboard],analyzer:['Analýza trhů',ChartNoAxesCombined],reports:['Reporty',Landmark],calendar:['Kalendář',CalendarDays],journal:['Deník',NotebookPen],journaling:['Journaling',ClipboardCheck]};
// Horní navigace: skryté položky se nevykreslí, jen právě otevřená (aby šlo poznat, kde jsem). Náhled na stránce Nastavení je stejná lišta bez ovládání.
export function NavBar({nav,view,onPick,pending=0,preview}:{nav:Nav;view:View;onPick?:(v:View)=>void;pending?:number;preview?:boolean}){
 const list=nav.order.filter(id=>!(nav.merge&&id==='journaling')&&(!nav.hidden.includes(id)||id===view));
 // Pilulka aktivní položky je jeden prvek, který při přepnutí přejede na novou položku (pozici a šířku měří z tlačítka).
 const ref=useRef<HTMLElement&HTMLDivElement>(null),[pill,setPill]=useState<{x:number;y:number;w:number;h:number;on:boolean}|null>(null),key=list.join(',');
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;
  const place=()=>{const b=el.querySelector<HTMLElement>('button.active');if(!b){setPill(null);return}setPill(p=>({x:b.offsetLeft,y:b.offsetTop,w:b.offsetWidth,h:b.offsetHeight,on:!!p}))};
  place();const ro=new ResizeObserver(place);ro.observe(el);return()=>ro.disconnect()},[view,key]);
 const indicator=pill&&<span className={'t-pill'+(pill.on?' on':'')} aria-hidden="true" style={{transform:`translate(${pill.x}px,${pill.y}px)`,width:pill.w,height:pill.h}}/>;
 const body=list.map(id=>{const [label,Icon]=NAV_META[id],badge=(id==='journaling'||(nav.merge&&id==='journal'))&&pending>0&&!preview,name=id==='journaling'?'Journaling':'Deník';
  return <button key={id} type="button" tabIndex={preview?-1:undefined} className={view===id?'active':''} aria-current={!preview&&view===id?'page':undefined} aria-label={badge?`${name}, ${pending} ${pending===1?'výzva':pending<5?'výzvy':'výzev'} ke zdůvodnění`:undefined} onClick={()=>onPick?.(id)}><Icon size={17}/>{label}{badge&&<span className="t-badge" aria-hidden="true">{pending>99?'99+':pending}</span>}</button>});
 return preview?<div ref={ref} className="t-nav has-pill" aria-hidden="true">{indicator}{body}</div>:<nav ref={ref} className="t-nav has-pill" aria-label="Hlavní navigace">{indicator}{body}</nav>;
}
