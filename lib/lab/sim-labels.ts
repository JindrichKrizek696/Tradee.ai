// Laboratoř · označení simulovaných účtů podle RODINY (čisté funkce bez závislostí – smí do prohlížeče; testy scripts/check-lab-paper.mjs).
// Rodiny: A–D = Tradee skóre, S01–S20 = Hledání prahů, G… = Známé strategie / evoluce (populace agentů), R… = Strategie z podkladů
// (pravidlové definice z lab_strategy_defs). U R… název definice + verze + ZDROJ (lab_strategy_defs.source_label – jen data z DB, v kódu
// žádné konkrétní zdroje) + směr. Zdroj se kopíruje do neměnné kopie agenta při spuštění; starší agenti bez něj ho dohledají podle defId.
// Seznamy: skupiny podle rodiny (pevné pořadí), uvnitř podle zdroje (abecedně, bez zdroje na konci), řádky podle celkového R sestupně.
export type SimFamily='score'|'sweep'|'evo'|'rule';
export type SimFamilyInfo={id:SimFamily;label:string;range:string;cls:string;hint:string};
export const SIM_FAMILIES:SimFamilyInfo[]=[
 {id:'score',label:'Tradee skóre',range:'A–D',cls:'fam-score',hint:'pevné varianty podle skóre Tradee'},
 {id:'sweep',label:'Hledání prahů',range:'S01–S20',cls:'fam-sweep',hint:'kombinace prahů spuštěné z Hledání prahů'},
 {id:'evo',label:'Známé strategie / evoluce',range:'G…',cls:'fam-evo',hint:'populace agentů s týdenní evolucí'},
 {id:'rule',label:'Strategie z podkladů',range:'R…',cls:'fam-rule',hint:'pravidlové definice ze záložky Strategie'},
];
export const NO_SOURCE='bez zdroje';
export const familyInfo=(f:SimFamily)=>SIM_FAMILIES.find(x=>x.id===f)!;
export function simFamily(id:string):SimFamily|null{
 if(/^[ABCD]$/.test(id))return 'score';
 if(/^S\d{2}$/.test(id))return 'sweep';
 if(/^G\d{2,}$/.test(id))return 'evo';
 if(/^R\d{2}$/.test(id))return 'rule';
 return null;
}
// metadata agenta R…: z neměnné kopie (rule) a / nebo dohledané podle defId v aktuálních definicích
export type RuleMeta={defId?:string|null;name?:string|null;version?:number|null;sourceLabel?:string|null;side?:'both'|'long'|'short'|null};
export type DefLabel={name:string;version:number;sourceLabel:string|null};
export type SimLabel={id:string;family:SimFamily|null;familyLabel:string;cls:string;title:string;version:number|null;source:string|null;direction:string|null;
 text:string}; // text = jeden řádek pro reporty a souhrny („R03 · Strategie z podkladů · <název> v2 · zdroj <…> · long“)
export const cleanSource=(s:unknown):string|null=>{if(typeof s!=='string')return null;const t=s.replace(/\s+/g,' ').trim().slice(0,120);return t||null};
const DIR:Record<string,string>={long:'long',short:'short',both:'long i short'};
export function simLabel(x:{id:string;name?:string|null;rule?:RuleMeta|null},defs?:Record<string,DefLabel|undefined>|null):SimLabel{
 const family=simFamily(x.id),info=family?familyInfo(family):null;
 let title=(x.name??'').trim()||x.id,version:number|null=null,source:string|null=null,direction:string|null=null;
 if(family==='rule'){
  const r=x.rule??{},d=r.defId?defs?.[r.defId]:undefined;
  title=(r.name??'').trim()||d?.name||(x.name??'').trim()||x.id;
  version=r.version??d?.version??null;
  source=cleanSource(r.sourceLabel)??cleanSource(d?.sourceLabel)??null;
  direction=r.side?DIR[r.side]??null:null;
 }
 const text=[x.id,info?.label??'simulace',title+(version!==null?` v${version}`:''),...(family==='rule'?[`zdroj ${source??NO_SOURCE}`]:[]),...(direction?[direction]:[])].join(' · ');
 return {id:x.id,family,familyLabel:info?.label??'Simulace',cls:info?.cls??'fam-none',title,version,source,direction,text};
}
// nadpis účtu v souhrnech: „R03 – <název> v2 · zdroj <…> · long“ (A–D, S…, G…: „A – Základní“)
export const simHead=(l:SimLabel)=>`${l.id} – ${l.title}${l.version!==null?` v${l.version}`:''}${l.family==='rule'?` · zdroj ${l.source??NO_SOURCE}`:''}${l.direction?` · ${l.direction}`:''}`;
// legenda rodin do textových souhrnů
export const familyLegend=()=>'Rodiny simulací: '+SIM_FAMILIES.map(f=>`${f.range} = ${f.label}`).join(' · ')+'.';
// stabilní řazení podle rodiny (pořadí uvnitř rodiny zůstává)
export const familyOrder=(id:string)=>{const f=simFamily(id);return f===null?99:SIM_FAMILIES.findIndex(x=>x.id===f)};
// skupiny: rodina → zdroj → řádky podle celkového R (stejné R → podle id)
export type SimGroup<T>={family:SimFamily|null;familyLabel:string;cls:string;sources:{source:string|null;items:T[]}[];count:number};
export function groupSims<T>(rows:T[],lab:(t:T)=>SimLabel,totalR:(t:T)=>number|null|undefined):SimGroup<T>[]{
 const order=(f:SimFamily|null)=>f===null?99:SIM_FAMILIES.findIndex(x=>x.id===f);
 const byFam=new Map<SimFamily|null,T[]>();for(const t of rows){const f=lab(t).family;const a=byFam.get(f);if(a)a.push(t);else byFam.set(f,[t])}
 const r=(t:T)=>{const v=totalR(t);return v===null||v===undefined||!Number.isFinite(v)?-Infinity:v};
 return [...byFam.entries()].sort((a,b)=>order(a[0])-order(b[0])).map(([family,items])=>{
  const bySrc=new Map<string|null,T[]>();for(const t of items){const s=family==='rule'?lab(t).source:null;const a=bySrc.get(s);if(a)a.push(t);else bySrc.set(s,[t])}
  const sources=[...bySrc.entries()].sort((a,b)=>a[0]===b[0]?0:a[0]===null?1:b[0]===null?-1:a[0].localeCompare(b[0],'cs'))
   .map(([source,list])=>({source,items:[...list].sort((p,q)=>r(q)-r(p)||lab(p).id.localeCompare(lab(q).id))}));
  const info=family?familyInfo(family):null;
  return {family,familyLabel:info?.label??'Simulace',cls:info?.cls??'fam-none',sources,count:items.length};
 });
}
// filtr: rodina ('' = všechny) a zdroj ('' = všechny, NO_SOURCE = R… bez zdroje; zdroj filtruje jen R…)
export function filterSims<T>(rows:T[],lab:(t:T)=>SimLabel,f:{family?:SimFamily|'';source?:string}):T[]{
 return rows.filter(t=>{const l=lab(t);if(f.family&&l.family!==f.family)return false;
  if(f.source){if(l.family!=='rule')return false;if(f.source===NO_SOURCE?l.source!==null:l.source!==f.source)return false}
  return true});
}
// seznam zdrojů pro filtr (abecedně, bez zdroje na konci)
export function sourcesOf<T>(rows:T[],lab:(t:T)=>SimLabel):string[]{
 const s=new Set<string>();let none=false;for(const t of rows){const l=lab(t);if(l.family!=='rule')continue;if(l.source)s.add(l.source);else none=true}
 return [...[...s].sort((a,b)=>a.localeCompare(b,'cs')),...(none?[NO_SOURCE]:[])];
}
// neplatný obchod: odznak podle důvodu (void_reason)
export const VOID_TINY_STOP='stop pod minimem';
export const voidLabel=(reason:string|null|undefined)=>reason===VOID_TINY_STOP?'neplatný – stop pod minimem':'neplatný – zavřený trh';
export const voidTitle=(reason:string|null|undefined)=>reason===VOID_TINY_STOP?'Stop byl blíž než minimální vzdálenost (spread / ATR) – R by bylo nesmyslné; nepočítá se do zůstatku, statistik ani křivky.':'Otevřeno nebo zavřeno při zavřeném trhu – nepočítá se do zůstatku, statistik ani křivky.';
