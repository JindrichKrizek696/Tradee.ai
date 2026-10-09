import {identity,db,failed} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {listReviews,listViolations,listCustomRules,listStrategies,getRuleSettings} from '@/lib/discipline/store';
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const d=db(),id=v.userId;
 const [reviews,violations,custom,strategies,rules]=await Promise.all([listReviews(d,id),listViolations(d,id),listCustomRules(d,id),listStrategies(d,id),getRuleSettings(d,id)]);
 return Response.json({reviews,violations,custom,strategies,rules},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
