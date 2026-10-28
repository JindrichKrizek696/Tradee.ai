// FX skóre v3: přímo z 11 složek přehledu (lib/fundamentals/breakdown.ts), každá −2…+2, s pevnými vahami.
// Čistá logika bez DB; kontrola: node --experimental-strip-types scripts/check-score-v3.mjs
//
//  skóre = Σ(wᵢ · sᵢ/2) / Σ(wᵢ dostupných) · 100   → −100…+100 (jedno desetinné místo)
//  příspěvek složky = wᵢ · sᵢ/2 / Σw dostupných · 100 (body; součet příspěvků = skóre)
//  Chybějící nebo zastaralá složka se vynechá a váhy ostatních se renormalizují.
//  Dostupná váha < 60 % → skóre null („pozastaveno – chybí podklady“) se seznamem toho, co chybí.
//
// Stáří (od data, které složka popisuje): COT 8 dní od zveřejnění (pátek; = 11 dní od úterního data pozic, stejné okno jako dřív), retail pozice 48 h od snímku,
// měsíční makro 75 dní a čtvrtletní řady (HDP vždy) 140 dní od konce období, trend 7 dní od poslední denní
// reference, sazby a zaměstnanost podle ověření zdroje banky (staleAfterHours, dnes 36 h).
// Měnový index (USD, EUR …) = průměr párových složek vůči 7 ostatním měnám; trend a sezonalita z ceny indexu.
import type {FundamentalData} from '../fundamentals.ts';
import {seasonalStats,fresh,type MarketData,type PriceData} from '../score-engine.ts';
import {pairBreakdown,macroSide,MACRO_READ,cotPairSignal,seasonRow,trendRow,monthName,ROWS,type BreakdownRow} from '../fundamentals/breakdown.ts';
import {eventMarkets} from '../calendar.ts';
import {cotPublishedAt,cotDatesLabel} from '../cot-dates.ts';

export const METHOD_V3='score-v3';
export const MIN_COVERAGE=60;
/** Váhy složek v % (součet 100), v pořadí zobrazení. */
export const WEIGHTS={rates:15,cot:15,trend:15,inflation:10,employment:10,gdp:8,mpmi:6,spmi:6,retailSales:5,seasonality:5,retailPositions:5} as const;
export type ComponentId=keyof typeof WEIGHTS;
export const COMPONENTS=Object.keys(WEIGHTS) as ComponentId[];
const DAY=86400000,HOUR=3600000;
// COT se počítá od zveřejnění (pátek = datum pozic + 3 dny): 8 dní od zveřejnění = dřívějších 11 dní od data pozic → hodnoty skóre beze změny
export const LIMITS={cot:8*DAY,retailPositions:48*HOUR,monthly:75*DAY,quarterly:140*DAY,trend:7*DAY};
const MACRO:ComponentId[]=['rates','inflation','employment','gdp','mpmi','spmi','retailSales'];

export type PartStatus='ok'|'missing'|'stale';
export type V3Part={
 id:ComponentId;label:string;weight:number;
 /** −2…+2 (u měnového indexu průměr párů, může být neceločíselný); null = chybí / zastaralé */
 value:number|null;
 /** value/2 → −1…+1 (kompatibilita s ostatními modely) */
 signal:number|null;
 /** body ke skóre (renormalizované); null = nezapočteno */
 contribution:number|null;
 reason:string;detail:string;
 asOf:string|null;asOfLabel:string;ageMs:number|null;age:string|null;window:string;
 source:string|null;sources:{label:string;url:string}[];
 stale:boolean;status:PartStatus;missingReason:string|null;
};

type Comp={value:number|null;detail:string;asOf:string|null;asOfLabel:string;ageMs:number|null;window:string;sources:{label:string;url:string}[];status:PartStatus;missingReason:string|null};

// --- formátování ---
const plural=(n:number,one:string,few:string,many:string)=>n===1?one:n>=2&&n<=4?few:many;
export function ageText(ms:number|null){if(ms===null||!Number.isFinite(ms))return null;if(ms<0)return 'v budoucnu';const h=Math.floor(ms/HOUR);if(h<48)return `${h} h`;const d=Math.floor(ms/DAY);return `${d} ${plural(d,'den','dny','dní')}`}
const dm=(s:string)=>{const t=Date.parse(s);return Number.isFinite(t)?new Date(t).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric'}).replace(/\s/g,' '):s};
const dmt=(s:string)=>{const t=Date.parse(s);return Number.isFinite(t)?new Date(t).toLocaleString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'}):s};
const sgn=(n:number)=>{const r=Math.round(n*10)/10;return (r>0?'+':r<0?'−':'')+Math.abs(r).toLocaleString('cs-CZ',{maximumFractionDigits:1})};
const round=(n:number,d:number)=>{const f=10**d,v=Math.sign(n)*Math.round(Math.abs(n)*f)/f;return v===0?0:v}; // symetrické zaokrouhlení (opačný pár = přesně opačné číslo)

// --- období makro vydání → konec období ---
const MONTHS:[RegExp,number][]=[[/červenec|července/i,7],[/červen|června/i,6],[/leden|ledna/i,1],[/únor|února/i,2],[/březen|března/i,3],[/duben|dubna/i,4],[/květen|května/i,5],[/srpen|srpna/i,8],[/září/i,9],[/říjen|října/i,10],[/listopad/i,11],[/prosinec|prosince/i,12]];
/** Konec období vydání („2026-08“, „2026 Q2“, „2. čtvrtletí 2026“, „srpen 2026“, „3 měsíce do července 2026“); jinak null. */
export function periodEnd(period:string|null|undefined):{end:number;kind:'month'|'quarter'}|null{
 const p=period||'';let m;
 const monthEnd=(y:number,mo:number)=>Date.UTC(y,mo,0,23,59,59);
 if((m=/(\d{4})\s*Q([1-4])/i.exec(p)))return {end:monthEnd(+m[1],3*+m[2]),kind:'quarter'};
 if((m=/([1-4])\.\s*čtvrtletí\s*(\d{4})/i.exec(p)))return {end:monthEnd(+m[2],3*+m[1]),kind:'quarter'};
 if((m=/(\d{4})-(\d{2})(?!-\d)/.exec(p))&&+m[2]>=1&&+m[2]<=12)return {end:monthEnd(+m[1],+m[2]),kind:'month'};
 const y=/(\d{4})/.exec(p);
 if(y)for(const [re,mo] of MONTHS)if(re.test(p))return {end:monthEnd(+y[1],mo),kind:'month'};
 return null;
}

const missing=(detail:string,window:string,why='chybí data'):Comp=>({value:null,detail,asOf:null,asOfLabel:'',ageMs:null,window,sources:[],status:'missing',missingReason:why});
const url=(label:string,u?:string|null)=>u?[{label,url:u}]:[];

const WINDOW={
 cot:'poslední týdenní report CFTC (TFF, leveraged funds), max. 8 dní od zveřejnění v pátek (= 11 dní od data pozic)',
 trend:'denní data · GMA50/GMA200 za posledních 200 dní, max. 7 dní',
 seasonality:(month:number,n:number)=>`průměr měsíce ${monthName[month-1]} za ${n} let (min. 10)`,
 macro:(id:string)=>id==='gdp'?'poslední vydání (čtvrtletí), max. 140 dní od konce období':'poslední vydání (měsíc), max. 75 dní od konce období; čtvrtletní řada 140 dní',
 rates:(h:number)=>`poslední rozhodnutí + výhled (guidance) banky; ověření max. ${h} h`,
 employment:(h:number)=>`hodnocení trhu práce bankou; ověření max. ${h} h`,
 retailPositions:'snímek vzorku retail brokerů (cíl ≤ 24 h), max. 48 h',
};

function priceComps(price:PriceData|undefined,now:number,trendRowOut:ReturnType<typeof trendRow>,seasonRowOut:ReturnType<typeof seasonRow>){
 const month=new Date(now).getUTCMonth()+1,year=new Date(now).getUTCFullYear(),season=seasonalStats(price,month);
 let trend:Comp;
 if(trendRowOut.score===null||!price)trend=missing(trendRowOut.detail,WINDOW.trend);
 else{const age=now-Date.parse(price.asOf),ok=Number.isFinite(age)&&age>=0&&age<=LIMITS.trend;
  trend={value:trendRowOut.score,detail:trendRowOut.detail,asOf:price.asOf,asOfLabel:'k '+dm(price.asOf),ageMs:Number.isFinite(age)?age:null,window:WINDOW.trend,sources:url('Cenová historie',price.sourceUrl),status:ok?'ok':'stale',missingReason:ok?null:'zastaralé'}}
 let seasonality:Comp;
 const tenYears=season.n>=10&&season.years.every(y=>y.year<year);
 if(seasonRowOut.score===null||!price)seasonality=missing(seasonRowOut.detail,WINDOW.seasonality(month,10));
 else if(!tenYears)seasonality=missing(`Chybí data: jen ${season.n} dokončených let pro ${monthName[month-1]} (potřeba 10).`,WINDOW.seasonality(month,10));
 else seasonality={value:seasonRowOut.score,detail:seasonRowOut.detail,asOf:null,asOfLabel:seasonRowOut.asOf||'',ageMs:null,window:WINDOW.seasonality(month,season.n),sources:url('Cenová historie',price.sourceUrl),status:'ok',missingReason:null};
 return {trend,seasonality};
}

/** Složky jednoho FX páru včetně stáří a zdroje. */
function pairComps(pair:string,data:FundamentalData,market:MarketData,now:number):Record<ComponentId,Comp>|null{
 const b=pairBreakdown(pair,data,market,now);if(!b)return null;
 const {base,quote}=b,row=(id:string)=>b.rows.find(r=>r.id===id) as BreakdownRow,hours=data.staleAfterHours;
 const out={} as Record<ComponentId,Comp>;
 // COT
 const cr=row('cot'),cot=cotPairSignal(market,base,quote);
 if(cr.score===null||!cot)out.cot=missing(cr.detail,WINDOW.cot);
 else{const age=now-cotPublishedAt(cot.date),ok=age>=0&&age<=LIMITS.cot;
  out.cot={value:cr.score,detail:cr.detail,asOf:cot.date,asOfLabel:cotDatesLabel(cot.date),ageMs:age,window:WINDOW.cot,sources:url('CFTC TFF',cot.url),status:ok?'ok':'stale',missingReason:ok?null:'zastaralé'}}
 // trend + sezonalita
 const price=market.prices[pair],pc=priceComps(price,now,{score:row('trend').score,detail:row('trend').detail},{score:row('seasonality').score,detail:row('seasonality').detail,asOf:row('seasonality').asOf});
 out.trend=pc.trend;out.seasonality=pc.seasonality;
 // makro vydání
 for(const id of ['gdp','retailSales','mpmi','spmi','inflation'] as const){
  const r=row(id),w=WINDOW.macro(id);
  if(r.score===null){out[id]=missing(r.detail,w);continue}
  // období a zdroj ze strany, která dodala číslo (Trading Economics / oficiální statistika / pozorování agenta / ForexFactory)
  const side=(c:string)=>{const m=macroSide(data,c,id,MACRO_READ[id],now);
   return {period:m.period,src:url(m.srcLabel?c+' · '+m.srcLabel:c,m.sourceUrl)}};
  const sa=side(base),sb=side(quote),pa=periodEnd(sa.period),pb=periodEnd(sb.period),srcs=[...sa.src,...sb.src],label=`${base} ${sa.period??'?'} · ${quote} ${sb.period??'?'}`;
  if(!pa||!pb){out[id]={...missing(r.detail+' Období vydání nelze určit.',w,'chybí období'),asOfLabel:label,sources:srcs};continue}
  const limit=(p:{kind:string})=>id==='gdp'||p.kind==='quarter'?LIMITS.quarterly:LIMITS.monthly;
  const ageA=now-pa.end,ageB=now-pb.end,ok=ageA<=limit(pa)&&ageB<=limit(pb),older=Math.max(ageA,ageB);
  out[id]={value:r.score,detail:r.detail,asOf:new Date(Math.min(pa.end,pb.end)).toISOString().slice(0,10),asOfLabel:label,ageMs:older,window:w,sources:srcs,status:ok?'ok':'stale',missingReason:ok?null:'zastaralé'};
 }
 // sazby a zaměstnanost: podle ověření zdroje banky (stejné pravidlo jako fundament v2.2)
 const srcFresh=(c:string,f:'decision'|'guidance'|'labor')=>{const s=data.sources[data.currencies[c]?.factors?.[f]?.source];return !!s&&fresh(s.checkedAt,hours/24,now)};
 const srcLink=(c:string,f:'decision'|'labor')=>{const s=data.sources[data.currencies[c]?.factors?.[f]?.source];return s?.url?[{label:`${c} · ${s.label||'banka'}`,url:s.url}]:[]};
 const checkedOf=(f:'decision'|'labor')=>[base,quote].map(c=>data.sources[data.currencies[c]?.factors?.[f]?.source]?.checkedAt).filter((x):x is string=>!!x).sort()[0]||null;
 const rr=row('rates');
 if(rr.score===null)out.rates=missing(rr.detail,WINDOW.rates(hours));
 else{const ok=[base,quote].every(c=>srcFresh(c,'decision')&&srcFresh(c,'guidance')),da=data.currencies[base].decisionDate,dq=data.currencies[quote].decisionDate,checked=checkedOf('decision');
  out.rates={value:rr.score,detail:rr.detail,asOf:checked,asOfLabel:`rozhodnutí ${base} ${dm(da)} · ${quote} ${dm(dq)}`+(checked?` · ověřeno ${dmt(checked)}`:''),ageMs:checked?now-Date.parse(checked):null,window:WINDOW.rates(hours),sources:[...srcLink(base,'decision'),...srcLink(quote,'decision')],status:ok?'ok':'stale',missingReason:ok?null:'zastaralé'}}
 const er=row('employment');
 if(er.score===null)out.employment=missing(er.detail,WINDOW.employment(hours));
 else{const ok=[base,quote].every(c=>srcFresh(c,'labor')),pe=(c:string)=>data.observations?.[c]?.employment?.period,checked=checkedOf('labor');
  out.employment={value:er.score,detail:er.detail,asOf:checked,asOfLabel:`data ${base} ${pe(base)??'?'} · ${quote} ${pe(quote)??'?'}`+(checked?` · ověřeno ${dmt(checked)}`:''),ageMs:checked?now-Date.parse(checked):null,window:WINDOW.employment(hours),sources:[...srcLink(base,'labor'),...srcLink(quote,'labor')],status:ok?'ok':'stale',missingReason:ok?null:'zastaralé'}}
 // retail pozice (kontrariánsky už v breakdown), jen pro přesně tento pár
 const rp=data.pairObservations?.[pair]?.retailPositions,pr=row('retailPositions');
 if(pr.score===null)out.retailPositions=missing(pr.detail,WINDOW.retailPositions);
 else{const age=now-Date.parse(rp?.checkedAt||''),ok=Number.isFinite(age)&&age>=0&&age<=LIMITS.retailPositions;
  out.retailPositions={value:pr.score,detail:pr.detail,asOf:rp?.checkedAt??null,asOfLabel:rp?.checkedAt?'snímek '+dmt(rp.checkedAt):(rp?.period??''),ageMs:Number.isFinite(age)?age:null,window:WINDOW.retailPositions,sources:url('Myfxbook',rp?.sourceUrl),status:ok?'ok':'stale',missingReason:ok?null:'zastaralé'}}
 return out;
}

/** Složky vlastního měnového indexu: průměr párů měna/ostatní; trend a sezonalita z ceny indexu. */
function indexComps(c:string,data:FundamentalData,market:MarketData,now:number):Record<ComponentId,Comp>{
 const others=Object.keys(data.currencies).filter(o=>o!==c),per=others.map(o=>[o,pairComps(c+'/'+o,data,market,now)!] as const);
 const out={} as Record<ComponentId,Comp>;
 for(const id of COMPONENTS){
  if(id==='trend'||id==='seasonality'||id==='retailPositions')continue;
  const list=per.map(([o,x])=>[o,x[id]] as const),bad=list.filter(([,x])=>x.status!=='ok'),w=list[0]?.[1].window??'';
  const sources=list.flatMap(([,x])=>x.sources).filter((s,i,a)=>a.findIndex(t=>t.url===s.url)===i);
  if(bad.length){const stale=bad.every(([,x])=>x.status==='stale');out[id]={value:null,detail:`Chybí u ${bad.map(([o,x])=>`${c}/${o} (${x.missingReason})`).join(', ')}. Index vyžaduje všech ${others.length} párů.`,asOf:null,asOfLabel:'',ageMs:null,window:w,sources,status:stale?'stale':'missing',missingReason:stale?'zastaralé':'chybí data'};continue}
  const vals=list.map(([,x])=>x.value as number),oldest=list.reduce((a,[,x])=>x.ageMs!==null&&(a===null||x.ageMs>(a.ageMs??-Infinity))?x:a,null as Comp|null);
  out[id]={value:vals.reduce((s,v)=>s+v,0)/vals.length,detail:`Průměr ${others.length} párů: `+list.map(([o,x])=>`${c}/${o} ${sgn(x.value as number)}`).join(', ')+'.',asOf:oldest?.asOf??null,asOfLabel:oldest?.asOfLabel??'',ageMs:oldest?.ageMs??null,window:w+' · průměr vůči 7 měnám',sources,status:'ok',missingReason:null};
 }
 const price=market.prices[c],pc=priceComps(price,now,trendRow(price),seasonRow(price,new Date(now).getUTCMonth()+1));
 out.trend=pc.trend;out.seasonality=pc.seasonality;
 out.retailPositions=missing('U vlastního měnového indexu neexistuje vzorek retailových pozic; složka se nezapočítává.',WINDOW.retailPositions,'u indexu se nesleduje');
 return out;
}

/** FX skóre v3 (−100…+100) pro pár BASE/QUOTE nebo měnový index (např. „USD“). Neplatný instrument → výjimka. */
export function scoreV3(instrument:string,data:FundamentalData,market:MarketData,now=Date.now()){
 const [base,quote,...rest]=instrument.split('/'),currencies=Object.keys(data.currencies);
 if(rest.length||!currencies.includes(base)||(quote!==undefined&&!currencies.includes(quote))||base===quote)throw Error('Neplatný instrument');
 const comps=quote?pairComps(instrument,data,market,now)!:indexComps(base,data,market,now);
 const others=quote?[quote]:currencies.filter(c=>c!==base),members=[base,...others];
 const ok=COMPONENTS.filter(id=>comps[id].status==='ok'&&comps[id].value!==null);
 const coverage=ok.reduce((s,id)=>s+WEIGHTS[id],0),raw=COMPONENTS.reduce((s,id)=>s+(ok.includes(id)?WEIGHTS[id]*(comps[id].value as number)/2:0),0);
 const contribution=(id:ComponentId)=>ok.includes(id)&&coverage>0?WEIGHTS[id]*(comps[id].value as number)/2/coverage*100:null;
 const info=Object.fromEntries(ROWS.map(r=>[r.id,r]));
 const parts:V3Part[]=COMPONENTS.map(id=>{const c=comps[id],v=c.value===null?null:round(c.value,4),con=contribution(id);return {id,label:info[id].label,weight:WEIGHTS[id],value:c.status==='ok'?v:null,signal:c.status==='ok'&&v!==null?v/2:null,contribution:con===null?null:round(con,2),reason:info[id].info,detail:c.detail,asOf:c.asOf,asOfLabel:c.asOfLabel,ageMs:c.ageMs,age:ageText(c.ageMs),window:c.window,source:c.sources[0]?.url??null,sources:c.sources,stale:c.status==='stale',status:c.status,missingReason:c.missingReason}});
 const known=coverage>0?raw/coverage*100:0,ready=coverage>=MIN_COVERAGE,score=ready?round(known,1):null;
 const missingParts=parts.filter(p=>p.status!=='ok').map(p=>`${p.label} (${p.missingReason})`);
 const paused=ready?null:`Pozastaveno – chybí podklady (dostupné váhy ${coverage} %, potřeba ${MIN_COVERAGE} %): ${missingParts.join(', ')}.`;
 const dir=Math.sign(known),abs=parts.reduce((s,p)=>s+Math.abs(p.contribution??0),0),agree=parts.reduce((s,p)=>s+(Math.sign(p.contribution??0)===dir&&dir!==0?Math.abs(p.contribution??0):0),0);
 const alignment=abs?Math.round(100*agree/abs):0;
 const full=raw,missingW=100-coverage;
 const bias=score===null?'Pozastaveno – chybí podklady':score>0?'Bullish':score<0?'Bearish':'Vyrovnané';
 const magnitude=score===null?'Bez závěru':Math.abs(score)<15?'Slabá převaha':Math.abs(score)<40?'Střední převaha':'Výrazná převaha';
 const events=data.events.filter(e=>eventMarkets(e).some(c=>(quote?members:currencies).includes(c))&&Date.parse(e.at)>=now&&Date.parse(e.at)-now<=72*3600000).sort((a,b)=>a.at.localeCompare(b.at));
 const macroOk=MACRO.filter(id=>ok.includes(id)),macroCoverage=macroOk.reduce((s,id)=>s+WEIGHTS[id],0);
 const price=market.prices[instrument],season=seasonalStats(price,new Date(now).getUTCMonth()+1);
 return {score,known:round(known,2),coverage,macroCoverage,parts,bias,magnitude,alignment,bounds:[Math.max(-100,round(full-missingW,1)),Math.min(100,round(full+missingW,1))] as [number,number],missing:missingW,
  base,quote,others,events,price,season,macro:macroOk.length?round(macroOk.reduce((s,id)=>s+(contribution(id) as number),0),2):null,
  available:ok.length,count:COMPONENTS.length,missingParts,paused,model:'FX kompozit',method:METHOD_V3 as 'score-v3'};
}
export type V3Result=ReturnType<typeof scoreV3>;
