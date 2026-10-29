// Replay: vstup pro založení seance (trhy, start, rámce, režim, „rozhodni, pak odkryj“, exekuce, účet a pravidla) a specifikace trhů.
// Čisté funkce – testy scripts/check-replay.mjs.
import {BASE_TFS,REPLAY_TFS,tfAllowed,type BaseTf,type ReplayTf} from './clock.ts';
import type {ExecConfig,ReplaySpec,Account} from './engine.ts';
import type {Mode} from './results.ts';
import {defaultInstrumentFor,applyOverride,type Instrument,type Override} from '../risk/instruments.ts';
import {normalizeRules,emptyRules,TEMPLATES,type Rules} from '../risk/account.ts';
import type {RateFn} from '../risk/size.ts';
export const LIMITS={symbols:4,name:80,note:1000,decideN:50,events:5000,sessions:100};
export type SpreadMode='fixed'|'registry';
export type ExecInput={spreadMode:SpreadMode;spreadTicks:number;commissionMode:SpreadMode;commission:number;slippageTicks:number;swap:ExecConfig['swap'];ambiguity:ExecConfig['ambiguity']};
export type AccountInput={source:'template'|'profile';templateId:string;profileId:string|null;balance:number;currency:string};
export type SessionInput={name:string;symbols:string[];start:number;baseTf:BaseTf;tfs:ReplayTf[];mode:Mode;decideN:number|null;exec:ExecInput;account:AccountInput;strategyId:string|null;versionId:string|null};
export type SessionConfig={exec:ExecConfig;execInput:ExecInput;specs:Record<string,ReplaySpec>;account:Account&{name:string;source:'template'|'profile';templateId:string|null;profileId:string|null};
 strategy:{strategyId:string;versionId:string;version:number;name:string}|null;notes:string[]};
type O=Record<string,unknown>;
const obj=(x:unknown):O=>x&&typeof x==='object'&&!Array.isArray(x)?x as O:{};
const num=(x:unknown,def:number,min:number,max:number)=>{const n=typeof x==='number'?x:typeof x==='string'&&x.trim()?Number(x.replace(',','.')):NaN;return Number.isFinite(n)?Math.min(max,Math.max(min,n)):def};
const idOk=(v:unknown)=>typeof v==='string'&&/^[\w:-]{1,48}$/.test(v)?v:null;
/** Vstup z formuláře → platný vstup, nebo text chyby. */
export function parseSessionInput(raw:unknown,marketIds:ReadonlySet<string>,currencies:readonly string[],now:number):SessionInput|string{
 const x=obj(raw);
 const name=(typeof x.name==='string'?x.name.replace(/\s+/g,' ').trim():'').slice(0,LIMITS.name);
 const symbols=[...new Set((Array.isArray(x.symbols)?x.symbols:[]).filter((s):s is string=>typeof s==='string'&&marketIds.has(s)))];
 if(!symbols.length)return 'Vyber aspoň jeden trh.';
 if(symbols.length>LIMITS.symbols)return `Nejvýš ${LIMITS.symbols} trhy najednou.`;
 const start=typeof x.start==='number'?x.start:Date.parse(String(x.start||''));
 if(!Number.isFinite(start))return 'Zadej datum a čas startu.';
 if(start<Date.parse('2003-01-01T00:00:00Z'))return 'Archiv svíček začíná rokem 2003.';
 if(start>now-86400000)return 'Start musí být aspoň den v minulosti.';
 const baseTf=BASE_TFS.includes(x.baseTf as BaseTf)?x.baseTf as BaseTf:'H1';
 const tfs=REPLAY_TFS.filter(t=>(Array.isArray(x.tfs)?x.tfs:[]).includes(t)&&tfAllowed(baseTf,t));
 if(!tfs.length)tfs.push(baseTf);
 const mode:Mode=x.mode==='validate'?'validate':'learn';
 const dn=x.decideN===null||x.decideN===undefined||x.decideN===''||x.decideN===0?null:Math.round(num(x.decideN,0,0,LIMITS.decideN));
 const e=obj(x.exec),sw=obj(e.swap);
 const exec:ExecInput={spreadMode:e.spreadMode==='registry'?'registry':'fixed',spreadTicks:num(e.spreadTicks,0,0,1e6),commissionMode:e.commissionMode==='registry'?'registry':'fixed',commission:num(e.commission,0,0,1e6),slippageTicks:num(e.slippageTicks,0,0,1e5),
  swap:{on:sw.on===true,long:num(sw.long,0,-1e6,1e6),short:num(sw.short,0,-1e6,1e6),tripleWed:sw.tripleWed!==false},ambiguity:e.ambiguity==='optimistic'?'optimistic':'conservative'};
 const a=obj(x.account);
 const currency=currencies.includes(String(a.currency))?String(a.currency):'';if(!currency)return 'Neznámá měna účtu.';
 const balance=num(a.balance,NaN,0,1e12);if(!(balance>0))return 'Zůstatek replay účtu musí být kladné číslo.';
 const source=a.source==='profile'?'profile':'template',templateId=TEMPLATES.some(t=>t.id===a.templateId)?String(a.templateId):'empty',profileId=source==='profile'?idOk(a.profileId):null;
 if(source==='profile'&&!profileId)return 'Vyber profil účtu.';
 return {name:name||symbols.join(', '),symbols,start:Math.floor(start/60000)*60000,baseTf,tfs,mode,decideN:dn&&dn>0?dn:null,exec,account:{source,templateId,profileId,balance,currency},strategyId:idOk(x.strategyId),versionId:idOk(x.versionId)};
}
/** Pravidla replay účtu: profil (jeho platná pravidla) nebo šablona; vždy normalizovaná. */
export function accountRules(a:AccountInput,profileRules:Rules|null):Rules{
 if(a.source==='profile'&&profileRules)return normalizeRules(profileRules);
 return normalizeRules(TEMPLATES.find(t=>t.id===a.templateId)?.rules??emptyRules());
}
/** Specifikace trhů: výchozí obchodovaný instrument trhu + přepis brokera profilu; spread a komise podle zvoleného zdroje. */
export function buildSpecs(symbols:string[],instruments:Instrument[],overrides:Record<string,Override>,exec:ExecInput,rate:RateFn,accountCcy:string):{specs:Record<string,ReplaySpec>;notes:string[]}|string{
 const specs:Record<string,ReplaySpec>={},notes:string[]=[];
 for(const s of symbols){
  const inst=defaultInstrumentFor(instruments,s);if(!inst)return `Pro trh ${s} chybí specifikace instrumentu v registru.`;
  const sp=applyOverride(inst,overrides[inst.id]);
  let spread=exec.spreadTicks*sp.tickSize,commission=exec.commission;
  if(exec.spreadMode==='registry'){if(sp.spread>0)spread=sp.spread;else notes.push(`${s}: registr nemá spread – použit pevný (${exec.spreadTicks} ticků).`)}
  if(exec.commissionMode==='registry'){if(sp.commission>0)commission=sp.commission;else notes.push(`${s}: registr nemá komisi – použita pevná.`)}
  const r=sp.quote===accountCcy?1:rate(sp.quote,accountCcy);
  if(r===null||!Number.isFinite(r)||r<=0)return `Chybí kurz ${sp.quote} → ${accountCcy}.`;
  const fx=/^([A-Z]{3})\/([A-Z]{3})$/.exec(s);
  specs[s]={symbol:s,instrumentId:sp.id,name:sp.name,unit:sp.unit,pip:sp.pip,tickSize:sp.tickSize,tickValue:sp.tickValue,quote:sp.quote,base:fx?fx[1]:null,lotStep:sp.lotStep,minLot:sp.minLot,spread:Math.round(spread*1e10)/1e10,commission,rate:r};
  if(sp.quote!==accountCcy&&specs[s].base!==accountCcy)notes.push(`${s}: přepočet ${sp.quote} → ${accountCcy} pevným kurzem z doby založení (${Math.round(r*1e6)/1e6}).`);
  if(inst.proxy)notes.push(`${s}: cena je z ${inst.dataSymbol} (proxy pro ${inst.id}).`);
 }
 return {specs,notes};
}
// ---- události z klienta
export const CHOICES={long:'Long',short:'Short',none:'Bez obchodu'} as const;
export type Choice=keyof typeof CHOICES;
export function parseDecision(raw:unknown,symbols:string[]):{symbol:string;choice:Choice;note:string;states:Record<string,string>;model:string|null}|string{
 const x=obj(raw);
 if(!symbols.includes(String(x.symbol)))return 'Neznámý trh.';
 if(!(String(x.choice) in CHOICES))return 'Vyber long, short nebo bez obchodu.';
 const note=typeof x.note==='string'?x.note.trim():'';if(note.length>LIMITS.note)return `Poznámka může mít nejvýš ${LIMITS.note} znaků.`;
 const st=obj(x.states),states:Record<string,string>={};for(const [k,v] of Object.entries(st))if(/^[a-z0-9]{8}$/.test(k)&&(v==='met'||v==='unmet'||v==='unknown'))states[k]=v;
 return {symbol:String(x.symbol),choice:x.choice as Choice,note,states,model:typeof x.model==='string'&&x.model.trim()?x.model.trim().slice(0,40):null};
}
/** Přetočení: jen dozadu a ne před start. */
export function checkRewind(to:unknown,clock:number,start:number):number|string{
 const t=Number(to);if(!Number.isFinite(t))return 'Neplatný čas přetočení.';
 if(t>=clock)return 'Přetočit jde jen zpět.';
 return Math.max(start,Math.floor(t));
}
