import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {listCustomRules,saveCustomRules} from '@/lib/discipline/store';
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 return Response.json({rules:await listCustomRules(db(),v.userId)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {rules?:unknown};
 if(!b||!Array.isArray(b.rules)||b.rules.some(r=>!r||typeof r!=='object'||typeof (r as {text?:unknown}).text!=='string'||((r as {id?:unknown}).id!==undefined&&typeof (r as {id?:unknown}).id!=='string')))throw Error('Neplatný seznam pravidel.');
 return Response.json({rules:await saveCustomRules(db(),u.id,b.rules as {id?:string;text:string}[])},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
