import {identity,db,failed} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {pendingReasons,pendingCount,getNotify} from '@/lib/discipline/store';
// Čekající zdůvodnění pro okno a odznak; v cizím pohledu (?as=) se okno nikdy neukazuje.
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const d=db(),[items,count,n]=await Promise.all([pendingReasons(d,v.userId),pendingCount(d,v.userId),getNotify(d,v.userId)]);
 const showPopup=!v.viewing&&n.popup&&(n.snoozeUntil===null||n.snoozeUntil<Date.now())&&count>0;
 return Response.json({items,count,showPopup},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
