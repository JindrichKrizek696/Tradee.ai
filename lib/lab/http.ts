// Vstup do /api/laborator/*: jen vlastník, jinak 404 (viz lib/lab/access.ts). Nepřihlášený i chyba session = 404.
import {currentUser,failed,type User} from '../server.ts';
import {labGate,labNotFound,LAB_HEADERS} from './access.ts';
import {isMissingLabTable,LAB_MISSING} from './core.ts';
export {LAB_HEADERS,labNotFound};
export async function labUser(req:Request):Promise<User|Response>{
 const u=await currentUser(req).catch(()=>null);
 return labGate(u,req.url);
}
export function labFailed(e:unknown){
 if(isMissingLabTable(e))return Response.json({error:LAB_MISSING,missing:true},{status:503,headers:LAB_HEADERS});
 return failed(e);
}
