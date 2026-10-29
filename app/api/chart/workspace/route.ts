import {identity,db,failed,sameOrigin} from '@/lib/server';
import {instruments} from '@/lib/markets';
import {validateWorkspace} from '@/lib/chart/workspace';
import {loadWorkspace,saveWorkspace,loadLayouts} from '@/lib/chart/workspace-store';
const NO_STORE={'Cache-Control':'private, no-store'},ids=instruments.filter(i=>i.group!=='currency').map(i=>i.id);
const bad=(error:string)=>Response.json({error},{status:400,headers:NO_STORE});
// pracovní plocha grafu přihlášeného: záložky (otevřené i nedávno zavřené se snímkem kreseb) a rozvržení
export async function GET(req:Request){
 try{const u=await identity(req),d=db();const [workspace,layouts]=await Promise.all([loadWorkspace(d,u.id,ids),loadLayouts(d,u.id)]);return Response.json({workspace,layouts},{headers:NO_STORE})}catch(e){return failed(e)}
}
// PUT: celá sada záložek nahradí uloženou (autosave)
export async function PUT(req:Request){
 try{
  sameOrigin(req);const u=await identity(req);
  const text=await req.text();if(text.length>3000000)return bad('Pracovní plocha je příliš velká.');
  let body:unknown;try{body=JSON.parse(text)}catch{return bad('Neplatná data.')}
  const r=validateWorkspace((body as {workspace?:unknown}|null)?.workspace,ids);if(!r.ok)return bad(r.error);
  await saveWorkspace(db(),u.id,r.v,Date.now());
  return Response.json({ok:true},{headers:NO_STORE});
 }catch(e){return failed(e)}
}
