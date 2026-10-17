// Laboratoř · Populace agentů (jen vlastník): 20 papírových agentů G01… s „genomem“ (parametry strategie), týdenní fitness a evoluce.
// Čisté a deterministické funkce (testy scripts/check-lab-agents.mjs). Agent = varianta simulace (lib/lab/paper.ts, kind 'agent'),
// běží každých 15 min ve scripts/lab-paper.mjs; pravidla se po založení NIKDY nemění (rules_version agent-G01-v1, nový genom = nový agent).
// Evoluce (scripts/lab-evolve.mjs, neděle po týdenním souhrnu):
//  • fitness = R za týden + 0,5 × průměr R na obchod × √(počet uzavřených obchodů) − penalizace drawdownu (0,2 za každé % DD nad 5 %),
//  • top 3 (aspoň 8 uzavřených obchodů a fitness > 0) dostanou po jednom potomkovi s malou mutací – jen do volného místa,
//    nebo místo vyřazeného agenta (aspoň 20 obchodů A průměr R < −0,1; nejhorší podle fitness). Agent s < 8 obchody se nikdy nevyřazuje.
//  • vyřazený agent se archivuje (active = 0, obchody i historie zůstanou, jen už neotevírá nové pozice), nikdy se nemaže. Max 20 aktivních.
import {KNOWN_FAMILIES,KNOWN_FAMILY_IDS,familyDef,type KnownFamily,type KnownCombo} from './known-grid.ts';
import {SWEEP_COMMODITIES,SWEEP_INDICES,type SweepCombo} from './sweep-grid.ts';
import {mulberry32} from './sweep.ts';
import {pairs} from '../score-engine.ts';

export type AgentFamily='score'|KnownFamily;
export type AgentEntry='immediate'|'pullback'|'contra';
export type AgentExit='tp'|'signal'|'trail';
export type AgentSet='fx'|'ci'|'all'|'crypto';
export type Genome={family:AgentFamily;v:string;threshold:number;entry:AgentEntry;slAtr:number;exit:AgentExit;tpR:number;trailAtr:number;hold:number;set:AgentSet;corrCap:boolean;cooldown:boolean;maxOpen:number;riskPct:number};
export const AGENT_FAMILIES:AgentFamily[]=['score',...KNOWN_FAMILY_IDS];
export const GENOME_BOUNDS={
 threshold:{min:30,max:80,step:5},slAtr:{min:1,max:4,step:.5},tpR:{min:1,max:4,step:.5},trailAtr:{min:1.5,max:4,step:.5},
 maxOpen:{min:2,max:8,step:1},riskPct:{min:.5,max:1,step:.1},
} as const;
export const GENOME_HOLDS=[3,5,10,15,20,30,40,60,120,260];
export const GENOME_ENTRIES:AgentEntry[]=['immediate','pullback','contra'];
export const GENOME_EXITS:AgentExit[]=['tp','signal','trail'];
export const GENOME_SETS:AgentSet[]=['fx','ci','all','crypto'];
export const AGENT_CRYPTO=['BTC-USD','ETH-USD','SOL-USD'];
export const AGENT_SET_LABELS:Record<AgentSet,string>={fx:'FX páry',ci:'Komodity + indexy',all:'FX + komodity + indexy',crypto:'Krypto'};
export const AGENT_SET_GROUPS:Record<AgentSet,('fx'|'commodities'|'index'|'crypto')[]>={fx:['fx'],ci:['commodities','index'],all:['fx','commodities','index'],crypto:['crypto']};
export const agentMarkets=(s:AgentSet)=>s==='crypto'?[...AGENT_CRYPTO]:[...(s!=='ci'?pairs:[]),...(s!=='fx'?[...SWEEP_COMMODITIES,...SWEEP_INDICES]:[])];
export const FAMILY_LABEL=(f:AgentFamily)=>f==='score'?'Skóre Tradee':familyDef(f)?.label??f;
export const FAMILY_SHORT:Record<AgentFamily,string>={score:'Skóre',donchian:'Donchian',macross:'MA cross',tsmom:'TSMOM',rsi:'RSI',bollinger:'Bollinger',keltner:'Keltner',carry:'Carry',cot:'COT extrémy',season:'Sezonalita'};
export const familyVs=(f:AgentFamily)=>f==='score'?['']:familyDef(f)?.v??[];
const DEFAULTS={threshold:50,entry:'immediate' as AgentEntry,tpR:2,trailAtr:2.5};

// ---- id agentů: G01…G99, pak G100…G999 (VARCHAR(4)); id se nikdy nepoužije znovu (archiv drží historii)
export const isAgentVariant=(v:unknown):v is `G${string}`=>typeof v==='string'&&/^G(0[1-9]|[1-9]\d|[1-9]\d\d)$/.test(v);
export const agentId=(n:number)=>'G'+(n<100?String(n).padStart(2,'0'):String(n));
export const agentNum=(id:string)=>Number(id.slice(1));
export function nextAgentIds(existing:string[],n:number):string[]{let k=Math.max(0,...existing.filter(isAgentVariant).map(agentNum));const out:string[]=[];while(out.length<n&&k<999)out.push(agentId(++k));return out}
export const MAX_ACTIVE_AGENTS=20,MIN_TRADES_TO_KILL=8,KILL_MIN_TRADES=20,KILL_MAX_AVG_R=-.1,PARENT_MIN_TRADES=8,CHILDREN_PER_WEEK=3;

// ---- validace a oprava genomu
const onStep=(v:number,b:{min:number;max:number;step:number})=>Number.isFinite(v)&&v>=b.min-1e-9&&v<=b.max+1e-9&&Math.abs((v-b.min)/b.step-Math.round((v-b.min)/b.step))<1e-6;
const snap=(v:number,b:{min:number;max:number;step:number})=>Math.round(Math.min(b.max,Math.max(b.min,Math.round((v-b.min)/b.step)*b.step+b.min))*1000)/1000;
// kanonický tvar: nepoužívané geny na výchozí hodnotě (stejné chování = stejný klíč), závislosti trhů a rodin
export function canonicalGenome(g:Genome):Genome{
 const x={...g};
 if(x.family!=='score'){x.threshold=DEFAULTS.threshold;x.entry=DEFAULTS.entry}
 if(x.exit!=='tp')x.tpR=DEFAULTS.tpR;
 if(x.exit!=='trail')x.trailAtr=DEFAULTS.trailAtr;
 if(x.family==='score')x.v='';
 if(x.family==='carry')x.set='fx';
 if(x.family==='cot'&&x.set==='crypto')x.set='all';
 return x;
}
export function validateGenome(raw:unknown):{ok:true;genome:Genome}|{ok:false;error:string}{
 const x=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>;
 const bad=(e:string)=>({ok:false as const,error:e});
 if(!AGENT_FAMILIES.includes(x.family as AgentFamily))return bad('rodina');
 const f=x.family as AgentFamily;
 if(f==='score'?x.v!=='':!familyVs(f).includes(x.v as string))return bad('varianta rodiny');
 for(const k of Object.keys(GENOME_BOUNDS) as (keyof typeof GENOME_BOUNDS)[])if(typeof x[k]!=='number'||!onStep(x[k] as number,GENOME_BOUNDS[k]))return bad(k);
 if(!GENOME_ENTRIES.includes(x.entry as AgentEntry))return bad('entry');
 if(!GENOME_EXITS.includes(x.exit as AgentExit))return bad('exit');
 if(!GENOME_SETS.includes(x.set as AgentSet))return bad('set');
 if(!GENOME_HOLDS.includes(x.hold as number))return bad('hold');
 if(typeof x.corrCap!=='boolean'||typeof x.cooldown!=='boolean')return bad('corrCap/cooldown');
 if(f==='carry'&&x.set!=='fx')return bad('carry jen FX');
 if(f==='cot'&&x.set==='crypto')return bad('COT nemá krypto');
 if(f!=='score'&&x.entry!=='immediate')return bad('pullback/kontra jen u skóre');
 const g={family:f,v:x.v as string,threshold:x.threshold as number,entry:x.entry as AgentEntry,slAtr:x.slAtr as number,exit:x.exit as AgentExit,tpR:x.tpR as number,trailAtr:x.trailAtr as number,
  hold:x.hold as number,set:x.set as AgentSet,corrCap:x.corrCap as boolean,cooldown:x.cooldown as boolean,maxOpen:x.maxOpen as number,riskPct:x.riskPct as number};
 return {ok:true,genome:canonicalGenome(g)};
}
export const genomeKey=(g:Genome)=>{const c=canonicalGenome(g);return [c.family,c.v,c.threshold,c.entry,c.slAtr,c.exit,c.tpR,c.trailAtr,c.hold,c.set,c.corrCap?1:0,c.cooldown?1:0,c.maxOpen,c.riskPct].join('|')};
export function genomeText(g:Genome):string{
 const c=canonicalGenome(g),fam=c.family==='score'?`Skóre Tradee ${c.entry==='immediate'?'hned':c.entry==='pullback'?'pullback':'kontra'}, |skóre| ≥ ${c.threshold}`:`${FAMILY_LABEL(c.family)} (${familyDef(c.family)?.vLabels[c.v]??c.v})`;
 const n=(v:number)=>String(v).replace('.',','),ex=c.exit==='tp'?`TP ${n(c.tpR)} R`:c.exit==='trail'?`trailing ${n(c.trailAtr)} × ATR`:'výstup signálem';
 return `${fam} · SL ${n(c.slAtr)} ATR · ${ex} · max ${c.hold} d · ${AGENT_SET_LABELS[c.set]} · max ${c.maxOpen} poz. · riziko ${String(c.riskPct).replace('.',',')} %${c.corrCap?' · kor. limit':''}${c.cooldown?' · ochlazení':''}`;
}

// ---- náhodný genom a mutace (deterministické podle seedu)
type Rnd=()=>number;
const pick=<T,>(r:Rnd,a:readonly T[])=>a[Math.floor(r()*a.length)];
const stepVals=(b:{min:number;max:number;step:number})=>{const o:number[]=[];for(let v=b.min;v<=b.max+1e-9;v+=b.step)o.push(Math.round(v*1000)/1000);return o};
export function randomGenome(r:Rnd,family?:AgentFamily):Genome{
 const f=family??pick(r,AGENT_FAMILIES);
 const g:Genome={family:f,v:pick(r,familyVs(f)),threshold:pick(r,stepVals(GENOME_BOUNDS.threshold).filter(v=>v>=40&&v<=70)),entry:f==='score'?pick(r,GENOME_ENTRIES):'immediate',
  slAtr:pick(r,[1.5,2,2.5,3]),exit:pick(r,GENOME_EXITS),tpR:pick(r,[1.5,2,2.5,3]),trailAtr:pick(r,[2,2.5,3]),hold:pick(r,[5,10,15,20,30,40,60]),
  set:f==='carry'?'fx':pick(r,f==='cot'?['fx','ci','all']:f==='score'?GENOME_SETS:['fx','ci','all','crypto']) as AgentSet,corrCap:r()<.6,cooldown:r()<.4,maxOpen:pick(r,[3,4,5,6]),riskPct:pick(r,[.5,.75,1].map(v=>snap(v,GENOME_BOUNDS.riskPct)))};
 return canonicalGenome(g);
}
const GENES=['family','v','threshold','entry','slAtr','exit','tpR','trailAtr','hold','set','corrCap','cooldown','maxOpen','riskPct'] as const;
// geny, které mají u daného genomu vliv (mutovat irelevantní gen = žádná změna chování)
function liveGenes(g:Genome):(typeof GENES[number])[]{
 return GENES.filter(k=>!(k==='threshold'||k==='entry')||g.family==='score').filter(k=>k!=='v'||g.family!=='score').filter(k=>k!=='tpR'||g.exit==='tp').filter(k=>k!=='trailAtr'||g.exit==='trail').filter(k=>k!=='set'||g.family!=='carry');
}
const nudge=(r:Rnd,v:number,b:{min:number;max:number;step:number})=>{const k=(r()<.25?2:1)*(r()<.5?-1:1);let n=snap(v+k*b.step,b);if(n===v)n=snap(v-k*b.step,b);return n};
export function mutateGenome(parent:Genome,seed:number):{genome:Genome;changes:string[]}{
 const r=mulberry32(seed),g={...canonicalGenome(parent)},changes:string[]=[],n=1+(r()<.4?1:0);
 for(let k=0;k<n;k++){
  // změna rodiny jen vzácně (10 %) – jinak malé kroky v parametrech
  const genes=liveGenes(g),gene=r()<.1?'family':pick(r,genes.filter(x=>x!=='family'));
  const before=JSON.stringify(g[gene]);
  if(gene==='family'){const f=pick(r,AGENT_FAMILIES.filter(x=>x!==g.family));g.family=f;g.v=pick(r,familyVs(f));if(f!=='score')g.entry='immediate';if(f==='carry')g.set='fx';if(f==='cot'&&g.set==='crypto')g.set='all'}
  else if(gene==='v'){const vs=familyVs(g.family);if(vs.length>1)g.v=pick(r,vs.filter(x=>x!==g.v))}
  else if(gene==='entry')g.entry=pick(r,GENOME_ENTRIES.filter(x=>x!==g.entry));
  else if(gene==='exit')g.exit=pick(r,GENOME_EXITS.filter(x=>x!==g.exit));
  else if(gene==='set')g.set=pick(r,GENOME_SETS.filter(x=>x!==g.set&&!(g.family==='cot'&&x==='crypto')));
  else if(gene==='corrCap'||gene==='cooldown')g[gene]=!g[gene];
  else if(gene==='hold'){const i=GENOME_HOLDS.indexOf(g.hold),j=Math.max(0,Math.min(GENOME_HOLDS.length-1,i+(r()<.5?-1:1)));g.hold=GENOME_HOLDS[j===i?(i?i-1:i+1):j]}
  else g[gene]=nudge(r,g[gene],GENOME_BOUNDS[gene]);
  const after=JSON.stringify(g[gene]);if(before!==after)changes.push(`${gene}: ${before} → ${after}`);
 }
 return {genome:canonicalGenome(g),changes};
}
// mutace, která nekoliduje s existujícím genomem (zkusí další sub-seedy)
export function mutateUnique(parent:Genome,seed:number,taken:Set<string>):{genome:Genome;changes:string[]}|null{
 for(let k=0;k<50;k++){const m=mutateGenome(parent,seed+k*15485863);const key=genomeKey(m.genome);if(m.changes.length&&!taken.has(key))return m}
 return null;
}
export const evolutionSeed=(gen:number,parent:string,i:number)=>((gen*1000003)^(agentNum(parent)*7919)^(i*104729))>>>0;

// ---- fitness
export type AgentWeekStat={id:string;active:boolean;trades:number;weekR:number;totalR:number;avgR:number|null;maxDdPct:number};
export const DD_FREE_PCT=5,DD_PENALTY=.2;
export function fitnessOf(s:Pick<AgentWeekStat,'trades'|'weekR'|'avgR'|'maxDdPct'>):number{
 const dd=Math.max(0,Math.abs(s.maxDdPct)-DD_FREE_PCT)*DD_PENALTY;
 return Math.round((s.weekR+.5*(s.avgR??0)*Math.sqrt(Math.max(0,s.trades))-dd)*1000)/1000;
}
export const canKill=(s:Pick<AgentWeekStat,'trades'|'avgR'>)=>s.trades>=Math.max(KILL_MIN_TRADES,MIN_TRADES_TO_KILL)&&(s.avgR??0)<KILL_MAX_AVG_R;

// ---- plán jednoho kola evoluce (čistá funkce; zápis dělá scripts/lab-evolve.mjs)
export type EvoAgent=AgentWeekStat&{genome:Genome;gen:number;parent:string|null};
export type EvoPlan={gen:number;evaluations:{agent:string;fitness:number;rank:number;reason:string}[];retire:{agent:string;fitness:number;reason:string}[];
 children:{id:string;parent:string;genome:Genome;changes:string[];reason:string}[];notes:string[]};
export function planEvolution(agents:EvoAgent[],o:{gen:number;allIds:string[];maxActive?:number;children?:number}):EvoPlan{
 const maxActive=o.maxActive??MAX_ACTIVE_AGENTS,want=o.children??CHILDREN_PER_WEEK,notes:string[]=[];
 const active=agents.filter(a=>a.active);
 const fit=new Map(active.map(a=>[a.id,fitnessOf(a)]));
 const ranked=[...active].sort((a,b)=>fit.get(b.id)!-fit.get(a.id)!||a.id.localeCompare(b.id));
 const evaluations=ranked.map((a,i)=>({agent:a.id,fitness:fit.get(a.id)!,rank:i+1,
  reason:`týden ${a.weekR>=0?'+':''}${a.weekR.toFixed(2)} R, celkem ${a.trades} obch., průměr ${a.avgR===null?'–':a.avgR.toFixed(2)} R, DD ${a.maxDdPct.toFixed(1)} %${a.trades<MIN_TRADES_TO_KILL?' (učí se – méně než 8 obchodů, nevyřazuje se)':''}`}));
 const parents=ranked.filter(a=>a.trades>=PARENT_MIN_TRADES&&fit.get(a.id)!>0).slice(0,want);
 if(parents.length<want)notes.push(`Rodičů jen ${parents.length} (potřeba aspoň ${PARENT_MIN_TRADES} uzavřených obchodů a fitness > 0).`);
 const free=Math.max(0,maxActive-active.length);
 const killable=[...active].filter(canKill).sort((a,b)=>fit.get(a.id)!-fit.get(b.id)!||a.id.localeCompare(b.id));
 const n=Math.min(parents.length,free+killable.length);
 if(n<parents.length)notes.push(`Volná místa ${free}, k vyřazení ${killable.length} (aspoň ${KILL_MIN_TRADES} obchodů a průměr R < ${KILL_MAX_AVG_R}) → potomků jen ${n}.`);
 const retire=killable.slice(0,Math.max(0,n-free)).map(a=>({agent:a.id,fitness:fit.get(a.id)!,reason:`vyřazen pro potomka: ${a.trades} obchodů, průměr ${a.avgR!.toFixed(2)} R (< ${KILL_MAX_AVG_R}), fitness ${fit.get(a.id)!.toFixed(2)} – nejhorší z vyřaditelných`}));
 const taken=new Set(agents.filter(a=>a.active).map(a=>genomeKey(a.genome)));
 const ids=nextAgentIds(o.allIds,n),children:EvoPlan['children']=[];
 for(let i=0;i<n;i++){const p=parents[i],m=mutateUnique(p.genome,evolutionSeed(o.gen,p.id,i),taken);if(!m){notes.push(`Potomek ${p.id}: žádná nová mutace.`);continue}
  taken.add(genomeKey(m.genome));children.push({id:ids[children.length],parent:p.id,genome:m.genome,changes:m.changes,reason:`potomek ${p.id} (fitness ${fit.get(p.id)!.toFixed(2)}, ${i+1}. místo): ${m.changes.join(', ')}`})}
 // vyřadit jen tolik, kolik potomků opravdu vzniklo nad volná místa
 const needRetire=Math.max(0,children.length-free);
 return {gen:o.gen,evaluations,retire:retire.slice(0,needRetire),children,notes};
}

// ---- počáteční populace: nejlepší robustní kombinace sweepu + známé strategie + náhodné v rozumných mezích
export type SeedSource={sweep:SweepCombo[];known:{combo:KnownCombo;robust:boolean;beatsChance?:boolean}[]};
export type SeedAgent={genome:Genome;origin:string};
export function sweepToGenome(c:SweepCombo):Genome{
 const exit:AgentExit=c.exit==='signal'?'signal':'tp',tpR=c.exit==='signal'?2:Number(c.exit.slice(2));
 return canonicalGenome({family:'score',v:'',threshold:c.threshold,entry:c.entry,slAtr:c.slAtr,exit,tpR,trailAtr:DEFAULTS.trailAtr,hold:GENOME_HOLDS.includes(c.hold)?c.hold:10,set:c.set,corrCap:c.corrCap,cooldown:c.cooldown,maxOpen:5,riskPct:1});
}
export function knownToGenome(c:KnownCombo):Genome{
 const hold=GENOME_HOLDS.reduce((b,h)=>Math.abs(h-c.hold)<Math.abs(b-c.hold)?h:b,GENOME_HOLDS[0]);
 return canonicalGenome({family:c.family,v:c.v,threshold:DEFAULTS.threshold,entry:'immediate',slAtr:snap(c.slAtr,GENOME_BOUNDS.slAtr),exit:'signal',tpR:DEFAULTS.tpR,trailAtr:DEFAULTS.trailAtr,hold,set:c.set,corrCap:true,cooldown:false,maxOpen:5,riskPct:1});
}
export function seedPopulation(src:SeedSource,seed=42,n=MAX_ACTIVE_AGENTS):SeedAgent[]{
 const out:SeedAgent[]=[],keys=new Set<string>(),r=mulberry32(seed);
 const add=(g:Genome,origin:string)=>{if(out.length>=n)return false;const k=genomeKey(g);if(keys.has(k))return false;keys.add(k);out.push({genome:g,origin});return true};
 for(const c of src.sweep.slice(0,6))add(sweepToGenome(c),'nejlepší robustní kombinace „Hledání prahů“');
 const known=[...src.known].sort((a,b)=>Number(b.robust)-Number(a.robust)||Number(!!b.beatsChance)-Number(!!a.beatsChance));
 let kn=0;for(const k of known){if(kn>=KNOWN_FAMILIES.length)break;if(add(knownToGenome(k.combo),`známá strategie ${FAMILY_LABEL(k.combo.family)} (${k.robust?'robustní':'nejlepší podle IS, ne robustní'}${k.beatsChance?', nad náhodou':''})`))kn++}
 // doplnění: nejdřív rodiny, které ještě v populaci nejsou (rozmanitost), pak náhodně; 1–2 agenti na krypto
 const missing=AGENT_FAMILIES.filter(f=>!out.some(a=>a.genome.family===f));
 for(const f of missing){for(let t=0;t<20;t++)if(add(randomGenome(r,f),`náhodný v mezích (rodina ${FAMILY_LABEL(f)} v populaci chyběla)`))break}
 if(!out.some(a=>a.genome.set==='crypto'))for(let t=0;t<20;t++){const g=randomGenome(r,'score');g.set='crypto';if(add(canonicalGenome(g),'náhodný v mezích (krypto)'))break}
 for(let t=0;out.length<n&&t<500;t++)add(randomGenome(r),'náhodný v rozumných mezích');
 return out;
}
export {KNOWN_FAMILIES};
