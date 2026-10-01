// Kalendář událostí: sloučení kostry ze skriptu (data/calendar.json) a ověřených událostí agenta (fundamentals.json → events).
export type Category='macro'|'central-bank'|'exchange'|'commodity'|'crypto'|'equity'|'politics';
export type Signal=1|2|3;
export type CalendarEvent={id:string;at:string;timeKnown:boolean;title:string;category:Category;markets:string[];kind?:string;signal:Signal;global:boolean;verified:boolean;source:string;watch?:string;consensus?:string|null;previous?:string|null;actual?:string|null;verifiedAt?:string};
export type AutoEvent={id:string;at:string;timeKnown:boolean;title:string;category:Category;markets:string[];kind?:string;source:string;origin?:string};
export type CuratedEvent={id:string;at:string;title:string;source:string;timeKnown:boolean;currency?:string;importance?:string;watch?:string;consensus?:string|null;actual?:string|null;category?:Category;markets?:string[];kind?:string;signal?:Signal;global?:boolean;previous?:string|null;verifiedAt?:string};
export type Filters={categories:Category[];markets:string[];minSignal:Signal;showGlobal:boolean;hidePast:boolean};

export const categories:Record<Category,string>={macro:'Makro','central-bank':'Centrální banky',exchange:'Burzy',commodity:'Komodity',crypto:'Krypto',equity:'Akcie',politics:'Politika'};
export const marketLabels:Record<string,string>={USD:'USD',EUR:'EUR',GBP:'GBP',JPY:'JPY',CHF:'CHF',AUD:'AUD',NZD:'NZD',CAD:'CAD',BTC:'BTC',ETH:'ETH',SOL:'SOL',OIL:'Ropa',GOLD:'Zlato',GAS:'Plyn',INDEX:'Indexy',STOCKS:'Akcie'};
export const signalLabels:Record<Signal,string>={1:'Slabá',2:'Střední',3:'Silná'};
// Výchozí síla podle typu, když ji agent nedoplnil.
export const DEFAULT_SIGNAL:Record<string,Signal>={'us-nfp':3,'us-cpi':3,'us-gdp':3,'us-pce':3,fomc:3,'ecb-rates':3,'us-ppi':2,'us-jolts':2,'us-eci':2,'us-trade':2,'eia-oil':2,'eia-gas':2,'rig-count':1,opex:2,'nyse-holiday':1};
// Události, které hýbou všemi trhy (štítek VŠE). Agent může VŠE přidat i jiným událostem polem global.
export const GLOBAL_KINDS=['fomc','us-nfp','us-cpi','us-gdp','ecb-rates','opec'];
// Staré záznamy agenta bez pole kind – typ odvozený z titulku.
const LEGACY_KINDS:[RegExp,string][]=[[/^FOMC/i,'fomc'],[/^USA • zaměstnanost/i,'us-nfp'],[/^USA • CPI/i,'us-cpi'],[/^USA • HDP/i,'us-gdp'],[/^USA • osobní příjmy|PCE/i,'us-pce'],[/^USA • JOLTS/i,'us-jolts'],[/^ECB/i,'ecb-rates']];
const BANKS=/^(FOMC|Fed|ECB|RBA|RBNZ|BoC|BoJ|BoE|Bank of England|Swiss National Bank|SNB)\b/i;
const STOCK=/^[A-Z][A-Z.-]{0,5}$/;

const day=(iso:string)=>iso.slice(0,10);
const legacySignal=(s?:string):Signal|undefined=>!s?undefined:/high|vysok/i.test(s)?3:/med|stř/i.test(s)?2:1;

export function normalizeCurated(e:CuratedEvent,base=false):Omit<CalendarEvent,'signal'|'global'|'markets'|'category'>&{signal?:Signal;global?:boolean;markets?:string[];category?:Category}{
 const kind=e.kind??LEGACY_KINDS.find(([re])=>re.test(e.title))?.[1];
 // Když existuje událost ze skriptu, odhady agenta (kategorie z titulku, trhy z currency, neověřený čas) ji nepřebíjí.
 const markets=e.markets?.length?e.markets:base?undefined:e.currency?[e.currency]:undefined;
 return {id:e.id,title:e.title,source:e.source,kind,
  ...(!base||e.timeKnown?{at:e.at,timeKnown:e.timeKnown}:{}),
  category:e.category??(base?undefined:BANKS.test(e.title)?'central-bank':'macro'),
  markets,signal:e.signal??legacySignal(e.importance),global:e.global,verified:true,
  watch:e.watch,consensus:e.consensus??null,previous:e.previous??null,actual:e.actual??null,verifiedAt:e.verifiedAt} as ReturnType<typeof normalizeCurated>;
}

// Měny a trhy události bez ohledu na formát záznamu (starý currency, nový markets).
export const eventMarkets=(e:{currency?:string;markets?:string[]})=>[...new Set([...(e.currency?[e.currency]:[]),...(e.markets??[])])];

// Agent píše do source klíč z fundamentals.sources (např. bls-cal); URL nechá beze změny.
const resolveSource=(s:string|undefined,sources?:Record<string,{url?:string}>)=>!s?undefined:/^https?:\/\//.test(s)?s:sources?.[s]?.url;
export function sourceUrl(s:string){try{return /^https?:\/\//.test(s)?new URL(s).hostname.replace(/^www\./,''):null}catch{return null}}

const filled=(v:unknown)=>v!==undefined&&v!==null&&v!==''&&!(Array.isArray(v)&&!v.length);

export function mergeCalendar(auto:AutoEvent[],curated:CuratedEvent[],sources?:Record<string,{url?:string}>):CalendarEvent[]{
 const byId=new Map<string,Partial<CalendarEvent>>();
 for(const a of auto)byId.set(a.id,{...a,verified:false});
 for(const raw of curated){
  const kind=raw.kind??LEGACY_KINDS.find(([re])=>re.test(raw.title))?.[1];
  // Agent použil ID skriptu, nebo jde o stejný typ ve stejný den (staré záznamy s vlastním ID).
  const match=byId.has(raw.id)?raw.id:kind?[...byId.entries()].find(([,a])=>!a.verified&&a.kind===kind&&day(a.at!)===day(raw.at))?.[0]:undefined;
  const base=match?byId.get(match)!:{};
  const c={...normalizeCurated(raw,!!match),source:resolveSource(raw.source,sources)};
  if(match&&match!==raw.id)byId.delete(match);
  const merged:Partial<CalendarEvent>={...base};
  for(const [k,v] of Object.entries(c))if(filled(v))(merged as Record<string,unknown>)[k]=v;
  merged.verified=true;
  merged.category??='macro';
  byId.set(raw.id,merged);
 }
 return [...byId.values()].map(e=>({
  ...e,
  markets:e.markets??[],
  signal:e.signal??DEFAULT_SIGNAL[e.kind??'']??1,
  global:e.global??GLOBAL_KINDS.includes(e.kind??''),
  verified:e.verified??false,
 } as CalendarEvent)).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
}

// Akciové tickery spadají pod filtr „Akcie“.
export const filterMarket=(m:string)=>marketLabels[m]?m:STOCK.test(m)?'STOCKS':m;

export const defaultFilters:Filters={categories:Object.keys(categories) as Category[],markets:Object.keys(marketLabels),minSignal:2,showGlobal:true,hidePast:false};

export function filterEvents(events:CalendarEvent[],f:Filters,now:number){
 return events.filter(e=>{
  if(f.hidePast&&Date.parse(e.at)<now-3600000)return false;
  if(f.showGlobal&&e.global)return true;
  if(e.signal<f.minSignal)return false;
  if(!f.categories.includes(e.category))return false;
  return !e.markets.length||e.markets.some(m=>f.markets.includes(filterMarket(m)));
 });
}

// Vlaječky jsou na instrumentech (EUR/USD, USD, BTC-USD, ^NDX, AAPL) → trhy kalendáře.
export function flaggedMarkets(flags:Record<string,string>){
 const out=new Set<string>();
 for(const [id,flag] of Object.entries(flags)){
  if(!flag||flag==='none')continue;
  if(id.includes('/'))id.split('/').forEach(c=>out.add(c));
  else if(id.endsWith('-USD'))out.add(id.slice(0,-4));
  else if(id.startsWith('^'))out.add('INDEX');
  else out.add(id);
 }
 return out;
}

export function relative(at:string,now:number){
 const diff=Date.parse(at)-now,abs=Math.abs(diff),min=Math.round(abs/60000);
 const txt=min<60?min+' min':min<1440?Math.floor(min/60)+' h'+(min%60&&min<600?' '+min%60+' min':''):Math.round(min/1440)+' d';
 return diff>=0?'za '+txt:'před '+txt;
}

export function upcomingCalendar(events:CalendarEvent[],now:number,limit:number){
 return events.filter(e=>Date.parse(e.at)>=now-3*3600000&&(e.signal>=2||e.global)).slice(0,limit);
}

// Filtry z localStorage – cokoli nečitelného nebo starého vrací výchozí hodnoty.
export function readFilters(raw:string|null):Filters{
 try{
  const v=raw?JSON.parse(raw):null;
  if(!v||typeof v!=='object')return defaultFilters;
  return {
   categories:Array.isArray(v.categories)?v.categories.filter((c:string)=>c in categories):defaultFilters.categories,
   markets:Array.isArray(v.markets)?v.markets.filter((m:string)=>m in marketLabels):defaultFilters.markets,
   minSignal:[1,2,3].includes(v.minSignal)?v.minSignal:defaultFilters.minSignal,
   showGlobal:typeof v.showGlobal==='boolean'?v.showGlobal:true,
   hidePast:v.hidePast===true,
  };
 }catch{return defaultFilters}
}
