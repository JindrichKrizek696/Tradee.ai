import {identity,db,failed} from '@/lib/server';
import {liveQuotes} from '@/lib/live-store';
export async function GET(req:Request){try{await identity(req);return Response.json(await liveQuotes(db()),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
