'use client';
import {useEffect,useState} from 'react';
type N={popup:boolean;mail:boolean;push:boolean;vapidPublic:string|null};
const key=(s:string)=>{const p='='.repeat((4-s.length%4)%4),r=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(r,c=>c.charCodeAt(0))};
const json={'Content-Type':'application/json'};
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||(navigator as unknown as {standalone?:boolean}).standalone===true;
const supported=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
// Přepínače upozornění v menu avatara: okno v aplikaci, mail, push (push se zapíná na každém zařízení zvlášť).
export function NotifySettings(){
 const [n,setN]=useState<N|null>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[here,setHere]=useState(false);
 useEffect(()=>{let live=true;
  (async()=>{try{const r=await fetch('/api/notify',{cache:'no-store'});if(!r.ok)return;const j=await r.json() as N;if(!live)return;setN(j);
   if(supported()){const reg=await navigator.serviceWorker.getRegistration('/sw.js'),sub=await reg?.pushManager.getSubscription();if(live)setHere(!!sub&&Notification.permission==='granted')}}catch{}})();
  return()=>{live=false}},[]);
 if(!n)return null;
 const save=async(p:Partial<N>)=>{const r=await fetch('/api/notify',{method:'PUT',headers:json,body:JSON.stringify(p)});if(!r.ok)throw Error();const j=await r.json() as N;setN(o=>({...(o as N),...j,vapidPublic:o?.vapidPublic??null}))};
 const flip=async(k:'popup'|'mail')=>{if(busy)return;setBusy(true);setMsg('');try{await save({[k]:!n[k]})}catch{setMsg('Nastavení se nepodařilo uložit.')}setBusy(false)};
 const pushOn=async()=>{
  if(ios()&&!standalone()){setMsg('Na iPhonu nejdřív přidej Tradee na plochu (Sdílet → Přidat na plochu).');return}
  if(!supported()){setMsg('Tento prohlížeč push nepodporuje.');return}
  const perm=await Notification.requestPermission();
  if(perm!=='granted'){setMsg('Prohlížeč upozornění blokuje – povol je v nastavení prohlížeče.');return}
  const reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(n.vapidPublic as string)}),j=sub.toJSON();
  const r=await fetch('/api/push',{method:'POST',headers:json,body:JSON.stringify({endpoint:j.endpoint,keys:j.keys})});
  if(!r.ok){await sub.unsubscribe().catch(()=>{});throw Error()}
  setN(o=>({...(o as N),push:true}));setHere(true);
 };
 const pushOff=async()=>{
  await save({push:false});
  try{const reg=await navigator.serviceWorker.getRegistration('/sw.js'),sub=await reg?.pushManager.getSubscription();
   if(sub){const endpoint=sub.endpoint;await sub.unsubscribe();await fetch('/api/push',{method:'DELETE',headers:json,body:JSON.stringify({endpoint})})}}catch{}
  setHere(false);
 };
 const flipPush=async()=>{if(busy)return;setBusy(true);setMsg('');try{if(n.push&&here)await pushOff();else await pushOn()}catch{setMsg('Push se nepodařilo nastavit. Zkus to znovu.')}setBusy(false)};
 const pushChecked=n.push&&here,state=pushChecked?'Zapnuto na tomto zařízení':n.push?'Na tomto zařízení zatím vypnuto':'';
 const sw=(label:string,on:boolean,onClick:()=>void)=><button type="button" role="switch" aria-checked={on} className={'ns-row'+(on?' on':'')} disabled={busy} onClick={onClick}><span>{label}</span><i aria-hidden="true"/></button>;
 return <div className="ns" role="group" aria-label="Upozornění">
  <b>Upozornění</b>
  {sw('Okno v aplikaci',n.popup,()=>flip('popup'))}
  {sw('Mail',n.mail,()=>flip('mail'))}
  {n.vapidPublic&&sw('Push',pushChecked,flipPush)}
  {state&&<small>{state}</small>}
  {msg&&<p className="p-error" role="alert">{msg}</p>}
 </div>;
}
// Při odhlášení odebere odběr push z tohoto prohlížeče (best-effort), aby další uživatel na sdíleném zařízení nedostával cizí upozornění.
export async function dropPush(){try{if(!('serviceWorker' in navigator))return;const reg=await navigator.serviceWorker.getRegistration('/sw.js'),sub=await reg?.pushManager.getSubscription();if(!sub)return;const endpoint=sub.endpoint;await Promise.race([fetch('/api/push',{method:'DELETE',headers:json,body:JSON.stringify({endpoint})}).catch(()=>{}),new Promise(r=>setTimeout(r,3000))]);await sub.unsubscribe().catch(()=>{})}catch{}}
