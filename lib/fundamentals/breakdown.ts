// Přehled skóre FX páru po složkách (−2…+2). Čistá logika; kontrola: node --experimental-strip-types scripts/check-breakdown.mjs
//
// Transparentní rozpad, NE nové skóre: kompozitní skóre Tradee (score-engine.ts) zůstává beze změny.
// Každá složka porovnává základní měnu páru (BASE) s kotovanou (QUOTE). Kladné číslo = podpora BASE vůči QUOTE.
// Chybějící vstup vrací score:null („chybí data“) – nikdy se nedopočítává odhadem ani nulou.
//
// Pravidla (rozdíl = BASE − QUOTE; práh t1 → ±1, t2 → ±2):
//  • COT          signál TFF leveraged funds z cotStats (60 % net/OI + 40 % změna za 4 týdny), párový stejně jako
//                 v score-engine (pár s USD = signál cizí měny, USD Index je jen proxy; kříž = polovina rozdílu).
//                 t1 0,15 · t2 0,5.
//  • HDP          mezikvartální růst reálného HDP (q/q, p. b.). Jen měsíční/anualizovaný údaj → chybí data. t1 0,2 · t2 0,5.
//  • Sezonalita   sezónní signál aktuálního měsíce z seasonalStats (rozsah ±0,5). |s| t1 0,03 · t2 0,1.
//  • Trend        tři hlasy ceny páru vůči GMA50/GMA200 (−1, −⅓, ⅓, 1): ±1 → ±2, ±⅓ → ±1.
//  • Retail Sales meziměsíční změna maloobchodních tržeb (m/m, p. b.). t1 0,3 · t2 1,0.
//  • Retail pozice kontrariánsky ze vzorku brokerů (Myfxbook) pro přesně tento pár: long ≥ 75 % → −2, ≥ 60 % → −1,
//                 ≤ 25 % → +2, ≤ 40 % → +1.
//  • mPMI / sPMI  úroveň indexu (body). Jen slovní komentář bez čísla → chybí data. t1 1 · t2 3.
//  • Úrokové sazby součet „poslední krok“ + „výhled“ banky (každé −1/0/+1), rozdíl omezený na ±2.
//  • Inflace      meziroční inflace (y/y, p. b.); vyšší inflace = tlak na restriktivnější banku = body pro měnu. t1 0,3 · t2 1,0.
//  • Zaměstnanost hodnocení pracovního trhu bankou (faktor labor −1/0/+1), rozdíl −2…+2.
// Celkové skóre = prostý součet dostupných složek (max ±22) + počet složek s daty.
import type {FundamentalData} from '../fundamentals.ts';
import {cotStats,seasonalStats,type MarketData} from '../score-engine.ts';
import {parseRetail} from '../reports.ts';

export type Score=-2|-1|0|1|2;
export type BreakdownRow={id:string;label:string;score:Score|null;detail:string;info:string;asOf?:string;source?:string};
export type Breakdown={pair:string;base:string;quote:string;rows:BreakdownRow[];total:number;available:number;count:number};

export const ROWS=[
 {id:'cot',label:'COT',info:'Pozice spekulativních fondů (CFTC TFF, leveraged funds): 60 % čistá pozice / open interest a 40 % její změna za 4 týdny. U páru s USD rozhoduje cizí měna (USD Index je jen proxy). ±1 od signálu 0,15, ±2 od 0,5.'},
 {id:'gdp',label:'HDP',info:'Mezikvartální růst reálného HDP: základní měna minus kotovaná. ±1 od rozdílu 0,2 p. b., ±2 od 0,5 p. b. Měsíční ani anualizovaná čísla se nepřepočítávají.'},
 {id:'seasonality',label:'Sezonalita',info:'Výnosy páru v aktuálním měsíci za posledních 10 let: průměr / odchylka × konzistence směru (stejný signál jako v kompozitu). ±1 od 0,03, ±2 od 0,1.'},
 {id:'trend',label:'Trend',info:'Denní reference páru vůči geometrickým průměrům 50 a 200 dnů a jejich pořadí. Všechny tři hlasy stejným směrem = ±2, převaha 2 : 1 = ±1.'},
 {id:'retailSales',label:'Retail Sales',info:'Meziměsíční změna maloobchodních tržeb. ±1 od rozdílu 0,3 p. b., ±2 od 1 p. b. Pozor: země publikují reálné i nominální řady.'},
 {id:'retailPositions',label:'Retail pozice',info:'Kontrariánský ukazatel ze vzorku retailových brokerů: když většina drobných obchodníků drží long, je to pro pár negativní. Long ≥ 60 % = −1, ≥ 75 % = −2; long ≤ 40 % = +1, ≤ 25 % = +2.'},
 {id:'mpmi',label:'mPMI (výroba)',info:'Index nákupních manažerů ve výrobě (50 = hranice růstu). Rozdíl úrovní ±1 od 1 bodu, ±2 od 3 bodů. Slovní komentář bez čísla se nehodnotí.'},
 {id:'spmi',label:'sPMI (služby)',info:'Index nákupních manažerů ve službách (50 = hranice růstu). Rozdíl úrovní ±1 od 1 bodu, ±2 od 3 bodů. Slovní komentář bez čísla se nehodnotí.'},
 {id:'rates',label:'Úrokové sazby',info:'Měnová politika: poslední krok banky (+1 zvýšení, −1 snížení) plus výhled (+1 zpřísnění, −1 uvolnění). Rozdíl obou bank omezený na ±2.'},
 {id:'inflation',label:'Inflace',info:'Meziroční inflace. Vyšší inflace drží banku restriktivnější, proto přidává body měně. ±1 od rozdílu 0,3 p. b., ±2 od 1 p. b.'},
 {id:'employment',label:'Zaměstnanost',info:'Hodnocení pracovního trhu podle poslední zprávy centrální banky (+1 napjatý, 0 stabilní, −1 slabý). Rozdíl obou měn.'},
] as const;

const fmt=(n:number,d=1)=>(n>0?'+':n<0?'−':'')+Math.abs(n).toLocaleString('cs-CZ',{minimumFractionDigits:d,maximumFractionDigits:d});
const sig=(n:number)=>Number(n.toPrecision(6)).toLocaleString('cs-CZ',{maximumFractionDigits:6});
const round=(n:number,d=2)=>Math.round(n*10**d)/10**d;
/** Spojité číslo → −2…+2 podle prahů t1 (±1) a t2 (±2). */
export function bucket(x:number,t1:number,t2:number):Score{const v=round(x,4);return v>=t2?2:v>=t1?1:v<=-t2?-2:v<=-t1?-1:0}
const clamp2=(n:number)=>Math.max(-2,Math.min(2,Math.round(n))) as Score;
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

function macroRow(data:FundamentalData,base:string,quote:string,id:string,read:(o?:Obs)=>number|null,unit:string,t1:number,t2:number,what:string,d=1){
 const a=obs(data,base,id),b=obs(data,quote,id),x=read(a),y=read(b);
 if(x===null||y===null){
  const both=x===null&&y===null,miss=both?`${base} ani ${quote}`:x===null?base:quote;
  return {score:null,detail:`Chybí data: ${miss} nemá číselný údaj (${what}).`};
 }
 const diff=round(x-y,2);
 const u=unit?' '+unit:'';
 return {score:bucket(diff,t1,t2),detail:`${base} ${fmt(x,d)}${u}${period(a)} vs ${quote} ${fmt(y,d)}${u}${period(b)} → rozdíl ${fmt(diff,d)} ${unit==='%'?'p. b.':'bodu'}`,source:a?.sourceUrl||b?.sourceUrl||undefined};
}

const monthName=['leden','únor','březen','duben','květen','červen','červenec','srpen','září','říjen','listopad','prosinec'];

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
 out.cot=cot?{score:bucket(cot.signal,.15,.5),detail:`Signál ${fmt(cot.signal,2)} · `+cot.parts.map(([c,p])=>`${c} fondy net ${fmt(p.net*100)} % OI`).join(', ')+(base==='USD'||quote==='USD'?' (USD jen proxy, rozhoduje cizí měna)':'')+'.',asOf:cot.date,source:cot.url}
  :{score:null,detail:'Chybí data: COT report pro obě měny se stejným datem není k dispozici.'};

 // HDP, Retail Sales, PMI, inflace
 out.gdp=macroRow(data,base,quote,'gdp',o=>pctChange(o?.value,'qq'),'%',.2,.5,'mezikvartální HDP');
 out.retailSales=macroRow(data,base,quote,'retailSales',o=>pctChange(o?.value,'mm'),'%',.3,1,'meziměsíční tržby');
 out.mpmi=macroRow(data,base,quote,'mpmi',o=>pmiLevel(o?.value),'',1,3,'hodnota výrobního PMI');
 out.spmi=macroRow(data,base,quote,'spmi',o=>pmiLevel(o?.value),'',1,3,'hodnota PMI služeb');
 out.inflation=macroRow(data,base,quote,'inflation',o=>pctChange(o?.value,'yy'),'%',.3,1,'meziroční inflace');

 // Sezonalita a trend z cen páru
 const price=market.prices[pair],month=new Date(now).getUTCMonth()+1,season=seasonalStats(price,month);
 out.seasonality=price&&season.signal!==null?{score:bucket(season.signal,.03,.1),detail:`${monthName[month-1][0].toUpperCase()+monthName[month-1].slice(1)}: průměr ${fmt(season.avg,2)} %, růst ${season.positive}/${season.n} let · signál ${fmt(season.signal,3)}.`,asOf:`${season.years[0]?.year}–${season.years.at(-1)?.year}`,source:price.sourceUrl}
  :{score:null,detail:'Chybí data: méně než 5 let cenové historie pro tento měsíc.'};
 const t=price&&Number.isFinite(price.trend)?price.trend:null;
 out.trend=t!==null&&price?{score:(Math.abs(t)>=.99?2*Math.sign(t):t>0?1:t<0?-1:0) as Score,detail:`Reference ${sig(price.reference)} · GMA50 ${sig(price.gma50)} · GMA200 ${sig(price.gma200)} → ${Math.abs(t)>=.99?'všechny 3 hlasy':t===0?'bez převahy':'převaha 2 : 1'} ${t>0?'nahoru':t<0?'dolů':''}`.trim()+'.',asOf:price.asOf,source:price.sourceUrl}
  :{score:null,detail:'Chybí data: cenová historie páru není k dispozici.'};

 // Retail pozice (kontrariánsky), jen pro přesně tento pár
 const rp=data.pairObservations?.[pair]?.retailPositions,r=rp?.value?parseRetail(rp.value):null;
 if(r&&r.long+r.short>0){const long=100*r.long/(r.long+r.short);out.retailPositions={score:(long>=75?-2:long>=60?-1:long<=25?2:long<=40?1:0) as Score,detail:`Retail long ${Math.round(long)} % / short ${Math.round(100-long)} % (vzorek brokerů) → kontrariánsky ${long>=60?'proti růstu':long<=40?'pro růst':'bez převahy'}.`,asOf:rp?.period??undefined,source:rp?.sourceUrl}}
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
