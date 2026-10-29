'use client';
// Výzva k průvodci na Dashboardu: jen dokud ho uživatel nepoužil ani nepřeskočil (po schválení přístupu = první přihlášení).
import {useEffect,useState} from 'react';
import {shouldPrompt,type OnbStatus} from '@/lib/onboarding/core';
import './onboarding.css';
export function OnboardingGate({name}:{name?:string}){
 const [show,setShow]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;fetch('/api/onboarding?lite=1',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{status:OnbStatus|'unavailable'}>:null).then(j=>{if(live&&j&&j.status!=='unavailable'&&shouldPrompt(j.status))setShow(true)}).catch(()=>{});return()=>{live=false}},[]);
 if(!show)return null;
 const skip=()=>{setBusy(true);fetch('/api/onboarding',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'skip'})}).finally(()=>{setBusy(false);setShow(false)})};
 return <section className="ob-gate" aria-labelledby="ob-gate-h">
  <p><b id="ob-gate-h">Vítej{name?`, ${name}`:''}! Nastavíme Tradee podle tebe?</b><br/>Pár otázek o trzích, stylu a účtu – uvidíš náhled změn a nic se nepoužije bez potvrzení. Zabere to asi 2 minuty.</p>
  <div className="ob-gate-acts"><a className="ob-primary" href="/pruvodce">Spustit průvodce</a><button type="button" disabled={busy} onClick={skip}>Přeskočit</button></div>
 </section>;
}
