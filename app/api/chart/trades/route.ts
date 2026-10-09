import {identity,db,failed} from '@/lib/server';
import {instruments} from '@/lib/markets';
import {chartTrades} from '@/lib/chart/trades';
export async function GET(req:Request){
 try{
  const u=await identity(req),instrument=new URL(req.url).searchParams.get('instrument')||'';
  if(!instruments.some(i=>i.id===instrument))return Response.json({error:'Neplatný trh.'},{status:400,headers:{'Cache-Control':'no-store'}});
  return Response.json({trades:await chartTrades(db(),u.id,instrument)},{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return failed(e)}
}
