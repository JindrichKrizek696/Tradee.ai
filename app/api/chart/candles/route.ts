import {identity,db,failed} from '@/lib/server';
import {instruments} from '@/lib/markets';
import {TFS,type Tf} from '@/lib/chart/candles';
import {getCandles} from '@/lib/chart/store';
export async function GET(req:Request){
 try{
  await identity(req);
  const u=new URL(req.url),instrument=u.searchParams.get('instrument')||'',tf=u.searchParams.get('tf')||'';
  if(!instruments.some(i=>i.id===instrument)||!TFS.includes(tf as Tf))return Response.json({error:'Neplatný trh nebo časový rámec.'},{status:400,headers:{'Cache-Control':'no-store'}});
  return Response.json(await getCandles(db(),instrument,tf as Tf,Date.now()),{headers:{'Cache-Control':'private, max-age=60'}});
 }catch(e){return failed(e)}
}
