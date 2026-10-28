import {identity,db,failed,sameOrigin} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {listNoTrades,createNoTrade,deleteNoTrade,listDays,planEvals} from '@/lib/strategy/store';
import {isDay} from '@/lib/strategy/scenario';
import {instruments} from '@/lib/markets';
const headers={'Cache-Control':'private, no-store'},ids=instruments.map(i=>i.id);
const day0=(s:string|null)=>s&&isDay(s)?s:null;
const ms=(s:string|null,end=false)=>s&&isDay(s)?Date.parse(s+'T00:00:00Z')+(end?864e5:0):null;
// Vynechané obchody a stav dne pro Deník: GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (&plans=1 i snímky plánů obchodů pro dodržování); POST nový; DELETE {id}
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;
 const q=new URL(req.url).searchParams,from=q.get('from'),to=q.get('to'),d=db();
 // hranice dne podle Prahy řeší klient; tady stačí širší okno o den na každou stranu
 const f=ms(from),t=ms(to,true);
 return Response.json({noTrades:await listNoTrades(d,v.userId,f===null?null:f-864e5,t===null?null:t+864e5),days:await listDays(d,v.userId,day0(from),day0(to)),...(q.get('plans')==='1'?{plans:await planEvals(d,v.userId)}:{})},{headers})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 if(Number(req.headers.get('content-length')||0)>100_000)throw Error('Záznam je příliš velký.');
 return Response.json({id:await createNoTrade(db(),u.id,await req.json(),ids)},{headers})}catch(e){return failed(e)}}
export async function DELETE(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {id?:unknown};
 if(typeof b?.id!=='string')throw Error('Chybí záznam.');
 return await deleteNoTrade(db(),u.id,b.id)?Response.json({ok:true},{headers}):Response.json({error:'Záznam nenalezen.'},{status:404,headers})}catch(e){return failed(e)}}
