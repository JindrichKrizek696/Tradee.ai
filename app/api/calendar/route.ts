import {identity,db,failed} from '@/lib/server';
import {histBetween,revisionsFor,feedStatus} from '@/lib/calendar-hist-store';
const headers={'Cache-Control':'private, no-store'},DAY=86400000;
// Historie kalendáře pro okno: GET ?from=<ms>&to=<ms> (nejvýš 400 dní) → události s plánovaným/skutečným časem, odvozenou skutečností,
// změny (posun času, odhad, revize) a stav zdroje ForexFactory. Před migrací 0040 vrací prázdný výsledek s available:false.
export async function GET(req:Request){try{await identity(req);const q=new URL(req.url).searchParams,now=Date.now();
 const to=Number(q.get('to'))||now+14*DAY,from=Math.max(Number(q.get('from'))||now-14*DAY,to-400*DAY);
 try{
  const d=db(),events=await histBetween(d,from,to,8000),changes=await revisionsFor(d,events.map(e=>e.id));
  return Response.json({available:true,events,changes,status:await feedStatus(d)},{headers});
 }catch(e){if(e instanceof Error&&/ER_NO_SUCH_TABLE|doesn't exist/i.test(e.message))return Response.json({available:false,events:[],changes:[],status:null},{headers});throw e}
}catch(e){return failed(e)}}
