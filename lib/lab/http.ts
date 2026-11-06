// Vstup do /api/laborator/*: vlastník + LAB_EMAILS, jinak 404 (viz lib/lab/access.ts). Nepřihlášený i chyba session = 404.
// Sdílený uživatel dostane id dat = members.id vlastníka (hledá se podle OWNER_EMAIL, cache 5 min); skutečný uživatel v actorId/actorEmail.
import {currentUser,failed,db,ownerEmail,type User} from '../server.ts';
import {labAllowed,labGate,labNotFound,LAB_HEADERS,type LabSession} from './access.ts';
import {isMissingLabTable,LAB_MISSING} from './core.ts';
export {LAB_HEADERS,labNotFound};
let ownerCache:{email:string;id:string|null;until:number}|null=null;
async function labOwnerId():Promise<string|null>{
 const email=ownerEmail();if(!email)return null;
 if(ownerCache&&ownerCache.email===email&&ownerCache.until>Date.now())return ownerCache.id;
 const m=await db().prepare('SELECT id FROM members WHERE LOWER(email)=? LIMIT 1').bind(email).first<{id:string}>().catch(()=>null);
 const id=m?.id?String(m.id):null;
 ownerCache={email,id,until:Date.now()+(id?300_000:30_000)};return id;
}
export async function labUser(req:Request):Promise<LabSession<User>|Response>{
 const u=await currentUser(req).catch(()=>null);
 if(!u||!labAllowed(u,req.url))return labNotFound();
 const s=labGate(u,req.url,u.owner?u.id:await labOwnerId());
 // změny v Laboratoři od sdíleného uživatele zalogovat (data patří vlastníkovi)
 if(!(s instanceof Response)&&!u.owner&&req.method!=='GET'&&req.method!=='HEAD')console.log(`[laborator] ${s.actorEmail} (${s.actorId}) ${req.method} ${new URL(req.url).pathname}`);
 return s;
}
export function labFailed(e:unknown){
 if(isMissingLabTable(e))return Response.json({error:LAB_MISSING,missing:true},{status:503,headers:LAB_HEADERS});
 return failed(e);
}
