'use client';
import {LayoutDashboard,ChartNoAxesCombined,Landmark,CalendarDays,RefreshCw} from 'lucide-react';
export type View='dashboard'|'analyzer'|'reports'|'calendar';
const items:[View,string,typeof LayoutDashboard][]=[['dashboard','Dashboard',LayoutDashboard],['analyzer','Analýza trhů',ChartNoAxesCombined],['reports','Reporty',Landmark],['calendar','Kalendář',CalendarDays]];
export function Shell({view,setView,busy,onRefresh,userName,children}:{view:View;setView:(v:View)=>void;busy:boolean;onRefresh:()=>void;userName:string;children:React.ReactNode}){
 return <div className="t-app">
  <header className="t-top">
   <a className="t-brand" href="#dashboard" onClick={e=>{e.preventDefault();setView('dashboard')}}><img src="/favicon.svg" alt=""/><span>Tradee</span></a>
   <nav className="t-nav" aria-label="Hlavní navigace">{items.map(([id,label,Icon])=><button key={id} className={view===id?'active':''} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}><Icon size={17}/>{label}</button>)}</nav>
   <div className="t-actions">
    <button className={'t-icon-btn'+(busy?' spin':'')} onClick={onRefresh} disabled={busy} aria-label="Obnovit podklady" title="Obnovit podklady"><RefreshCw size={17}/></button>
    <div className="t-avatar" title={userName} aria-label={'Přihlášen: '+userName}>{userName.trim().charAt(0).toUpperCase()||'?'}</div>
   </div>
  </header>
  <main className="t-main">{children}</main>
  <footer className="t-footer">TRADEE.AI · Veřejná data. Dohledatelné výpočty. Vlastní rozhodnutí.</footer>
 </div>;
}
