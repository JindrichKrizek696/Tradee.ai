// Scénáře (plán obchodu), vynechané obchody, stav dne, propojení obchodu se scénářem a statistiky. Čisté funkce – testy scripts/check-strategy-versions.mjs.
import type {Eval,PlanSnapshot} from './core.ts';
export const STATUSES={waiting:'Čekám',active:'Aktivní',entered:'Vstoupeno',skipped:'Vynecháno',invalidated:'Zneplatněno',expired:'Vypršelo'} as const;
export type Status=keyof typeof STATUSES;
export const OPEN_STATUSES:Status[]=['waiting','active'];
export const BIASES={long:'Long',short:'Short',both:'Obojí'} as const;
export type Bias=keyof typeof BIASES;
// přechody stavů: otevřený scénář jde uzavřít; vstoupeno je konečné; vynechaný / zneplatněný / vypršelý jde znovu otevřít (čekám)
const NEXT:Record<Status,Status[]>={waiting:['active','entered','skipped','invalidated','expired'],active:['waiting','entered','skipped','invalidated','expired'],entered:[],skipped:['waiting'],invalidated:['waiting'],expired:['waiting']};
export const canMove=(from:Status,to:Status)=>from===to||NEXT[from].includes(to);
export const isStatus=(v:unknown):v is Status=>typeof v==='string'&&v in STATUSES;
// otevřený scénář po platnosti = vypršelý (i když to ještě není zapsané v DB)
export function effectiveStatus(s:{status:Status;validUntil:number|null},now:number):Status{
 return OPEN_STATUSES.includes(s.status)&&s.validUntil!==null&&now>=s.validUntil?'expired':s.status;
}
export function moveStatus(s:{status:Status;validUntil:number|null},to:Status,now:number):string|null{
 const from=effectiveStatus(s,now);
 if(!canMove(from,to))return `Scénář nejde přepnout ze stavu „${STATUSES[from]}“ na „${STATUSES[to]}“.`;
 if(OPEN_STATUSES.includes(to)&&s.validUntil!==null&&now>=s.validUntil)return 'Scénář už vypršel – pro znovuotevření prodluž platnost.';
 return null;
}
export type Levels={entryFrom:number|null;entryTo:number|null;invalidation:number|null;targets:number[]};
export const emptyLevels=():Levels=>({entryFrom:null,entryTo:null,invalidation:null,targets:[]});
const num=(v:unknown)=>{if(v===null||v===undefined||v==='')return null;const n=typeof v==='string'?Number(v.replace(',','.').replace(/\s/g,'')):Number(v);return Number.isFinite(n)?n:NaN};
export function validateLevels(v:unknown):Levels|string{
 if(v===undefined||v===null)return emptyLevels();
 if(typeof v!=='object'||Array.isArray(v))return 'Neplatné úrovně.';
 const o=v as Record<string,unknown>,a=num(o.entryFrom),b=num(o.entryTo),inv=num(o.invalidation);
 if([a,b,inv].some(x=>Number.isNaN(x)))return 'Úroveň musí být číslo.';
 const tg=(Array.isArray(o.targets)?o.targets:[]).map(num);
 if(tg.some(x=>Number.isNaN(x)))return 'Cíl musí být číslo.';
 const targets=tg.filter((x):x is number=>x!==null);if(targets.length>5)return 'Nejvýš 5 cílů.';
 // zóna vstupu vždy od nižší k vyšší; jedna hodnota = jedna cena
 const lo=a===null?b:b===null?a:Math.min(a as number,b as number),hi=a===null?b:b===null?a:Math.max(a as number,b as number);
 return {entryFrom:lo as number|null,entryTo:hi as number|null,invalidation:inv as number|null,targets};
}
export type ScenarioFields={instrument:string;bias:Bias;hypothesis:string;strategyId:string|null;versionId:string|null;model:string|null;levels:Levels;validUntil:number|null;reviewAt:number|null;note:string;chartUrl:string|null;alertId:string|null};
export const SC_LIMITS={hypothesis:1000,note:2000,open:100,total:3000,noTrades:20000,noteSkip:1000};
const time=(v:unknown)=>{if(v===null||v===undefined||v==='')return null;const t=typeof v==='number'?v:Date.parse(String(v));return Number.isFinite(t)?t:NaN};
// vstup z UI → očištěná pole scénáře; partial = úprava (chybějící pole se nemění)
export function validateScenario(raw:unknown,ids:readonly string[],now:number,partial=false):Partial<ScenarioFields>|string{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return 'Neplatný scénář.';
 const o=raw as Record<string,unknown>,out:Partial<ScenarioFields>={},has=(k:string)=>!partial||k in o;
 if(has('instrument')){if(typeof o.instrument!=='string'||!ids.includes(o.instrument))return 'Vyber trh scénáře.';out.instrument=o.instrument}
 if(has('bias')){if(typeof o.bias!=='string'||!(o.bias in BIASES))return 'Vyber směr: long, short nebo obojí.';out.bias=o.bias as Bias}
 if(has('hypothesis')){const h=typeof o.hypothesis==='string'?o.hypothesis.trim():'';if(!h)return 'Napiš hypotézu – co favorizuješ a za jakých podmínek.';if(h.length>SC_LIMITS.hypothesis)return `Hypotéza může mít nejvýš ${SC_LIMITS.hypothesis} znaků.`;out.hypothesis=h}
 if(has('strategyId')){if(o.strategyId!==null&&o.strategyId!==undefined&&o.strategyId!==''&&typeof o.strategyId!=='string')return 'Neplatná strategie.';out.strategyId=typeof o.strategyId==='string'&&o.strategyId?o.strategyId:null}
 if(has('versionId')){out.versionId=typeof o.versionId==='string'&&o.versionId?o.versionId:null}
 if(has('model')){out.model=typeof o.model==='string'&&o.model.trim()?o.model.trim().slice(0,40):null}
 if(has('levels')){const l=validateLevels(o.levels);if(typeof l==='string')return l;out.levels=l}
 if(has('validUntil')){const t=time(o.validUntil);if(Number.isNaN(t))return 'Neplatné datum platnosti.';if(!partial&&t!==null&&t<=now)return 'Platnost musí být v budoucnu.';out.validUntil=t}
 if(has('reviewAt')){const t=time(o.reviewAt);if(Number.isNaN(t))return 'Neplatné datum přehodnocení.';out.reviewAt=t}
 if(has('note')){const n=typeof o.note==='string'?o.note.trim():'';if(n.length>SC_LIMITS.note)return `Poznámka může mít nejvýš ${SC_LIMITS.note} znaků.`;out.note=n}
 if(has('chartUrl')){const u=o.chartUrl;if(u===null||u===undefined||u==='')out.chartUrl=null;else{try{const x=new URL(String(u).trim());if(x.protocol!=='https:'&&x.protocol!=='http:'||String(u).length>500)throw 0;out.chartUrl=x.toString()}catch{return 'Odkaz na graf musí být adresa http(s).'}}}
 if(has('alertId')){out.alertId=typeof o.alertId==='string'&&/^al_[a-z0-9]{1,40}$/.test(o.alertId)?o.alertId:null}
 return out;
}
// Návrh scénáře k obchodu: stejný trh, směr sedí (long ↔ buy, short ↔ sell, obojí vždy) a scénář platil v době vstupu.
export type ScenarioLite={id:string;instrument:string;bias:Bias;status:Status;created:number;validUntil:number|null;closedAt?:number|null};
export function suggestScenarios(trade:{instrument:string|null;side:'buy'|'sell'|null;openTs:number|null},list:ScenarioLite[]):string[]{
 if(!trade.instrument||trade.openTs===null)return [];
 const t=trade.openTs,dir=trade.side==='buy'?'long':trade.side==='sell'?'short':null;
 return list.filter(s=>s.instrument===trade.instrument&&(s.bias==='both'||!dir||s.bias===dir)&&s.created<=t&&(s.validUntil===null||t<s.validUntil)
   // zneplatněný / vynechaný scénář se nenabízí, pokud se uzavřel před vstupem
   &&!((s.status==='skipped'||s.status==='invalidated')&&(s.closedAt??0)<=t))
  .sort((a,b)=>(a.bias===dir?0:1)-(b.bias===dir?0:1)||b.created-a.created).map(s=>s.id);
}
// nejbližší zpráva s vysokým dopadem pro měny instrumentu (kalendář dodá volající)
export type NewsLite={at:number;title:string;currencies:string[]};
export function instrumentCurrencies(id:string):string[]{
 const fx=id.match(/^([A-Z]{3})\/([A-Z]{3})$/);if(fx)return [fx[1],fx[2]];
 if(/^[A-Z]{3}$/.test(id))return [id];
 if(id==='CL=F'||id==='BZ=F')return ['USD','OIL'];
 return ['USD'];
}
export function nearestEvent(events:NewsLite[],instrument:string,now:number,horizonMs=14*864e5):NewsLite|null{
 const cur=instrumentCurrencies(instrument);
 return events.filter(e=>e.at>=now&&e.at<=now+horizonMs&&e.currencies.some(c=>cur.includes(c))).sort((a,b)=>a.at-b.at)[0]??null;
}
// kresba vybraná v grafu → úrovně scénáře (nejlépe jak to jde): obdélník = zóna vstupu, pozice long/short = vstup, stop, cíl a směr, čára = cena
export function levelsFromDrawing(d:{type:string;a:{p:number}[]}|null|undefined):{bias?:Bias;levels:Levels}|null{
 if(!d||!Array.isArray(d.a)||!d.a.length||d.a.some(x=>!Number.isFinite(x?.p)))return null;
 const p=d.a.map(x=>x.p),L=emptyLevels();
 if(d.type==='rect'||d.type==='prange'){if(p.length<2)return null;L.entryFrom=Math.min(p[0],p[1]);L.entryTo=Math.max(p[0],p[1]);return {levels:L}}
 if(d.type==='long'||d.type==='short'){if(p.length<3)return null;L.entryFrom=L.entryTo=p[0];L.invalidation=p[1];L.targets=[p[2]];return {bias:d.type,levels:L}}
 if(d.type==='hline'||d.type==='hray'||d.type==='touch'){L.entryFrom=L.entryTo=p[0];return {levels:L}}
 return null;
}

// ---------- vynechané obchody a stav dne
export const SKIP_REASONS={condition:'Nesplněná podmínka',news:'Zprávy',session:'Mimo seanci',emotion:'Emoce / únava',risk:'Limit rizika',other:'Jiné'} as const;
export type SkipReason=keyof typeof SKIP_REASONS;
export const DAY_STATUSES={waiting:'Čekám',skipping:'Vynechávám',pause:'Pauza'} as const;
export type DayStatus=keyof typeof DAY_STATUSES;
export type NoTradeFields={instrument:string|null;direction:'long'|'short'|null;reason:SkipReason;note:string;at:number;scenarioId:string|null};
export function validateNoTrade(raw:unknown,ids:readonly string[],now:number):NoTradeFields|string{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return 'Neplatný záznam.';
 const o=raw as Record<string,unknown>;
 if(typeof o.reason!=='string'||!(o.reason in SKIP_REASONS))return 'Vyber důvod, proč obchod vynecháváš.';
 const instrument=typeof o.instrument==='string'&&o.instrument?o.instrument:null;if(instrument&&!ids.includes(instrument))return 'Neznámý trh.';
 const direction=o.direction==='long'||o.direction==='short'?o.direction:null;
 const note=typeof o.note==='string'?o.note.trim():'';if(note.length>SC_LIMITS.noteSkip)return `Poznámka může mít nejvýš ${SC_LIMITS.noteSkip} znaků.`;
 const t=time(o.at);if(Number.isNaN(t))return 'Neplatný čas.';const at=t??now;if(at>now+864e5)return 'Vynechaný obchod nemůže být v budoucnu.';
 return {instrument,direction,reason:o.reason as SkipReason,note,at,scenarioId:typeof o.scenarioId==='string'&&o.scenarioId?o.scenarioId:null};
}
export const isDay=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'));
export const isDayStatus=(v:unknown):v is DayStatus=>typeof v==='string'&&v in DAY_STATUSES;
// Statistiky: počet vynechaných setupů podle důvodu, dny bez obchodu a dodržování plánu
// dodržení = obchod s plánem, kde žádná povinná podmínka nebyla nesplněná; vynechání při nesplněné podmínce se počítá jako dodržení
export type PlanStat={count:number;byReason:Record<SkipReason,number>;days:Record<DayStatus,number>;plans:number;followed:number;broken:number;skipsOnRule:number;adherence:number|null};
export function planStats(noTrades:{reason:SkipReason;eval?:Eval|null}[],days:{status:DayStatus}[],plans:{eval?:Eval|null}[]):PlanStat{
 const byReason=Object.fromEntries(Object.keys(SKIP_REASONS).map(k=>[k,0])) as Record<SkipReason,number>,d=Object.fromEntries(Object.keys(DAY_STATUSES).map(k=>[k,0])) as Record<DayStatus,number>;
 for(const n of noTrades)byReason[n.reason]=(byReason[n.reason]||0)+1;
 for(const x of days)d[x.status]=(d[x.status]||0)+1;
 const judged=plans.filter(p=>p.eval),broken=judged.filter(p=>p.eval!.requiredUnmet>0).length,followed=judged.length-broken;
 const skipsOnRule=noTrades.filter(n=>n.reason==='condition'||(n.eval&&n.eval.requiredUnmet>0)).length;
 const total=judged.length+skipsOnRule;
 return {count:noTrades.length,byReason,days:d,plans:judged.length,followed,broken,skipsOnRule,adherence:total?Math.round((followed+skipsOnRule)/total*100):null};
}
// časová osa Deníku: vynechané obchody a stavy dne podle dne (nejnovější nahoře)
export type TimelineDay<N>={day:string;status:DayStatus|null;dayNote:string;items:N[]};
export function timeline<N extends {at:number}>(noTrades:N[],days:{day:string;status:DayStatus;note:string}[],dayOf:(ms:number)=>string):TimelineDay<N>[]{
 const m=new Map<string,TimelineDay<N>>();
 const get=(k:string)=>m.get(k)??m.set(k,{day:k,status:null,dayNote:'',items:[]}).get(k)!;
 for(const x of days){const t=get(x.day);t.status=x.status;t.dayNote=x.note}
 for(const n of noTrades)get(dayOf(n.at)).items.push(n);
 for(const t of m.values())t.items.sort((a,b)=>b.at-a.at);
 return [...m.values()].sort((a,b)=>b.day.localeCompare(a.day));
}
// plán vs. provedení: směr, vstup v zóně, stop proti invalidaci, splnění povinných podmínek
export type Exec={side:'buy'|'sell'|null;openPrice:number|null;sl:number|null;tp:number|null;closePrice:number|null};
export function compareExecution(plan:{bias:Bias|null;levels:Levels|null;snapshot:PlanSnapshot|null},e:Exec){
 const out:{key:string;label:string;ok:boolean|null;detail:string}[]=[];
 const dir=e.side==='buy'?'long':e.side==='sell'?'short':null;
 if(plan.bias)out.push({key:'dir',label:'Směr',ok:!dir||plan.bias==='both'?null:plan.bias===dir,detail:`plán ${BIASES[plan.bias]} · obchod ${dir?BIASES[dir]:'–'}`});
 const L=plan.levels;
 if(L&&L.entryFrom!==null&&e.openPrice!==null){const lo=L.entryFrom,hi=L.entryTo??lo,tol=Math.abs(hi||lo)*0.0005;out.push({key:'entry',label:'Vstup v zóně',ok:e.openPrice>=lo-tol&&e.openPrice<=hi+tol,detail:`zóna ${lo}${hi!==lo?' – '+hi:''} · vstup ${e.openPrice}`})}
 // stop do 0,2 % od invalidace = podle plánu
 if(L&&L.invalidation!==null)out.push({key:'sl',label:'Stop u invalidace',ok:e.sl===null?false:Math.abs(e.sl-L.invalidation)<=Math.abs(L.invalidation)*0.002,detail:`invalidace ${L.invalidation} · SL ${e.sl??'bez SL'}`});
 if(L&&L.targets.length&&e.tp!==null)out.push({key:'tp',label:'Cíl',ok:null,detail:`plán ${L.targets.join(', ')} · TP ${e.tp}`});
 if(plan.snapshot){const v=plan.snapshot.eval;out.push({key:'req',label:'Povinné podmínky',ok:v.requiredUnmet===0&&v.requiredUnknown===0?true:v.requiredUnmet>0?false:null,detail:v.requiredTotal?`${v.requiredTotal-v.requiredUnmet-v.requiredUnknown} z ${v.requiredTotal} splněno${v.requiredUnmet?` · ${v.requiredUnmet} nesplněno`:''}${v.requiredUnknown?` · ${v.requiredUnknown} nevím`:''}`:'strategie nemá povinné podmínky'})}
 return out;
}
// alert propojený se scénářem: upozornění otevře scénář místo grafu
export const scenarioLink=(site:string,id:string)=>site.replace(/\/$/,'')+'/scenare#'+encodeURIComponent(id);
