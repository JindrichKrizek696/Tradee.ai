// Pořadí a viditelnost položek horní navigace (čistá logika bez serverových importů, sdílí ji klient i API).
export const VIEWS=['dashboard','analyzer','reports','calendar','journal','journaling'] as const;
export type View=typeof VIEWS[number];
// merge: Deník a Journaling jsou v liště jedna položka „Deník“ (Journaling se z lišty schová, jeho obsah je v záložkách Deníku)
export type Nav={order:View[];hidden:View[];merge:boolean};
export const isView=(v:unknown):v is View=>typeof v==='string'&&(VIEWS as readonly string[]).includes(v);
export const defaultNav=():Nav=>({order:[...VIEWS],hidden:[],merge:false});
// Neznámá id a duplicity zahodí, chybějící položky doplní na konec ve výchozím pořadí, Dashboard se nikdy neschová.
export function normalizeNav(raw:unknown):Nav{
 const o=(raw&&typeof raw==='object'?raw:{}) as {order?:unknown;hidden?:unknown;merge?:unknown};
 const order:View[]=[];
 if(Array.isArray(o.order))for(const v of o.order)if(isView(v)&&!order.includes(v))order.push(v);
 for(const v of VIEWS)if(!order.includes(v))order.push(v);
 const hidden:View[]=[];
 if(Array.isArray(o.hidden))for(const v of o.hidden)if(isView(v)&&v!=='dashboard'&&!hidden.includes(v))hidden.push(v);
 return {order,hidden,merge:o.merge===true};
}
export function parseNav(s:string|null|undefined):Nav{if(!s)return defaultNav();try{return normalizeNav(JSON.parse(s))}catch{return defaultNav()}}
