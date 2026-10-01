import type {FundamentalData,CoreFactor} from './fundamentals';
export type CotGroup={long:number;short:number;spread:number;net:number};
export type CotRow={date:string;openInterest:number;groups:Record<string,CotGroup>};
export type CotContract={contract:string;code:string;isProxy:boolean;sourceUrl:string;checkedAt:string;history:CotRow[]};
export type SeasonYear={year:number;path:number[];logReturn:number};
export type PriceData={asOf:string;checkedAt:string;sourceUrl:string;reference:number;gma50:number;gma200:number;trend:number;months:Record<string,{years:SeasonYear[]}>;currentMonth:number;currentYear:number;currentPath:number[];trendPath?:{date:string;value:number}[];pricePath:{date:string;value:number}[]};
export type MarketData={prices:Record<string,PriceData>;cot:Record<string,CotContract>;legacy?:Record<string,CotContract>;refresh:{attemptedAt:string;issues:string[]}};
export const METHOD='score-v2.2';
export const pairs=['EUR/USD','GBP/USD','USD/JPY','USD/CHF','USD/CAD','AUD/USD','NZD/USD','EUR/CAD','EUR/GBP','EUR/JPY','EUR/CHF','EUR/AUD','EUR/NZD','GBP/JPY','GBP/CHF','GBP/CAD','GBP/AUD','GBP/NZD','CHF/JPY','CAD/JPY','CAD/CHF','AUD/JPY','AUD/CAD','AUD/CHF','AUD/NZD','NZD/CHF','NZD/JPY','NZD/CAD'];
export const clamp=(n:number)=>Math.max(-1,Math.min(1,n));
export const mean=(ns:number[])=>ns.length?ns.reduce((s,n)=>s+n,0)/ns.length:0;
export const deviation=(ns:number[])=>ns.length>1?Math.sqrt(ns.reduce((s,n)=>s+(n-mean(ns))**2,0)/(ns.length-1)):0;
export const pct=(log:number)=>(Math.exp(log/100)-1)*100;
export const fresh=(stamp:string|undefined,days:number,now:number)=>{const t=Date.parse(stamp||'');return Number.isFinite(t)&&t<=now&&now-t<=days*86400000};
export function seasonalStats(price:PriceData|undefined,month:number,sample=10){
 const years=(price?.months[String(month)]?.years||[]).slice(-sample),values=years.map(y=>y.logReturn),avg=mean(values),sd=deviation(values),positive=values.filter(v=>v>0).length,negative=values.filter(v=>v<0).length;
 const n=years.length;const signal=n>=5&&sd>0?clamp(avg/sd)*Math.abs(positive-negative)/n*n/(n+10):n>=5&&sd===0&&avg===0?0:null;
 return {years,n,avg,sd,positive,signal,median:[...values].sort((a,b)=>a-b).length?mean([...values].sort((a,b)=>a-b).slice(Math.floor((n-1)/2),Math.floor(n/2)+1)):0,best:values.length?Math.max(...values):0,worst:values.length?Math.min(...values):0};
}
export function cotStats(contract:CotContract|undefined,group='leveraged'){
 const history=(contract?.history||[]).filter(r=>r.groups[group]&&r.openInterest>0),last=history.at(-1),previous=history.at(-2);
 if(!last)return null;
 const four=history.filter(r=>Date.parse(r.date)<=Date.parse(last.date)-28*86400000).at(-1),g=last.groups[group];
 const netRatio=g.net/last.openInterest,change4=four?netRatio-four.groups[group].net/four.openInterest:null;
 const sample=history.slice(-52).map(r=>r.groups[group].net/r.openInterest);
 const percentile=sample.length>=26?100*(sample.filter(v=>v<netRatio).length+.5*sample.filter(v=>v===netRatio).length)/sample.length:null;
 return {last,previous,group:g,netRatio,changeWeek:previous?g.net-previous.groups[group].net:null,change4,percentile,sample:sample.length,signal:change4===null?null:.6*clamp(netRatio/.25)+.4*clamp(change4/.10)};
}
export type ScorePart={id:string;label:string;weight:number;signal:number|null;contribution:number|null;reason:string};
export function scoreV2(data:FundamentalData,market:MarketData,instrument:string,now=Date.now()){
 const [base,quote,...rest]=instrument.split('/'),currencies=Object.keys(data.currencies);
 if(rest.length||!currencies.includes(base)||(quote&&!currencies.includes(quote))||base===quote)throw Error('Neplatný instrument');
 const others=quote?[quote]:currencies.filter(c=>c!==base),members=[base,...others];
 const macro=(id:CoreFactor)=>{const values=members.map(c=>data.currencies[c].factors[id]);return values.every(v=>v&&v.value!==null&&[-1,0,1].includes(v.value)&&fresh(data.sources[v.source]?.checkedAt,data.staleAfterHours/24,now))?((values[0].value as number)-mean(values.slice(1).map(v=>v.value as number)))/2:null};
 const cotCurrency=(c:string)=>{const ct=market.cot[c],s=cotStats(ct);return s&&ct&&!ct.isProxy&&fresh(ct.checkedAt,2,now)&&fresh(s.last.date,11,now)?s:null};
 const cotPair=(a:string,b:string):number|null=>{
  if(b==='USD')return cotCurrency(a)?.signal??null;
  if(a==='USD'){const v=cotCurrency(b)?.signal;return v===null||v===undefined?null:-v}
  const x=cotCurrency(a),y=cotCurrency(b);return x&&y&&x.signal!==null&&y.signal!==null&&x.last.date===y.last.date?(x.signal-y.signal)/2:null;
 };
 const cotValues=others.map(c=>cotPair(base,c)),cot=cotValues.every(v=>v!==null)?mean(cotValues as number[]):null;
 const price=market.prices[instrument],month=new Date(now).getUTCMonth()+1,year=new Date(now).getUTCFullYear(),season=seasonalStats(price,month);
 const trend=price&&fresh(price.asOf,7,now)&&fresh(price.checkedAt,2,now)&&Number.isFinite(price.trend)?price.trend:null;
 const seasonal=price&&price.currentYear===year&&season.n===10&&season.years.every(y=>y.year<year)&&fresh(price.checkedAt,32,now)?season.signal:null;
 const raw:[string,string,number,number|null,string][]=[
 ['decision','Krok centrální banky',15,macro('decision'),'Rozdíl posledních kroků sazeb. Nejde o překvapení vůči očekávání trhu.'],
 ['guidance','Výhled sazeb',20,macro('guidance'),'Rozdíl doloženého směru měnové politiky.'],
 ['activity','Ekonomická aktivita',15,macro('activity'),'Jeden souhrnný vstup pro HDP, PMI a spotřebu; bez trojího započtení růstu.'],
 ['labor','Pracovní trh',10,macro('labor'),'Relativní síla pracovního trhu podle ověřeného reportu.'],
 ['cot','Pozice fondů · COT',15,cot,'60 % čisté pozice / open interest a 40 % změna tohoto poměru za 4 týdny.'],
 ['trend','Cenový trend',15,trend,'Tři hlasy: reference vůči geometrickým průměrům 50 a 200 dnů a jejich vzájemné pořadí.'],
 ['seasonality','Sezónní kontext',10,seasonal,'Průměr / odchylka log výnosů × konzistence směru × zmenšení vlivu malého vzorku.']];
 const parts:ScorePart[]=raw.map(([id,label,weight,signal,reason])=>({id,label,weight,signal,contribution:signal===null?null:weight*clamp(signal),reason}));
 const coverage=parts.reduce((s,p)=>s+(p.signal===null?0:p.weight),0),known=parts.reduce((s,p)=>s+(p.contribution??0),0),missing=100-coverage;
 const macroCoverage=parts.slice(0,4).reduce((s,p)=>s+(p.signal===null?0:p.weight),0);
 const ready=coverage>=70&&macroCoverage===60;const score=ready?Math.round(known*10)/10:null;
 const bull=parts.reduce((s,p)=>s+Math.max(0,p.contribution??0),0),bear=parts.reduce((s,p)=>s+Math.max(0,-(p.contribution??0)),0);
 const alignment=bull+bear?Math.round(100*Math.abs(bull-bear)/(bull+bear)):0;
 const bounds=[Math.max(-100,known-missing),Math.min(100,known+missing)];
 const bias=score===null?'Nedostatek dat':score>0?'Bullish':score<0?'Bearish':'Vyrovnané';
 const magnitude=score===null?'Bez závěru':Math.abs(score)<15?'Slabá převaha':Math.abs(score)<40?'Střední převaha':'Výrazná převaha';
 const events=data.events.filter(e=>(quote?members:currencies).includes(e.currency??'')&&Date.parse(e.at)>=now&&Date.parse(e.at)-now<=72*3600000).sort((a,b)=>a.at.localeCompare(b.at));
 return {score,known,coverage,macroCoverage,parts,bias,magnitude,alignment,bounds,missing,base,quote,others,events,price,season,macro:parts.slice(0,4).every(p=>p.contribution!==null)?parts.slice(0,4).reduce((s,p)=>s+(p.contribution??0),0):null};
}
