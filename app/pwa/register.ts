// Registrace service workeru (/sw.js, scope /). Volá ji PwaClient při každém načtení aplikace i NotifySettings před zapnutím push.
// Hlídá: běh v prohlížeči, podporu SW, zabezpečený kontext (https / localhost) a ruční vypnutí přes localStorage tradee.sw=off.
export const SW_URL='/sw.js';
export function swSupported():boolean{
 if(typeof window==='undefined'||typeof navigator==='undefined')return false;
 if(!('serviceWorker' in navigator)||!window.isSecureContext)return false;
 try{if(localStorage.getItem('tradee.sw')==='off')return false}catch{}
 return true;
}
let pending:Promise<ServiceWorkerRegistration|null>|null=null;
export function registerSW():Promise<ServiceWorkerRegistration|null>{
 if(!swSupported())return Promise.resolve(null);
 return pending??=navigator.serviceWorker.register(SW_URL,{scope:'/',updateViaCache:'none'}).catch(()=>{pending=null;return null});
}
// Odhlášení: runtime cache pryč (sdílené zařízení). HTML ani API se neukládají nikdy, tohle maže i hashované soubory.
export async function clearPwaCaches():Promise<void>{
 try{if(typeof caches!=='undefined')for(const k of await caches.keys())if(k.startsWith('tradee-static-'))await caches.delete(k)}catch{}
}
