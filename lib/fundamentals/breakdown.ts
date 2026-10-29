// Přehled skóre FX páru po složkách (−2…+2). Čistá logika; kontrola: node --experimental-strip-types scripts/check-breakdown.mjs
//
// Složky −2…+2, ze kterých počítá FX skóre v3 (lib/score/v3.ts: váhy, stáří a renormalizace).
// Každá složka porovnává základní měnu páru (BASE) s kotovanou (QUOTE). Kladné číslo = podpora BASE vůči QUOTE.
// Chybějící vstup vrací score:null („chybí data“) – nikdy se nedopočítává odhadem ani nulou.
//
// Pravidla (rozdíl = BASE − QUOTE; práh t1 → ±1, t2 → ±2):
//  • COT          signál TFF leveraged funds z cotStats (60 % net/OI + 40 % změna za 4 týdny), párový stejně jako
//                 v score-engine (pár s USD = signál cizí měny, USD Index je jen proxy; kříž = polovina rozdílu).
//                 t1 0,25 · t2 0,75 (THRESHOLDS.cot).
//  • HDP          mezikvartální růst reálného HDP (q/q, p. b.). Jen měsíční/anualizovaný údaj → chybí data. t1 0,3 · t2 0,8.
//  • Sezonalita   sezónní signál aktuálního měsíce z seasonalStats (rozsah ±0,5). |s| t1 0,03 · t2 0,1.
//  • Trend        tři hlasy ceny páru vůči GMA50/GMA200 (−1, −⅓, ⅓, 1): ±1 → ±2, ±⅓ → ±1.
//  • Retail Sales meziměsíční změna maloobchodních tržeb (m/m, p. b.). t1 0,5 · t2 1,5. Zdroj: oficiální statistika
//                 (data.retailOfficial, ≤ 120 dní od konce období, jen m/m) > pozorování agenta > ForexFactory.
//  • Retail pozice kontrariánsky ze vzorku brokerů (Myfxbook) pro přesně tento pár: long ≥ 75 % → −2, ≥ 60 % → −1,
//                 ≤ 25 % → +2, ≤ 40 % → +1.
//  • mPMI / sPMI  úroveň indexu (body). Jen slovní komentář bez čísla → chybí data. t1 1,5 · t2 5. Zdroj: Trading Economics
//                 (data.tePmi, ≤ 75 dní od konce období) > pozorování agenta > ForexFactory. USD = S&P Global (srovnatelné
//                 s ostatními měnami); ISM je v detailu jen pro informaci („ISM 54,5 pro info“) a do skóre nevstupuje.
//  • Úrokové sazby součet „poslední krok“ + „výhled“ banky (každé −1/0/+1), rozdíl omezený na ±2.
//  • Inflace      meziroční inflace (y/y, p. b.); vyšší inflace = tlak na restriktivnější banku = body pro měnu. t1 0,5 · t2 1,5.
//  • Zaměstnanost hodnocení pracovního trhu bankou (faktor labor −1/0/+1), rozdíl −2…+2.
// Celkové skóre FX (−100…+100) počítá lib/score/v3.ts; `total` zde zůstává jen jako prostý součet pro kontrolu.
import type {FundamentalData} from '../fundamentals.ts';
import {cotStats,seasonalStats,type MarketData,type PriceData} from '../score-engine.ts';
import {parseRetail} from '../reports.ts';
import type {MacroValue} from '../macro/ff-macro.ts';
import {monthEnd as teMonthEnd,type TEPmiValue} from '../macro/te-pmi.ts';
import {retailPeriodEnd,type RetailValue} from '../macro/retail.ts';

export type Score=-2|-1|0|1|2;
export type BreakdownRow={id:string;label:string;score:Score|null;detail:string;info:string;asOf?:string;source?:string};
export type Breakdown={pair:string;base:string;quote:string;rows:BreakdownRow[];total:number;available:number;count:number};

export const ROWS=[
 {id:'cot',label:'COT',info:'Pozice spekulativních fondů (CFTC TFF, leveraged funds): 60 % čistá pozice / open interest a 40 % její změna za 4 týdny. U páru s USD rozhoduje cizí měna (USD Index je jen proxy). ±1 od signálu 0,25, ±2 od 0,75.'},
 {id:'gdp',label:'HDP',info:'Mezikvartální růst reálného HDP: základní měna minus kotovaná. ±1 od rozdílu 0,3 p. b., ±2 od 0,8 p. b. Měsíční ani anualizovaná čísla se nepřepočítávají.'},
 {id:'seasonality',label:'Sezonalita',info:'Výnosy páru v aktuálním měsíci za posledních 10 let: průměr / odchylka × konzistence směru (stejný signál jako v kompozitu). ±1 od 0,03, ±2 od 0,1.'},
 {id:'trend',label:'Trend',info:'Denní reference páru vůči geometrickým průměrům 50 a 200 dnů a jejich pořadí. Všechny tři hlasy stejným směrem = ±2, převaha 2 : 1 = ±1.'},
 {id:'retailSales',label:'Retail Sales',info:'Meziměsíční změna maloobchodních tržeb (u zemí se čtvrtletní řadou, např. NZD, se q/q dělí třemi). ±1 od rozdílu 0,5 p. b., ±2 od 1,5 p. b. Pozor: země publikují reálné i nominální řady.'},
 {id:'retailPositions',label:'Retail pozice',info:'Kontrariánský ukazatel ze vzorku retailových brokerů: když většina drobných obchodníků drží long, je to pro pár negativní. Long ≥ 60 % = −1, ≥ 75 % = −2; long ≤ 40 % = +1, ≤ 25 % = +2.'},
 {id:'mpmi',label:'mPMI (výroba)',info:'Index nákupních manažerů ve výrobě (50 = hranice růstu). Rozdíl úrovní ±1 od 1,5 bodu, ±2 od 5 bodů. USA podle S&P Global (srovnatelné s ostatními zeměmi), ISM jen pro informaci. Slovní komentář bez čísla se nehodnotí.'},
 {id:'spmi',label:'sPMI (služby)',info:'Index nákupních manažerů ve službách (50 = hranice růstu). Rozdíl úrovní ±1 od 1,5 bodu, ±2 od 5 bodů. USA podle S&P Global (srovnatelné s ostatními zeměmi), ISM jen pro informaci. Slovní komentář bez čísla se nehodnotí.'},
 {id:'rates',label:'Úrokové sazby',info:'Měnová politika: poslední krok banky (+1 zvýšení, −1 snížení) plus výhled (+1 zpřísnění, −1 uvolnění). Rozdíl obou bank omezený na ±2.'},
 {id:'inflation',label:'Inflace',info:'Meziroční inflace. Vyšší inflace drží banku restriktivnější, proto přidává body měně. ±1 od rozdílu 0,5 p. b., ±2 od 1,5 p. b.'},
 {id:'employment',label:'Zaměstnanost',info:'Hodnocení pracovního trhu podle poslední zprávy centrální banky (+1 napjatý, 0 stabilní, −1 slabý). Rozdíl obou měn.'},
] as const;

const fmt=(n:number,d=1)=>(n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('cs-CZ',{minimumFractionDigits:d,maximumFractionDigits:d});
const sig=(n:number)=>Number(n.toPrecision(6)).toLocaleString('cs-CZ',{maximumFractionDigits:6});
const round=(n:number,d=2)=>Math.round(n*10**d)/10**d;
/** Prahy složek [t1 → ±1, t2 → ±2] – jediný zdroj pro výpočet i vysvětlení „Proč?“ (lib/score/pit.ts). */
export const THRESHOLDS={cot:[.25,.75],gdp:[.3,.8],retailSales:[.5,1.5],mpmi:[1.5,5],spmi:[1.5,5],inflation:[.5,1.5],seasonality:[.03,.1]} as const;
/** Retail pozice (kontrariánsky): podíl long v %. */
export const RETAIL_LONG={minus2:75,minus1:60,plus1:40,plus2:25} as const;
/** Spojité číslo → −2…+2 podle prahů t1 (±1) a t2 (±2). */
export function bucket(x:number,t1:number,t2:number):Score{const v=round(x,4);return v>=t2?2:v>=t1?1:v<=-t2?-2:v<=-t1?-1:0}
/** Kontrariánské skóre z podílu long (%). */
export const retailScore=(long:number):Score=>(long>=RETAIL_LONG.minus2?-2:long>=RETAIL_LONG.minus1?-1:long<=RETAIL_LONG.plus2?2:long<=RETAIL_LONG.plus1?1:0) as Score;
export const clamp2=(n:number)=>Math.max(-2,Math.min(2,Math.round(n))) as Score;
const toNum=(s:string)=>Number(s.replace(/[−–]/g,'-').replace(',','.'));

const UNIT:Record<'qq'|'mm'|'yy',string>={qq:'(?:mezikvartálně|q\\/q)',mm:'(?:meziměsíčně|m\\/m)',yy:'(?:meziročně|y\\/y)'};
/** První procento s danou periodou změny („+0,6 % mezikvartálně“, „1,0 % y/y“); jinak null. */
export function pctChange(text:string|null|undefined,unit:'qq'|'mm'|'yy'):number|null{
 const m=new RegExp('([+\\-−–]?\\d+(?:[.,]\\d+)?)\\s*%\\s*'+UNIT[unit],'i').exec(text||'');
 return m?toNum(m[1]):null;
}
/** Úroveň PMI: první číslo ve tvaru 54,5 v rozmezí 30–70, které není procentem ani změnou; jinak null. */
export function pmiLevel(text:string|null|undefined):number|null{
 for(const m of (text||'').matchAll(/(^|[^\d.,+\-−–])(\d{2}[.,]\d)(?![\d%])(?!\s*%)/g)){const v=toNum(m[2]);if(v>=30&&v<=70)return v}
 return null;
}

type Obs={value:string|null;period:string|null;sourceUrl:string};
const obs=(data:FundamentalData,c:string,id:string):Obs|undefined=>data.observations?.[c]?.[id];
const period=(o?:Obs)=>o?.period?` (${o.period})`:'';

export const FF_URL='https://www.forexfactory.com/calendar';
const FF_MAX_AGE:Record<string,number>={mpmi:75,spmi:75,retailSales:120,retailSalesQ:200}; // dny od vydání, ze kterého hodnota pochází
/** Záložní číslo z ForexFactory (data.ffMacro): jen potvrzené/finální≈flash, ne starší než limit; maloobchod jen m/m. */
export function ffFallback(data:FundamentalData,c:string,id:string,now:number):MacroValue|null{
 const v=(data.ffMacro?.currencies?.[c] as Record<string,MacroValue|undefined>|undefined)?.[id];
 if(!v||!Number.isFinite(v.value)||v.basis==='forecast-pending'||(id==='retailSales'&&v.kind!=='m/m'&&v.kind!=='q/q'))return null;
 return now-v.releasedAt<=(FF_MAX_AGE[id==='retailSales'&&v.kind==='q/q'?'retailSalesQ':id]??75)*86400000&&now>=v.releasedAt-86400000*40?v:null;
}
const DAY=86400000;
export const TE_MAX_AGE_DAYS=75,RETAIL_MAX_AGE_DAYS=120,RETAIL_Q_MAX_AGE_DAYS=170; // dny od konce období (čtvrtletní řady vycházejí později)
const fresh=(end:number,days:number,now:number)=>Number.isFinite(end)&&now-end<=days*DAY&&end-now<=31*DAY;
const ym=(p:string)=>{const m=/^(\d{4})-(\d{2})$/.exec(p);return m?`${monthName[+m[2]-1]} ${m[1]}`:p.replace(/^(\d{4}) Q([1-4])$/,'$2. čtvrtletí $1')};
const cz=(n:number,unit='')=>(n<0?'−':'')+Math.abs(n).toLocaleString('cs-CZ',{minimumFractionDigits:1,maximumFractionDigits:2})+unit;
/** PMI z Trading Economics (data.tePmi), jen je-li konec období nejvýš 75 dní zpět. */
export function tePmi(data:FundamentalData,c:string,id:string,now:number):TEPmiValue|null{
 if(id!=='mpmi'&&id!=='spmi')return null;
 const v=data.tePmi?.currencies?.[c]?.[id];
 return v&&Number.isFinite(v.value)&&fresh(teMonthEnd(v.period),TE_MAX_AGE_DAYS,now)?v:null;
}
/** Maloobchod z oficiální statistiky (data.retailOfficial): m/m (≤ 120 dní) nebo čtvrtletní q/q (≤ 170 dní, přepočte se na měsíční ekvivalent). */
export function retailOfficial(data:FundamentalData,c:string,id:string,now:number):RetailValue|null{
 if(id!=='retailSales')return null;
 const v=data.retailOfficial?.currencies?.[c];
 return v&&(v.kind==='m/m'||v.kind==='q/q')&&Number.isFinite(v.value)&&fresh(retailPeriodEnd(v.period),v.kind==='q/q'?RETAIL_Q_MAX_AGE_DAYS:RETAIL_MAX_AGE_DAYS,now)?v:null;
}
/** Pozorování agenta je ISM (USA)? Do skóre PMI nejde (jiná úroveň než S&P Global ostatních zemí), jen jako info. */
const isIsm=(o?:Obs)=>!!o&&/\bISM\b/.test(`${o.value??''} ${o.period??''}`);
/** ISM (USA) jen pro informaci: Trading Economics (≤ 75 dní) > ForexFactory > pozorování agenta; text „; ISM 54,5 pro info“ nebo ''. */
export function ismInfo(data:FundamentalData,c:string,id:string,now:number):string{
 if(id!=='mpmi'&&id!=='spmi')return '';
 const k=id==='mpmi'?'ismMpmi':'ismSpmi',te=data.tePmi?.currencies?.[c]?.[k],o=obs(data,c,id);
 const v=te&&Number.isFinite(te.value)&&fresh(teMonthEnd(te.period),TE_MAX_AGE_DAYS,now)?te.value:ffFallback(data,c,k,now)?.value??(isIsm(o)?pmiLevel(o?.value):null);
 return v===undefined||v===null?'':`; ISM ${cz(v)} pro info`;
}
export type MacroSide={x:number|null;tag:string;ff:MacroValue|null;sourceUrl?:string;period?:string|null;srcLabel?:string};
/** Jedna strana složky. Pořadí: PMI – Trading Economics > číslo z agentova pozorování (ne ISM) > ForexFactory;
 *  maloobchod – oficiální statistika > pozorování > ForexFactory; ostatní – pozorování. tag = text za číslem v detailu. */
export function macroSide(data:FundamentalData,c:string,id:string,read:(o?:Obs)=>number|null,now:number):MacroSide{
 const te=tePmi(data,c,id,now);
 if(te)return {x:te.value,tag:` (${ym(te.period)}${te.previous!==null?', předtím '+cz(te.previous):''}; zdroj: Trading Economics – ${te.publisher}${ismInfo(data,c,id,now)})`,ff:null,sourceUrl:te.url,period:te.period,srcLabel:'Trading Economics'};
 const ro=retailOfficial(data,c,id,now);
 if(ro)return {x:ro.kind==='q/q'?round(ro.value/3,2):ro.value,tag:` (${ro.kind==='q/q'?`čtvrtletně ${cz(ro.value,' %')} q/q ÷ 3 ≈ m/m, `:''}${ym(ro.period)}${ro.previous!==null?', předtím '+cz(ro.previous,' %'):''}; zdroj: ${ro.source})`,ff:null,sourceUrl:ro.url,period:ro.period,srcLabel:ro.source};
 const o=obs(data,c,id),x=(id==='mpmi'||id==='spmi')&&isIsm(o)?null:read(o);
 if(x!==null)return {x,tag:period(o),ff:null,sourceUrl:o?.sourceUrl,period:o?.period};
 const f=ffFallback(data,c,id,now);
 return f?{x:f.kind==='q/q'&&id==='retailSales'?round(f.value/3,2):f.value,tag:` (${f.kind==='q/q'&&id==='retailSales'?`čtvrtletně ${cz(f.value,' %')} q/q ÷ 3 ≈ m/m, `:''}${f.note.replace(/ \(ForexFactory\)$/,'')}; zdroj: ForexFactory${ismInfo(data,c,id,now)})`,ff:f,sourceUrl:FF_URL,period:f.period,srcLabel:'ForexFactory'}:{x:null,tag:'',ff:null,sourceUrl:undefined};
}

export const MACRO_READ:Record<string,(o?:Obs)=>number|null>={gdp:o=>pctChange(o?.value,'qq'),retailSales:o=>{const m=pctChange(o?.value,'mm');if(m!==null)return m;const q=pctChange(o?.value,'qq');return q===null?null:round(q/3,2)},mpmi:o=>pmiLevel(o?.value),spmi:o=>pmiLevel(o?.value),inflation:o=>pctChange(o?.value,'yy')};
function macroRow(data:FundamentalData,base:string,quote:string,id:string,read:(o?:Obs)=>number|null,unit:string,t1:number,t2:number,what:string,now:number,d=1){
 const A=macroSide(data,base,id,read,now),B=macroSide(data,quote,id,read,now),x=A.x,y=B.x;
 if(x===null||y===null){
  const both=x===null&&y===null,miss=both?`${base} ani ${quote}`:x===null?base:quote;
  return {score:null,detail:`Chybí data: ${miss} nemá číselný údaj (${what}).`};
 }
 const diff=round(x-y,2);
 const u=unit?' '+unit:'';
 return {score:bucket(diff,t1,t2),detail:`${base} ${fmt(x,d)}${u}${A.tag} vs ${quote} ${fmt(y,d)}${u}${B.tag} → rozdíl ${fmt(diff,d)} ${unit==='%'?'p. b.':'bodu'}`,source:A.sourceUrl||B.sourceUrl||undefined};
}

export const monthName=['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];

type RowOut={score:Score|null;detail:string;asOf?:string;source?:string};
/** Sezonalita aktuálního měsíce z cenové řady (páru i vlastního měnového indexu). */
export function seasonRow(price:PriceData|undefined,month:number,sample=10):RowOut{
 const season=seasonalStats(price,month,sample);
 return price&&season.signal!==null?{score:bucket(season.signal,...THRESHOLDS.seasonality),detail:`${monthName[month-1][0].toUpperCase()+monthName[month-1].slice(1)}: průměr ${fmt(season.avg,2)} %, růst ${season.positive}/${season.n} let · signál ${fmt(season.signal,3)}.`,asOf:`${season.years[0]?.year}–${season.years.at(-1)?.year}`,source:price.sourceUrl}
  :{score:null,detail:'Chybí data: méně než 5 let cenové historie pro tento měsíc.'};
}
/** Denní trend ze tří hlasů (reference vs. GMA50, vs. GMA200, pořadí průměrů). */
export function trendRow(price:PriceData|undefined):RowOut{
 const t=price&&Number.isFinite(price.trend)?price.trend:null;
 return t!==null&&price?{score:(Math.abs(t)>=.99?2*Math.sign(t):t>0?1:t<0?-1:0) as Score,detail:`Reference ${sig(price.reference)} · GMA50 ${sig(price.gma50)} · GMA200 ${sig(price.gma200)} → ${Math.abs(t)>=.99?'všechny 3 hlasy':t===0?'bez převahy':'převaha 2 : 1'} ${t>0?'nahoru':t<0?'dolů':''}`.trim()+'.',asOf:price.asOf,source:price.sourceUrl}
  :{score:null,detail:'Chybí data: cenová historie páru není k dispozici.'};
}

export function cotPairSignal(market:MarketData,base:string,quote:string){
 const one=(c:string)=>{const ct=market.cot[c];if(!ct||ct.isProxy)return null;const s=cotStats(ct);return s&&s.signal!==null?{signal:s.signal,net:s.netRatio,date:s.last.date,url:ct.sourceUrl}:null};
 if(quote==='USD'){const x=one(base);return x?{signal:x.signal,parts:[[base,x]] as const,date:x.date,url:x.url}:null}
 if(base==='USD'){const y=one(quote);return y?{signal:-y.signal,parts:[[quote,y]] as const,date:y.date,url:y.url}:null}
 const x=one(base),y=one(quote);
 return x&&y&&x.date===y.date?{signal:(x.signal-y.signal)/2,parts:[[base,x],[quote,y]] as const,date:x.date,url:x.url}:null;
}

/** Rozpad fundamentálního přehledu FX páru (BASE/QUOTE) na 11 složek −2…+2. Ne-FX instrument → null. */
export function pairBreakdown(pair:string,data:FundamentalData,market:MarketData,now=Date.now()):Breakdown|null{
 const [base,quote,...rest]=pair.split('/');
 if(rest.length||!base||!quote||base===quote||!data.currencies[base]||!data.currencies[quote])return null;
 const out:Record<string,{score:Score|null;detail:string;asOf?:string;source?:string}>={};

 // COT
 const cot=cotPairSignal(market,base,quote);
 out.cot=cot?{score:bucket(cot.signal,...THRESHOLDS.cot),detail:`Signál ${fmt(cot.signal,2)} · `+cot.parts.map(([c,p])=>`${c} fondy net ${fmt(p.net*100)} % OI`).join(', ')+(base==='USD'||quote==='USD'?' (USD jen proxy, rozhoduje cizí měna)':'')+'.',asOf:cot.date,source:cot.url}
  :{score:null,detail:'Chybí data: COT report pro obě měny se stejným datem není k dispozici.'};

 // HDP, Retail Sales, PMI, inflace
 out.gdp=macroRow(data,base,quote,'gdp',o=>pctChange(o?.value,'qq'),'%',...THRESHOLDS.gdp,'mezikvartální HDP',now);
 out.retailSales=macroRow(data,base,quote,'retailSales',o=>{const m=pctChange(o?.value,'mm');if(m!==null)return m;const q=pctChange(o?.value,'qq');return q===null?null:round(q/3,2)},'%',...THRESHOLDS.retailSales,'meziměsíční tržby',now);
 out.mpmi=macroRow(data,base,quote,'mpmi',o=>pmiLevel(o?.value),'',...THRESHOLDS.mpmi,'hodnota výrobního PMI',now);
 out.spmi=macroRow(data,base,quote,'spmi',o=>pmiLevel(o?.value),'',...THRESHOLDS.spmi,'hodnota PMI služeb',now);
 out.inflation=macroRow(data,base,quote,'inflation',o=>pctChange(o?.value,'yy'),'%',...THRESHOLDS.inflation,'meziroční inflace',now);

 // Sezonalita a trend z cen páru
 const price=market.prices[pair];
 out.seasonality=seasonRow(price,new Date(now).getUTCMonth()+1);
 out.trend=trendRow(price);

 // Retail pozice (kontrariánsky), jen pro přesně tento pár
 const rp=data.pairObservations?.[pair]?.retailPositions,r=rp?.value?parseRetail(rp.value):null;
 if(r&&r.long+r.short>0){const long=100*r.long/(r.long+r.short);out.retailPositions={score:retailScore(long),detail:`Retail long ${Math.round(long)} % / short ${Math.round(100-long)} % (vzorek brokerů) → kontrariánsky ${long>=60?'proti růstu':long<=40?'pro růst':'bez převahy'}.`,asOf:rp?.period??undefined,source:rp?.sourceUrl}}
 else out.retailPositions={score:null,detail:'Chybí data: pro tento pár není uložený ověřený vzorek retailových pozic (Myfxbook / broker sentiment).'};

 // Úrokové sazby a zaměstnanost z hodnocení bank
 const f=(c:string,id:'decision'|'guidance'|'labor')=>{const v=data.currencies[c]?.factors?.[id]?.value;return v===null||v===undefined||![-1,0,1].includes(v)?null:v};
 const word=(v:number,kind:'decision'|'guidance')=>kind==='decision'?(v>0?'zvýšení':v<0?'snížení':'ponechání'):(v>0?'výhled zpřísnění':v<0?'výhled uvolnění':'výhled neutrální');
 const pol=(c:string)=>{const d=f(c,'decision'),g=f(c,'guidance');return d===null||g===null?null:{sum:d+g,text:`${c} ${data.currencies[c].rate}: ${word(d,'decision')}, ${word(g,'guidance')}`}};
 const pb=pol(base),pq=pol(quote);
 out.rates=pb&&pq?{score:clamp2(pb.sum-pq.sum),detail:`${pb.text} · ${pq.text}.`,asOf:data.currencies[base].decisionDate,source:data.sources[data.currencies[base].factors.decision.source]?.url}
  :{score:null,detail:'Chybí data: hodnocení kroku nebo výhledu banky není ověřené.'};
 const lb=f(base,'labor'),lq=f(quote,'labor'),lab=(v:number)=>v>0?'silný':v<0?'slabý':'stabilní';
 out.employment=lb!==null&&lq!==null?{score:(lb-lq) as Score,detail:`Pracovní trh podle bank: ${base} ${lab(lb)}, ${quote} ${lab(lq)}.`+(obs(data,base,'employment')?.value?` ${base}: ${obs(data,base,'employment')!.value}.`:''),source:data.sources[data.currencies[base].factors.labor.source]?.url}
  :{score:null,detail:'Chybí data: hodnocení pracovního trhu bankou není ověřené.'};

 const rows:BreakdownRow[]=ROWS.map(d=>({id:d.id,label:d.label,info:d.info,...out[d.id]}));
 const known=rows.filter(r=>r.score!==null);
 return {pair,base,quote,rows,total:known.reduce((s,r)=>s+(r.score as number),0),available:known.length,count:rows.length};
}
