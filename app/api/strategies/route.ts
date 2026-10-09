import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {listStrategies,createStrategy,renameStrategy,archiveStrategy} from '@/lib/discipline/store';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 return Response.json({strategies:await listStrategies(db(),v.userId)},{headers})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {name?:unknown};if(typeof b?.name!=='string')throw Error('Chybí název strategie.');
 return Response.json({id:await createStrategy(db(),u.id,b.name)},{headers})}catch(e){return failed(e)}}
export async function PATCH(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {id?:unknown;name?:unknown;archived?:unknown};
 if(typeof b?.id!=='string'||!b.id)throw Error('Chybí strategie.');
 if(b.name===undefined&&b.archived===undefined)throw Error('Není co změnit.');
 if(b.name!==undefined&&typeof b.name!=='string')throw Error('Neplatný název strategie.');
 if(b.archived!==undefined&&typeof b.archived!=='boolean')throw Error('Neplatná hodnota archivace.');
 const d=db();let ok=true;
 if(typeof b.name==='string')ok=await renameStrategy(d,u.id,b.id,b.name);
 if(ok&&typeof b.archived==='boolean')ok=await archiveStrategy(d,u.id,b.id,b.archived);
 if(!ok)throw Error('Strategie nenalezena.');
 return Response.json({ok:true},{headers})}catch(e){return failed(e)}}
