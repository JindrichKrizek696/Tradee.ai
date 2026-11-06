// Laboratoř je soukromá: vlastník (OWNER_EMAIL → user.owner) + vybraní uživatelé z LAB_EMAILS (→ user.lab).
// Čistá logika, testy scripts/check-lab.mjs.
// Pravidla (záměrně přísnější než administrace):
//  • přístup má jen vlastník a e-maily z LAB_EMAILS (čárkami oddělené, bez ohledu na velikost písmen); i ti musí být
//    schválení a nezablokovaní členové (jinak je currentUser vůbec nevrátí),
//  • kdokoli jiný (admin, člen, nepřihlášený) dostane 404 – ne 403, ať se o existenci Laboratoře nedozví,
//  • sdílený uživatel pracuje s TÝMIŽ daty jako vlastník: labGate mu jako id podstrčí members.id vlastníka
//    (skutečné id/e-mail zůstává v actorId/actorEmail pro log); když id vlastníka nejde dohledat → 404,
//  • admin „zobrazit jako“ (?as=, lib/admin/http.ts viewAs) se v Laboratoři nikdy nepoužívá; požadavek s ?as= na cizí id = 404
//    (data se nikdy nečtou za jiného uživatele než vlastníka Laboratoře),
//  • tabulky lab_* nečte žádná admin routa ani export (lib/admin/* je nezná),
//  • cron skripty (simulace, týdenní souhrn, analytik, evoluce) dál hledají vlastníka přes OWNER_EMAIL a maily chodí jen jemu.
export type LabActor={id:string;role:string;owner:boolean;lab?:boolean}|null|undefined;
export function labAllowed(u:LabActor,url?:string):boolean{
 if(!u||(u.lab!==true&&u.owner!==true))return false;
 if(url){const as=new URL(url).searchParams.get('as');if(as!==null&&as!==u.id)return false}
 return true;
}
export const LAB_HEADERS={'Cache-Control':'private, no-store'};
// stejná odpověď jako neexistující cesta – nic neprozradí
export const labNotFound=()=>Response.json({error:'Nenalezeno.'},{status:404,headers:{'Cache-Control':'no-store'}});
export type LabSession<U>=U&{actorId:string;actorEmail:string};
// vrátí uživatele s id dat Laboratoře (vlastník = vlastní id, sdílený = ownerId), nebo 404 odpověď
export function labGate<U extends {id:string;role:string;owner:boolean;lab?:boolean;email?:string}>(u:U|null|undefined,url:string,ownerId?:string|null):LabSession<U>|Response{
 if(!u||!labAllowed(u,url))return labNotFound();
 const dataId=u.owner===true?u.id:ownerId;
 if(!dataId)return labNotFound();
 return {...u,id:dataId,actorId:u.id,actorEmail:u.email||''};
}
