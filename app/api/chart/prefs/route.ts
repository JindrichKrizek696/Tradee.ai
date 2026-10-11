import {identity,db,failed,sameOrigin} from '@/lib/server';
import {normalizePrefs} from '@/lib/chart/drawings';
import {loadPrefs,savePrefs} from '@/lib/chart/prefs-store';
const NO_STORE={'Cache-Control':'private, no-store'};
const bad=(error:string)=>Response.json({error},{status:400,headers:NO_STORE});
// presety a výchozí vzhled nástrojů kreslení (a vlastní barvy) přihlášeného uživatele
export async function GET(req:Request){
 try{const u=await identity(req);return Response.json({prefs:await loadPrefs(db(),u.id)},{headers:NO_STORE})}catch(e){return failed(e)}
}
// PUT: poslané klíče (presets, defaults, …) nahradí uložené, ostatní zůstanou
export async function PUT(req:Request){
 try{
  sameOrigin(req);const u=await identity(req);
  const text=await req.text();if(text.length>300000)return bad('Nastavení kreslení je příliš velké.');
  let body:unknown;try{body=JSON.parse(text)}catch{return bad('Neplatná data.')}
  const r=normalizePrefs((body as {prefs?:unknown}|null)?.prefs);
  if(!r.ok)return bad(r.error);
  const d=db(),prefs={...await loadPrefs(d,u.id),...r.prefs};
  await savePrefs(d,u.id,prefs,Date.now());
  return Response.json({ok:true,prefs},{headers:NO_STORE});
 }catch(e){return failed(e)}
}
