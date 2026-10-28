// Přepis instrumentu brokerem pro profil účtu (tick, hodnota ticku, loty, komise, spread). Prázdný přepis = smazat.
import {identity,db,failed,sameOrigin} from '@/lib/server';
import {saveOverride,listInstruments} from '@/lib/risk/store';
import {parseOverride} from '@/lib/risk/instruments';
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req),d=db();
 const b=await req.json().catch(()=>null) as {profileId?:unknown;instrumentId?:unknown;override?:unknown}|null;
 if(!b||typeof b.profileId!=='string'||typeof b.instrumentId!=='string')throw Error('Chybí profil nebo instrument.');
 if(!(await listInstruments(d)).some(i=>i.id===b.instrumentId))throw Error('Neznámý instrument.');
 const o=parseOverride(b.override??{});if(!o.ok)throw Error(o.error);
 if(!await saveOverride(d,u.id,b.profileId,b.instrumentId,o.value))return Response.json({error:'Profil nenalezen.'},{status:404,headers:{'Cache-Control':'no-store'}});
 return Response.json({ok:true,override:o.value},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
