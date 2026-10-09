import {identity,db,failed,sameOrigin,runtime} from '@/lib/server';
import {getNotify,setNotify,snooze} from '@/lib/discipline/store';
const H={headers:{'Cache-Control':'private, no-store'}};
export async function GET(req:Request){try{const u=await identity(req);return Response.json({...await getNotify(db(),u.id),vapidPublic:runtime().VAPID_PUBLIC_KEY||null},H)}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {popup?:unknown;mail?:unknown;push?:unknown};
 if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Neplatné nastavení.');
 return Response.json(await setNotify(db(),u.id,b),H)}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {action?:unknown};
 if(!b||b.action!=='snooze')throw Error('Neznámá akce.');
 return Response.json({snoozeUntil:await snooze(db(),u.id)},H)}catch(e){return failed(e)}}
