'use client';
import {useEffect,useRef,useState} from 'react';
import {dropPush} from './notify-settings';
import {InstallMenuItem} from './pwa/pwa-ui';
import {clearPwaCaches} from './pwa/register';
import {ThemeToggle,useTheme} from './theme';
import {NavBar,MobileNav} from './nav-bar';
import {useNav} from './nav-prefs';
import {Avatar} from './avatar';
import {SearchButton} from './search';
import {AlertBell} from './alerts/alert-bell';
import {AlertToasts} from './alerts/alert-toast';
import {RefreshCw,Moon,Sun} from 'lucide-react';
import type {View} from '@/lib/nav';
export type {View};
export function Shell({wide,view,setView,busy,onRefresh,userName,avatar,avatarColor,admin,owner,pending=0,children}:{pending?:number;wide?:boolean;admin?:boolean;owner?:boolean;view:View;setView:(v:View)=>void;busy:boolean;onRefresh:()=>void;userName:string;avatar?:string|null;avatarColor?:string|null;children:React.ReactNode}){
 const {nav}=useNav(),{theme,toggle}=useTheme(),[menu,setMenu]=useState(false),wrap=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!menu)return;const close=(e:MouseEvent)=>{if(!wrap.current?.contains(e.target as Node))setMenu(false)};const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false)};document.addEventListener('mousedown',close);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',esc)}},[menu]);
 return <div className="t-app">
  <header className="t-top">
   <a className="t-brand" href="#dashboard" onClick={e=>{e.preventDefault();setView('dashboard')}}><svg className="t-mark" viewBox="0 0 340 232" aria-hidden="true"><path fill="currentColor" d="M70 1H217V152L138 231V91L159 70H1Z"/><path fill="#2a5cf5" d="M243 1H339L243 97Z"/></svg><span>Tradee</span></a>
   <NavBar nav={nav} view={view} onPick={setView} pending={pending} end={<SearchButton/>}/>
   <div className="t-actions">
    <SearchButton mobile/>
    <AlertBell/><AlertToasts/>
    <span className="t-desk-only"><ThemeToggle/></span>
    <button className={'t-icon-btn t-desk-only'+(busy?' spin':'')} onClick={onRefresh} disabled={busy} aria-label="Obnovit podklady" title="Obnovit podklady"><RefreshCw size={17}/></button>
    <div className="t-avatar-wrap" ref={wrap}><button type="button" className="t-avatar" title={userName} aria-label={'Přihlášen: '+userName+'. Menu účtu'} aria-expanded={menu} onClick={()=>setMenu(!menu)}><Avatar name={userName} src={avatar} color={avatarColor}/></button>{menu&&<div className="p-picker p-menu"><a className="p-me" href="/profil"><span className="p-me-av"><Avatar name={userName} src={avatar} color={avatarColor}/></span><span><b>{userName}</b><small>Můj profil</small></span></a><a className="p-link" href="/nastaveni">Nastavení</a><button type="button" className="p-link p-mob" onClick={toggle}>{theme==='dark'?<Sun size={15}/>:<Moon size={15}/>}{theme==='dark'?'Světlý režim':'Tmavý režim'}</button><button type="button" className="p-link p-mob" disabled={busy} onClick={()=>{setMenu(false);onRefresh()}}><RefreshCw size={15}/>{busy?'Obnovuji podklady…':'Obnovit podklady'}</button><a className="p-link" href="/alerty">Alerty</a>{admin&&<a className="p-link" href="/admin">Administrace</a>}<a className="p-link" href="/mt">Propojení s MetaTraderem</a><a className="p-link" href="/scenare">Scénáře</a><a className="p-link" href="/strategie">Strategie (playbook)</a><a className="p-link" href="/replay">Replay</a><a className="p-link" href="/pravidla">Pravidla a strategie</a>{owner&&<a className="p-link" href="/laborator">Laboratoř</a>}<InstallMenuItem onDone={()=>setMenu(false)}/><form method="post" action="/auth/logout" className="p-logout" onSubmit={e=>{e.preventDefault();const f=e.currentTarget;Promise.all([dropPush(),clearPwaCaches()]).finally(()=>f.submit())}}><button type="submit">Odhlásit</button></form></div>}</div>
   </div>
  </header>
  <main className={'t-main'+(wide?' wide':'')}>{children}</main>
  <footer className="t-footer">TRADEE.EU · Veřejná data. Dohledatelné výpočty. Vlastní rozhodnutí.</footer>
  <MobileNav nav={nav} view={view} onPick={setView} pending={pending}/>
 </div>;
}
