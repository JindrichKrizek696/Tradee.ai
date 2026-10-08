import {db,failed,ownerEmail} from '@/lib/server';
import {adminUser} from '@/lib/admin/http';
import {overview} from '@/lib/admin/store';
export async function GET(req:Request){try{const u=await adminUser(req);if(u instanceof Response)return u;return Response.json(await overview(db(),ownerEmail()),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
