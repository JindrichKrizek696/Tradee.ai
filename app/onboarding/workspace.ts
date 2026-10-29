'use client';
// Skryté panely Dashboardu a pole záznamu obchodu (průvodce / Nastavení): hned z localStorage, pak z účtu. Změna se uloží k účtu.
import {useEffect,useState} from 'react';
import {defaultPrefs,normalizePrefs,type Prefs} from '@/lib/onboarding/core';
const KEY='tradee.prefs',EVT='tradee:prefs';
const read=():Prefs=>{try{const s=localStorage.getItem(KEY);return s?normalizePrefs(JSON.parse(s)):defaultPrefs()}catch{return defaultPrefs()}};
export const storePrefs=(p:Prefs)=>{try{localStorage.setItem(KEY,JSON.stringify(p))}catch{}dispatchEvent(new Event(EVT))};
let loaded:Promise<void>|null=null;
export function usePrefs(){
 const [prefs,setPrefsState]=useState<Prefs>(defaultPrefs);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage až po hydrataci (server nezná uložené panely)
 useEffect(()=>{setPrefsState(read());const on=()=>setPrefsState(read());addEventListener(EVT,on);
  loaded??=fetch('/api/onboarding?prefs=1',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{prefs?:unknown}>:null).then(j=>{if(j?.prefs)storePrefs(normalizePrefs(j.prefs))}).catch(()=>{});
  return()=>removeEventListener(EVT,on)},[]);
 const save=async(next:Prefs)=>{const p=normalizePrefs(next),prev=read();storePrefs(p);
  const r=await fetch('/api/onboarding',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefs:p})});if(!r.ok){storePrefs(prev);const j=await r.json().catch(()=>({})) as {error?:string};throw Error(j.error||'Uložení se nepovedlo.')}};
 return {prefs,save};
}
