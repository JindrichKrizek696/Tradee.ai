import {identity,db,failed,sameOrigin} from '@/lib/server';
import {listIdeas,ideaAction} from '@/lib/journal/record-store';
import {viewAs} from '@/lib/admin/http';
const headers={'Cache-Control':'private, no-store'};
// Nápady s více vstupy: GET seznam (auto + scénář + ruční), POST akce (assign / split / reset / update / leg / cancel / remove)
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 return Response.json(await listIdeas(db(),v.userId),{headers})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 if(Number(req.headers.get('content-length')||0)>20_000)throw Error('Požadavek je příliš velký.');
 return Response.json(await ideaAction(db(),u.id,await req.json().catch(()=>null)),{headers})}catch(e){return failed(e)}}
