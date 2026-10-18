import {identity,db,failed,sameOrigin} from '@/lib/server';
import {parseProfile} from '@/lib/profile/rules';
import {readProfile,saveProfile} from '@/lib/profile/store';
const noStore={'Cache-Control':'private, no-store'};
// profil přihlášeného: vlastní údaje + účet z Google (jméno, e-mail, role); jméno z Google zůstává výchozí
export async function GET(req:Request){try{const u=await identity(req);const p=await readProfile(db(),u.id,u.email);
 return Response.json({...p,account:{googleName:u.name,first:u.first||null,email:u.email,role:u.role,owner:u.owner}},{headers:noStore})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);const r=parseProfile(await req.json().catch(()=>null));if(!r.ok)throw Error(r.error);
 const d=db();await saveProfile(d,u.id,r.value);return Response.json((await readProfile(d,u.id,u.email)),{headers:noStore})}catch(e){return failed(e)}}
