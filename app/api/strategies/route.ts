import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {createStrategy,renameStrategy,archiveStrategy} from '@/lib/discipline/store';
import {ensureMigrated,listStrategiesFull,setStrategyOrigin} from '@/lib/strategy/store';
import {instruments} from '@/lib/markets';
const headers={'Cache-Control':'private, no-store'},ids=instruments.map(i=>i.id);
// GET: strategie s poslední verzí (?full=1 i s obsahem verze pro checklist); první načtení převede staré strategie a checklisty na verzi 1
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const d=db();if(!v.viewing)await ensureMigrated(d,v.userId,ids);
 return Response.json({strategies:await listStrategiesFull(d,v.userId,new URL(req.url).searchParams.get('full')==='1')},{headers})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {name?:unknown;origin?:unknown;mentor?:unknown};if(typeof b?.name!=='string')throw Error('Chybí název strategie.');
 const d=db(),id=await createStrategy(d,u.id,b.name);
 if(b.origin!==undefined||b.mentor!==undefined)await setStrategyOrigin(d,u.id,id,b.origin,b.mentor);
 await ensureMigrated(d,u.id,ids);
 return Response.json({id},{headers})}catch(e){return failed(e)}}
export async function PATCH(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {id?:unknown;name?:unknown;archived?:unknown;origin?:unknown;mentor?:unknown};
 if(typeof b?.id!=='string'||!b.id)throw Error('Chybí strategie.');
 if(b.name===undefined&&b.archived===undefined&&b.origin===undefined)throw Error('Není co změnit.');
 if(b.name!==undefined&&typeof b.name!=='string')throw Error('Neplatný název strategie.');
 if(b.archived!==undefined&&typeof b.archived!=='boolean')throw Error('Neplatná hodnota archivace.');
 const d=db();let ok=true;
 if(typeof b.name==='string')ok=await renameStrategy(d,u.id,b.id,b.name);
 if(ok&&typeof b.archived==='boolean')ok=await archiveStrategy(d,u.id,b.id,b.archived);
 if(ok&&b.origin!==undefined)ok=await setStrategyOrigin(d,u.id,b.id,b.origin,b.mentor);
 if(!ok)throw Error('Strategie nenalezena.');
 return Response.json({ok:true},{headers})}catch(e){return failed(e)}}
