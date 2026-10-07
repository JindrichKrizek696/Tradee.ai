import {identity,db,failed} from '@/lib/server';
import {listJournal} from '@/lib/journal/store';
export async function GET(req:Request){try{const u=await identity(req);return Response.json(await listJournal(db(),u.id),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
