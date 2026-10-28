import {identity,db,failed,sameOrigin} from '@/lib/server';
import {listEvents,markRead} from '@/lib/alerts/store';
import {H} from '@/lib/alerts/api';
// Spuštěné alerty (schránka u zvonku a historie): GET ?unread=1&alert=<id>&limit=; POST {action:'read', ids?:number[]} (bez ids = vše).
export async function GET(req:Request){try{const u=await identity(req),q=new URL(req.url).searchParams;
 return Response.json(await listEvents(db(),u.id,{unread:q.get('unread')==='1',alertId:q.get('alert'),limit:Number(q.get('limit'))||50}),H)}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {action?:unknown;ids?:unknown};
 if(!b||b.action!=='read')throw Error('Neznámá akce.');
 if(b.ids!==undefined&&!Array.isArray(b.ids))throw Error('Neplatná id.');
 const n=await markRead(db(),u.id,Array.isArray(b.ids)?b.ids.map(Number):null,Date.now());
 return Response.json({ok:true,marked:n},H)}catch(e){return failed(e)}}
