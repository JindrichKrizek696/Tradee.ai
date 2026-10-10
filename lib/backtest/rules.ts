// Pravidla strategie pro backtest: typy, výchozí hodnoty, normalizace, parametry trhu (velikost bodu, výchozí spread).
// Čisté funkce – testy scripts/check-backtest.mjs.
import type {SessionKey} from '../journal/analytics.ts';
import {fxCurrencies} from '../markets.ts';
export type Cmp='>'|'<';
export type MaKind='sma'|'ema';
export type Condition=
 |{type:'score';op:'>'|'<'|'rising'|'falling';value:number;days:number} // skóre Tradee vs value; rising/falling = vůči skóre před `days` dny
 |{type:'strength';op:Cmp;value:number} // síla base − síla quote (jen FX páry)
 |{type:'cot';op:'long'|'short'|'>'|'<';value:number} // long/short = znaménko netto pozice spekulantů; >/< = týdenní změna netto vs value
 |{type:'ma';kind:MaKind;period:number;op:'above'|'below'} // close nad/pod MA
 |{type:'ma_cross';kind:MaKind;fast:number;slow:number;dir:'up'|'down'} // křížení právě na této svíčce
 |{type:'breakout';period:number;dir:'up'|'down'} // close nad maximem / pod minimem PŘEDCHOZÍCH `period` svíček (bez aktuální)
 |{type:'ma_distance';kind:MaKind;period:number;op:Cmp;value:number} // (close − MA)/ATR(14), se znaménkem (+ nad MA, − pod MA)
 |{type:'rsi';period:number;op:'>'|'<'|'cross_up'|'cross_down';value:number}
 |{type:'change';bars:number;op:Cmp;value:number} // změna close za `bars` svíček v %
 |{type:'atr';period:number;op:'above'|'below';k:number} // ATR(14) vs k × průměr ATR(14) za `period` svíček
 |{type:'session';sessions:SessionKey[]} // seance podle pražské hodiny vstupu (lib/journal/analytics.ts)
 |{type:'weekday';days:number[]} // 0 = pondělí … 6 = neděle (pražské datum vstupu)
 |{type:'hour';from:number;to:number} // pražská hodina vstupu v [from, to); from > to = přes půlnoc
 |{type:'no_news';minutes:number;minSignal:number}; // žádná zpráva se signálem ≥ minSignal v okně ±minutes kolem vstupu
export type ConditionType=Condition['type'];
export type SlType='pips'|'pct'|'atr';
export type TpType='r'|'pips'|'pct'|'signal'|'none';
export type SpreadGroup='fx_major'|'fx_jpy'|'fx_other'|'metal'|'index'|'stock'|'crypto';
export type StrategyRules={
 version:1;
 entry:Condition[]; // „a zároveň“
 direction:'long'|'short'|'score';
 exit:{sl:{type:SlType;value:number};tp:{type:TpType;value:number};maxBars:number|null};
 sizing:{riskPct:number;capital:number};
 costs:{commissionPct:number;spread:Partial<Record<SpreadGroup,number>>}; // spread: přepis výchozích hodnot podle skupiny (jednotka viz SPREAD_UNIT)
};
export const DATA_CONDITIONS:ConditionType[]=['score','strength','cot','no_news']; // podmínky s daty Tradee (mohou chybět)
export const CONDITION_LABELS:Record<ConditionType,string>={score:'Skóre Tradee',strength:'Síla měn',cot:'COT',ma:'Cena vs. MA',ma_cross:'Křížení MA',breakout:'Průraz',ma_distance:'Vzdálenost od MA',rsi:'RSI',change:'Změna ceny',atr:'Volatilita (ATR)',session:'Seance',weekday:'Den v týdnu',hour:'Hodina',no_news:'Bez zpráv'};
// výchozí podoba každé podmínky (pro „přidat podmínku“ v editoru)
export const DEFAULT_CONDITIONS:{[K in ConditionType]:Extract<Condition,{type:K}>}={
 score:{type:'score',op:'>',value:20,days:5},
 strength:{type:'strength',op:'>',value:0},
 cot:{type:'cot',op:'long',value:0},
 ma:{type:'ma',kind:'sma',period:200,op:'above'},
 ma_cross:{type:'ma_cross',kind:'ema',fast:20,slow:50,dir:'up'},
 breakout:{type:'breakout',period:20,dir:'up'},
 ma_distance:{type:'ma_distance',kind:'ema',period:20,op:'<',value:1},
 rsi:{type:'rsi',period:14,op:'<',value:30},
 change:{type:'change',bars:24,op:'>',value:0.5},
 atr:{type:'atr',period:100,op:'above',k:1},
 session:{type:'session',sessions:['london','overlap']},
 weekday:{type:'weekday',days:[0,1,2,3,4]},
 hour:{type:'hour',from:8,to:17},
 no_news:{type:'no_news',minutes:60,minSignal:2},
};
export const DEFAULT_RULES:StrategyRules={version:1,entry:[],direction:'long',exit:{sl:{type:'atr',value:1.5},tp:{type:'r',value:2},maxBars:null},sizing:{riskPct:1,capital:10000},costs:{commissionPct:0,spread:{}}};

// ---- trh: skupina, velikost bodu, výchozí spread
// Velikost bodu (pip): FX s JPY 0,01, ostatní FX 0,0001, kovy 0,01; indexy, akcie, krypto a měnové indexy = 1 cenová jednotka.
// Spread: FX a kovy v bodech (pips), indexy v bodech indexu, akcie a krypto v % ceny.
export const DEFAULT_SPREADS:Record<SpreadGroup,number>={fx_major:1,fx_jpy:1.5,fx_other:2,metal:3,index:1,stock:0.05,crypto:0.1};
export const SPREAD_UNIT:Record<SpreadGroup,'pips'|'points'|'pct'>={fx_major:'pips',fx_jpy:'pips',fx_other:'pips',metal:'pips',index:'points',stock:'pct',crypto:'pct'};
export const SPREAD_LABELS:Record<SpreadGroup,string>={fx_major:'FX majors',fx_jpy:'JPY páry',fx_other:'Ostatní FX',metal:'Kovy',index:'Indexy',stock:'Akcie',crypto:'Krypto'};
const MAJORS=new Set(['EUR/USD','GBP/USD','USD/JPY','USD/CHF','USD/CAD','AUD/USD','NZD/USD']);
const FX=/^([A-Z]{3})\/([A-Z]{3})$/,METAL=/^(XAU|XAG|XPT|XPD)|^(GC|SI|PL|PA)=F$/;
const CCY_INDEX=new Set(fxCurrencies);
export const isCurrencyIndex=(id:string)=>CCY_INDEX.has(id); // měnové indexy (skupina 'currency' v lib/markets.ts); jiné tříznakové tickery (JPM) jsou akcie
export type InstrumentSpec={group:SpreadGroup;pip:number;base:string|null;quote:string|null};
export function instrumentSpec(id:string):InstrumentSpec{
 const m=id.match(FX);
 if(m){const jpy=m[1]==='JPY'||m[2]==='JPY';return {group:MAJORS.has(id)?'fx_major':jpy?'fx_jpy':'fx_other',pip:jpy?0.01:0.0001,base:m[1],quote:m[2]}}
 if(METAL.test(id))return {group:'metal',pip:0.01,base:null,quote:null};
 if(id.startsWith('^')||isCurrencyIndex(id))return {group:'index',pip:1,base:null,quote:null}; // ^NDX, ^GSPC; měnové indexy (USD, EUR…)
 if(id.endsWith('-USD'))return {group:'crypto',pip:1,base:null,quote:null};
 return {group:'stock',pip:1,base:null,quote:null};
}
export const defaultSpread=(id:string)=>{const g=instrumentSpec(id).group;return {group:g,value:DEFAULT_SPREADS[g],unit:SPREAD_UNIT[g]}};
// spread v cenových jednotkách pro daný trh a cenu (procentní skupiny se počítají z ceny)
export function spreadPrice(id:string,price:number,rules:Pick<StrategyRules,'costs'>):number{
 const s=instrumentSpec(id),v=rules.costs.spread[s.group]??DEFAULT_SPREADS[s.group];
 return SPREAD_UNIT[s.group]==='pct'?v/100*price:v*s.pip;
}

// ---- normalizace (vstup z API/DB → platná pravidla; neznámé podmínky se zahodí, čísla se ořežou do rozsahu)
type O=Record<string,unknown>;
const obj=(x:unknown):O=>x&&typeof x==='object'&&!Array.isArray(x)?x as O:{};
function num(x:unknown,def:number,min:number,max:number,int=false){
 const n=typeof x==='number'?x:typeof x==='string'&&x.trim()!==''?Number(x):NaN;
 if(!Number.isFinite(n))return def;
 const v=Math.min(max,Math.max(min,n));return int?Math.round(v):v;
}
const pick=<T extends string>(x:unknown,allowed:readonly T[],def:T):T=>allowed.includes(x as T)?x as T:def;
const KINDS=['sma','ema'] as const,CMP=['>','<'] as const,SESS=['asia','london','overlap','ny','off'] as const;
export function normalizeCondition(raw:unknown):Condition|null{
 const x=obj(raw),t=x.type as ConditionType;
 if(!(t in DEFAULT_CONDITIONS))return null;
 const d=DEFAULT_CONDITIONS[t] as O,P=(k:string,min:number,max:number,int=false)=>num(x[k],d[k] as number,min,max,int);
 switch(t){
  case 'score':return {type:t,op:pick(x.op,['>','<','rising','falling'],'>'),value:P('value',-100,100),days:P('days',1,365,true)};
  case 'strength':return {type:t,op:pick(x.op,CMP,'>'),value:P('value',-1000,1000)};
  case 'cot':return {type:t,op:pick(x.op,['long','short','>','<'],'long'),value:P('value',-1e9,1e9)};
  case 'ma':return {type:t,kind:pick(x.kind,KINDS,'sma'),period:P('period',1,1000,true),op:pick(x.op,['above','below'],'above')};
  case 'ma_cross':return {type:t,kind:pick(x.kind,KINDS,'ema'),fast:P('fast',1,1000,true),slow:P('slow',2,1000,true),dir:pick(x.dir,['up','down'],'up')};
  case 'breakout':return {type:t,period:P('period',1,1000,true),dir:pick(x.dir,['up','down'],'up')};
  case 'ma_distance':return {type:t,kind:pick(x.kind,KINDS,'ema'),period:P('period',1,1000,true),op:pick(x.op,CMP,'<'),value:P('value',-100,100)};
  case 'rsi':return {type:t,period:P('period',2,200,true),op:pick(x.op,['>','<','cross_up','cross_down'],'<'),value:P('value',0,100)};
  case 'change':return {type:t,bars:P('bars',1,1000,true),op:pick(x.op,CMP,'>'),value:P('value',-100,1000)};
  case 'atr':return {type:t,period:P('period',2,1000,true),op:pick(x.op,['above','below'],'above'),k:P('k',0.1,10)};
  case 'session':{const s=Array.isArray(x.sessions)?SESS.filter(k=>(x.sessions as unknown[]).includes(k)):[...(d.sessions as SessionKey[])];return {type:t,sessions:s}}
  case 'weekday':{const s=Array.isArray(x.days)?[0,1,2,3,4,5,6].filter(k=>(x.days as unknown[]).map(Number).includes(k)):[...(d.days as number[])];return {type:t,days:s}}
  case 'hour':return {type:t,from:P('from',0,23,true),to:P('to',0,24,true)};
  case 'no_news':return {type:t,minutes:P('minutes',0,1440,true),minSignal:P('minSignal',0,3)};
 }
 return null;
}
export function normalizeRules(raw:unknown):StrategyRules{
 const x=obj(raw),D=DEFAULT_RULES,ex=obj(x.exit),sl=obj(ex.sl),tp=obj(ex.tp),sz=obj(x.sizing),co=obj(x.costs),sp=obj(co.spread);
 const slType=pick(sl.type,['pips','pct','atr'],D.exit.sl.type),tpType=pick(tp.type,['r','pips','pct','signal','none'],D.exit.tp.type);
 const spread:Partial<Record<SpreadGroup,number>>={};
 for(const g of Object.keys(DEFAULT_SPREADS) as SpreadGroup[])if(sp[g]!==undefined&&sp[g]!==null&&sp[g]!==''){const v=num(sp[g],NaN,0,1e6);if(Number.isFinite(v))spread[g]=v}
 const mb=ex.maxBars===null||ex.maxBars===undefined||ex.maxBars===''||ex.maxBars===0?null:num(ex.maxBars,0,1,100000,true)||null;
 return {
  version:1,
  entry:(Array.isArray(x.entry)?x.entry:[]).map(normalizeCondition).filter((c):c is Condition=>c!==null).slice(0,20),
  direction:pick(x.direction,['long','short','score'],D.direction),
  exit:{sl:{type:slType,value:num(sl.value,slType===D.exit.sl.type?D.exit.sl.value:slType==='pct'?1:20,0.0001,1e6)},
   tp:{type:tpType,value:num(tp.value,tpType==='r'?2:tpType==='pct'?2:40,0,1e6)},maxBars:mb},
  sizing:{riskPct:num(sz.riskPct,D.sizing.riskPct,0.01,100),capital:num(sz.capital,D.sizing.capital,1,1e12)},
  costs:{commissionPct:num(co.commissionPct,0,0,1000),spread},
 };
}
// problémy, kvůli kterým běh nedává smysl (česky, pro API/UI)
export function rulesIssues(r:StrategyRules):string[]{
 const out:string[]=[];
 if(!r.entry.length)out.push('Přidej aspoň jednu vstupní podmínku.');
 for(const c of r.entry){
  if(c.type==='ma_cross'&&c.fast>=c.slow)out.push('Křížení MA: rychlá MA musí mít kratší periodu než pomalá.');
  if(c.type==='hour'&&c.from===c.to)out.push('Hodina: začátek a konec nesmí být stejné.');
  if((c.type==='session'&&!c.sessions.length)||(c.type==='weekday'&&!c.days.length))out.push(`${CONDITION_LABELS[c.type]}: vyber aspoň jednu možnost.`);
 }
 if((r.exit.tp.type==='r'||r.exit.tp.type==='pips'||r.exit.tp.type==='pct')&&r.exit.tp.value<=0)out.push('Take profit musí být větší než nula.');
 return out;
}
