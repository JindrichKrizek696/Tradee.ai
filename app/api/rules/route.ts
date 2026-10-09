import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {getRuleSettings,saveRuleSettings} from '@/lib/discipline/store';
import {RULES} from '@/lib/discipline/rules';
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 return Response.json({rules:await getRuleSettings(db(),v.userId),defs:RULES},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {rules?:unknown};if(!b||typeof b.rules!=='object'||b.rules===null||Array.isArray(b.rules))throw Error('Chybí nastavení pravidel.');
 return Response.json({rules:await saveRuleSettings(db(),u.id,b.rules)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
