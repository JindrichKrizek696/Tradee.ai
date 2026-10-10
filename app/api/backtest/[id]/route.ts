import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {getRun,deleteRun} from '@/lib/backtest/store';
type Ctx={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
const notFound=()=>Response.json({error:'Běh nenalezen.'},{status:404,headers});
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const run=await getRun(db(),v.userId,(await params).id);
 return run?Response.json({run},{headers}):notFound()}catch(e){return failed(e)}}
export async function DELETE(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req);
 return await deleteRun(db(),u.id,(await params).id)?Response.json({ok:true},{headers}):notFound()}catch(e){return failed(e)}}
