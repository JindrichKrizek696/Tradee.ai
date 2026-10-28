import {identity,db,failed,sameOrigin} from '@/lib/server';
import {listAlerts,createAlert,countActive,pushAvailable,publicAlert} from '@/lib/alerts/store';
import {MAX_ACTIVE} from '@/lib/alerts/logic';
import {H,ctxFor} from '@/lib/alerts/api';
// Alerty přihlášeného: GET ?instrument= (jen jeden trh, pro graf a detail), POST nový alert.
export async function GET(req:Request){try{const u=await identity(req),d=db(),inst=new URL(req.url).searchParams.get('instrument');
 const [alerts,active,push]=await Promise.all([listAlerts(d,u.id,inst),countActive(d,u.id),pushAvailable(d,u.id)]);
 return Response.json({alerts:alerts.map(publicAlert),active,limit:MAX_ACTIVE,pushAvailable:push},H)}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),d=db(),b=await req.json() as Record<string,unknown>;
 if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Neplatný alert.');
 const now=Date.now(),r=await createAlert(d,u.id,b,await ctxFor(d,b.instrument,b.hint,now));
 return Response.json({alert:r.alert&&publicAlert(r.alert),warnings:r.warnings},H)}catch(e){return failed(e)}}
