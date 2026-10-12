// Laboratoř · „Předpovídá to cenu?“: studie signálů na požádání (jen vlastník), cache v paměti 6 h + poslední výsledek v lab_studies.
import {db} from '@/lib/server';
import {labUser,labFailed,LAB_HEADERS} from '@/lib/lab/http';
import {parseStudyParams,computeStudy} from '@/lib/lab/run';
import {cotSource,scoreSnaps} from '@/lib/lab/sources';
import {saveStudy,latestStudy,refreshSummary} from '@/lib/lab/store';
import {STUDY_SETS} from '@/lib/lab/run';
import type {StudyResult} from '@/lib/lab/study';
const cache=new Map<string,{until:number;result:StudyResult}>(),TTL=6*3600000;let running=false;
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const q=new URL(req.url).searchParams;
 if(q.get('latest')==='1'){const s=await latestStudy(d,u.id).catch(()=>null);return Response.json({study:s?.result??null,params:s?.params??null},{headers:LAB_HEADERS})}
 const p=parseStudyParams(req.url),key=JSON.stringify(p),hit=cache.get(key);
 if(hit&&hit.until>Date.now()&&q.get('fresh')!=='1')return Response.json({study:hit.result,params:p,cached:true},{headers:LAB_HEADERS});
 if(running)return Response.json({error:'Studie se právě počítá, zkus to za chvíli.'},{status:429,headers:LAB_HEADERS});
 running=true;
 try{
  const [{cot,note},snaps]=await Promise.all([cotSource(d),scoreSnaps(d,STUDY_SETS[p.set].markets)]);
  const result=await computeStudy(d,p,cot,snaps);result.notes.push(note);
  cache.set(key,{until:Date.now()+TTL,result});
  try{await saveStudy(d,u.id,p,result);await refreshSummary(d,u.id)}catch(e){console.error(e)} // bez migrace se jen neuloží
  return Response.json({study:result,params:p,cached:false},{headers:LAB_HEADERS});
 }finally{running=false}
}catch(e){return labFailed(e)}}
