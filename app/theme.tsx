'use client';
import {useSyncExternalStore} from 'react';
import {Moon,Sun} from 'lucide-react';
const KEY='tradee.theme';
type Theme='light'|'dark';
// Vkládá se do <head>: motiv se nastaví před prvním vykreslením, takže tmavý režim neprobliká světlým.
export const themeScript=`try{document.documentElement.dataset.theme=localStorage.getItem('${KEY}')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`;
const subscribe=(cb:()=>void)=>{const o=new MutationObserver(cb);o.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>o.disconnect()};
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
