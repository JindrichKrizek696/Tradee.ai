'use client';
import {useEffect,useRef,useState} from 'react';
import {PalettePicker} from './palette';
import {ThemeToggle} from './theme';
import {LayoutDashboard,ChartNoAxesCombined,Landmark,CalendarDays,NotebookPen,RefreshCw} from 'lucide-react';
export type View='dashboard'|'analyzer'|'reports'|'calendar'|'journal';
const items:[View,string,typeof LayoutDashboard][]=[['dashboard','Dashboard',LayoutDashboard],['analyzer','Analýza trhů',ChartNoAxesCombined],['reports','Reporty',Landmark],['calendar','Kalendář',CalendarDays],['journal','Deník',NotebookPen]];
export function Shell({wide,view,setView,busy,onRefresh,userName,palette,onPalette,paletteError,admin,children}:{wide?:boolean;admin?:boolean;view:View;setView:(v:View)=>void;busy:boolean;onRefresh:()=>void;userName:string;palette:string;onPalette:(id:string)=>void;paletteError?:string;children:React.ReactNode}){
 const [menu,setMenu]=useState(false),wrap=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!menu)return;const close=(e:MouseEvent)=>{if(!wrap.current?.contains(e.target as Node))setMenu(false)};const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false)};document.addEventListener('mousedown',close);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',esc)}},[menu]);
 return <div className="t-app">
  <header className="t-top">
   <a className="t-brand" href="#dashboard" onClick={e=>{e.preventDefault();setView('dashboard')}}><img src="/favicon.svg" alt=""/><span>Tradee</span></a>
   <nav className="t-nav" aria-label="Hlavní navigace">{items.map(([id,label,Icon])=><button key={id} className={view===id?'active':''} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}><Icon size={17}/>{label}</button>)}</nav>
   <div className="t-actions">
    <ThemeToggle/>
    <button className={'t-icon-btn'+(busy?' spin':'')} onClick={onRefresh} disabled={busy} aria-label="Obnovit podklady" title="Obnovit podklady"><RefreshCw size={17}/></button>
    <div className="t-avatar-wrap" ref={wrap}><button type="button" className="t-avatar" title={userName+' · barvy signálu'} aria-label={'Přihlášen: '+userName+'. Nastavení barev signálu'} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{userName.trim().charAt(0).toUpperCase()}</button>{menu&&<PalettePicker value={palette} onChoose={onPalette} error={paletteError}>{admin&&<a className="p-link" href="/admin">Administrace</a>}<a className="p-link" href="/mt">Propojení s MetaTraderem</a><a className="p-link" href="/checklisty">Checklisty</a><form method="post" action="/auth/logout" className="p-logout"><button type="submit">Odhlásit</button></form></PalettePicker>}</div>
   </div>
  </header>
  <main className={'t-main'+(wide?' wide':'')}>{children}</main>
  <footer className="t-footer">TRADEE.EU · Veřejná data. Dohledatelné výpočty. Vlastní rozhodnutí.</footer>
 </div>;
}
