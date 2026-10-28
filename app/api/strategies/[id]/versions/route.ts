import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {ensureMigrated,listStrategiesFull,listVersions,saveVersion} from '@/lib/strategy/store';
import {instruments} from '@/lib/markets';
type Ctx={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'},ids=instruments.map(i=>i.id);
const notFound=()=>Response.json({error:'Strategie nenalezena.'},{status:404,headers});
const okId=(s:string)=>/^str_[a-z0-9]{1,36}$/.test(s);
// Verze strategie (nejnovější první) s počtem použití; PUT {content, changelog} = uložit (přepis nepoužité / nová verze)
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const {id}=await params;if(!okId(id))return notFound();
 const d=db();if(!v.viewing)await ensureMigrated(d,v.userId,ids);
 const s=(await listStrategiesFull(d,v.userId)).find(x=>x.id===id);if(!s)return notFound();
 return Response.json({strategy:s,versions:await listVersions(d,v.userId,id)},{headers})}catch(e){return failed(e)}}
export async function PUT(req:Request,{params}:Ctx){try{sameOrigin(req);const u=await identity(req),{id}=await params;if(!okId(id))return notFound();
 const len=Number(req.headers.get('content-length')||0);if(len>400_000)throw Error('Strategie je příliš velká.');
 const b=await req.json() as {content?:unknown;changelog?:unknown};
 const r=await saveVersion(db(),u.id,id,b?.content,b?.changelog,ids);
 return r?Response.json(r,{headers}):notFound()}catch(e){return failed(e)}}
