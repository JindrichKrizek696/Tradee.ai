'use client';
import {useSyncExternalStore} from 'react';
import {Moon,Sun} from 'lucide-react';
const KEY='tradee.theme';
type Theme='light'|'dark';
// Vkládá se do <head>: motiv se nastaví před prvním vykreslením, takže tmavý režim neprobliká světlým.
export const themeScript=`try{document.documentElement.dataset.theme=localStorage.getItem('${KEY}')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`;
const stored=():Theme=>{try{return localStorage.getItem(KEY)==='dark'?'dark':'light'}catch{return 'light'}};
// Když React po nesouladu hydratace přegeneruje stránku, smaže z <html> i data-theme – tady se hned vrátí.
const subscribe=(cb:()=>void)=>{const el=document.documentElement,fix=()=>{if(!el.dataset.theme)el.dataset.theme=stored()};fix();const o=new MutationObserver(()=>{fix();cb()});o.observe(el,{attributes:true,attributeFilter:['data-theme']});return()=>o.disconnect()};
const read=():Theme=>document.documentElement.dataset.theme==='dark'?'dark':'light';
export function useTheme(){
 const theme=useSyncExternalStore(subscribe,read,():Theme=>'light');
 const set=(t:Theme)=>{document.documentElement.dataset.theme=t;try{localStorage.setItem(KEY,t)}catch{}};
 return {theme,toggle:()=>set(theme==='dark'?'light':'dark')};
}
export function ThemeToggle(){
 const {theme,toggle}=useTheme(),label=theme==='dark'?'Přepnout na světlý režim':'Přepnout na tmavý režim';
 return <button type="button" className="t-icon-btn" onClick={toggle} aria-label={label} title={label}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button>;
}
