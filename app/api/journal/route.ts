import {identity,db,failed} from '@/lib/server';
import {listJournal} from '@/lib/journal/store';
import {viewAs} from '@/lib/admin/http';
import {audit} from '@/lib/admin/store';
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;const d=db();
 if(v.viewing)await audit(d,u.id,'view_journal',v.userId);
 return Response.json(await listJournal(d,v.userId),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
