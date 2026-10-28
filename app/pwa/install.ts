'use client';
// Stav instalace PWA sdílený mezi menu avataru, bannerem na Dashboardu, nastavením upozornění a návodem pro iPhone.
import {useSyncExternalStore} from 'react';
type PromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
type W=Window&{__tradeeBip?:PromptEvent|null};
export const BANNER_KEY='tradee.pwa.banner';

export function isIos(ua:string,platform='',touch=0):boolean{return /iPad|iPhone|iPod/.test(ua)||(platform==='MacIntel'&&touch>1)}
export function isStandalone():boolean{
 if(typeof window==='undefined')return false;
 const mq=(q:string)=>{try{return window.matchMedia(q).matches}catch{return false}};
 return mq('(display-mode: standalone)')||mq('(display-mode: window-controls-overlay)')||mq('(display-mode: fullscreen)')||(navigator as Navigator&{standalone?:boolean}).standalone===true;
}
export const iosDevice=()=>typeof navigator!=='undefined'&&isIos(navigator.userAgent,navigator.platform,navigator.maxTouchPoints||0);

export type InstallState={mode:'none'|'prompt'|'ios';standalone:boolean;ios:boolean;guide:boolean};
let guide=false,installed=false,snap:InstallState={mode:'none',standalone:false,ios:false,guide:false};
const subs=new Set<()=>void>();
function compute():InstallState{
 const standalone=isStandalone(),ios=iosDevice(),bip=!!(window as W).__tradeeBip;
 const mode=standalone||installed?'none':bip?'prompt':ios?'ios':'none';
 if(mode!==snap.mode||standalone!==snap.standalone||ios!==snap.ios||guide!==snap.guide)snap={mode,standalone,ios,guide};
 return snap;
}
const emit=()=>{compute();subs.forEach(f=>f())};
function subscribe(cb:()=>void){
 if(!subs.size){addEventListener('tradee:install',emit);addEventListener('appinstalled',onInstalled)}
 subs.add(cb);
 return()=>{subs.delete(cb);if(!subs.size){removeEventListener('tradee:install',emit);removeEventListener('appinstalled',onInstalled)}};
}
function onInstalled(){installed=true;emit()}
const SERVER:InstallState={mode:'none',standalone:false,ios:false,guide:false};
export function useInstall():InstallState{return useSyncExternalStore(subscribe,compute,()=>SERVER)}
export function openGuide(){guide=true;emit()}
export function closeGuide(){guide=false;emit()}
// „Nainstalovat aplikaci“: Chrome/Edge/Android = systémový dialog, iPhone/iPad = návod Sdílet → Přidat na plochu
export async function install():Promise<void>{
 const w=window as W,e=w.__tradeeBip;
 if(!e){if(iosDevice())openGuide();return}
 w.__tradeeBip=null;
 try{await e.prompt();const c=await e.userChoice;if(c.outcome==='accepted')installed=true}catch{}
 emit();
}
export function bannerDismissed():boolean{try{return !!localStorage.getItem(BANNER_KEY)}catch{return false}}
export function dismissBanner(){try{localStorage.setItem(BANNER_KEY,String(Date.now()))}catch{}emit()}
