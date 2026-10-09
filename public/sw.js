// Service worker Tradee: zobrazí push o výzvě ke zdůvodnění a po kliknutí otevře deník.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{
  let p={};try{p=e.data?e.data.json():{}}catch{}
  const title=p.title||'Tradee';
  e.waitUntil(self.registration.showNotification(title,{body:p.body||'',data:{url:p.url||'/'},icon:'/icon-192.png',badge:'/icon-192.png',tag:p.tag}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  let t;try{t=new URL((e.notification.data&&e.notification.data.url)||'/',self.location.origin)}catch{t=new URL('/',self.location.origin)}
  if(t.origin!==self.location.origin)t=new URL('/',self.location.origin);
  e.waitUntil((async()=>{
    const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const mine=all.find(c=>{try{return new URL(c.url).origin===self.location.origin}catch{return false}});
    if(mine){try{await mine.focus();if('navigate' in mine)await mine.navigate(t.href);return}catch{}}
    await self.clients.openWindow(t.href);
  })());
});
