// Laboratoř · Populace agentů – statistiky žebříčku a markdown report pro týdenního AI analytika (čisté funkce, testy scripts/check-lab-agents.mjs).
// Report čte jen Claude v scripts/lab-analyst.py (smí číst jedině tento soubor) a jde i do „Shrnutí pro AI“ (zkrácený).
import {paperStats,maxDrawdownPct,signed,fmtCzk,type PaperTrade,type PaperEquityPoint,type PaperStats,type VariantId} from './paper.ts';
import {fitnessOf,genomeText,canKill,MIN_TRADES_TO_KILL,type Genome} from './agents.ts';
import {knownKey,type KnownCombo} from './known-grid.ts';

const WEEK=7*86400000;
const r2=(v:number|null|undefined)=>v===null||v===undefined?'–':signed(v,2)+' R';
const iso=(t:number|null)=>t===null?'–':new Date(t).toISOString().slice(0,16).replace('T',' ');
export type AgentMetaIn={gen:number;parent:string|null;origin:string};
export type AgentRow={id:string;active:boolean;genome:Genome;meta:AgentMetaIn;started:number;rulesVersion:string;stats:PaperStats;weekR:number;weekTrades:number;weekPnl:number;
 fitness:number;learning:boolean;killable:boolean;equity:PaperEquityPoint[]};
// jeden agent: uzavřené obchody, týdenní R (obchody uzavřené za posledních 7 dní), týdenní P&L z křivky, fitness
export function agentRow(x:{id:string;active:boolean;genome:Genome;meta:AgentMetaIn;started:number;rulesVersion:string;startEquity:number;trades:PaperTrade[];equity:PaperEquityPoint[];openPnl:number},now:number):AgentRow{
 const stats=paperStats(x.trades,x.startEquity,x.openPnl,x.equity);
 const week=x.trades.filter(t=>t.closed!==null&&t.closed>now-WEEK&&t.closed<=now);
 const weekR=Math.round(week.reduce((s,t)=>s+(t.r??0),0)*1000)/1000;
 const before=x.equity.filter(p=>p.t<=now-WEEK).sort((a,b)=>a.t-b.t),weekStart=before.length?before[before.length-1].equity:x.startEquity;
 const ws={trades:stats.trades,weekR,avgR:stats.avgR,maxDdPct:stats.maxDrawdownPct};
 return {id:x.id,active:x.active,genome:x.genome,meta:x.meta,started:x.started,rulesVersion:x.rulesVersion,stats,weekR,weekTrades:week.length,weekPnl:Math.round((stats.equity-weekStart)*100)/100,
  fitness:fitnessOf(ws),learning:stats.trades<MIN_TRADES_TO_KILL,killable:canKill(ws),equity:x.equity};
}
export const rankAgents=(rows:AgentRow[])=>[...rows].sort((a,b)=>Number(b.active)-Number(a.active)||b.fitness-a.fitness||a.id.localeCompare(b.id));
export {maxDrawdownPct};

export type EvolutionRow={gen:number;at:number;agent:string;parent:string|null;genome:Genome|null;action:string;reason:string;fitness:number|null};
export type KnownSumIn={family:string;label:string;skipped:string|null;key:string|null;robust:boolean;beatsChance:boolean;isAvg:number|null;oosAvg:number|null;oosN:number;oosPf:number|null;oosDd:number;chance:number|null};
export type VariantSumIn={id:VariantId|string;name:string;stats:PaperStats;started:number|null};
export type ReportInput={now:number;agents:AgentRow[];trades:Record<string,PaperTrade[]>;evolution:EvolutionRow[];
 known:{created:string;rows:KnownSumIn[]}|null;sweep:{created:string;robust:number;chance:number|null;top:{key:string;oosAvg:number|null;oosN:number|null}[]}|null;
 variants:VariantSumIn[];open:(PaperTrade&{variant?:string;mark?:{r:number;pnlCzk:number}|null})[]};
const clip=(s:string,n=420)=>s.replace(/\s+/g,' ').trim().slice(0,n);
// markdown report pro analytika: statistiky agentů, nejlepší/nejhorší obchody s „proč“, evoluce, sweep a známé strategie, A–D/S, otevřené pozice
export function buildAgentReport(x:ReportInput):string{
 const out:string[]=[`# Týdenní podklady pro analýzu agentů – ${iso(x.now)} UTC`,'',
  'Data jsou z papírového obchodování (virtuální účty 100 000 Kč, P&L = R × riziko). Malé vzorky: < 30 obchodů je statisticky slabé, < 8 = agent se teprve učí.',''];
 const rows=rankAgents(x.agents),act=rows.filter(a=>a.active),arch=rows.filter(a=>!a.active);
 out.push(`## Žebříček aktivních agentů (${act.length})`,'','| # | agent | gen | rodič | týden R | týden Kč | obch. celkem | win % | průměr R | celkem R | DD % | fitness | genom |','|---|---|---|---|---|---|---|---|---|---|---|---|---|');
 act.forEach((a,i)=>out.push(`| ${i+1} | ${a.id}${a.learning?' (učí se)':''} | ${a.meta.gen} | ${a.meta.parent??'–'} | ${signed(a.weekR,2)} | ${fmtCzk(a.weekPnl)} | ${a.stats.trades} | ${a.stats.winRate??'–'} | ${a.stats.avgR??'–'} | ${a.stats.totalR} | ${a.stats.maxDrawdownPct} | ${a.fitness} | ${genomeText(a.genome)} |`));
 out.push('',`Fitness = týden R + 0,5 × průměr R × √obchodů − 0,2 × (DD % nad 5 %). Agent s < ${MIN_TRADES_TO_KILL} obchody se nevyřazuje.`,'');
 if(arch.length){out.push(`## Archivovaní agenti (${arch.length})`,'');for(const a of arch)out.push(`- ${a.id} (gen ${a.meta.gen}, rodič ${a.meta.parent??'–'}): ${a.stats.trades} obch., průměr ${r2(a.stats.avgR)}, celkem ${r2(a.stats.totalR)} – ${genomeText(a.genome)}`);out.push('')}
 out.push('## Nejlepší a nejhorší obchody agentů (posledních 30 dní)','');
 const recent=Object.entries(x.trades).flatMap(([v,ts])=>ts.filter(t=>t.closed!==null&&t.closed>x.now-30*86400000).map(t=>({...t,v})));
 const byR=[...recent].sort((a,b)=>(b.r??0)-(a.r??0)||a.id.localeCompare(b.id));
 const show=(t:typeof recent[number])=>out.push(`### ${t.v} · ${t.instrument} ${t.direction} · ${r2(t.r)} · ${t.exitReason??'?'} · ${iso(t.opened)} → ${iso(t.closed)}`,`Proč: ${clip(t.why)}`,`Výsledek: ${clip(t.resultNote??'')}`,'');
 if(!byR.length)out.push('_Zatím žádné uzavřené obchody._','');
 byR.slice(0,5).forEach(show);if(byR.length>5){out.push('— nejhorší —','');byR.slice(-5).reverse().forEach(show)}
 out.push('## Evoluce (posledních 60 záznamů)','');
 if(!x.evolution.length)out.push('_Zatím žádná evoluce._','');
 for(const e of x.evolution.slice(0,60))out.push(`- gen ${e.gen} · ${iso(e.at)} · ${e.action} ${e.agent}${e.parent?' (rodič '+e.parent+')':''}${e.fitness!==null?' · fitness '+e.fitness:''}: ${clip(e.reason,300)}`);
 out.push('','## Známé strategie (historie, IS 2015–2022 / OOS 2023–dnes)','');
 if(!x.known)out.push('_Test ještě neproběhl (scripts/lab-known.mjs)._','');
 else{out.push(`Spočítáno ${x.known.created}.`,'','| strategie | nejlepší parametry | IS R | OOS R | OOS obch. | OOS PF | OOS DD R | náhoda R | robustní | nad náhodou |','|---|---|---|---|---|---|---|---|---|---|');
  for(const k of x.known.rows){let key='–';try{key=k.key?knownKey(JSON.parse(k.key) as KnownCombo):'–'}catch{}
   out.push(k.skipped?`| ${k.label} | ${k.skipped} | | | | | | | | |`:`| ${k.label} | ${key} | ${k.isAvg??'–'} | ${k.oosAvg??'–'} | ${k.oosN} | ${k.oosPf??'–'} | ${k.oosDd} | ${k.chance??'–'} | ${k.robust?'ano':'ne'} | ${k.beatsChance?'ano':'ne'} |`)}out.push('')}
 out.push('## Hledání prahů (sweep technického kompozitu)','');
 if(!x.sweep)out.push('_Sweep ještě neproběhl._','');
 else{out.push(`Spočítáno ${x.sweep.created}: robustních ${x.sweep.robust}, hranice náhody ${x.sweep.chance??'–'} R.`);for(const t of x.sweep.top)out.push(`- ${t.key}: OOS ${t.oosN} obch., ${r2(t.oosAvg)}`);out.push('')}
 out.push('## Varianty simulace A–D a S… (srovnání)','','| varianta | od | obch. | win % | průměr R | celkem R | výnos % | DD % |','|---|---|---|---|---|---|---|---|');
 for(const v of x.variants)out.push(`| ${v.id} – ${v.name} | ${v.started===null?'neběží':iso(v.started).slice(0,10)} | ${v.stats.trades} | ${v.stats.winRate??'–'} | ${v.stats.avgR??'–'} | ${v.stats.totalR} | ${v.stats.returnPct} | ${v.stats.maxDrawdownPct} |`);
 out.push('',`## Otevřené pozice (${x.open.length})`,'');
 if(!x.open.length)out.push('_Žádné._');
 for(const t of x.open)out.push(`- ${t.variant??'A'} · ${t.instrument} ${t.direction} od ${iso(t.opened)}${t.mark?` → ${r2(t.mark.r)} / ${fmtCzk(t.mark.pnlCzk)}`:''}: ${clip(t.why,200)}`);
 return out.join('\n').trim()+'\n';
}
// krátký blok do „Shrnutí pro AI“
export function agentsSummaryMd(agents:AgentRow[],evolution:EvolutionRow[]):string{
 if(!agents.length)return '';
 const rows=rankAgents(agents).filter(a=>a.active);
 const out=['## Populace agentů (paper trading)','',...rows.map((a,i)=>`${i+1}. ${a.id} (gen ${a.meta.gen}${a.meta.parent?', rodič '+a.meta.parent:''}) fitness ${a.fitness}, týden ${signed(a.weekR,2)} R, ${a.stats.trades} obch., průměr ${r2(a.stats.avgR)}, DD ${a.stats.maxDrawdownPct} % – ${genomeText(a.genome)}`),''];
 const arch=agents.filter(a=>!a.active).length;if(arch)out.push(`Archivovaných agentů: ${arch}.`,'');
 if(evolution.length)out.push('Poslední změny populace:',...evolution.filter(e=>e.action!=='evaluate').slice(0,10).map(e=>`- gen ${e.gen} ${e.action} ${e.agent}: ${clip(e.reason,200)}`),'');
 return out.join('\n');
}

// ---- týdenní AI analytik (scripts/lab-analyst.py): název poznámky a krátký verdikt do mailu
export const analysisTitle=(now:number)=>`Týdenní analýza agentů ${new Date(now).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'})}`;
// verdikt = řádek „Verdikt: …“ (i tučně / jako nadpis), jinak první odstavec textu; nejvýš 600 znaků
export function analysisVerdict(md:string):string{
 const lines=md.split(/\r?\n/).map(l=>l.trim());
 const i=lines.findIndex(l=>/^(?:#+\s*)?(?:\*\*)?verdikt/i.test(l));
 let v='';
 if(i>=0){v=lines[i].replace(/^(?:#+\s*)?(?:\*\*)?verdikt(?:\*\*)?\s*:?\s*(?:\*\*)?\s*/i,'');if(!v)v=lines.slice(i+1).find(l=>l&&!l.startsWith('#'))??''}
 if(!v)v=lines.find(l=>l&&!l.startsWith('#'))??'';
 v=v.replace(/\*\*/g,'').trim();
 return v.length>600?v.slice(0,597)+'…':v;
}
