// Laboratoř je soukromá: jen vlastník (OWNER_EMAIL → user.owner). Čistá logika, testy scripts/check-lab.mjs.
// Pravidla (záměrně přísnější než administrace):
//  • kdokoli jiný (admin, člen, nepřihlášený) dostane 404 – ne 403, ať se o existenci Laboratoře nedozví,
//  • admin „zobrazit jako“ (?as=, lib/admin/http.ts viewAs) se v Laboratoři nikdy nepoužívá; požadavek s ?as= na cizí id = 404
//    (data vždy patří přihlášenému vlastníkovi, nikdy se nečtou za jiného uživatele),
//  • tabulky lab_* nečte žádná admin routa ani export (lib/admin/* je nezná).
export type LabActor={id:string;role:string;owner:boolean}|null|undefined;
export function labAllowed(u:LabActor,url?:string):boolean{
 if(!u||u.owner!==true)return false;
 if(url){const as=new URL(url).searchParams.get('as');if(as!==null&&as!==u.id)return false}
 return true;
}
export const LAB_HEADERS={'Cache-Control':'private, no-store'};
// stejná odpověď jako neexistující cesta – nic neprozradí
export const labNotFound=()=>Response.json({error:'Nenalezeno.'},{status:404,headers:{'Cache-Control':'no-store'}});
// vrátí uživatele, nebo 404 odpověď
export function labGate<U extends {id:string;role:string;owner:boolean}>(u:U|null|undefined,url:string):U|Response{return labAllowed(u,url)?u as U:labNotFound()}
