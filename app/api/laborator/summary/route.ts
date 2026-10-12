// Laboratoř · Shrnutí pro AI (jen vlastník): markdown poznámek, pravidel a poslední studie; zároveň se uloží do lab_summary.
import {db} from '@/lib/server';
import {labUser,labFailed,LAB_HEADERS} from '@/lib/lab/http';
import {refreshSummary} from '@/lib/lab/store';
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;
 return Response.json(await refreshSummary(db(),u.id),{headers:LAB_HEADERS})}catch(e){return labFailed(e)}}
