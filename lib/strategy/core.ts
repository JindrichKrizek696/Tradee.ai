// Strategie s verzemi (playbook): 8 bloků, podmínky s rolí a vstupním modelem, verzování, tří-stavový checklist a převod starých dat.
// Čisté funkce – testy scripts/check-strategy-versions.mjs.
export const BLOCKS=[['scope','Rozsah'],['context','Kontext'],['setup','Setup'],['trigger','Trigger'],['invalidation','Invalidace'],['risk','Risk a management'],['notrade','Kdy neobchodovat'],['review','Review']] as const;
export type BlockId=typeof BLOCKS[number][0];
export const BLOCK_IDS=BLOCKS.map(b=>b[0]) as BlockId[];
export const BLOCK_LABEL=Object.fromEntries(BLOCKS) as Record<BlockId,string>;
export const BLOCK_HINT:Record<BlockId,string>={scope:'Na jakých trzích, časových rámcích a seancích strategii obchoduješ.',context:'Jaký musí být širší obraz trhu (trend, struktura, fundament).',setup:'Co musí být na grafu připravené, než začneš hledat vstup.',trigger:'Co přesně je signál ke vstupu.',invalidation:'Kdy přestává scénář platit.',risk:'Velikost pozice, stop loss, cíle a správa obchodu.',notrade:'Kdy neobchodovat: zprávy, dny, stav mysli.',review:'Otázky, které si položíš po obchodu.'};
export const ROLES={required:'Povinná',supportive:'Podpůrná',note:'Poznámka'} as const;
export type Role=keyof typeof ROLES;
export const ORIGINS={own:'Vlastní',mentor:'Od mentora',example:'Příklad'} as const;
export type Origin=keyof typeof ORIGINS;
export const STYLES={day:'Day trading',swing:'Swing',both:'Day i swing'} as const;
export type Style=keyof typeof STYLES;
export const SESSIONS={asia:'Asie',london:'Londýn',newyork:'New York',overlap:'Překryv Londýn / New York'} as const;
export const TIMEFRAMES=['M1','M5','M15','M30','H1','H4','D1','W1','MN'] as const;
export const WEEKDAYS=['Po','Út','St','Čt','Pá','So','Ne'];
export type Example={kind:'valid'|'invalid';text:string;fileId:string|null};
export type Condition={id:string;text:string;role:Role;model:string|null;examples:Example[]};
export type Block={text:string;conditions:Condition[]};
export type Scope={markets:string[];timeframes:string[];sessions:string[];style:Style|null};
// Kdy neobchodovat: okno kolem zpráv (minuty před / po; minImpact 2 = i střední zprávy, bez klíče = jen silné – výchozí tvar zůstává jako v migraci 0036) a dny v týdnu 1 = pondělí … 7 = neděle
export type NoTradeRules={newsBefore:number|null;newsAfter:number|null;days:number[];minImpact?:2};
export const IMPACTS={3:'Jen silné zprávy',2:'Střední i silné zprávy'} as const;
export type Content={models:string[];scope:Scope;noTrade:NoTradeRules;blocks:Record<BlockId,Block>};
export const LIMITS={text:4000,cond:200,conds:25,totalConds:120,models:6,model:40,examples:3,validExamples:2,invalidExamples:1,example:300,changelog:300,mentor:80,markets:60,versions:200,newsMin:240,fileId:40};
export function newItemId(){const a='abcdefghijklmnopqrstuvwxyz0123456789';let s='';const b=crypto.getRandomValues(new Uint8Array(8));for(const x of b)s+=a[x%a.length];return s}
export function emptyContent():Content{
 return {models:[],scope:{markets:[],timeframes:[],sessions:[],style:null},noTrade:{newsBefore:null,newsAfter:null,days:[]},blocks:Object.fromEntries(BLOCK_IDS.map(b=>[b,{text:'',conditions:[] as Condition[]}])) as unknown as Record<BlockId,Block>};
}
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const FILE_RE=/^plf_[a-z0-9]{24}$/;
// vstup z UI → kanonický obsah verze (stejné pořadí klíčů, takže porovnání přes JSON funguje), nebo text chyby
export function validateContent(raw:unknown,marketIds:readonly string[]):Content|string{
 if(!isObj(raw))return 'Neplatný obsah strategie.';
 const out=emptyContent();
 const models=Array.isArray(raw.models)?raw.models:[];
 if(models.length>LIMITS.models)return `Nejvýš ${LIMITS.models} vstupních modelů.`;
 for(const m of models){const t=str(m);if(!t)return 'Název vstupního modelu nesmí být prázdný.';if(t.length>LIMITS.model)return `Název modelu může mít nejvýš ${LIMITS.model} znaků.`;if(out.models.some(x=>x.toLowerCase()===t.toLowerCase()))return `Model „${t}“ je dvakrát.`;out.models.push(t)}
 const sc=isObj(raw.scope)?raw.scope:{};
 const list=(v:unknown,ok:(s:string)=>boolean,max:number)=>[...new Set((Array.isArray(v)?v:[]).filter((x):x is string=>typeof x==='string'&&ok(x)))].slice(0,max);
 out.scope={markets:list(sc.markets,m=>marketIds.includes(m),LIMITS.markets),timeframes:TIMEFRAMES.filter(t=>list(sc.timeframes,x=>(TIMEFRAMES as readonly string[]).includes(x),20).includes(t)),sessions:Object.keys(SESSIONS).filter(s=>list(sc.sessions,x=>x in SESSIONS,10).includes(s)),style:typeof sc.style==='string'&&sc.style in STYLES?sc.style as Style:null};
 const nt=isObj(raw.noTrade)?raw.noTrade:{};
 const mins=(v:unknown)=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>=0?Math.min(LIMITS.newsMin,Math.round(n)):null};
 out.noTrade={newsBefore:mins(nt.newsBefore),newsAfter:mins(nt.newsAfter),days:[...new Set((Array.isArray(nt.days)?nt.days:[]).map(Number).filter(d=>Number.isInteger(d)&&d>=1&&d<=7))].sort(),...(Number(nt.minImpact)===2?{minImpact:2 as const}:{})};
 const blocks=isObj(raw.blocks)?raw.blocks:{};let total=0;const ids=new Set<string>();
 for(const b of BLOCK_IDS){
  const src=isObj(blocks[b])?blocks[b] as Record<string,unknown>:{};
  const text=typeof src.text==='string'?src.text.replace(/\r\n/g,'\n').trim():'';
  if(text.length>LIMITS.text)return `Text bloku ${BLOCK_LABEL[b]} může mít nejvýš ${LIMITS.text} znaků.`;
  const conds=Array.isArray(src.conditions)?src.conditions:[];
  if(conds.length>LIMITS.conds)return `Blok ${BLOCK_LABEL[b]} může mít nejvýš ${LIMITS.conds} podmínek.`;
  total+=conds.length;if(total>LIMITS.totalConds)return `Strategie může mít nejvýš ${LIMITS.totalConds} podmínek.`;
  const cs:Condition[]=[];
  for(const c of conds){
   if(!isObj(c))return 'Neplatná podmínka.';
   const t=str(c.text);if(!t)return `Podmínka v bloku ${BLOCK_LABEL[b]} nesmí být prázdná.`;if(t.length>LIMITS.cond)return `Podmínka může mít nejvýš ${LIMITS.cond} znaků.`;
   const role:Role=typeof c.role==='string'&&c.role in ROLES?c.role as Role:'supportive';
   const mRaw=str(c.model),model=mRaw?out.models.find(m=>m.toLowerCase()===mRaw.toLowerCase())??null:null;
   if(mRaw&&!model)return `Podmínka „${t.slice(0,40)}“ odkazuje na neznámý model „${mRaw}“.`;
   let id=typeof c.id==='string'&&/^[a-z0-9]{8}$/.test(c.id)?c.id:newItemId();while(ids.has(id))id=newItemId();ids.add(id);
   const exs:Example[]=[];
   for(const e of Array.isArray(c.examples)?c.examples:[]){
    if(!isObj(e))continue;const kind=e.kind==='invalid'?'invalid':'valid',et=str(e.text).slice(0,LIMITS.example),fileId=typeof e.fileId==='string'&&FILE_RE.test(e.fileId)?e.fileId:null;
    if(!et&&!fileId)continue;
    if(exs.filter(x=>x.kind===kind).length>=(kind==='valid'?LIMITS.validExamples:LIMITS.invalidExamples))return `Podmínka může mít nejvýš ${LIMITS.validExamples} platné a ${LIMITS.invalidExamples} neplatný příklad.`;
    exs.push({kind,text:et,fileId});
   }
   cs.push({id,text:t,role,model,examples:exs});
  }
  out.blocks[b]={text,conditions:cs};
 }
 return out;
}
// obsah z DB (JSON) – poškozený nebo starší tvar se doplní na prázdný
export function parseContent(s:unknown):Content{
 try{const v=JSON.parse(String(s));const base=emptyContent();if(!isObj(v))return base;
  const r=validateContent(v,Array.isArray((v.scope as {markets?:unknown})?.markets)?((v.scope as {markets:unknown[]}).markets.filter(x=>typeof x==='string') as string[]):[]);
  return typeof r==='string'?{...base,...v} as Content:r}catch{return emptyContent()}
}
export const sameContent=(a:Content,b:Content)=>JSON.stringify(a)===JSON.stringify(b);
export const conditionCount=(c:Content)=>BLOCK_IDS.reduce((n,b)=>n+c.blocks[b].conditions.length,0);
// Uložení úpravy: neměněný obsah nic nedělá; použitá verze (obchod, scénář, vynechaný obchod) je neměnná → nová verze s popisem změny; nepoužitá se přepíše
export type SavePlan={action:'none'}|{action:'update'}|{action:'create';version:number}|{error:string};
export function planSave(latest:{version:number;used:boolean;content:Content}|null,next:Content,changelog:string):SavePlan{
 const note=changelog.trim();
 if(note.length>LIMITS.changelog)return {error:`Popis změny může mít nejvýš ${LIMITS.changelog} znaků.`};
 if(!latest)return {action:'create',version:1};
 if(sameContent(latest.content,next))return {action:'none'};
 if(!latest.used)return {action:'update'};
 if(!note)return {error:'Verze už je použitá u obchodu nebo scénáře. Napiš krátce, co se mění – vznikne nová verze.'};
 return {action:'create',version:latest.version+1};
}
export function validateOrigin(origin:unknown,mentor:unknown):{origin:Origin;mentor:string|null}|string{
 const o=origin===undefined?'own':origin;if(typeof o!=='string'||!(o in ORIGINS))return 'Neplatný původ strategie.';
 const m=typeof mentor==='string'?mentor.trim():'';if(m.length>LIMITS.mentor)return `Pole mentor může mít nejvýš ${LIMITS.mentor} znaků.`;
 return {origin:o as Origin,mentor:o==='mentor'&&m?m:null};
}

// ---------- checklist při rozhodování (tři stavy)
export const STATES={met:'Splněno',unmet:'Nesplněno',unknown:'Nevím'} as const;
export type CheckState=keyof typeof STATES;
export type DecisionItem={id:string;text:string;role:Exclude<Role,'note'>;block:BlockId;model:string|null};
// podmínky k odškrtnutí: bez bloku Review (to jsou otázky po obchodu) a bez poznámek; společné (bez modelu) + podmínky zvoleného modelu
export function decisionItems(c:Content,model:string|null):DecisionItem[]{
 const out:DecisionItem[]=[];
 for(const b of BLOCK_IDS){if(b==='review')continue;for(const x of c.blocks[b].conditions)if(x.role!=='note'&&(x.model===null||x.model===model))out.push({id:x.id,text:x.text,role:x.role,block:b,model:x.model})}
 return out;
}
export type Eval={requiredTotal:number;requiredUnmet:number;requiredUnknown:number;supportiveTotal:number;supportiveMet:number;supportiveUnknown:number;score:number|null;verdict:'blocked'|'incomplete'|'ready'};
// Nesplněná povinná podmínka = blokováno, i když je všechno ostatní zelené. Skóre = podíl splněných podpůrných (zvlášť).
export function evaluate(items:{role:string;state:CheckState}[]):Eval{
 const req=items.filter(i=>i.role==='required'),sup=items.filter(i=>i.role==='supportive');
 const requiredUnmet=req.filter(i=>i.state==='unmet').length,requiredUnknown=req.filter(i=>i.state==='unknown').length,supportiveMet=sup.filter(i=>i.state==='met').length;
 return {requiredTotal:req.length,requiredUnmet,requiredUnknown,supportiveTotal:sup.length,supportiveMet,supportiveUnknown:sup.filter(i=>i.state==='unknown').length,score:sup.length?Math.round(supportiveMet/sup.length*100)/100:null,verdict:requiredUnmet?'blocked':requiredUnknown?'incomplete':'ready'};
}
export const stateOf=(v:unknown):CheckState=>v==='met'||v==='unmet'?v:'unknown';
export type SnapItem=DecisionItem&{state:CheckState};
export type PlanSnapshot={strategyId:string;strategyName:string;versionId:string;version:number;model:string|null;items:SnapItem[];eval:Eval;chartUrl:string|null;fileId:string|null;note:string;at:number};
export function cleanUrl(v:unknown):string|null|false{
 if(v===null||v===undefined||v==='')return null;if(typeof v!=='string'||v.length>500)return false;
 try{const u=new URL(v.trim());return u.protocol==='https:'||u.protocol==='http:'?u.toString():false}catch{return false}
}
// Snímek se staví na serveru z verze strategie a stavů od klienta (texty podmínek nejdou podvrhnout)
export function buildSnapshot(strategy:{id:string;name:string},ver:{id:string;version:number;content:Content},model:unknown,states:unknown,extra:{chartUrl?:unknown;fileId?:unknown;note?:unknown},now:number):PlanSnapshot|string{
 const m=typeof model==='string'&&model.trim()?ver.content.models.find(x=>x===model.trim())??false:null;
 if(m===false)return 'Neznámý vstupní model.';
 const st=isObj(states)?states:{};
 const items=decisionItems(ver.content,m).map(i=>({...i,state:stateOf(st[i.id])}));
 const chartUrl=cleanUrl(extra.chartUrl);if(chartUrl===false)return 'Odkaz na graf musí být adresa http(s).';
 const fileId=typeof extra.fileId==='string'&&FILE_RE.test(extra.fileId)?extra.fileId:null;
 const note=typeof extra.note==='string'?extra.note.trim():'';if(note.length>1000)return 'Poznámka ke checklistu může mít nejvýš 1000 znaků.';
 return {strategyId:strategy.id,strategyName:strategy.name,versionId:ver.id,version:ver.version,model:m,items,eval:evaluate(items),chartUrl,fileId,note,at:now};
}
export function parseSnapshot(s:unknown):PlanSnapshot|null{try{const v=s?JSON.parse(String(s)):null;return isObj(v)&&Array.isArray(v.items)?v as unknown as PlanSnapshot:null}catch{return null}}

// ---------- převod starých dat do verze 1
export const LEGACY_V1_NOTE='Verze 1 převedená z původní strategie';
export const legacyVersionId=(strategyId:string)=>'v1_'+strategyId;
// starý checklist (body + trhy) → obsah verze 1: trhy do Rozsahu, body jako podpůrné podmínky Setupu se stejným id (sedí na staré zaškrtnutí)
export function legacyChecklistContent(cl:{name:string;items:{id:string;text:string}[];markets:string[]},marketIds?:readonly string[]):Content{
 const c=emptyContent();
 c.scope.markets=[...new Set(cl.markets.filter(m=>!marketIds||marketIds.includes(m)))].slice(0,LIMITS.markets);
 const seen=new Set<string>();
 c.blocks.setup.conditions=cl.items.filter(i=>typeof i?.text==='string'&&i.text.trim()).slice(0,LIMITS.conds).map(i=>{let id=/^[a-z0-9]{8}$/.test(i.id)?i.id:newItemId();while(seen.has(id))id=newItemId();seen.add(id);return {id,text:i.text.trim().slice(0,LIMITS.cond),role:'supportive' as Role,model:null,examples:[]}});
 return c;
}
// název strategie z checklistu: kolize se stávající strategií (bez ohledu na velikost písmen) → přípona „(checklist)“, max. 60 znaků
export function legacyStrategyName(name:string,taken:readonly string[]):string{
 const has=(n:string)=>taken.some(t=>t.toLowerCase()===n.toLowerCase());
 const base=(name.trim()||'Checklist').slice(0,60);if(!has(base))return base;
 const suf=' (checklist)';let n=base.slice(0,60-suf.length)+suf,i=2;
 while(has(n)){const s=` (checklist ${i++})`;n=base.slice(0,60-s.length)+s}
 return n;
}
