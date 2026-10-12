// Laboratoř · poznámky pro AI a souhrnný export (čisté funkce, testy scripts/check-lab.mjs).
import type {StudyResult,SignalStat} from './study.ts';
import {DIRECTION_LABELS,LAB_COND_LABELS,type LabRule} from './rules.ts';

export const LAB_LIMITS={title:160,body:100000,tags:12,tag:32,notes:500,rules:100,name:120};
export const LAB_MISSING='Laboratoř ještě nemá tabulky v databázi (chybí migrace 0025_lab.sql).';
export type LabNote={id:string;title:string;body:string;tags:string[];created:string;updated:string};
export type LabRuleRow={id:string;name:string;rule:LabRule;summary:Record<string,unknown>|null;created:string;updated:string};

export function cleanTags(raw:unknown):string[]{
 const list=Array.isArray(raw)?raw:typeof raw==='string'?raw.split(','):[];
 const out:string[]=[];
 for(const t of list){const v=String(t).trim().replace(/^#/,'').replace(/\s+/g,'-').slice(0,LAB_LIMITS.tag);if(v&&!out.some(x=>x.toLowerCase()===v.toLowerCase()))out.push(v)}
 return out.slice(0,LAB_LIMITS.tags);
}
export function validateLabNote(raw:unknown):{title:string;body:string;tags:string[]}|{error:string}{
 const x=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>;
 const title=typeof x.title==='string'?x.title.trim():'',body=typeof x.body==='string'?x.body:'';
 if(!title)return {error:'Poznámka potřebuje název.'};
 if(title.length>LAB_LIMITS.title)return {error:`Název může mít nejvýš ${LAB_LIMITS.title} znaků.`};
 if(body.length>LAB_LIMITS.body)return {error:'Text poznámky je příliš dlouhý.'};
 return {title,body,tags:cleanTags(x.tags)};
}
export function parseTagsCol(s:unknown):string[]{if(typeof s!=='string'||!s)return [];try{const v=JSON.parse(s);return Array.isArray(v)?v.map(String):[]}catch{return []}}
export function isMissingLabTable(e:unknown){const x=e as {code?:unknown;errno?:unknown;message?:unknown}|null;return !!x&&(x.code==='ER_NO_SUCH_TABLE'||x.errno===1146||/Table '[^']*lab_[^']*' doesn't exist/i.test(String(x.message??''))||/Unknown column '(?:[^']*\.)?variant'/i.test(String(x.message??'')))} // variant = chybí migrace 0027

const f=(v:number|null|undefined,d=2)=>v===null||v===undefined?'–':v.toFixed(d);
const day=(t:number|null)=>t===null?'–':new Date(t).toISOString().slice(0,10);
export function condText(r:LabRule){
 const c=r.conds.map(c=>`${LAB_COND_LABELS[c.type]} ${c.op} ${c.value}`);
 const t=r.tech.map(x=>x.type==='ma'?`close ${x.op==='above'?'nad':'pod'} ${x.kind.toUpperCase()}${x.period}`:x.type==='rsi'?`RSI${x.period} ${x.op} ${x.value}`:x.type);
 return [...c,...t].join(' A ')||'bez podmínek';
}
export function ruleText(r:LabRule){
 return `${condText(r)} → ${DIRECTION_LABELS[r.direction]}; SL ${r.sl}× ATR, ${r.tp.type==='r'?`TP ${r.tp.value} R`:'bez TP'}${r.hold?`, držet max. ${r.hold} dní`:''}; trhy ${r.markets.join(', ')}; ${r.from} – ${r.to||'dnes'}`;
}
function signalMd(s:SignalStat){
 const lines=[`### ${s.label} (${day(s.from)} – ${day(s.to)})`,'','| h | koš | n | průměr % | průměr ATR | hit % | vs baseline % | t |','|---|---|---|---|---|---|---|---|'];
 for(const h of s.horizons){
  for(const b of h.buckets)if(b.n)lines.push(`| ${h.h} | ${b.label} | ${b.n} | ${f(b.avgPct,3)} | ${f(b.avgAtr)} | ${f(b.hit,1)} | ${f(b.excessPct,3)} | ${f(b.t)} |`);
  lines.push(`| ${h.h} | směrová hrana | ${h.edge.n} | ${f(h.edge.avgPct,3)} | ${f(h.edge.avgAtr)} | ${f(h.edge.hit,1)} | – | ${f(h.edge.t)} |`);
 }
 return lines.join('\n');
}
// jeden markdown pro AI: poznámky + uložená pravidla (s posledním výsledkem) + poslední studie (souhrn přes trhy)
export function aiSummary(notes:LabNote[],rules:LabRuleRow[],study:StudyResult|null,now=new Date()):string{
 const out=[`# Tradee Laboratoř – shrnutí pro AI`,'',`Vygenerováno ${now.toISOString()}. Soukromá data vlastníka; čísla jsou historická (bez look-ahead), ne doporučení.`,''];
 out.push(`## Poznámky (${notes.length})`,'');
 if(!notes.length)out.push('_Žádné poznámky._','');
 for(const n of notes)out.push(`### ${n.title}`,`_${n.updated.slice(0,10)}${n.tags.length?' · '+n.tags.map(t=>'#'+t).join(' '):''}_`,'',n.body.trim()||'_(prázdné)_','');
 out.push(`## Uložená pravidla (${rules.length})`,'');
 if(!rules.length)out.push('_Žádná uložená pravidla._','');
 for(const r of rules){
  out.push(`### ${r.name}`,'',ruleText(r.rule));
  const s=r.summary as {trades?:number;winRate?:number|null;avgR?:number|null;profitFactor?:number|null;maxDrawdownPct?:number;at?:string}|null;
  out.push(s&&typeof s.trades==='number'?`Poslední test${s.at?' '+s.at.slice(0,10):''}: ${s.trades} obchodů, win rate ${f(s.winRate??null,1)} %, průměr ${f(s.avgR??null)} R, PF ${f(s.profitFactor??null)}, max DD ${f(s.maxDrawdownPct??null,1)} %.`:'Zatím netestováno.','');
 }
 out.push('## Poslední studie „Předpovídá to cenu?“','');
 if(!study)out.push('_Studie zatím neproběhla._');
 else{
  out.push(`Období ${day(study.from)} – ${day(study.to)}, trhy: ${study.markets.join(', ')}. Spočítáno ${study.computedAt}.`,'',...study.notes.map(n=>'- '+n),'');
  for(const s of study.aggregate)out.push(signalMd(s),'');
 }
 return out.join('\n').trim()+'\n';
}
