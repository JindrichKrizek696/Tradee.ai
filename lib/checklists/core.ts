// Checklisty: mapování MT symbolu na trh, platné checklisty pro trh, snímek při vstupu, míra splnění. Čisté funkce – testy scripts/check-checklists.mjs.
export type ChecklistItem={id:string;text:string};
export type Checklist={id:string;name:string;items:ChecklistItem[];markets:string[]};
export type SnapshotList={checklistId:string;name:string;items:(ChecklistItem&{checked:boolean})[]};
export const LIMITS={lists:20,items:30,name:60,item:120};
export function newItemId(){const a='abcdefghijklmnopqrstuvwxyz0123456789';let s='';const b=crypto.getRandomValues(new Uint8Array(8));for(const x of b)s+=a[x%a.length];return s}
const INDEX:Record<string,string>={NAS100:'^NDX',US100:'^NDX',USTEC:'^NDX',NDX:'^NDX',NQ:'^NDX',NASDAQ:'^NDX',NASDAQ100:'^NDX',US500:'^GSPC',SPX500:'^GSPC',SP500:'^GSPC',SPX:'^GSPC',ES:'^GSPC'};
const CRYPTO=['BTC','ETH','SOL'];
// MT symbol → id trhu Tradee; ruční přiřazení (klíč velkými písmeny, '' = nesledovat) má přednost; nepoznané → null
export function mapSymbol(symbol:string,ids:readonly string[],userMap:Record<string,string>):string|null{
 const raw=String(symbol||'').trim().toUpperCase();if(!raw)return null;
 if(Object.hasOwn(userMap,raw))return userMap[raw]&&ids.includes(userMap[raw])?userMap[raw]:null;
 if(ids.includes(raw))return raw;
 const slash=raw.match(/^([A-Z]{3})\/([A-Z]{3})$/);
 const base=raw.replace(/^[#.]+/,'').split(/[._+]/)[0];
 const fx=slash?[slash[1],slash[2]]:base.match(/^([A-Z]{3})([A-Z]{3})[A-Z]{0,2}$/)?.slice(1,3);
 if(fx){const [a,b]=fx;if(ids.includes(a+'/'+b))return a+'/'+b;if(ids.includes(b+'/'+a))return b+'/'+a}
 const cr=CRYPTO.find(c=>base===c+'USD'||base===c+'USDT');if(cr&&ids.includes(cr+'-USD'))return cr+'-USD';
 const idx=INDEX[base]||INDEX[base.replace(/CASH$/,'')];if(idx&&ids.includes(idx))return idx;
 if(ids.includes(base))return base;
 const dot=raw.replace(/^#/,'').match(/^([A-Z]+)\.([A-Z])$/);if(dot&&ids.includes(dot[1]+'-'+dot[2]))return dot[1]+'-'+dot[2];
 return null;
}
export const applicable=(lists:Checklist[],instrument:string)=>lists.filter(l=>l.markets.includes(instrument));
// kopie platných checklistů s aktuálním zaškrtnutím (neexistující id bodů se ignorují)
export function snapshotFor(lists:Checklist[],instrument:string,states:Record<string,string[]>):SnapshotList[]{
 return applicable(lists,instrument).map(l=>{const on=new Set(states[l.id]||[]);return {checklistId:l.id,name:l.name,items:l.items.map(i=>({id:i.id,text:i.text,checked:on.has(i.id)}))}});
}
export function completion(snap:SnapshotList[]):number|null{let n=0,c=0;for(const l of snap)for(const i of l.items){n++;if(i.checked)c++}return n?c/n:null}
export const completionGroup=(r:number|null)=>r===null?'none' as const:r>=1?'full' as const:r>=0.7?'most' as const:'less' as const;
// vstup z UI → očištěný checklist, nebo text chyby
export function validateChecklist(v:unknown,ids:readonly string[]):Omit<Checklist,'id'>|string{
 const o=v as {name?:unknown;items?:unknown;markets?:unknown}|null;if(!o||typeof o!=='object')return 'Neplatný checklist.';
 const name=typeof o.name==='string'?o.name.trim():'';if(!name)return 'Zadej název checklistu.';if(name.length>LIMITS.name)return `Název může mít nejvýš ${LIMITS.name} znaků.`;
 if(!Array.isArray(o.items))return 'Body musí být seznam.';if(o.items.length>LIMITS.items)return `Nejvýš ${LIMITS.items} bodů v checklistu.`;
 const items:ChecklistItem[]=[];
 for(const it of o.items as {id?:unknown;text?:unknown}[]){const text=typeof it?.text==='string'?it.text.trim():'';if(!text)return 'Bod nesmí být prázdný.';if(text.length>LIMITS.item)return `Bod může mít nejvýš ${LIMITS.item} znaků.`;const id=typeof it.id==='string'&&/^[a-z0-9]{8}$/.test(it.id)?it.id:newItemId();items.push({id,text})}
 const markets=Array.isArray(o.markets)?[...new Set((o.markets as unknown[]).filter((m):m is string=>typeof m==='string'&&ids.includes(m)))]:[];
 return {name,items,markets};
}
