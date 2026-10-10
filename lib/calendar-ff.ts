// ForexFactory odhady a předchozí hodnoty: parsování oficiálního exportu a párování s událostmi kalendáře.
import type {CalendarEvent} from './calendar.ts';
export type FFRow={at:string;currency:string;title:string;impact:string;forecast:string|null;previous:string|null};
export type FFMatch={forecast:string|null;previous:string|null;ffTitle:string;impact:string};

const CURRENCIES=['USD','EUR','GBP','JPY','CHF','AUD','NZD','CAD','CNY'];
const clean=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():null;

// Export FF: [{title,country,date,impact,forecast,previous}]; country „All“ a nečitelná data se zahazují.
export function parseFF(json:unknown):FFRow[]{
 if(!Array.isArray(json))return [];
 const out:FFRow[]=[];
 for(const r of json as Record<string,unknown>[]){
  if(!r||typeof r!=='object')continue;
  const t=Date.parse(String(r.date)),title=clean(r.title),currency=clean(r.country)?.toUpperCase();
  if(!Number.isFinite(t)||!title||!currency||!CURRENCIES.includes(currency))continue;
  out.push({at:new Date(t).toISOString().replace('.000Z','Z'),currency,title,impact:clean(r.impact)??'Low',forecast:clean(r.forecast),previous:clean(r.previous)});
 }
 return out;
}

export const ffKey=(r:{currency:string;title:string;at:string})=>r.currency+'|'+r.title+'|'+r.at;

// Slučování uložených řádků s novými; nová prázdná hodnota nepřepíše dřívější vyplněnou. Starší než keepDays se zahodí.
export function mergeFF(old:FFRow[],fresh:FFRow[],now:number,keepDays=21):FFRow[]{
 const m=new Map<string,FFRow>();
 for(const r of old)m.set(ffKey(r),r);
 for(const r of fresh){const o=m.get(ffKey(r));m.set(ffKey(r),o?{...r,forecast:r.forecast??o.forecast,previous:r.previous??o.previous}:r)}
 return [...m.values()].filter(r=>Date.parse(r.at)>=now-keepDays*86400000).sort((a,b)=>a.at.localeCompare(b.at)||ffKey(a).localeCompare(ffKey(b)));
}

// Pojmy, které se v kalendářích jmenují různě (česky, anglicky, FF). Pořadí je důležité: konkrétnější první.
const CONCEPTS:[string,RegExp][]=[
 ['core-pce',/core pce/],['pce',/\bpce\b|osobní (příjmy|výdaje)|personal (income|spending)/],
 ['core-cpi',/core (cpi|consumer price)|jádrov\w* (cpi|inflace)/],['cpi',/\bcpi\b|consumer price|inflace|inflation rate/],
 ['ppi',/\bppi\b|producer price|ceny výrobců/],
 ['nfp',/non-?farm|\bnfp\b|^usa • zaměstnanost/],['unemployment',/unemployment rate|míra nezaměstnanosti/],
 ['jolts',/jolts/],
 ['core-retail',/core retail/],['retail',/retail sales|maloobchod/],
 ['gdp',/\bgdp\b|\bhdp\b/],
 ['ism-mfg',/ism manufacturing|ism výrob/],['ism-svc',/ism services|ism non-manufacturing|ism služby/],['trade',/trade balance|obchodní bilance/],
 ['pmi-mfg',/manufacturing pmi|výrobní pmi|\bmpmi\b/],['pmi-svc',/services pmi|pmi služeb|\bspmi\b/],
 ['rate',/^(?!.*(minutes|zápis|press|conference|statement|speaks|projections)).*(interest rate|cash rate|official bank rate|federal funds rate|main refinancing|bank rate|overnight rate|policy rate|sazb|rate decision|rozhodnutí)/],
 ['crude-inv',/crude oil inventories|zásoby ropy/],['gas-storage',/natural gas storage|zásoby plynu/],
];
const KIND_CONCEPT:Record<string,string>={'us-nfp':'nfp','us-cpi':'cpi','us-gdp':'gdp','us-pce':'pce','us-ppi':'ppi','us-jolts':'jolts',fomc:'rate','ecb-rates':'rate','eia-oil':'crude-inv','eia-gas':'gas-storage'};
// Která z více variant (m/m × y/y) se u hlavních čísel bere, když se časově kryjí.
const PREFER:Record<string,string>={cpi:'y/y',ppi:'y/y',pce:'y/y',gdp:'q/q'};

export const conceptOf=(title:string,kind?:string)=>(kind&&KIND_CONCEPT[kind])||CONCEPTS.find(([,re])=>re.test(title.toLowerCase()))?.[0]||null;

const STOP=new Set(['the','of','and','a','in','for','flash','prelim','preliminary','final','advance','revised','s','za','a']);
export function tokens(title:string):string[]{
 return title.toLowerCase().replace(/\b(m\/m|y\/y|q\/q|mom|yoy|qoq)\b/g,' ').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').split(' ').filter(t=>t&&!STOP.has(t));
}
export function overlap(a:string,b:string){
 const ta=new Set(tokens(a)),tb=new Set(tokens(b));
 if(!ta.size||!tb.size)return 0;
 let n=0;for(const t of ta)if(tb.has(t))n++;
 return n/Math.min(ta.size,tb.size);
}

const OIL_GAS=['OIL','GAS'];
// Měny události: trhy, které jsou měnami; komoditní zásoby (ropa, plyn z EIA) patří USD.
function currenciesOf(e:CalendarEvent,concept:string|null){
 const c=e.markets.filter(m=>CURRENCIES.includes(m));
 if(!c.length&&(concept==='crude-inv'||concept==='gas-storage')&&e.markets.some(m=>OIL_GAS.includes(m)))c.push('USD');
 return c;
}

export function matchFF(events:CalendarEvent[],rows:FFRow[],toleranceMin=10):Record<string,FFMatch>{
 const out:Record<string,FFMatch>={};
 const usable=rows.filter(r=>r.forecast!==null||r.previous!==null).map(r=>({r,t:Date.parse(r.at),concept:conceptOf(r.title)}));
 for(const e of events){
  if(!e.timeKnown)continue;
  const t=Date.parse(e.at),concept=conceptOf(e.title,e.kind),cur=currenciesOf(e,concept);
  if(!cur.length||!Number.isFinite(t))continue;
  let best:{r:FFRow;score:number;diff:number;pref:number}|null=null;
  for(const x of usable){
   const diff=Math.abs(x.t-t);
   if(diff>toleranceMin*60000||!cur.includes(x.r.currency))continue;
   let score:number;
   if(concept&&x.concept)score=concept===x.concept?1:0;      // známé pojmy se musí shodovat
   else score=overlap(e.title,x.r.title);
   if(concept&&x.concept&&score===0)continue;
   if(score<0.5)continue;
   const pref=concept&&PREFER[concept]&&x.r.title.toLowerCase().includes(PREFER[concept])?1:0;
   if(!best||score>best.score||(score===best.score&&(pref>best.pref||(pref===best.pref&&diff<best.diff))))best={r:x.r,score,diff,pref};
  }
  if(best)out[e.id]={forecast:best.r.forecast,previous:best.r.previous,ffTitle:best.r.title,impact:best.r.impact};
 }
 return out;
}

// Doplní odhad a předchozí hodnotu; vlastní konsenzus, předchozí ani výsledek nikdy nepřepíše.
export function applyFF(events:CalendarEvent[],matches:Record<string,FFMatch>):CalendarEvent[]{
 return events.map(e=>{
  const m=matches[e.id];
  if(!m)return e;
  return {...e,forecast:m.forecast,previous:e.previous||m.previous||null};
 });
}

// Text „Odhad X · Předchozí Y · Skutečnost Z“ (vynechá, co chybí).
export function forecastLine(e:Pick<CalendarEvent,'consensus'|'forecast'|'previous'|'actual'>){
 const f=e.consensus||e.forecast,parts:string[]=[];
 if(f)parts.push('Odhad '+f);
 if(e.previous)parts.push('Předchozí '+e.previous);
 if(e.actual)parts.push('Skutečnost '+e.actual);
 return parts.join(' · ');
}
