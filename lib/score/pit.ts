// Skóre k datu (point-in-time): plné neměnné snímky skóre se vstupy, pravidly, vahami a příspěvky,
// vyhledání stavu k času t (nejbližší snímek ≤ t), rozdíly mezi snímky a deterministické vysvětlení „Proč?“.
// Čistá logika bez DB (DB: lib/score/pit-store.ts); kontrola: node --experimental-strip-types scripts/check-pit.mjs
//
//  • Snímek = výsledek marketScore v čase `at` + u každé složky přesná čísla, ze kterých vznikla (hodnota, jednotka,
//    období, datum vydání a zveřejnění, odkdy byla v Tradee, zdroj, transformace), porovnávaná veličina x a pravidlo
//    (prahy z lib/fundamentals/breakdown.ts THRESHOLDS), které x převedlo na −2…+2.
//  • Snímek se nikdy nepřepisuje: klíč (trh, druh, čas), zápis jen INSERT IGNORE. Druhy: capture (každé plánované
//    uložení), daily (první snímek dne – kanonický denní), backfill (rekonstruováno z historie, bez vstupů).
//  • Žádný generovaný text: vysvětlení skládá jen uložená čísla a pravidla.
import type {FundamentalData} from '../fundamentals.ts';
import {seasonalStats,cotStats,type MarketData,type PriceData} from '../score-engine.ts';
import {THRESHOLDS,RETAIL_LONG,bucket,retailScore,clamp2,macroSide,MACRO_READ,tePmi,retailOfficial,cotPairSignal,monthName,pctChange,type MacroSide} from '../fundamentals/breakdown.ts';
import {parseRetail} from '../reports.ts';
import {marketScore,commodityCot,assetNames} from '../markets.ts';
import {METHOD_V3,METHOD_REVISION,WEIGHTS,COMPONENTS,type V3Part,type ComponentId} from './v3.ts';
import {cotPublishedAt} from '../cot-dates.ts';

export const PIT_SCHEMA=1;
export type PitInput={side:string|null;label:string;value:number|null;unit:string;period:string|null;
 /** datum vydání statistiky / rozhodnutí */ releasedAt:string|null;
 /** datum zveřejnění zdrojem (COT pátek, stránka banky) */ publishedAt:string|null;
 /** odkdy hodnotu Tradee měla (stažení / ověření) */ availableAt:string|null;
 source:string|null;url:string|null;transform:string|null};
export type PitScale='pm2'|'signal'|'points';
export type PitPart={id:string;label:string;weight:number;
 /** −2…+2 (v3), −1…+1 (technický model), null = chybí / zastaralé / u rekonstrukce neznámé */ value:number|null;
 /** body ke skóre */ contribution:number|null;
 status:'ok'|'missing'|'stale';missingReason:string|null;detail:string;
 /** porovnávaná veličina, ze které pravidlo udělalo hodnotu (rozdíl BASE − QUOTE, signál, podíl long …) */ x:number|null;xLabel:string|null;
 /** pravidlo převodu x → hodnota */ rule:string|null;
 inputs:PitInput[];period:string|null;publishedAt:string|null;availableAt:string|null;asOf:string|null;ageMs:number|null;window:string|null;scale:PitScale};
export type PitKind='capture'|'daily'|'backfill';
export type PitSnapshot={market:string;at:string;kind:PitKind;method:string;version:string;score:number|null;coverage:number|null;
 reconstructed:boolean;source:string;note:string|null;parts:PitPart[]};

export const RECONSTRUCTED_NOTE='rekonstruováno z historie';
const DAY=86400000;
const iso=(ms:number|null|undefined)=>ms===null||ms===undefined||!Number.isFinite(ms)?null:new Date(ms).toISOString();
const r4=(n:number)=>{const v=Math.round(n*1e4)/1e4;return v===0?0:v};
const r2=(n:number)=>Math.round(n*100)/100; // stejné zaokrouhlení rozdílu jako macroRow v breakdown.ts
/** Číslo česky se znaménkem: +0,6 / −1,25 */
export const cz=(n:number|null|undefined,d=2)=>n===null||n===undefined||!Number.isFinite(n)?'—':(n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('cs-CZ',{maximumFractionDigits:d});
const plain=(n:number,d=2)=>(n<0?'−':'')+Math.abs(n).toLocaleString('cs-CZ',{maximumFractionDigits:d});
/** „6. 11.“ (Praha); datum bez času YYYY-MM-DD se bere jako den. */
export function dayMonth(s:string|null|undefined){if(!s)return '';const t=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00Z':s);return Number.isFinite(t)?new Date(t).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric'}).replace(/\s/g,' '):s}
/** „6. 11. 14:00“ (Praha) */
export function dayMonthTime(s:string|number|null|undefined){if(s===null||s===undefined)return '';const t=typeof s==='number'?s:Date.parse(s);return Number.isFinite(t)?new Date(t).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):String(s)}
/** Den v Praze YYYY-MM-DD (klíč kanonického denního snímku). */
export const pragueDay=(ms:number)=>new Date(ms).toLocaleDateString('sv-SE',{timeZone:'Europe/Prague'});

// ---------- pravidla (stejné prahy jako breakdown.ts) ----------
const thr=(t:readonly [number,number],u='')=>`±1 od ${plain(t[0])}${u}, ±2 od ${plain(t[1])}${u}`;
/** Převod porovnávané veličiny x na −2…+2 přesně jako lib/fundamentals/breakdown.ts. */
export function mapValue(id:string,x:number|null):number|null{
 if(x===null||!Number.isFinite(x))return null;
 switch(id){
  case 'cot':case 'gdp':case 'retailSales':case 'mpmi':case 'spmi':case 'inflation':case 'seasonality':{const t=THRESHOLDS[id];return bucket(x,t[0],t[1])}
  case 'trend':return Math.abs(x)>=.99?2*Math.sign(x):x>0?1:x<0?-1:0;
  case 'retailPositions':return retailScore(x);
  case 'rates':return clamp2(x);
  case 'employment':return Math.max(-2,Math.min(2,Math.round(x)));
  default:return null;
 }
}
/** Text pravidla včetně toho, kam x padlo: „rozdíl +0,62 p. b. ≥ 0,5 → +1 (±1 od 0,5, ±2 od 1,5)“. */
export function ruleText(id:string,x:number|null):string|null{
 const v=mapValue(id,x);
 const unit=id==='mpmi'||id==='spmi'?' b.':id==='gdp'||id==='retailSales'||id==='inflation'?' p. b.':'';
 if(id in THRESHOLDS){const t=THRESHOLDS[id as keyof typeof THRESHOLDS],rule=thr(t,unit);if(x===null||v===null)return 'Pravidlo: '+rule+'.';
  const a=Math.abs(x),edge=a>=t[1]?`|${plain(x,3)}| ≥ ${plain(t[1])}`:a>=t[0]?`|${plain(x,3)}| ≥ ${plain(t[0])}`:`|${plain(x,3)}| < ${plain(t[0])}`;
  return `${edge}${unit} → ${cz(v,0)} (${rule}).`}
 if(id==='trend')return x===null?'Pravidlo: všechny 3 hlasy stejným směrem = ±2, převaha 2 : 1 = ±1.':`hlasy ${cz(x,2)} → ${cz(v,0)} (všechny 3 hlasy = ±2, převaha 2 : 1 = ±1).`;
 if(id==='retailPositions'){const rule=`long ≥ ${RETAIL_LONG.minus2} % = −2, ≥ ${RETAIL_LONG.minus1} % = −1, ≤ ${RETAIL_LONG.plus1} % = +1, ≤ ${RETAIL_LONG.plus2} % = +2 (kontrariánsky)`;return x===null?'Pravidlo: '+rule+'.':`long ${plain(x,1)} % → ${cz(v,0)} (${rule}).`}
 if(id==='rates')return x===null?'Pravidlo: (krok + výhled) BASE − QUOTE, omezeno na ±2.':`(krok + výhled) rozdíl ${cz(x,0)} → ${cz(v,0)} (omezeno na ±2).`;
 if(id==='employment')return x===null?'Pravidlo: hodnocení trhu práce BASE − QUOTE.':`rozdíl hodnocení ${cz(x,0)} → ${cz(v,0)}.`;
 return null;
}

// ---------- vstupy složek ----------
type Ex={inputs:PitInput[];x:number|null;xLabel:string|null;rule:string|null};
const NAME:Record<string,string>={gdp:'HDP q/q',retailSales:'maloobchod m/m',mpmi:'výrobní PMI',spmi:'PMI služeb',inflation:'inflace y/y'};
const unitOf=(id:string)=>id==='mpmi'||id==='spmi'?'b.':'%';
function macroInput(data:FundamentalData,c:string,id:string,m:MacroSide,now:number):PitInput{
 const te=tePmi(data,c,id,now),ro=te?null:retailOfficial(data,c,id,now),o=data.observations?.[c]?.[id];
 const base={side:c,label:`${c} ${NAME[id]}`,value:m.x,unit:unitOf(id),period:m.period??null,url:m.sourceUrl??null};
 if(te)return {...base,releasedAt:null,publishedAt:null,availableAt:te.fetchedAt,source:'Trading Economics – '+te.publisher,transform:null};
 if(ro)return {...base,releasedAt:ro.releasedAt??null,publishedAt:ro.releasedAt??null,availableAt:ro.fetchedAt,source:ro.source,transform:ro.kind==='q/q'?`q/q ${plain(ro.value)} % ÷ 3 ≈ m/m`:null};
 if(m.ff)return {...base,releasedAt:iso(m.ff.releasedAt),publishedAt:iso(m.ff.releasedAt),availableAt:null,source:'ForexFactory',transform:m.ff.kind==='q/q'&&id==='retailSales'?`q/q ${plain(m.ff.value)} % ÷ 3 ≈ m/m`:null};
 const qq=id==='retailSales'&&m.x!==null&&pctChange(o?.value,'mm')===null;
 return {...base,releasedAt:null,publishedAt:null,availableAt:m.x===null?null:o?.checkedAt??null,source:m.x===null?null:'ověřené pozorování',transform:qq?`q/q ${plain(pctChange(o?.value,'qq') as number)} % ÷ 3 ≈ m/m`:null};
}
function priceInputs(price:PriceData|undefined):PitInput[]{
 if(!price)return [];
 const p=(label:string,value:number,transform:string|null=null):PitInput=>({side:null,label,value,unit:'',period:price.asOf,releasedAt:null,publishedAt:price.asOf,availableAt:price.checkedAt,source:'Cenová historie',url:price.sourceUrl,transform});
 return [p('Denní reference',price.reference),p('GMA50',price.gma50,'geometrický průměr 50 dní'),p('GMA200',price.gma200,'geometrický průměr 200 dní')];
}
function trendEx(price:PriceData|undefined):Ex{
 const x=price&&Number.isFinite(price.trend)?r4(price.trend):null;
 return {inputs:priceInputs(price),x,xLabel:'hlasy ref/GMA50, ref/GMA200, GMA50/GMA200 (−1…+1)',rule:ruleText('trend',x)};
}
function seasonEx(price:PriceData|undefined,month:number):Ex{
 const s=seasonalStats(price,month),span=s.years.length?`${s.years[0].year}–${s.years.at(-1)!.year}`:null;
 const inp=(label:string,value:number,unit:string,transform:string|null=null):PitInput=>({side:null,label,value,unit,period:span,releasedAt:null,publishedAt:null,availableAt:price?.checkedAt??null,source:'Cenová historie',url:price?.sourceUrl??null,transform});
 const x=price&&s.signal!==null?r4(s.signal):null;
 return {inputs:price&&s.n?[inp(`Průměr ${monthName[month-1]}`,r4(s.avg),'%','průměr log výnosů'),inp('Roky s růstem',s.positive,`z ${s.n}`),inp('Směrodatná odchylka',r4(s.sd),'%')]:[],x,xLabel:'sezónní signál = clip(průměr / odchylka) × konzistence × N/(N+10)',rule:ruleText('seasonality',x)};
}
function cotEx(market:MarketData,base:string,quote:string):Ex{
 const cot=cotPairSignal(market,base,quote);
 const inputs:PitInput[]=(cot?.parts||[]).map(([c,p])=>({side:c,label:`COT ${c} · signál fondů`,value:r4(p.signal),unit:'',period:p.date,releasedAt:null,publishedAt:new Date(cotPublishedAt(p.date)).toISOString().slice(0,10),availableAt:market.cot[c]?.checkedAt??null,source:'CFTC TFF (leveraged funds)',url:p.url,transform:`60 % × clip(net/OI ${plain(p.net*100,1)} % / 25 %) + 40 % × clip(změna 4 t. / 10 %)`}));
 const x=cot?r4(cot.signal):null;
 const xLabel=quote==='USD'?`signál ${base} (USD Index je jen proxy)`:base==='USD'?`−signál ${quote} (USD Index je jen proxy)`:`(signál ${base} − signál ${quote}) / 2`;
 return {inputs,x,xLabel,rule:ruleText('cot',x)};
}
function factorInputs(data:FundamentalData,c:string,f:'decision'|'guidance'|'labor'):PitInput|null{
 const cur=data.currencies[c],fa=cur?.factors?.[f],src=fa?data.sources[fa.source]:undefined;
 if(!cur||!fa||fa.value===null||![-1,0,1].includes(fa.value))return null;
 const label=f==='decision'?`${c} poslední krok banky`:f==='guidance'?`${c} výhled banky`:`${c} trh práce (banka)`;
 return {side:c,label,value:fa.value,unit:'',period:f==='labor'?data.observations?.[c]?.employment?.period??null:cur.decisionDate,releasedAt:f==='labor'?null:cur.decisionDate,publishedAt:src?.publishedAt??null,availableAt:src?.checkedAt??null,source:src?.label??cur.bank,url:src?.url??null,
  transform:f==='decision'?'zvýšení +1 · ponechání 0 · snížení −1':f==='guidance'?'zpřísnění +1 · neutrální 0 · uvolnění −1':'napjatý +1 · stabilní 0 · slabý −1'};
}
/** Vstupy všech 11 složek FX páru BASE/QUOTE (stejné výpočty jako breakdown.ts). */
export function pairExplain(pair:string,data:FundamentalData,market:MarketData,now:number):Record<ComponentId,Ex>{
 const [base,quote]=pair.split('/'),price=market.prices[pair],out={} as Record<ComponentId,Ex>;
 out.cot=cotEx(market,base,quote);
 for(const id of ['gdp','retailSales','mpmi','spmi','inflation'] as const){
  const A=macroSide(data,base,id,MACRO_READ[id],now),B=macroSide(data,quote,id,MACRO_READ[id],now);
  const x=A.x!==null&&B.x!==null?r2(A.x-B.x):null;
  out[id]={inputs:[macroInput(data,base,id,A,now),macroInput(data,quote,id,B,now)],x,xLabel:`${base} − ${quote} (${unitOf(id)==='%'?'p. b.':'body'})`,rule:ruleText(id,x)};
 }
 out.trend=trendEx(price);
 out.seasonality=seasonEx(price,new Date(now).getUTCMonth()+1);
 const rp=data.pairObservations?.[pair]?.retailPositions,rr=rp?.value?parseRetail(rp.value):null,long=rr&&rr.long+rr.short>0?r4(100*rr.long/(rr.long+rr.short)):null;
 out.retailPositions={inputs:rp?.value?[{side:null,label:`Retail long ${pair}`,value:long,unit:'%',period:rp.period??null,releasedAt:null,publishedAt:null,availableAt:rp.checkedAt??null,source:'Myfxbook (vzorek brokerů)',url:rp.sourceUrl||null,transform:rr?`long ${plain(rr.long,1)} / (long + short ${plain(rr.short,1)})`:null}]:[],x:long,xLabel:'podíl long v %',rule:ruleText('retailPositions',long)};
 const rates=[factorInputs(data,base,'decision'),factorInputs(data,base,'guidance'),factorInputs(data,quote,'decision'),factorInputs(data,quote,'guidance')];
 const rx=rates.every(Boolean)?(rates[0]!.value as number)+(rates[1]!.value as number)-(rates[2]!.value as number)-(rates[3]!.value as number):null;
 out.rates={inputs:rates.filter((x):x is PitInput=>!!x),x:rx,xLabel:`(krok + výhled) ${base} − ${quote}`,rule:ruleText('rates',rx)};
 const lab=[factorInputs(data,base,'labor'),factorInputs(data,quote,'labor')],lx=lab.every(Boolean)?(lab[0]!.value as number)-(lab[1]!.value as number):null;
 out.employment={inputs:lab.filter((x):x is PitInput=>!!x),x:lx,xLabel:`trh práce ${base} − ${quote}`,rule:ruleText('employment',lx)};
 return out;
}
/** Vstupy měnového indexu: vlastní čísla měny + hodnota složky v každém ze 7 párů; trend a sezonalita z ceny indexu. */
export function indexExplain(c:string,data:FundamentalData,market:MarketData,now:number):Record<ComponentId,Ex>{
 const others=Object.keys(data.currencies).filter(o=>o!==c),per=others.map(o=>[o,pairExplain(c+'/'+o,data,market,now)] as const),out={} as Record<ComponentId,Ex>;
 for(const id of COMPONENTS){
  if(id==='trend'||id==='seasonality'||id==='retailPositions')continue;
  const own=per[0]?.[1][id].inputs.filter(i=>i.side===c)??[];
  const pairs:PitInput[]=per.map(([o,e])=>{const v=mapValue(id,e[id].x);return {side:o,label:`${c}/${o}`,value:v,unit:'složka −2…+2',period:null,releasedAt:null,publishedAt:null,availableAt:null,source:null,url:null,transform:e[id].x===null?null:`x = ${cz(e[id].x,3)}`}});
  const vals=pairs.map(p=>p.value),x=vals.every(v=>v!==null)?r4((vals as number[]).reduce((s,v)=>s+v,0)/vals.length):null;
  out[id]={inputs:[...own,...pairs],x,xLabel:`průměr ${others.length} párů ${c}/…`,rule:x===null?`Průměr složky v ${others.length} párech; chybí-li v některém páru, složka indexu chybí.`:`průměr ${others.length} párů = ${cz(x,2)} (bez zaokrouhlení).`};
 }
 const price=market.prices[c];
 out.trend=trendEx(price);out.seasonality=seasonEx(price,new Date(now).getUTCMonth()+1);
 out.retailPositions={inputs:[],x:null,xLabel:null,rule:'U měnového indexu se retailové pozice nesledují.'};
 return out;
}
const latest=(xs:(string|null)[])=>xs.filter((x):x is string=>!!x).sort().at(-1)??null;
const periodOf=(inputs:PitInput[])=>{const ps=[...new Set(inputs.map(i=>i.period).filter((x):x is string=>!!x))];return ps.length?ps.join(' · '):null};

/** Plný snímek jednoho trhu v čase now. Výsledek je zmrazený (neměnný). */
export function buildSnapshot(id:string,data:FundamentalData,market:MarketData,now:number,kind:PitKind='capture'):PitSnapshot{
 const r=marketScore(data,market,id,now),at=new Date(now).toISOString();
 let parts:PitPart[];
 if(r.method===METHOD_V3){
  const ex=id.includes('/')?pairExplain(id,data,market,now):indexExplain(id,data,market,now);
  parts=(r.parts as V3Part[]).map(p=>{const e=ex[p.id];return {id:p.id,label:p.label,weight:p.weight,value:p.value,contribution:p.contribution,status:p.status,missingReason:p.missingReason,detail:p.detail,x:e.x,xLabel:e.xLabel,rule:e.rule,inputs:e.inputs,period:periodOf(e.inputs),publishedAt:latest(e.inputs.map(i=>i.publishedAt)),availableAt:latest(e.inputs.map(i=>i.availableAt)),asOf:p.asOf,ageMs:p.ageMs,window:p.window,scale:'pm2' as const}});
 }else{
  const price=market.prices[id],month=new Date(now).getUTCMonth()+1;
  parts=r.parts.map(p=>{let e:Ex={inputs:[],x:null,xLabel:null,rule:null};
   if(p.id==='trend')e={...trendEx(price),rule:'signál −1…+1 (3 hlasy) × váha.'};
   else if(p.id==='seasonality')e={...seasonEx(price,month),rule:'signál −1…+1 × váha (min. 5 dokončených let).'};
   else if(p.id==='cot'){const ct=market.legacy?.[id],s=ct?cotStats(ct,'managedMoney'):null;
    e={inputs:s&&ct?[{side:null,label:'COT managed money · net/OI',value:r4(s.netRatio*100),unit:'%',period:s.last.date,releasedAt:null,publishedAt:new Date(cotPublishedAt(s.last.date)).toISOString().slice(0,10),availableAt:ct.checkedAt,source:'CFTC Disaggregated · '+commodityCot[id],url:ct.sourceUrl,transform:s.change4===null?null:`změna 4 t. ${cz(s.change4*100,2)} p. b.`}]:[],x:p.signal,xLabel:'signál −1…+1',rule:'60 % × clip(net/OI / 25 %) + 40 % × clip(změna 4 t. / 10 %), × váha.'}}
   const ok=p.signal!==null;
   return {id:p.id,label:p.label,weight:p.weight,value:p.signal===null?null:r4(p.signal),contribution:p.contribution===null?null:r4(p.contribution),status:ok?'ok':'missing',missingReason:ok?null:'chybí nebo zastaralé',detail:p.reason,x:e.x===null?null:r4(e.x),xLabel:e.xLabel,rule:e.rule,inputs:e.inputs,period:periodOf(e.inputs),publishedAt:latest(e.inputs.map(i=>i.publishedAt)),availableAt:latest(e.inputs.map(i=>i.availableAt)),asOf:price?.asOf??null,ageMs:null,window:null,scale:'signal' as const};
  });
 }
 return deepFreeze({market:id,at,kind,method:r.method,version:r.method===METHOD_V3?METHOD_REVISION:r.method,score:r.score,coverage:r.coverage,reconstructed:false,source:'capture',note:null,parts});
}
export function deepFreeze<T>(o:T):T{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o as object))deepFreeze(v)}return o}
/** Snímky všech trhů v jednom čase (stejné `at`). */
export function captureAll(ids:string[],data:FundamentalData,market:MarketData,now:number):PitSnapshot[]{return ids.map(id=>buildSnapshot(id,data,market,now))}
/** Kopie snímku jako kanonický denní (stejný obsah i čas, druh daily). */
export const asDaily=(s:PitSnapshot):PitSnapshot=>deepFreeze({...s,kind:'daily' as const});

// ---------- rekonstrukce ze starší historie (data/score-history.json, tabulka score_snapshots) ----------
type HistPart={value?:number|null;label?:string;weight?:number;score?:number|null;status?:string;asOf?:string|null;reason?:string};
export type HistEntry={score:number|null;coverage?:number|null;method?:string|null;parts?:Record<string,HistPart>|null};
/** Záznam staré historie → snímek označený „rekonstruováno z historie“ (vstupy nejsou k dispozici). */
export function fromHistoryEntry(market:string,at:string,e:HistEntry):PitSnapshot{
 const v3=e.method===METHOD_V3;
 const parts:PitPart[]=Object.entries(e.parts||{}).map(([id,p])=>{const st=p.status==='stale'||p.status==='missing'?p.status:'ok' as const,val=v3&&typeof p.score==='number'?p.score:null;
  return {id,label:p.label||id,weight:typeof p.weight==='number'?p.weight:v3&&id in WEIGHTS?WEIGHTS[id as ComponentId]:0,value:v3?(st==='ok'?val:null):null,contribution:typeof p.value==='number'?p.value:null,status:v3?st:(typeof p.value==='number'?'ok':'missing'),missingReason:v3&&st!=='ok'?(st==='stale'?'zastaralé':'chybí data'):null,detail:p.reason||'',x:null,xLabel:null,rule:null,inputs:[],period:null,publishedAt:null,availableAt:null,asOf:p.asOf??null,ageMs:null,window:null,scale:v3?'pm2':'points'}});
 return deepFreeze({market,at:new Date(Date.parse(at)).toISOString(),kind:'backfill',method:e.method||'neznámá',version:e.method||'neznámá',score:e.score??null,coverage:e.coverage??null,reconstructed:true,source:'score-history',note:RECONSTRUCTED_NOTE+' – vstupní čísla nebyla uložena',parts});
}
export function fromHistory(h:{snapshots?:{at:string;scores:Record<string,HistEntry|undefined>}[]}|null|undefined,markets?:string[]|null):PitSnapshot[]{
 const want=markets?new Set(markets):null,out:PitSnapshot[]=[];
 for(const s of h?.snapshots||[]){if(!Number.isFinite(Date.parse(s.at)))continue;for(const [m,e] of Object.entries(s.scores||{}))if(e&&(!want||want.has(m)))out.push(fromHistoryEntry(m,s.at,e))}
 return out.sort((a,b)=>a.at.localeCompare(b.at));
}

// ---------- vyhledání a porovnání ----------
/** Nejbližší snímek s časem ≤ t (seznam seřazený vzestupně podle at); jinak null. */
export function nearestAtOrBefore<T extends {at:string}>(sorted:T[],t:number):T|null{
 let lo=0,hi=sorted.length-1,best=-1;
 while(lo<=hi){const mid=(lo+hi)>>1;if(Date.parse(sorted[mid].at)<=t){best=mid;lo=mid+1}else hi=mid-1}
 return best<0?null:sorted[best];
}
/** Otisk obsahu (skóre, hodnoty, stavy, příspěvky, období vstupů) – shodný otisk = beze změny. */
export function fingerprint(s:Pick<PitSnapshot,'score'|'method'|'version'|'parts'>):string{
 const str=[s.method,s.version,s.score??'n',...s.parts.map(p=>`${p.id}:${p.value??'n'}:${p.status}:${p.contribution??'n'}:${p.inputs.map(i=>`${i.value??'n'}@${i.period??''}`).join(',')}`)].join('|');
 let h1=0x811c9dc5,h2=0x01000193^str.length;
 for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1=Math.imul(h1^c,16777619);h2=Math.imul(h2^c,2246822519)}
 return (h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0');
}
export type PitChange={id:string;label:string;from:number|null;to:number|null;fromC:number|null;toC:number|null;why:string;text:string};
const fmtVal=(p:PitPart|undefined)=>!p?'—':p.status!=='ok'||p.value===null?(p?.status==='stale'?'zastaralé':p?.scale==='points'?cz(p.contribution,1)+' b.':'chybí'):cz(p.value,p.scale==='pm2'?(p.value%1?2:0):2);
const inKey=(i:PitInput)=>(i.side||'')+'|'+i.label;
/** Proč se složka změnila – jen z uložených čísel. */
function changeWhy(a:PitPart|undefined,b:PitPart,prevCoverage:number|null,coverage:number|null):string{
 if(!a)return 'nová složka';
 if(a.status!==b.status){if(b.status==='stale')return 'data zastarala'+(b.ageMs!==null?` (stáří ${Math.floor(b.ageMs/DAY)} d)`:'');if(b.status==='missing')return b.missingReason||'chybí data';if(a.status!=='ok'&&b.status==='ok')return 'data opět dostupná'+(b.publishedAt||b.availableAt?` (${dayMonth(b.publishedAt||b.availableAt)})`:'')}
 if(!a.inputs.length&&!b.inputs.length)return a.value===b.value&&a.contribution!==b.contribution?`přepočet vah (dostupné váhy ${prevCoverage??'?'} → ${coverage??'?'} %)`:'vstupy rekonstruovaného záznamu nejsou uložené';
 const prev=new Map(a.inputs.map(i=>[inKey(i),i])),fresh=b.inputs.filter(i=>{const o=prev.get(inKey(i));return !o||o.period!==i.period||o.publishedAt!==i.publishedAt||o.releasedAt!==i.releasedAt});
 if(fresh.length){const d=latest(fresh.map(i=>i.publishedAt||i.releasedAt||i.availableAt||null));const who=[...new Set(fresh.map(i=>i.side).filter(Boolean))].join(', ');return `nová data${who?' '+who:''}${d?' '+dayMonth(d):''}`}
 const moved=b.inputs.filter(i=>{const o=prev.get(inKey(i));return o&&o.value!==i.value});
 if(moved.length)return moved.slice(0,3).map(i=>`${i.label} ${cz(prev.get(inKey(i))!.value,2)} → ${cz(i.value,2)}${i.unit&&i.unit.length<4?' '+i.unit:''}`).join(', ');
 if(a.value===b.value&&a.contribution!==b.contribution)return `přepočet vah (dostupné váhy ${prevCoverage??'?'} → ${coverage??'?'} %)`;
 return 'beze změny vstupů';
}
/** Rozdíl dvou snímků téhož trhu: seznam změněných složek s důvodem („COT +1 → +2 (nová data 6. 11.)“). */
export function diffSnapshots(prev:PitSnapshot|null,cur:PitSnapshot):PitChange[]{
 if(!prev)return [];
 if(prev.method!==cur.method||(!prev.reconstructed&&!cur.reconstructed&&prev.version!==cur.version)){const text=prev.method!==cur.method?`Změna metodiky ${prev.method} → ${cur.method}`:`Revize metodiky ${prev.version} → ${cur.version}`;return [{id:'method',label:'Metodika',from:null,to:null,fromC:null,toC:null,why:text,text}]}
 const before=new Map(prev.parts.map(p=>[p.id,p])),out:PitChange[]=[];
 for(const b of cur.parts){const a=before.get(b.id);
  if(a&&a.value===b.value&&a.status===b.status&&(a.contribution===b.contribution||Math.abs((a.contribution??0)-(b.contribution??0))<0.005))continue;
  const why=changeWhy(a,b,prev.coverage,cur.coverage),valueSame=a&&a.value===b.value&&a.status===b.status;
  const text=valueSame?`${b.label} ${cz(a!.contribution,1)} → ${cz(b.contribution,1)} b. (${why})`:`${b.label} ${fmtVal(a)} → ${fmtVal(b)} (${why})`;
  out.push({id:b.id,label:b.label,from:a?.value??null,to:b.value,fromC:a?.contribution??null,toC:b.contribution,why,text});
 }
 return out;
}

// ---------- vysvětlení „Proč?“ ----------
export type Explanation={title:string;value:string;inputs:{label:string;value:string;meta:string[];url:string|null;transform:string|null}[];x:string|null;rule:string|null;weight:string;contribution:string;status:string|null;reconstructed:boolean};
const unitText=(i:PitInput)=>i.value===null?'—':i.unit==='%'?plain(i.value,3)+' %':i.unit==='b.'?plain(i.value,2):i.unit?`${plain(i.value,3)} ${i.unit}`:plain(i.value,4);
/** Deterministické vysvětlení jedné složky ze snímku (vstupy → x → pravidlo → hodnota → váha → příspěvek). */
export function explainPart(p:PitPart,s:Pick<PitSnapshot,'coverage'|'reconstructed'|'method'>):Explanation{
 const inputs=p.inputs.map(i=>({label:i.label,value:unitText(i),url:i.url,transform:i.transform,meta:[i.period?`období ${i.period}`:'',i.releasedAt?`vydáno ${dayMonth(i.releasedAt)}`:'',i.publishedAt&&i.publishedAt!==i.releasedAt?`zveřejněno ${dayMonth(i.publishedAt)}`:'',i.availableAt?`v Tradee od ${dayMonthTime(i.availableAt)}`:'',i.source?`zdroj ${i.source}`:''].filter(Boolean)}));
 const contribution=p.contribution===null?'nezapočteno':p.scale==='pm2'&&p.value!==null&&s.coverage?`${cz(p.value,2)} / 2 × váha ${p.weight} / ${s.coverage} % dostupných vah × 100 = ${cz(p.contribution,2)} b.`:p.scale==='signal'&&p.value!==null?`signál ${cz(p.value,3)} × váha ${p.weight} = ${cz(p.contribution,2)} b.`:`${cz(p.contribution,2)} b.`;
 return {title:p.label,value:fmtVal(p),inputs,x:p.x===null?null:`${p.xLabel??'x'} = ${cz(p.x,3)}`,rule:p.rule,weight:`${p.weight} %`,contribution,status:p.status==='ok'?null:`${p.missingReason||p.status}: ${p.detail}`,reconstructed:s.reconstructed};
}
/** Přepočet hodnoty složky jen z uložených vstupů snímku (kontrola soběstačnosti snímku). null = nelze (index, technický model, rekonstrukce). */
export function recompute(p:PitPart,market:string):number|null{
 const [base,quote]=market.split('/');if(!quote||p.scale!=='pm2'||!p.inputs.length)return null;
 const side=(c:string,label?:RegExp)=>p.inputs.find(i=>i.side===c&&(!label||label.test(i.label)))?.value??null;
 let x:number|null=null;
 if(p.id==='cot'){const a=side(base),b=side(quote);x=quote==='USD'?a:base==='USD'?(b===null?null:-b):a!==null&&b!==null?r4((a-b)/2):null}
 else if(p.id in NAME){const a=side(base),b=side(quote);x=a!==null&&b!==null?r2(a-b):null}
 else if(p.id==='rates'){const v=[side(base,/krok/),side(base,/výhled/),side(quote,/krok/),side(quote,/výhled/)];x=v.every(n=>n!==null)?(v[0]!+v[1]!)-(v[2]!+v[3]!):null}
 else if(p.id==='employment'){const a=side(base),b=side(quote);x=a!==null&&b!==null?a-b:null}
 else if(p.id==='retailPositions')x=p.inputs[0]?.value??null;
 else return mapValue(p.id,p.x); // trend, sezonalita: x je přímo uložená veličina z ceny
 return mapValue(p.id,x);
}

// ---------- směr: karta páru vs karta měny ----------
/** „Kladné = podpora USD vůči CAD“ / u indexu „vůči ostatním 7 měnám“. */
export function directionText(market:string,others=7){const [b,q]=market.split('/');return q?`Kladné = podpora ${b} vůči ${q}`:`Kladné = podpora ${b} vůči ostatním ${others} měnám (průměr párů)`}
/** Komu složka pomáhá: kladná → BASE, záporná → QUOTE (u indexu „ostatním“). */
export function stance(p:Pick<PitPart,'value'|'status'>,market:string):{side:'pro'|'proti'|'neutral'|'none';text:string}{
 const [b,q]=market.split('/');
 if(p.status!=='ok'||p.value===null)return {side:'none',text:'nezapočteno'};
 if(p.value===0)return {side:'neutral',text:'neutrální'};
 return p.value>0?{side:'pro',text:`pro ${b}`}:{side:'proti',text:q?`pro ${q}`:`proti ${b}`};
}
/** Smíšené signály: které složky táhnou pro BASE a které proti (nic se neskrývá). */
export function mixedSignals(parts:Pick<PitPart,'id'|'label'|'value'|'status'|'contribution'>[],market:string){
 const pro=parts.filter(p=>stance(p,market).side==='pro'),proti=parts.filter(p=>stance(p,market).side==='proti');
 const sum=(xs:typeof parts)=>r2(xs.reduce((s,p)=>s+Math.abs(p.contribution??0),0));
 return {pro:pro.map(p=>p.label),proti:proti.map(p=>p.label),proPts:sum(pro),protiPts:sum(proti),mixed:pro.length>0&&proti.length>0};
}
export type CurrencyRow={id:string;label:string;own:string;ownValue:number|null;period:string|null;source:string|null;url:string|null;index:number|null;indexStatus:string};
export type CurrencyGroup={id:'trend'|'macro'|'positions'|'season';label:string;horizon:string;rows:CurrencyRow[]};
/** Karta měny: každá složka jen pro tuto měnu (vlastní čísla ze vstupů snímku indexu) + hodnota složky indexu; horizonty oddělené.
 *  Funguje pro živý snímek i pro snímek k datu (stejná data, jaká vstoupila do skóre). */
export function currencyGroups(c:string,snap:PitSnapshot):CurrencyGroup[]{
 const part=(id:string)=>snap.parts.find(p=>p.id===id);
 const row=(id:string,label:string):CurrencyRow=>{const p=part(id),own=(p?.inputs||[]).filter(i=>i.side===c);
  const ownText=id==='trend'?(p?.x===null||p?.x===undefined?'chybí':`hlasy ${cz(p.x,2)}`):id==='seasonality'?(p?.x===null||p?.x===undefined?'chybí':`signál ${cz(p.x,3)}`)
   :own.length?own.map(i=>`${i.label.replace(c+' ','')} ${i.value===null?'—':plain(i.value,2)}${i.unit==='%'?' %':''}${i.transform&&!/·/.test(i.transform)?` (${i.transform})`:''}`).join(' · ')
   :id==='cot'&&c==='USD'?'USD Index je jen proxy – rozhoduje cizí měna páru':'chybí';
  const src=id==='trend'||id==='seasonality'?p?.inputs[0]:own[0];
  return {id,label,own:ownText,ownValue:id==='trend'||id==='seasonality'?p?.x??null:own.length===1?own[0].value:own.length?own.reduce((s,i)=>s+(i.value??0),0):null,period:(id==='trend'||id==='seasonality'?p?.period:src?.period)??null,source:src?.source??null,url:src?.url??null,index:p?.status==='ok'?p.value:null,indexStatus:p?.status==='ok'?'':p?.missingReason||'chybí'}};
 const month=new Date(Date.parse(snap.at)).getUTCMonth()+1;
 return [
  {id:'trend',label:'Trend',horizon:'D1 · denní reference indexu',rows:[row('trend','Trend (GMA50/GMA200)')]},
  {id:'macro',label:'Makro',horizon:'měsíčně / čtvrtletně · poslední vydání',rows:[row('rates','Úrokové sazby (krok · výhled)'),row('inflation','Inflace y/y'),row('employment','Zaměstnanost (banka)'),row('gdp','HDP q/q'),row('mpmi','Výrobní PMI'),row('spmi','PMI služeb'),row('retailSales','Maloobchod m/m')]},
  {id:'positions',label:'Pozice',horizon:'týdně · COT (pozice k úterý, zveřejnění v pátek)',rows:[row('cot','COT fondy (signál)')]},
  {id:'season',label:'Sezonalita',horizon:`měsíc · ${monthName[month-1]}, 10 let`,rows:[row('seasonality',`Sezonalita ${monthName[month-1]}`)]},
 ];
}
/** Karta měny z živých dat. */
export const currencyCard=(c:string,data:FundamentalData,market:MarketData,now:number)=>currencyGroups(c,buildSnapshot(c,data,market,now));
/** Skóre-podobný trh, který má tradiční FX model (pár nebo index), ne technický. */
export const isFxModel=(id:string)=>!assetNames[id];

// ---------- historie pro graf ----------
export const WINDOWS={'1D':DAY,'1W':7*DAY,'1M':31*DAY,'3M':92*DAY,'1R':366*DAY} as const;
export type WindowKey=keyof typeof WINDOWS;
/** Delší okna čtou kanonické denní snímky (jinak by šlo o tisíce hodinových záznamů). */
export const dailyWindow=(w:WindowKey)=>w==='3M'||w==='1R';
/** Ponechá jen body změny (jiný otisk nebo metodika) + první a poslední. */
export function changePoints(sorted:PitSnapshot[]):PitSnapshot[]{
 const out:PitSnapshot[]=[];let last='';
 for(const s of sorted){const f=fingerprint(s);if(f!==last){out.push(s);last=f}}
 const tail=sorted.at(-1);if(tail&&out.at(-1)!==tail)out.push(tail);
 return out;
}
/** Seznam změn metodiky v řadě (svislé značky v grafu). */
export function methodChanges(sorted:PitSnapshot[]){const out:{at:string;from:string;to:string}[]=[];for(let i=1;i<sorted.length;i++){const a=sorted[i-1],b=sorted[i];if(a.method!==b.method)out.push({at:b.at,from:a.method,to:b.method});else if(!a.reconstructed&&!b.reconstructed&&a.version!==b.version)out.push({at:b.at,from:a.version,to:b.version})}return out}
/** Stav trhu ze snímku pro seznam trhů (heatmapa/tabulka). */
export function snapshotItem(s:PitSnapshot){const t=s.parts.find(p=>p.id==='trend');const tv=t?.status==='ok'&&t.x!==null?Math.sign(t.x):t?.status==='ok'&&t.value!==null?Math.sign(t.value):null;
 return {score:s.score,coverage:s.coverage??0,bias:s.score===null?'Pozastaveno – chybí podklady':s.score>0?'Bullish':s.score<0?'Bearish':'Vyrovnané',trend:(tv===null?null:tv) as 1|-1|0|null}}
