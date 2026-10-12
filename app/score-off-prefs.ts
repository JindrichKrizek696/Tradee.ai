'use client';
import {useSyncExternalStore} from 'react';
import {normalizeOff} from '@/lib/overview-toggle';
// Vypnuté složky přehledu skóre: hned z localStorage, pak sjednocení s účtem (/api/settings); změna se uloží po 500 ms.
// Jeden stav pro celou stránku – platí pro všechny trhy a karty přehledu; další karty prohlížeče přes událost storage.
// Bez sloupce members.score_off (migrace 0023) se výběr drží aspoň v tomto prohlížeči.
const KEY='tradee.scoreOff',EMPTY:string[]=[];
let off:string[]=EMPTY,started=false,dirty=false,timer:ReturnType<typeof setTimeout>|null=null;
const subs=new Set<()=>void>(),emit=()=>subs.forEach(f=>f());
const read=(s:string|null)=>{try{return normalizeOff(JSON.parse(s||'[]'))}catch{return EMPTY}};
const store=(v:string[])=>{try{localStorage.setItem(KEY,JSON.stringify(v))}catch{}};
function start(){
 if(started)return;started=true;
 try{off=read(localStorage.getItem(KEY))}catch{}
 fetch('/api/settings',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{scoreOff?:unknown}>:null).then(j=>{if(!dirty&&Array.isArray(j?.scoreOff)){off=normalizeOff(j.scoreOff);store(off);emit()}}).catch(()=>{});
 addEventListener('storage',e=>{if(e.key===KEY){off=read(e.newValue);emit()}});
}
const subscribe=(f:()=>void)=>{start();subs.add(f);return()=>{subs.delete(f)}};
function save(next:string[]){
 off=normalizeOff(next);dirty=true;store(off);emit();if(timer)clearTimeout(timer);const v=off;
 timer=setTimeout(()=>{timer=null;fetch('/api/settings',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({scoreOff:v})}).catch(()=>{})},500);
}
export function useScoreOff(){return [useSyncExternalStore(subscribe,()=>off,()=>EMPTY),save] as const}
