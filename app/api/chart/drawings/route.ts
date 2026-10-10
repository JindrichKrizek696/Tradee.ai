import {identity,db,failed,sameOrigin} from '@/lib/server';
import {instruments} from '@/lib/markets';
import {parseDrawings} from '@/lib/chart/drawings';
import {loadDrawings,saveDrawings} from '@/lib/chart/drawings-store';
const NO_STORE={'Cache-Control':'private, no-store'};
const bad=(error:string)=>Response.json({error},{status:400,headers:NO_STORE});
const instrumentOf=(req:Request)=>{const i=new URL(req.url).searchParams.get('instrument')||'';return instruments.some(x=>x.id===i)?i:null};
export async function GET(req:Request){
 try{
  const u=await identity(req),instrument=instrumentOf(req);
  if(!instrument)return bad('Neplatný trh.');
  return Response.json({drawings:await loadDrawings(db(),u.id,instrument)},{headers:NO_STORE});
 }catch(e){return failed(e)}
}
export async function PUT(req:Request){
 try{
  sameOrigin(req);const u=await identity(req),instrument=instrumentOf(req);
  if(!instrument)return bad('Neplatný trh.');
  const text=await req.text();if(text.length>400000)return bad('Kreseb je příliš mnoho.');
  let body:unknown;try{body=JSON.parse(text)}catch{return bad('Neplatná data kreseb.')}
  const r=parseDrawings((body as {drawings?:unknown}|null)?.drawings);
  if(!r.ok)return bad(r.error);
  await saveDrawings(db(),u.id,instrument,r.drawings,Date.now());
  return Response.json({ok:true,count:r.drawings.length},{headers:NO_STORE});
 }catch(e){return failed(e)}
}
