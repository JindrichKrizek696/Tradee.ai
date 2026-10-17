// Laboratoř · Známé strategie (jen vlastník, lab_known). GET = poslední výsledek (nebo ?id=) + seznam posledních 10 – bez vedlejších efektů.
// Výpočet běží mimo web (scripts/lab-known.mjs na VPS).
import {db} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {getKnown,listKnown} from '@/lib/lab/known-store';
const ID=/^[0-9a-f-]{36}$/;
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const id=new URL(req.url).searchParams.get('id');
 if(id!==null&&!ID.test(id))return labNotFound();
 const [known,list]=await Promise.all([getKnown(d,u.id,id),listKnown(d,u.id)]);
 if(id!==null&&!known)return labNotFound();
 return Response.json({known,list},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
