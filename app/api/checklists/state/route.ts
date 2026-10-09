import {identity,db,failed,sameOrigin} from '@/lib/server';
import {listChecklists,marketState,setMarketState,clearMarketState} from '@/lib/checklists/store';
import {applicable} from '@/lib/checklists/core';
import {instruments} from '@/lib/markets';
const valid=(x:unknown):x is string=>typeof x==='string'&&instruments.some(i=>i.id===x);
const notFound=()=>Response.json({error:'Checklist nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){try{const u=await identity(req),ins=new URL(req.url).searchParams.get('instrument');
 if(!valid(ins))throw Error('Neznámý trh.');
 const d=db();
 return Response.json({checklists:applicable(await listChecklists(d,u.id),ins),state:await marketState(d,u.id,ins)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {checklistId?:unknown;instrument?:unknown;checked?:unknown};
 if(typeof b.checklistId!=='string'||!valid(b.instrument))throw Error('Neplatný požadavek.');
 if(!Array.isArray(b.checked)||b.checked.length>100||b.checked.some(x=>typeof x!=='string'))throw Error('Neplatné zaškrtnutí.');
 return await setMarketState(db(),u.id,b.checklistId,b.instrument,b.checked as string[])?Response.json({ok:true}):notFound()}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {checklistId?:unknown;instrument?:unknown};
 if(typeof b.checklistId!=='string'||!valid(b.instrument))throw Error('Neplatný požadavek.');
 await clearMarketState(db(),u.id,b.checklistId,b.instrument);return Response.json({ok:true})}catch(e){return failed(e)}}
