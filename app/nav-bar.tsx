'use client';
import {LayoutDashboard,ChartNoAxesCombined,Landmark,CalendarDays,NotebookPen,ClipboardCheck} from 'lucide-react';
import type {Nav,View} from '@/lib/nav';
export const NAV_META:Record<View,[string,typeof LayoutDashboard]>={dashboard:['Dashboard',LayoutDashboard],analyzer:['Analýza trhů',ChartNoAxesCombined],reports:['Reporty',Landmark],calendar:['Kalendář',CalendarDays],journal:['Deník',NotebookPen],journaling:['Journaling',ClipboardCheck]};
// Horní navigace: skryté položky se nevykreslí, jen právě otevřená (aby šlo poznat, kde jsem). Náhled na stránce Nastavení je stejná lišta bez ovládání.
export function NavBar({nav,view,onPick,pending=0,preview}:{nav:Nav;view:View;onPick?:(v:View)=>void;pending?:number;preview?:boolean}){
 const list=nav.order.filter(id=>!nav.hidden.includes(id)||id===view);
 const body=list.map(id=>{const [label,Icon]=NAV_META[id],badge=id==='journaling'&&pending>0&&!preview;
  return <button key={id} type="button" tabIndex={preview?-1:undefined} className={view===id?'active':''} aria-current={!preview&&view===id?'page':undefined} aria-label={badge?`Journaling, ${pending} ${pending===1?'výzva':pending<5?'výzvy':'výzev'} ke zdůvodnění`:undefined} onClick={()=>onPick?.(id)}><Icon size={17}/>{label}{badge&&<span className="t-badge" aria-hidden="true">{pending>99?'99+':pending}</span>}</button>});
 return preview?<div className="t-nav" aria-hidden="true">{body}</div>:<nav className="t-nav" aria-label="Hlavní navigace">{body}</nav>;
}
