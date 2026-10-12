// Laboratoř · rychlý test pravidla (jen vlastník): signály Laboratoře + backtest engine na D1.
import {db,sameOrigin} from '@/lib/server';
import {labUser,labFailed,LAB_HEADERS} from '@/lib/lab/http';
import {normalizeLabRule,labRuleIssues} from '@/lib/lab/rules';
import {testRule} from '@/lib/lab/run';
import {cotSource,scoreSnaps} from '@/lib/lab/sources';
import {saveRule,refreshSummary} from '@/lib/lab/store';
import {instruments} from '@/lib/markets';
const known=new Set(instruments.map(i=>i.id));let running=false;
export async function POST(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;sameOrigin(req);const d=db();
 const b=await req.json().catch(()=>({})) as {rule?:unknown;id?:unknown;name?:unknown};
 const rule=normalizeLabRule(b.rule,known),issues=labRuleIssues(rule);if(issues.length)throw Error(issues.join(' '));
 if(running)return Response.json({error:'Test už běží, počkej na výsledek.'},{status:429,headers:LAB_HEADERS});
 running=true;
 try{
  const [{cot,note},snaps]=await Promise.all([cotSource(d),scoreSnaps(d,rule.markets)]);
  const res=await testRule(d,rule,cot,snaps);
  if(rule.conds.some(c=>c.type==='cot')||rule.direction==='cot')res.warnings.push(note);
  // u uloženého pravidla si zapamatuj poslední výsledek (pro Shrnutí pro AI)
  if(typeof b.id==='string'&&b.id&&typeof b.name==='string'&&b.name.trim()){
   try{await saveRule(d,u.id,b.id,b.name.trim().slice(0,120),rule,{...res.summary,at:new Date().toISOString()});await refreshSummary(d,u.id)}catch(e){console.error(e)}
  }
  return Response.json({rule,...res},{headers:LAB_HEADERS});
 }finally{running=false}
}catch(e){return labFailed(e)}}
