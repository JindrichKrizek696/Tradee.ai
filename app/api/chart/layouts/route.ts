import {identity,db,failed,sameOrigin} from '@/lib/server';
import {validateLayouts} from '@/lib/chart/workspace';
import {loadLayouts,saveLayouts} from '@/lib/chart/workspace-store';
const NO_STORE={'Cache-Control':'private, no-store'};
const bad=(error:string)=>Response.json({error},{status:400,headers:NO_STORE});
export async function GET(req:Request){try{const u=await identity(req);return Response.json({layouts:await loadLayouts(db(),u.id)},{headers:NO_STORE})}catch(e){return failed(e)}}
// PUT: celý seznam pojmenovaných rozvržení
export async function PUT(req:Request){
 try{
  sameOrigin(req);const u=await identity(req);
  const text=await req.text();if(text.length>400000)return bad('Rozvržení jsou příliš velká.');
  let body:unknown;try{body=JSON.parse(text)}catch{return bad('Neplatná data.')}
  const r=validateLayouts((body as {layouts?:unknown}|null)?.layouts);if(!r.ok)return bad(r.error);
  await saveLayouts(db(),u.id,r.v,Date.now());
  return Response.json({ok:true,layouts:r.v},{headers:NO_STORE});
 }catch(e){return failed(e)}
}
