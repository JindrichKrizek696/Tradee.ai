'use client';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Download,Share,SquarePlus,X} from 'lucide-react';
import {registerSW} from './register';
import {useInstall,install,openGuide,closeGuide,bannerDismissed,dismissBanner} from './install';
import {THEME_COLOR} from './constants';
import './pwa.css';

// theme-color podle motivu aplikace (přepínač v liště), ne jen podle systému: přepíše obě meta značky (light i dark media)
function syncThemeColor(){
 const t=document.documentElement.dataset.theme==='dark'?'dark':'light',c=THEME_COLOR[t];
 const metas=document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
 if(!metas.length){const m=document.createElement('meta');m.name='theme-color';m.content=c;document.head.appendChild(m);return}
 metas.forEach(m=>{if(m.content!==c)m.content=c});
}

// Montuje se v kořenovém layoutu: registrace SW při každém načtení, nabídka aktualizace, theme-color a návod pro iPhone.
export function PwaClient(){
 const [waiting,setWaiting]=useState<ServiceWorker|null>(null),reloading=useRef(false);
 useEffect(()=>{
  syncThemeColor();
  const o=new MutationObserver(syncThemeColor);o.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  return()=>o.disconnect();
 },[]);
 useEffect(()=>{
  let live=true,timer:ReturnType<typeof setInterval>|undefined,reg:ServiceWorkerRegistration|null=null;
  // nová verze čeká jen tehdy, když už stránku řídí starší SW (při první instalaci se nic nenabízí)
  const check=()=>{if(live&&reg?.waiting&&navigator.serviceWorker.controller)setWaiting(reg.waiting)};
  const onChange=()=>{if(reloading.current)location.reload()};
  const onVisible=()=>{if(document.visibilityState==='visible')reg?.update().catch(()=>{})};
  registerSW().then(r=>{
   if(!r||!live)return;reg=r;check();
   // instalace nové verze mohla začít už před registrací posluchače (kontrola při navigaci) → hlídat i r.installing
   const watch=(w:ServiceWorker|null)=>w?.addEventListener('statechange',()=>{if(w.state==='installed')check()});
   watch(r.installing);r.addEventListener('updatefound',()=>watch(r.installing));
   navigator.serviceWorker.addEventListener('controllerchange',onChange);
   document.addEventListener('visibilitychange',onVisible);
   // kontrola nové verze při načtení (Chrome po navigaci kontroluje s prodlevou), při návratu na kartu a každou hodinu
   r.update().catch(()=>{});
   timer=setInterval(()=>r.update().catch(()=>{}),60*60*1000);
  });
  return()=>{live=false;if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);if('serviceWorker' in navigator)navigator.serviceWorker.removeEventListener('controllerchange',onChange)};
 },[]);
 const refresh=()=>{if(!waiting)return;reloading.current=true;waiting.postMessage({type:'SKIP_WAITING'});setTimeout(()=>location.reload(),3000)};
 return <>
  {waiting&&<div className="pwa-toast" role="status">
   <span>Je k dispozici nová verze Tradee</span>
   <button type="button" className="pwa-toast-btn" onClick={refresh}>Obnovit</button>
   <button type="button" className="pwa-x" aria-label="Zavřít" onClick={()=>setWaiting(null)}><X size={16}/></button>
  </div>}
  <IosGuide/>
 </>;
}

function IosGuide(){
 const {guide}=useInstall(),box=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!guide)return;box.current?.focus();const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')closeGuide()};document.addEventListener('keydown',esc);return()=>document.removeEventListener('keydown',esc)},[guide]);
 if(!guide)return null;
 return <div className="pwa-back" onMouseDown={e=>{if(e.target===e.currentTarget)closeGuide()}}>
  <div className="pwa-box" ref={box} role="dialog" aria-modal="true" aria-labelledby="pwa-guide-title" tabIndex={-1}>
   <button type="button" className="pwa-x pwa-box-x" aria-label="Zavřít" onClick={closeGuide}><X size={18}/></button>
   <h2 id="pwa-guide-title">Přidej Tradee na plochu</h2>
   <ol className="pwa-steps">
    <li><span className="pwa-ico"><Share size={18}/></span><span>V Safari klepni na <b>Sdílet</b> (čtverec se šipkou nahoru).</span></li>
    <li><span className="pwa-ico"><SquarePlus size={18}/></span><span>Sjeď níž a zvol <b>Přidat na plochu</b>.</span></li>
    <li><span className="pwa-ico"><Download size={18}/></span><span>Potvrď <b>Přidat</b> – Tradee se otevře jako samostatná aplikace.</span></li>
   </ol>
   <p className="pwa-note">Push upozornění fungují na iPhonu a iPadu jen v aplikaci přidané na plochu (iOS 16.4 a novější). Po instalaci je zapni v Nastavení → Upozornění.</p>
   <button type="button" className="pwa-primary" onClick={closeGuide}>Rozumím</button>
  </div>
 </div>;
}

// Položka v menu avataru; skrytá v nainstalované aplikaci a tam, kde instalace nejde
export function InstallMenuItem({onDone}:{onDone?:()=>void}){
 const {mode}=useInstall();
 if(mode==='none')return null;
 return <button type="button" className="p-link pwa-menu" onClick={()=>{onDone?.();install()}}><Download size={15}/>Nainstalovat aplikaci</button>;
}

const noop=()=>()=>{};
// Zavíratelný banner na Dashboardu (zavření se pamatuje v localStorage)
export function InstallBanner(){
 // localStorage až v prohlížeči (na serveru banner skrytý, ať hydratace sedí)
 const {mode}=useInstall(),stored=useSyncExternalStore(noop,bannerDismissed,()=>true),[closed,setClosed]=useState(false);
 if(mode==='none'||stored||closed)return null;
 return <div className="pwa-banner" role="region" aria-label="Instalace aplikace">
  <svg className="pwa-banner-mark" viewBox="0 0 340 232" aria-hidden="true"><path fill="currentColor" d="M70 1H217V152L138 231V91L159 70H1Z"/><path fill="#2a5cf5" d="M243 1H339L243 97Z"/></svg>
  <div className="pwa-banner-text"><b>Tradee jako aplikace</b><span>{mode==='ios'?'Přidej si Tradee na plochu – vlastní okno a push upozornění i na iPhonu.':'Nainstaluj si Tradee – vlastní okno, rychlé spuštění a push upozornění.'}</span></div>
  <button type="button" className="pwa-primary" onClick={()=>mode==='ios'?openGuide():install()}>{mode==='ios'?'Jak na to':'Nainstalovat'}</button>
  <button type="button" className="pwa-x" aria-label="Skrýt nabídku instalace" onClick={()=>{dismissBanner();setClosed(true)}}><X size={16}/></button>
 </div>;
}

// Poznámka v nastavení upozornění: na iPhonu bez instalace push nejde
export function IosPushNote(){
 const {ios,standalone}=useInstall();
 if(!ios||standalone)return null;
 return <p className="pwa-ios-note">Na iPhonu a iPadu fungují push upozornění jen v aplikaci přidané na plochu (iOS 16.4+). <button type="button" onClick={openGuide}>Jak na to</button></p>;
}
