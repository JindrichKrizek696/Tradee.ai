import {identity,db,failed,sameOrigin} from '@/lib/server';
import {getPrefs,setPrefs} from '@/lib/calendar-hist-store';
const headers={'Cache-Control':'private, no-store'};
// Filtry kalendáře uživatele (dopad, jen moje trhy/pozice, události jen z FF): GET → {prefs|null}; PUT {prefs} → uložené (normalizované)
export async function GET(req:Request){try{const u=await identity(req);return Response.json({prefs:await getPrefs(db(),u.id).catch(()=>null)},{headers})}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req);
 if(Number(req.headers.get('content-length')||0)>5_000)throw Error('Filtry jsou příliš velké.');
 const b=await req.json() as {prefs?:unknown};return Response.json({prefs:await setPrefs(db(),u.id,b?.prefs)},{headers})}catch(e){return failed(e)}}
