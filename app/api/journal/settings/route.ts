import {identity,db,failed,sameOrigin} from '@/lib/server';
import {getIdeaWindow,setIdeaWindow} from '@/lib/journal/record-store';
const headers={'Cache-Control':'private, no-store'};
// Nastavení deníku: okno pro automatické seskupení pozic do nápadu (minuty)
export async function GET(req:Request){try{const u=await identity(req);return Response.json({ideaWindow:await getIdeaWindow(db(),u.id)},{headers})}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json().catch(()=>null) as {ideaWindow?:unknown}|null;
 return Response.json({ideaWindow:await setIdeaWindow(db(),u.id,b?.ideaWindow)},{headers})}catch(e){return failed(e)}}
