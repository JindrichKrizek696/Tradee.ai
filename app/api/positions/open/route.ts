import {identity,db,failed} from '@/lib/server';
import {openPositions} from '@/lib/positions/store';
import {viewAs} from '@/lib/admin/http';
import {instruments} from '@/lib/markets';
const ids=instruments.map(i=>i.id);
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 return Response.json(await openPositions(db(),v.userId,ids),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
