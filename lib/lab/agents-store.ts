// Laboratoř · Populace agentů – databáze. Agenti = účty lab_paper_accounts s variantou G01… (pravidla = genom, neměnná),
// změny populace v lab_evolution (migrace 0030). Volá se z /api/laborator/agents za labGate a ze scripts/lab-evolve.mjs, lab-agents-report.mjs.
// Všechny dotazy filtrují user_id vlastníka. Nic se tu nemaže: vyřazení = active 0 (archiv s plnou historií).
import type {Db} from '../mysql.ts';
import {agentVariant,isAgentVariant,isVoid,type PaperTrade,type VariantId} from './paper.ts';
import {listAccounts,listTrades,equitySeries,withMarks,addLog,rulesJson,toSql,fromSql,type Quotes,type PaperAccount,type AgentMeta} from './paper-store.ts';
import {validateGenome,genomeText,type Genome} from './agents.ts';
import {agentRow,type AgentRow,type EvolutionRow} from './agents-report.ts';

const json=<T,>(s:unknown,def:T):T=>{if(typeof s!=='string'||!s)return def;try{return JSON.parse(s) as T}catch{return def}};
export const ANALYSIS_TITLE='Týdenní analýza agentů';

// nový agent (start = teď, obchoduje od dalšího běhu). Existující id se NIKDY nepřepíše (INSERT IGNORE + kontrola) → pravidla jsou neměnná.
export async function createAgent(d:Db,uid:string,now:number,id:string,genome:Genome,meta:AgentMeta&{reason:string}){
 if(!isAgentVariant(id))throw Error('Neplatné id agenta.');
 const v=validateGenome(genome);if(!v.ok)throw Error('Neplatný genom: '+v.error);
 const V=agentVariant(id as VariantId,v.genome),m:AgentMeta={gen:meta.gen,parent:meta.parent,origin:meta.origin};
 const r=await d.prepare('INSERT IGNORE INTO lab_paper_accounts(user_id,variant,start_equity,started,rules_version,rules,active,updated) VALUES(?,?,?,?,?,?,1,?)')
  .bind(uid,id,V.rules.startEquity,toSql(now),V.rulesVersion,rulesJson(V,undefined,m),toSql(now)).run();
 if(!r.meta.changes)throw Error(`Agent ${id} už existuje – pravidla existujícího agenta se nemění.`);
 await addLog(d,uid,now,`Start agenta ${id} (gen ${meta.gen}${meta.parent?', rodič '+meta.parent:''}): ${genomeText(v.genome)}. Důvod: ${meta.reason}`,id as VariantId);
 await logEvolution(d,uid,{gen:meta.gen,at:now,agent:id,parent:meta.parent,genome:v.genome,action:meta.parent?'clone':'seed',reason:meta.reason,fitness:null});
}
// archivace: jen active = 0 (pravidla, obchody, křivka i deník zůstanou; otevřené pozice runner jen dobíhá)
export async function retireAgent(d:Db,uid:string,now:number,id:string,o:{gen:number;genome:Genome;reason:string;fitness:number|null}){
 if(!isAgentVariant(id))throw Error('Neplatné id agenta.');
 const r=await d.prepare('UPDATE lab_paper_accounts SET active=0,updated=? WHERE user_id=? AND variant=? AND active=1').bind(toSql(now),uid,id).run();
 if(!r.meta.changes)return false;
 await addLog(d,uid,now,`Agent ${id} archivován: ${o.reason}`,id as VariantId);
 await logEvolution(d,uid,{gen:o.gen,at:now,agent:id,parent:null,genome:o.genome,action:'retire',reason:o.reason,fitness:o.fitness});
 return true;
}
export async function logEvolution(d:Db,uid:string,e:{gen:number;at:number;agent:string;parent:string|null;genome:Genome|null;action:string;reason:string;fitness:number|null}){
 await d.prepare('INSERT INTO lab_evolution(user_id,gen,at,agent,parent,genome,action,reason,fitness) VALUES(?,?,?,?,?,?,?,?,?)')
  .bind(uid,e.gen,toSql(e.at),e.agent,e.parent,JSON.stringify(e.genome),e.action,e.reason.slice(0,4000),e.fitness).run();
}
export async function listEvolution(d:Db,uid:string,limit=300):Promise<EvolutionRow[]>{
 return (await d.prepare('SELECT gen,at,agent,parent,genome,action,reason,fitness FROM lab_evolution WHERE user_id=? ORDER BY at DESC,id DESC LIMIT '+Math.max(1,Math.min(2000,Math.floor(limit)))).bind(uid)
  .all<{gen:number;at:string;agent:string;parent:string|null;genome:string;action:string;reason:string;fitness:number|null}>()).results
  .map(r=>{const g=validateGenome(json(r.genome,null));return {gen:Number(r.gen),at:fromSql(r.at)!,agent:r.agent,parent:r.parent,genome:g.ok?g.genome:null,action:r.action,reason:r.reason,fitness:r.fitness===null?null:Number(r.fitness)}});
}
export async function lastGeneration(d:Db,uid:string):Promise<{gen:number;at:number|null}>{
 const r=await d.prepare("SELECT MAX(gen) g,MAX(at) a FROM lab_evolution WHERE user_id=? AND action='evaluate'").bind(uid).first<{g:number|null;a:string|null}>();
 return {gen:r?.g===null||r?.g===undefined?0:Number(r.g),at:fromSql(r?.a??null)};
}
export const agentAccounts=(accs:PaperAccount[])=>accs.filter(a=>isAgentVariant(a.variant)&&a.agent);
// žebříček: všichni agenti (aktivní i archiv) se statistikami a křivkou
export async function agentsData(d:Db,uid:string,quotes:Quotes,now:number){
 const [accs,trades,equity]=await Promise.all([listAccounts(d,uid),listTrades(d,uid),equitySeries(d,uid)]);
 const agents=agentAccounts(accs),tradesOf:Record<string,PaperTrade[]>={};
 const rows:AgentRow[]=agents.map(a=>{
  const mine=trades.filter(t=>t.variant===a.variant),marked=withMarks(mine,quotes);tradesOf[a.variant]=mine;
  const openPnl=marked.filter(t=>t.closed===null&&!isVoid(t)).reduce((s,t)=>s+(t.mark?.pnlCzk??0),0);
  return agentRow({id:a.variant,active:a.active,genome:a.agent!.genome,meta:{gen:a.agent!.meta.gen,parent:a.agent!.meta.parent,origin:a.agent!.meta.origin},started:a.started,rulesVersion:a.rulesVersion,startEquity:a.startEquity,
   trades:mine,equity:equity.filter(p=>p.variant===a.variant).map(({t,equity})=>({t,equity})),openPnl},now);
 });
 const bench=equity.filter(p=>p.variant==='A').map(({t,equity})=>({t,equity})),benchAcc=accs.find(a=>a.variant==='A')??null;
 const open=withMarks(trades.filter(t=>t.closed===null&&!isVoid(t)&&isAgentVariant(t.variant)),quotes);
 return {rows,tradesOf,bench,benchStart:benchAcc?.started??null,open,accounts:accs,allTrades:trades};
}
// poslední poznámka analytika (lab_notes „Týdenní analýza agentů …“)
export async function latestAnalysis(d:Db,uid:string){
 const r=await d.prepare('SELECT id,title,body,updated FROM lab_notes WHERE user_id=? AND title LIKE ? ORDER BY created DESC LIMIT 1').bind(uid,ANALYSIS_TITLE+'%').first<{id:string;title:string;body:string;updated:string}>();
 return r?{id:r.id,title:r.title,body:r.body,updated:String(r.updated)}:null;
}
