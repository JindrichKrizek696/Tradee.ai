import {db,failed} from '@/lib/server';
import {adminUser} from '@/lib/admin/http';
import {auditLog} from '@/lib/admin/store';
export async function GET(req:Request){try{const u=await adminUser(req);if(u instanceof Response)return u;return Response.json({audit:await auditLog(db(),u.owner)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
