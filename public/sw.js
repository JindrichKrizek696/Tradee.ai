// Service worker Tradee (scope /): offline stránka, cache statických souborů a push upozornění.
// Soukromí (sdílená zařízení): /api/*, /auth/* ani HTML přihlášených stránek se NIKDY neukládají – navigace jde vždy na síť,
// při výpadku se ukáže jen obecná offline stránka (public/offline.html). Ukládají se jen hashované soubory (/assets, /_next/static), fonty a ikony.
// Při změně tohoto souboru zvedni VERSION: prohlížeč nový SW nainstaluje a aplikace nabídne „Je k dispozici nová verze“.
const VERSION='2026-10-28.1';
const SHELL='tradee-shell-'+VERSION,STATIC='tradee-static-'+VERSION,KEEP=[SHELL,STATIC];
// public/offline.html – statické assety Workers ho servírují jako /offline (/offline.html → 307 na /offline)
const OFFLINE='/offline';
const PRECACHE=[OFFLINE,'/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/favicon.svg','/pwa/badge-96.png','/pwa/icon-maskable-192.png'];
const STATIC_MAX=120;
const NEVER=/^\/(api|auth)(\/|$)/;
const STATIC_PATH=/^\/(assets|_next\/static|landing\/fonts|pwa)\//;
const STATIC_EXT=/\.(js|mjs|css|woff2?|ttf|otf|png|svg|webp|jpe?g|ico)$/i;

self.addEventListener('install',e=>{
 e.waitUntil((async()=>{
  const c=await caches.open(SHELL);
  // jednotlivě a bez přesměrování: chybějící ikona nesmí shodit instalaci; přesměrovaná odpověď (např. na přihlášení) se neuloží
  await Promise.all(PRECACHE.map(async u=>{try{const r=await fetch(u,{cache:'reload',credentials:'same-origin'});if(r.ok&&!r.redirected)await c.put(u,new Response(await r.blob(),{status:200,headers:r.headers}))}catch{}}));
 })());
 // bez skipWaiting: nová verze čeká, dokud uživatel v aplikaci neklikne na „Obnovit“ (zpráva SKIP_WAITING)
});
self.addEventListener('activate',e=>{
 e.waitUntil((async()=>{
  for(const k of await caches.keys())if(k.startsWith('tradee-')&&!KEEP.includes(k))await caches.delete(k);
  if(self.registration.navigationPreload)try{await self.registration.navigationPreload.enable()}catch{}
  await self.clients.claim();
 })());
});
self.addEventListener('message',e=>{
 const t=e.data&&e.data.type;
 if(t==='SKIP_WAITING')self.skipWaiting();
 // odhlášení: smaž runtime cache (sdílené zařízení)
 else if(t==='CLEAR_CACHES')e.waitUntil(caches.delete(STATIC));
});

async function trim(c){const keys=await c.keys();for(let i=0;i<keys.length-STATIC_MAX;i++)await c.delete(keys[i])}
// stale-while-revalidate: rychle z cache, na pozadí obnovit
async function swr(e){
 const c=await caches.open(STATIC),hit=await c.match(e.request);
 const net=fetch(e.request).then(async r=>{if(r.ok&&r.type==='basic'&&!r.redirected&&!/no-store|private/i.test(r.headers.get('Cache-Control')||'')){await c.put(e.request,r.clone());trim(c)}return r});
 if(hit){e.waitUntil(net.catch(()=>{}));return hit}
 return net.catch(async()=>(await caches.match(e.request))||Response.error());
}
// navigace: vždy síť (HTML se neukládá), při výpadku obecná offline stránka
async function navigate(e){
 try{const pre=await e.preloadResponse;if(pre)return pre;return await fetch(e.request)}
 catch{return (await caches.match(OFFLINE))||new Response('<h1>Jsi offline</h1>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}})}
}
self.addEventListener('fetch',e=>{
 const req=e.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 if(NEVER.test(url.pathname))return; // API a přihlášení: prohlížeč to vyřídí sám, nic se neukládá
 if(req.mode==='navigate'){e.respondWith(navigate(e));return}
 if(url.pathname===OFFLINE||url.pathname==='/offline.html'||url.pathname==='/manifest.webmanifest'){e.respondWith(fetch(req).catch(async()=>(await caches.match(url.pathname==='/offline.html'?OFFLINE:url.pathname))||Response.error()));return}
 if(STATIC_PATH.test(url.pathname)&&STATIC_EXT.test(url.pathname)&&!url.search){e.respondWith(swr(e));return}
 if(PRECACHE.includes(url.pathname)){e.respondWith(caches.match(url.pathname).then(r=>r||fetch(req)));return}
});

// Push: obecný formát {title, body, url, tag, actions?:[{action,title,url?,icon?}], requireInteraction?, renotify?, silent?, icon?, badge?, image?, timestamp?}
// (výzvy ke zdůvodnění, cenové alerty a další funkce posílají stejný tvar)
const sameOrigin=u=>{try{const t=new URL(u||'/',self.location.origin);return t.origin===self.location.origin?t.href:new URL('/',self.location.origin).href}catch{return new URL('/',self.location.origin).href}};
self.addEventListener('push',e=>{
 let p={};try{p=e.data?e.data.json():{}}catch{try{p={body:e.data?e.data.text():''}}catch{}}
 const title=typeof p.title==='string'&&p.title?p.title:'Tradee';
 const max=self.Notification&&Notification.maxActions||2;
 const actions=Array.isArray(p.actions)?p.actions.filter(a=>a&&typeof a.action==='string'&&typeof a.title==='string').slice(0,max):[];
 const opts={body:typeof p.body==='string'?p.body:'',icon:p.icon||'/icon-192.png',badge:p.badge||'/pwa/badge-96.png',lang:'cs',
  data:{url:sameOrigin(p.url),actions:Object.fromEntries(actions.filter(a=>a.url).map(a=>[a.action,sameOrigin(a.url)]))}};
 if(p.tag)opts.tag=String(p.tag);
 if(p.tag&&p.renotify)opts.renotify=true;
 if(p.requireInteraction)opts.requireInteraction=true;
 if(p.silent)opts.silent=true;
 if(p.image)opts.image=p.image;
 if(typeof p.timestamp==='number')opts.timestamp=p.timestamp;
 if(actions.length)opts.actions=actions.map(a=>({action:a.action,title:a.title,...(a.icon?{icon:a.icon}:{})}));
 e.waitUntil(self.registration.showNotification(title,opts));
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 const d=e.notification.data||{};
 if(e.action&&d.actions&&!d.actions[e.action])return; // akce bez odkazu (např. „Zavřít“) jen zavře upozornění
 const t=new URL(sameOrigin((e.action&&d.actions&&d.actions[e.action])||d.url));
 e.waitUntil((async()=>{
  const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const mine=all.find(c=>{try{return new URL(c.url).origin===self.location.origin}catch{return false}});
  if(mine){try{await mine.focus();if('navigate' in mine)await mine.navigate(t.href);return}catch{}}
  await self.clients.openWindow(t.href);
 })());
});
