import {identity,db,failed} from '@/lib/server';
import {windowDefs} from '@/lib/journal/record-store';
// No-trade okna kolem zpráv (strategie a účty) pro kalendář
export async function GET(req:Request){try{const u=await identity(req);return Response.json({windows:await windowDefs(db(),u.id)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
