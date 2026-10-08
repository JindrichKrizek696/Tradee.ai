import {db,failed,sameOrigin,ownerEmail,isOwner,forgetAccess} from '@/lib/server';
import {adminUser} from '@/lib/admin/http';
import {people,personByEmail,setApproved,setBlocked,setRole,audit} from '@/lib/admin/store';
import {canDo,ADMIN_ACTIONS,type AdminAction} from '@/lib/admin/rules';
export async function GET(req:Request){try{const u=await adminUser(req);if(u instanceof Response)return u;return Response.json({people:await people(db(),ownerEmail()),me:{id:u.id,owner:u.owner}},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await adminUser(req);if(u instanceof Response)return u;
 const b=await req.json().catch(()=>({})) as {email?:unknown;action?:unknown};
 if(typeof b.email!=='string'||typeof b.action!=='string'||!(ADMIN_ACTIONS as readonly string[]).includes(b.action))throw Error('Chybí e-mail nebo akce.');
 const action=b.action as AdminAction,d=db(),p=await personByEmail(d,b.email.trim());
 if(!p)return Response.json({error:'Uživatel nenalezen.'},{status:404});
 const err=canDo(u,action,{isOwner:isOwner(p.email),memberId:p.member_id});if(err)throw Error(err);
 if(action==='approve')await setApproved(d,p.email);
 else if(action==='block'||action==='unblock')await setBlocked(d,p.email,action==='block');
 else await setRole(d,p.member_id as string,action==='role_admin'?'admin':'member');
 if(p.member_id)forgetAccess(p.member_id);
 await audit(d,u.id,action,p.email);
 return Response.json({ok:true})}catch(e){return failed(e)}}
