import {identity,db,failed,sameOrigin,runtime} from '@/lib/server';
import {getPrefs,setPrefs,parsePatch,publicPrefs,visibleCategories} from '@/lib/notify/prefs';
const H={headers:{'Cache-Control':'private, no-store'}};
// Volba kanálů po kategoriích (Push / E-mail / V aplikaci). GET vrací jen kategorie, které uživatel vidí (Laboratoř jen vlastník), a adresu pro e-maily.
export async function GET(req:Request){try{const u=await identity(req),p=await getPrefs(db(),u.id);
 return Response.json({prefs:publicPrefs(p,u.owner),categories:visibleCategories(u.owner),email:u.email,owner:u.owner,vapidPublic:runtime().VAPID_PUBLIC_KEY||null},H)}catch(e){return failed(e)}}
// PUT {prefs:{alerts:{push:false}}} – jen změněné kanály
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json().catch(()=>null) as {prefs?:unknown}|null;
 const patch=parsePatch(b?.prefs,u.owner),p=await setPrefs(db(),u.id,patch);
 return Response.json({prefs:publicPrefs(p,u.owner)},H)}catch(e){return failed(e)}}
