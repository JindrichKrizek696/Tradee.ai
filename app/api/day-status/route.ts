import {identity,db,failed,sameOrigin} from '@/lib/server';
import {listDays,setDay} from '@/lib/strategy/store';
import {isDay,isDayStatus} from '@/lib/strategy/scenario';
const headers={'Cache-Control':'private, no-store'};
// Stav dne (čekám / vynechávám / pauza) jako legitimní výsledek deníku. GET ?from&to (YYYY-MM-DD), PUT {day, status|null, note}
export async function GET(req:Request){try{const u=await identity(req),q=new URL(req.url).searchParams,from=q.get('from'),to=q.get('to');
 return Response.json({days:await listDays(db(),u.id,isDay(from)?from:null,isDay(to)?to:null)},{headers})}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json() as {day?:unknown;status?:unknown;note?:unknown};
 if(!isDay(b?.day))throw Error('Neplatný den.');
 if(b.status!==null&&!isDayStatus(b.status))throw Error('Neznámý stav dne.');
 const note=typeof b.note==='string'?b.note.trim():'';if(note.length>500)throw Error('Poznámka může mít nejvýš 500 znaků.');
 await setDay(db(),u.id,b.day,b.status,note);return Response.json({ok:true},{headers})}catch(e){return failed(e)}}
