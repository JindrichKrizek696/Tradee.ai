// Ověření klíče EA z hlavičky Authorization: Bearer tk_…
import {db,hasAccessById} from '../server.ts';
import {isKeyFormat,hashKey} from './keys.ts';
import {keyOwner} from './store.ts';
export const mtJson=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function authKey(req:Request):Promise<{userId:string}|Response>{
 const h=req.headers.get('authorization')||'',key=h.startsWith('Bearer ')?h.slice(7).trim():'';
 if(!isKeyFormat(key))return mtJson({error:'Chybí nebo je neplatný klíč Tradee.'},401);
 const o=await keyOwner(db(),await hashKey(key));
 if(!o)return mtJson({error:'Klíč neexistuje nebo byl zrušen.'},401);
 if(!await hasAccessById(o.userId))return mtJson({error:'Účet Tradee zatím nemá schválený přístup.'},403);
 return {userId:o.userId};
}
