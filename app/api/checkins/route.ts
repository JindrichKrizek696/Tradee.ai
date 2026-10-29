// Check-iny jsou soukromé: jen identity(req), žádný pohled správce (?as=) – parametr se ignoruje. Kontrola scripts/check-checkins.mjs.
import {identity,db,failed,sameOrigin} from '@/lib/server';
import {validateCheckin} from '@/lib/checkins/core';
import {listCheckins,createCheckin,deleteCheckin,statsFor,isMissing,MISSING} from '@/lib/checkins/store';
const headers={'Cache-Control':'private, no-store'};
const day=(v:string|null)=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;
const fail=(e:unknown)=>failed(isMissing(e)?new Error(MISSING):e);
// GET ?from&to&tradeId → seznam; ?stats=1 → statistika do Deníku
export async function GET(req:Request){try{const u=await identity(req),q=new URL(req.url).searchParams,d=db();
 if(q.get('stats')==='1')return Response.json({stats:await statsFor(d,u.id)},{headers});
 const t=q.get('tradeId'),sc=q.get('scenarioId');return Response.json({checkins:await listCheckins(d,u.id,{from:day(q.get('from')),to:day(q.get('to')),tradeId:t&&/^[\w:.-]{1,80}$/.test(t)?t:null,scenarioId:sc&&/^[\w:.-]{1,40}$/.test(sc)?sc:null,limit:200})},{headers})}catch(e){return fail(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 const c=validateCheckin(await req.json().catch(()=>null),Date.now());if(typeof c==='string')throw Error(c);
 return Response.json({checkin:await createCheckin(db(),u.id,c)},{headers})}catch(e){return fail(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json().catch(()=>null) as {id?:unknown}|null;
 if(typeof b?.id!=='string'||!/^chk_[a-z0-9]{24}$/.test(b.id))throw Error('Neplatný check-in.');
 return Response.json({ok:await deleteCheckin(db(),u.id,b.id)},{headers})}catch(e){return fail(e)}}
