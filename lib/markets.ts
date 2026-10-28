import type {FundamentalData} from './fundamentals';
import {pairs,seasonalStats,fresh,cotStats,type MarketData} from './score-engine.ts';
import {scoreV3} from './score/v3.ts';
import {TECH_FX,isTechFx} from './instrument-info.ts';
export const assetNames:Record<string,string>={'BTC-USD':'Bitcoin','ETH-USD':'Ethereum','SOL-USD':'Solana','^NDX':'Nasdaq 100 (index)','^GSPC':'S&P 500 (index)',AAPL:'Apple',MSFT:'Microsoft',NVDA:'NVIDIA',AMZN:'Amazon',GOOGL:'Alphabet',META:'Meta',TSLA:'Tesla','BRK-B':'Berkshire Hathaway',JPM:'JPMorgan Chase',AVGO:'Broadcom','GC=F':'Zlato (futures GC=F)','SI=F':'Stříbro (futures SI=F)','CL=F':'Ropa WTI (futures CL=F)','BZ=F':'Ropa Brent (futures BZ=F)',
 // FX mimo 8měnový model (lib/instrument-info.ts TECH_FX): technický model, žádný fundament ani COT
 'USD/CZK':'USD/CZK'};
export {TECH_FX,isTechFx};
// Komodity = futures z Yahoo (id končí =F; spot XAUUSD=X Yahoo nemá) – UI to říká v názvu a v odznaku zdroje dat (app/data-source.tsx).
// Indexy ^NDX/^GSPC jsou hotovostní indexy, ne futures NQ/ES ani CFD US100/US500. COT: CFTC Disaggregated, managed money (scripts/refresh-expanded-data.py → expanded-market.json legacy[id]).
// Brent COT nemá: hlavní ICE Brent CFTC nevykazuje, NYMEX Brent Last Day má zanedbatelné pozice fondů.
export const isCommodity=(id:string)=>id.endsWith('=F');
export const commodityCot:Record<string,string>={'GC=F':'GOLD · COMEX','SI=F':'SILVER · COMEX','CL=F':'WTI-PHYSICAL · NYMEX'};
export const fxCurrencies=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD'];
// model:false = trh mimo 8měnový FX model (USD/CZK): skupina FX páry, ale do měnových indexů, skóre v3 ani Laboratoře nepatří
export const instruments:{id:string;name:string;group:string;model:boolean}[]=[...pairs.map(id=>({id,name:id,group:'fx',model:true})),...TECH_FX.map(id=>({id,name:assetNames[id],group:'fx',model:false})),...fxCurrencies.map(id=>({id,name:id+' · měnový index',group:'currency',model:true})),...Object.entries(assetNames).filter(([id])=>!isTechFx(id)).map(([id,name])=>({id,name,group:id.startsWith('^')?'index':isCommodity(id)?'commodities':id.endsWith('-USD')?'crypto':'stock',model:true}))];
/** FX páry 8měnového modelu (28) – jen ty tvoří měnové indexy a skóre v3. */
export const isModelPair=(id:string)=>pairs.includes(id);
export const groups:Record<string,string>={all:'Všechny trhy',fx:'FX páry',currency:'Měnové indexy',index:'Akciové indexy',commodities:'Komodity',crypto:'Krypto',stock:'Akcie'};
// Text „Výpočet skóre“ technického modelu (akcie, indexy, krypto; komodity s COT).
export const technicalMethodText=(id:string)=>isTechFx(id)?'Technický model: denní trend 70 % a sezonalita 30 %. Bez fundamentu – CZK není v 8měnovém modelu (žádné makro ani COT), proto ani ve skóre v3 a měnových indexech. Kurz Yahoo CZK=X. S FX skóre v3 není přímo srovnatelný.':commodityCot[id]?'Technický model s COT: denní trend 50 %, pozice fondů (COT, managed money) 30 % a sezonalita 20 %. Futures kontrakt (Yahoo), COT z CFTC Disaggregated. Neobsahuje fundament nabídky a poptávky. S FX skóre v3 není přímo srovnatelný.':isCommodity(id)?'Technický model: denní trend 70 % a sezonalita 30 %. Futures kontrakt (Yahoo); COT pro tento trh CFTC spolehlivě nevykazuje. S FX skóre v3 není přímo srovnatelný.':'Technický model: denní trend 70 % a sezonalita 30 %. Neobsahuje výkazy firmy, ocenění ani kryptoměnové fundamenty. S FX skóre v3 není přímo srovnatelný.';
// COT signál komodity (managed money): stejné čtení i limity stáří jako u FX (report do 11 dní, kontrola do 48 h); jinak null
export function commodityCotSignal(market:MarketData,id:string,now=Date.now()){
 const ct=market.legacy?.[id],s=ct?cotStats(ct,'managedMoney'):null;
 return s&&ct&&fresh(ct.checkedAt,2,now)&&fresh(s.last.date,11,now)?s.signal:null;
}
export function marketScore(data:FundamentalData,market:MarketData,id:string,now=Date.now()){
 // FX páry i vlastní měnové indexy: skóre v3 ze složek (lib/score/v3.ts). scoreV2 zůstává v score-engine.ts pro starší snímky a analyzátor v2.2.
 if(!assetNames[id])return scoreV3(id,data,market,now);
 const price=market.prices[id],season=seasonalStats(price,new Date(now).getUTCMonth()+1);
 const trend=price&&fresh(price.asOf,7,now)&&fresh(price.checkedAt,2,now)?price.trend:null;
 const sea=price&&price.currentYear===new Date(now).getUTCFullYear()&&fresh(price.checkedAt,32,now)&&season.n>=5?season.signal:null;
 const cot=!!commodityCot[id],wT=cot?50:70,wS=cot?20:30,wC=30,cotSig=cot?commodityCotSignal(market,id,now):null;
 const parts=[{id:'trend',label:'Denní cenový trend',weight:wT,signal:trend,contribution:trend===null?null:wT*trend,reason:'Tři rovnocenné hlasy: cena vs. GMA50, cena vs. GMA200 a GMA50 vs. GMA200.'},
  ...(cot?[{id:'cot',label:'Pozice fondů · COT',weight:wC,signal:cotSig,contribution:cotSig===null?null:wC*cotSig,reason:'CFTC Disaggregated, futures only ('+commodityCot[id]+'), skupina managed money: 60 % čisté pozice / open interest a 40 % změna tohoto poměru za 4 týdny. Pozice k úterý, CFTC zveřejňuje v pátek 15:30 ET; report do 11 dní od data pozic (8 dní od zveřejnění), jinak se nezapočítá.'}]:[]),
  {id:'seasonality',label:'Sezonalita',weight:wS,signal:sea,contribution:sea===null?null:wS*sea,reason:'Konzistence měsíčních výnosů, minimálně 5 dokončených let. Stejná normalizace jako u FX.'}];
 const coverage=parts.reduce((s,p)=>s+(p.signal===null?0:p.weight),0),known=parts.reduce((s,p)=>s+(p.contribution??0),0),score=trend===null?null:Math.round(known*10)/10,den=parts.reduce((s,p)=>s+Math.abs(p.contribution??0),0);
 return {score,known,coverage,macroCoverage:0,parts,bias:score===null?'Nedostatek dat':score>0?'Bullish':score<0?'Bearish':'Vyrovnané',magnitude:'Technický kontext',alignment:den?Math.round(Math.abs(known)/den*100):0,bounds:[Math.max(-100,known-100+coverage),Math.min(100,known+100-coverage)],missing:100-coverage,base:id,quote:undefined,others:[],events:[],price,season,macro:null,model:cot?'Technický model + COT':isTechFx(id)?'Technický model · bez fundamentu (CZK není v modelu)':'Technický model',method:cot?'technical-cot-v1' as const:'technical-v1.1' as const,available:parts.filter(p=>p.signal!==null).length,count:parts.length,missingParts:[] as string[],paused:null as string|null};
}
export const flagLabels:Record<string,string>={none:'Bez vlaječky',red:'Čekám na reakci trhu',orange:'Vyhlížím konkrétní pozici',green:'Jsem v tradu'};
