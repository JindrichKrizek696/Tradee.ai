import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {ownsStrategy,getRules,saveRules} from '@/lib/backtest/store';
import {rulesIssues} from '@/lib/backtest/rules';
type Ctx={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
const notFound=()=>Response.json({error:'Strategie nenalezena.'},{status:404,headers});
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const {id}=await params,d=db();if(!await ownsStrategy(d,v.userId,id))return notFound();
 const r=await getRules(d,v.userId,id);
 return Response.json({...r,issues:rulesIssues(r.rules)},{headers})}catch(e){return failed(e)}}
export async function PUT(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req);
 const {id}=await params,d=db();if(!await ownsStrategy(d,u.id,id))return notFound();
 const b=await req.json() as {rules?:unknown};if(!b||typeof b!=='object'||b.rules===undefined||b.rules===null||typeof b.rules!=='object')throw Error('Chybí pravidla.');
 const rules=await saveRules(d,u.id,id,b.rules);
 return Response.json({rules,saved:true,issues:rulesIssues(rules)},{headers})}catch(e){return failed(e)}}
