'use client';
import {useEffect,useRef,useState} from 'react';
import {dropPush} from './notify-settings';
import {ThemeToggle} from './theme';
import {NavBar} from './nav-bar';
import {useNav} from './nav-prefs';
import {RefreshCw} from 'lucide-react';
import type {View} from '@/lib/nav';
export type {View};
export function Shell({wide,view,setView,busy,onRefresh,userName,admin,owner,pending=0,children}:{pending?:number;wide?:boolean;admin?:boolean;owner?:boolean;view:View;setView:(v:View)=>void;busy:boolean;onRefresh:()=>void;userName:string;children:React.ReactNode}){
 const {nav}=useNav(),[menu,setMenu]=useState(false),wrap=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!menu)return;const close=(e:MouseEvent)=>{if(!wrap.current?.contains(e.target as Node))setMenu(false)};const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false)};document.addEventListener('mousedown',close);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',esc)}},[menu]);
 return <div className="t-app">
  <header className="t-top">
   <a className="t-brand" href="#dashboard" onClick={e=>{e.preventDefault();setView('dashboard')}}><svg className="t-mark" viewBox="0 0 340 232" aria-hidden="true"><path fill="currentColor" d="M70 1H217V152L138 231V91L159 70H1Z"/><path fill="#2a5cf5" d="M243 1H339L243 97Z"/></svg><span>Tradee</span></a>
   <NavBar nav={nav} view={view} onPick={setView} pending={pending}/>
   <div className="t-actions">
    <ThemeToggle/>
    <button className={'t-icon-btn'+(busy?' spin':'')} onClick={onRefresh} disabled={busy} aria-label="Obnovit podklady" title="Obnovit podklady"><RefreshCw size={17}/></button>
    <div className="t-avatar-wrap" ref={wrap}><button type="button" className="t-avatar" title={userName} aria-label={'Přihlášen: '+userName+'. Menu účtu'} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{userName.trim().charAt(0).toUpperCase()}</button>{menu&&<div className="p-picker p-menu"><a className="p-link" href="/nastaveni">Nastavení</a>{admin&&<a className="p-link" href="/admin">Administrace</a>}<a className="p-link" href="/mt">Propojení s MetaTraderem</a><a className="p-link" href="/pravidla">Pravidla a strategie</a>{owner&&<a className="p-link" href="/laborator">Laboratoř</a>}<form method="post" action="/auth/logout" className="p-logout" onSubmit={e=>{e.preventDefault();const f=e.currentTarget;dropPush().finally(()=>f.submit())}}><button type="submit">Odhlásit</button></form></div>}</div>
   </div>
  </header>
  <main className={'t-main'+(wide?' wide':'')}>{children}</main>
  <footer className="t-footer">TRADEE.EU · Veřejná data. Dohledatelné výpočty. Vlastní rozhodnutí.</footer>
 </div>;
}
