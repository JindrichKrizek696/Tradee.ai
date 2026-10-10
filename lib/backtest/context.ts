// Kontext pro podmínky s daty Tradee (skóre, síla měn, COT, zprávy) – čisté funkce nad JSON daty, bez DB.
// Všechny funkce vrací jen to, co bylo známé k času t (krokové funkce, žádný pohled do budoucna):
//  - skóre / síla: poslední snapshot z data/score-history.json s časem ≤ t; starší než SCORE_MAX_AGE_MS = bez dat
//  - COT: týdenní řádek platí od zveřejnění (CFTC: běžně pátek po úterním datu; počítáme konzervativně až pondělí), ne od data pozorování
//  - zprávy: kalendář je dopředu známý, ale pokrývá jen své období; mimo něj bez dat
import type {BacktestContext,CotPoint} from './engine.ts';
import {instrumentSpec,isCurrencyIndex} from './rules.ts';
import {mergeCalendar,eventMarkets,type AutoEvent,type CuratedEvent} from '../calendar.ts';

export const SCORE_MAX_AGE_MS=72*3600000; // snapshoty chodí několikrát denně; delší mezera = data chybí
export const COT_MAX_AGE_MS=14*86400000; // týdenní report; po dvou týdnech bez nového řádku už neplatí
export const COT_LAG_MS=6*86400000+21*3600000; // úterý + 6 dní = následující pondělí 21:00 UTC; konzervativně pokrývá i report zpožděný svátkem (běžně pátek 15:30 ET)
export const COT_GROUP='leveraged'; // spekulanti (stejná skupina jako skóre Tradee)

export type HistoryData={snapshots:{at:string;scores:Record<string,{score:number|null}|undefined>}[]};
export type CotRowData={date:string;openInterest?:number;groups:Record<string,{net:number}|undefined>};
export type MarketCot={cot:Record<string,{isProxy?:boolean;history:CotRowData[]}|undefined>};
export type NewsItem={at:number;currencies:string[];signal:number};

// krokový přístup: poslední záznam s časem ≤ t (pole seřazené vzestupně podle času)
function lastIndexAtOrBefore(times:number[],t:number):number{
 let lo=0,hi=times.length-1,ans=-1;
 while(lo<=hi){const m=(lo+hi)>>1;if(times[m]<=t){ans=m;lo=m+1}else hi=m-1}
 return ans;
}
function stepSeries<T>(times:number[],values:T[],maxAge:number){
 return (t:number):T|undefined=>{const i=lastIndexAtOrBefore(times,t);return i<0||t-times[i]>maxAge?undefined:values[i]};
}

// skóre každého instrumentu (a síla měny = skóre měnového indexu 'EUR', 'USD' …) jako krokové funkce
export function scoreLookup(history:HistoryData|undefined){
 const snaps=[...(history?.snapshots||[])].map(s=>({t:Date.parse(s.at),s})).filter(x=>Number.isFinite(x.t)).sort((a,b)=>a.t-b.t);
 const times=snaps.map(x=>x.t),cache=new Map<string,(t:number)=>number|undefined>();
 return (instrument:string)=>{
  let f=cache.get(instrument);
  if(!f){
   const vals=snaps.map(x=>{const v=x.s.scores?.[instrument]?.score;return typeof v==='number'&&Number.isFinite(v)?v:undefined});
   const step=stepSeries(times,vals,SCORE_MAX_AGE_MS);
   f=(t:number)=>step(t);cache.set(instrument,f);
  }
  return f;
 };
}

// COT jedné měny: [čas zveřejnění] → {net, změna proti předchozímu týdnu}; proxy (USD index) se nepoužívá
export function cotSeries(market:MarketCot|undefined,ccy:string){
 const c=market?.cot?.[ccy];if(!c||c.isProxy)return null;
 const rows=(c.history||[]).filter(r=>r.groups?.[COT_GROUP]&&Number.isFinite(Date.parse(r.date))).sort((a,b)=>a.date<b.date?-1:1);
 const times:number[]=[],vals:(CotPoint|undefined)[]=[];
 rows.forEach((r,i)=>{
  const net=(r.groups[COT_GROUP] as {net:number}).net,prev=i>0?(rows[i-1].groups[COT_GROUP] as {net:number}).net:null;
  times.push(Date.parse(r.date+'T00:00:00Z')+COT_LAG_MS);
  vals.push(prev===null?undefined:{net,change:net-prev}); // první řádek nemá změnu → bez dat
 });
 return stepSeries(times,vals,COT_MAX_AGE_MS);
}

// COT instrumentu: měnový index = net měny; FX pár = net(base) − net(quote); USD strana (proxy) se vynechá se správným znaménkem
export function cotLookup(market:MarketCot|undefined){
 const cache=new Map<string,ReturnType<typeof cotSeries>>(),get=(c:string)=>{if(!cache.has(c))cache.set(c,cotSeries(market,c));return cache.get(c)!};
 return (instrument:string,t:number):CotPoint|undefined=>{
  const sp=instrumentSpec(instrument);
  if(sp.base&&sp.quote){
   if(sp.quote==='USD'){return get(sp.base)?.(t)}
   if(sp.base==='USD'){const v=get(sp.quote)?.(t);return v&&{net:-v.net,change:-v.change}}
   const a=get(sp.base)?.(t),b=get(sp.quote)?.(t);
   return a&&b?{net:a.net-b.net,change:a.change-b.change}:undefined;
  }
  if(isCurrencyIndex(instrument))return get(instrument)?.(t);
  return undefined;
 };
}

// události kalendáře se známým časem a signálem (rozdíl proti highNews: drží i signál 1–2, aby šlo použít minSignal)
export function newsItems(auto:AutoEvent[],curated:CuratedEvent[],sources?:Record<string,{url?:string}>):NewsItem[]{
 const out:NewsItem[]=[];
 for(const e of mergeCalendar(auto,curated,sources)){
  if(!e.timeKnown)continue;
  const at=Date.parse(e.at),cur=eventMarkets(e).filter(m=>/^[A-Z]{3}$/.test(m));
  if(Number.isFinite(at)&&cur.length)out.push({at,currencies:cur,signal:e.signal});
 }
 return out.sort((a,b)=>a.at-b.at);
}
const currenciesOfInstrument=(id:string)=>{const sp=instrumentSpec(id);return sp.base&&sp.quote?[sp.base,sp.quote]:isCurrencyIndex(id)?[id]:['USD']}; // indexy, akcie, krypto: dopad USD zpráv
export function newsLookup(items:NewsItem[]){
 const ev=[...items].sort((a,b)=>a.at-b.at),first=ev.length?ev[0].at:null,last=ev.length?ev[ev.length-1].at:null,times=ev.map(e=>e.at);
 return (instrument:string,t:number,minutes:number,minSignal:number):boolean|undefined=>{
  const w=minutes*60000;
  if(first===null||last===null||t-w<first||t+w>last)return undefined; // celé okno musí ležet v období, které kalendář pokrývá
  const cur=currenciesOfInstrument(instrument);
  let i=lastIndexAtOrBefore(times,t-w-1)+1;
  for(;i<ev.length&&ev[i].at<=t+w;i++)if(ev[i].signal>=minSignal&&ev[i].currencies.some(c=>cur.includes(c)))return true;
  return false;
 };
}

export function buildContext(src:{history?:HistoryData;market?:MarketCot;news?:NewsItem[]}):BacktestContext{
 const score=scoreLookup(src.history),cot=cotLookup(src.market),news=newsLookup(src.news||[]);
 return {score:(i,t)=>score(i)(t),strength:(c,t)=>score(c)(t),cot,news};
}
