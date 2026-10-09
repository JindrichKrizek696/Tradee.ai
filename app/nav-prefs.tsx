'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {defaultNav,normalizeNav,type Nav} from '@/lib/nav';
const KEY='tradee.nav';
const useIso=typeof window==='undefined'?useEffect:useLayoutEffect;
export type NavStatus='idle'|'saving'|'saved'|'err';
const store=(n:Nav)=>{try{localStorage.setItem(KEY,JSON.stringify(n))}catch{}};
const post=(n:Nav,keepalive?:boolean)=>fetch('/api/settings',{method:'POST',keepalive,headers:{'Content-Type':'application/json'},body:JSON.stringify({nav:n})}).then(r=>{if(!r.ok)throw Error()});
// Pořadí navigace: hned z localStorage (bez bliknutí), pak sjednocení s účtem; změna se ukládá sama po 500 ms.
export function useNav(){
 const [nav,setNav]=useState<Nav>(defaultNav),[status,setStatus]=useState<NavStatus>('idle');
 const dirty=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),seq=useRef(0),pending=useRef<Nav|null>(null),alive=useRef(true);
 useIso(()=>{try{const s=localStorage.getItem(KEY);if(s)setNav(normalizeNav(JSON.parse(s)))}catch{}},[]);
 useEffect(()=>{alive.current=true;fetch('/api/settings',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{nav?:unknown}>:null).then(j=>{if(alive.current&&!dirty.current&&j?.nav){const n=normalizeNav(j.nav);setNav(n);store(n)}}).catch(()=>{});
  return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current);if(pending.current)post(pending.current,true).catch(()=>{})}},[]);
 const change=(next:Nav)=>{
  const n=normalizeNav(next);setNav(n);store(n);dirty.current=true;setStatus('saving');pending.current=n;if(timer.current)clearTimeout(timer.current);const k=++seq.current;
  timer.current=setTimeout(()=>{pending.current=null;post(n).then(()=>{if(alive.current&&k===seq.current)setStatus('saved')}).catch(()=>{if(alive.current&&k===seq.current)setStatus('err')})},500);
 };
 return {nav,change,status};
}
