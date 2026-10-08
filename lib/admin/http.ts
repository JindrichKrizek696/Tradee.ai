// Oprávnění pro /api/admin/* a čtení deníku za jiného uživatele (?as=, jen vlastník).
import {identity,db,type User} from '../server.ts';
import {isAdmin} from './rules.ts';
export const forbidden=()=>Response.json({error:'Na tohle nemáš oprávnění.'},{status:403,headers:{'Cache-Control':'no-store'}});
export async function adminUser(req:Request):Promise<User|Response>{const u=await identity(req);return isAdmin(u)?u:forbidden()}
export async function ownerUser(req:Request):Promise<User|Response>{const u=await identity(req);return u.owner?u:forbidden()}
export async function viewAs(req:Request,u:User):Promise<{userId:string;viewing:boolean}|Response>{
 const as=new URL(req.url).searchParams.get('as');
 if(!as||as===u.id)return {userId:u.id,viewing:false};
 if(!u.owner)return forbidden();
 if(!/^[\w:.-]{1,128}$/.test(as)||!await db().prepare('SELECT id FROM members WHERE id=?').bind(as).first())return Response.json({error:'Uživatel nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
 return {userId:as,viewing:true};
}
