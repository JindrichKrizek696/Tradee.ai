import {identity,db,failed} from '@/lib/server';
import {listFolders,listNotes,notebookError} from '@/lib/notebook/store';
import {instruments} from '@/lib/markets';
const markets=instruments.map(i=>({id:i.id,name:i.name,group:i.group}));
// Poznámky jsou soukromé: jen vlastní data (žádné ?as= pro admina)
export async function GET(req:Request){try{const u=await identity(req),d=db();
 const [folders,notes]=await Promise.all([listFolders(d,u.id),listNotes(d,u.id)]);
 return Response.json({folders,notes,markets},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(notebookError(e))}}
