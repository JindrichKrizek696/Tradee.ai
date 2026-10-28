// Laboratoř (jen vlastník): ověření přístupu pro stránku /laborator + číselníky. Ostatní → 404.
import {labUser,LAB_HEADERS} from '@/lib/lab/http';
import {instruments} from '@/lib/markets';
import {STUDY_SETS,SCORE_METHODS} from '@/lib/lab/run';
export async function GET(req:Request){const u=await labUser(req);if(u instanceof Response)return u;
 return Response.json({ok:true,name:u.name,markets:instruments.filter(i=>i.model&&['fx','commodities','index','currency'].includes(i.group)).map(i=>({id:i.id,name:i.name,group:i.group})),
  sets:Object.entries(STUDY_SETS).map(([id,s])=>({id,label:s.label})),methods:Object.entries(SCORE_METHODS).map(([id,s])=>({id,label:s.label}))},{headers:LAB_HEADERS})}
