import {identity,db,failed,sameOrigin} from '@/lib/server';
import {sessionOverview,saveLimits,deleteLimits,addSessionReview} from '@/lib/journal/record-store';
const headers={'Cache-Control':'private, no-store'};
// Limity seance: GET stav (připraven / aktivní / pauza / review) + dnešní upozornění; PUT {scope,scopeId,limits}; DELETE {scope,scopeId}; POST review {scope,scopeId,note}
export async function GET(req:Request){try{const u=await identity(req);return Response.json(await sessionOverview(db(),u.id),{headers})}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req),d=db();await saveLimits(d,u.id,await req.json().catch(()=>null));
 return Response.json(await sessionOverview(d,u.id),{headers})}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req),d=db(),b=await req.json().catch(()=>null) as {scope?:unknown;scopeId?:unknown}|null;
 await deleteLimits(d,u.id,b?.scope,b?.scopeId);return Response.json(await sessionOverview(d,u.id),{headers})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),d=db();await addSessionReview(d,u.id,await req.json().catch(()=>null));
 return Response.json(await sessionOverview(d,u.id),{headers})}catch(e){return failed(e)}}
