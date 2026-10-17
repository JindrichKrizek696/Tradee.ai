// Laboratoř · Populace agentů (jen vlastník; lab_paper_* s variantou G…, lab_evolution). GET = žebříček, křivky top 5 + benchmark A,
// genomy, evoluce, archiv a poslední analýza AI; ?agent=G01 = obchody a deník jednoho agenta. Jen čtení – agenty mění jen týdenní evoluce
// (scripts/lab-evolve.mjs), web žádnou mutaci nemá.
import {db} from '@/lib/server';
import {labUser,labFailed,labNotFound,LAB_HEADERS} from '@/lib/lab/http';
import {agentsData,listEvolution,latestAnalysis} from '@/lib/lab/agents-store';
import {listLog,withMarks} from '@/lib/lab/paper-store';
import {rankAgents} from '@/lib/lab/agents-report';
import {agentVariant,isAgentVariant} from '@/lib/lab/paper';
import {genomeText} from '@/lib/lab/agents';
import {liveQuotes} from '@/lib/live-store';
import {instruments} from '@/lib/markets';
export async function GET(req:Request){try{const u=await labUser(req);if(u instanceof Response)return u;const d=db();
 const agent=new URL(req.url).searchParams.get('agent');
 if(agent!==null&&!isAgentVariant(agent))return labNotFound();
 const now=Date.now(),quotes=(await liveQuotes(d).catch(()=>({quotes:{}}))).quotes;
 const data=await agentsData(d,u.id,quotes,now);
 if(agent!==null){
  const row=data.rows.find(r=>r.id===agent);if(!row)return labNotFound();
  const V=agentVariant(agent,row.genome);
  const trades=withMarks(data.tradesOf[agent]??[],quotes).map(t=>({...t,partsAtEntry:undefined}));
  return Response.json({agent:{...row,text:V.text,rules:V.rules,genomeText:genomeText(row.genome)},trades,log:await listLog(d,u.id,agent,100)},{headers:LAB_HEADERS});
 }
 const [evolution,analysis]=await Promise.all([listEvolution(d,u.id,300),latestAnalysis(d,u.id).catch(()=>null)]);
 const ranked=rankAgents(data.rows),top=ranked.filter(r=>r.active).slice(0,5).map(r=>r.id);
 const rows=ranked.map(({equity,...r})=>({...r,genomeText:genomeText(r.genome),equity:top.includes(r.id)?equity:undefined}));
 return Response.json({now,agents:rows,top,bench:{started:data.benchStart,equity:data.bench},evolution,analysis,
  names:Object.fromEntries(instruments.map(i=>[i.id,i.name]))},{headers:LAB_HEADERS});
}catch(e){return labFailed(e)}}
