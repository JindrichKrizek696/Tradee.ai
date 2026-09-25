import type {FundamentalData} from './fundamentals';
import {pairs,scoreV2,seasonalStats,fresh,type MarketData} from './score-engine.ts';
export const assetNames:Record<string,string>={'BTC-USD':'Bitcoin','ETH-USD':'Ethereum','SOL-USD':'Solana','^NDX':'Nasdaq 100','^GSPC':'S&P 500',AAPL:'Apple',MSFT:'Microsoft',NVDA:'NVIDIA',AMZN:'Amazon',GOOGL:'Alphabet',META:'Meta',TSLA:'Tesla','BRK-B':'Berkshire Hathaway',JPM:'JPMorgan Chase',AVGO:'Broadcom'};
export const fxCurrencies=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD'];
export const instruments=[...pairs.map(id=>({id,name:id,group:'fx'})),...fxCurrencies.map(id=>({id,name:id+' · měnový index',group:'currency'})),...Object.entries(assetNames).map(([id,name])=>({id,name,group:id.startsWith('^')?'index':id.endsWith('-USD')?'crypto':'stock'}))];
export const groups:Record<string,string>={all:'Všechny trhy',fx:'FX páry',currency:'Měnové indexy',index:'Akciové indexy',crypto:'Krypto',stock:'Akcie'};
export function marketScore(data:FundamentalData,market:MarketData,id:string,now=Date.now()){
 if(!assetNames[id])return {...scoreV2(data,market,id,now),model:'FX kompozit',method:'score-v2.2'};
 const price=market.prices[id],season=seasonalStats(price,new Date(now).getUTCMonth()+1);
 const trend=price&&fresh(price.asOf,7,now)&&fresh(price.checkedAt,2,now)?price.trend:null;
 const sea=price&&price.currentYear===new Date(now).getUTCFullYear()&&fresh(price.checkedAt,32,now)&&season.n>=5?season.signal:null;
 const parts=[{id:'trend',label:'Denní cenový trend',weight:70,signal:trend,contribution:trend===null?null:70*trend,reason:'Tři rovnocenné hlasy: cena vs. GMA50, cena vs. GMA200 a GMA50 vs. GMA200.'},{id:'seasonality',label:'Sezonalita',weight:30,signal:sea,contribution:sea===null?null:30*sea,reason:'Konzistence měsíčních výnosů, minimálně 5 dokončených let. Stejná normalizace jako u FX.'}];
 const coverage=parts.reduce((s,p)=>s+(p.signal===null?0:p.weight),0),known=parts.reduce((s,p)=>s+(p.contribution??0),0),score=trend===null?null:Math.round(known*10)/10,den=parts.reduce((s,p)=>s+Math.abs(p.contribution??0),0);
 return {score,known,coverage,macroCoverage:0,parts,bias:score===null?'Nedostatek dat':score>0?'Bullish':score<0?'Bearish':'Vyrovnané',magnitude:'Technický kontext',alignment:den?Math.round(Math.abs(known)/den*100):0,bounds:[Math.max(-100,known-100+coverage),Math.min(100,known+100-coverage)],missing:100-coverage,base:id,quote:undefined,others:[],events:[],price,season,macro:null,model:'Technický model',method:'technical-v1.1'};
}
export const flagLabels:Record<string,string>={none:'Bez vlaječky',red:'Čekám na reakci trhu',orange:'Vyhlížím konkrétní pozici',green:'Jsem v tradu'};
