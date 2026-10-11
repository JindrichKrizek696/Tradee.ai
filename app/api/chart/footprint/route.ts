import {identity,db,failed} from '@/lib/server';
import {fpSymbol,isFpTf} from '@/lib/chart/footprint';
import {getFootprint} from '@/lib/chart/footprint-store';
// Footprint krypta (Binance): GET ?instrument=BTC-USD&tf=M5|M15|H1
export async function GET(req:Request){
 try{
  await identity(req);
  const u=new URL(req.url),instrument=u.searchParams.get('instrument')||'',tf=u.searchParams.get('tf')||'';
  if(!fpSymbol(instrument)||!isFpTf(tf))return Response.json({error:'Footprint je jen pro BTC, ETH a SOL na M5, M15 nebo H1.'},{status:400,headers:{'Cache-Control':'no-store'}});
  return Response.json(await getFootprint(db(),instrument,tf,Date.now()),{headers:{'Cache-Control':'private, max-age=30'}});
 }catch(e){return failed(e)}
}
