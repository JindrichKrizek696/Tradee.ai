// Co Tradee u trhu umí a proč něco nejde: objem (volume profile, VWAP, footprint), COT, fundament, skóre v3, sezonalita, živá cena.
// Zdroj pravdy: registr instrumentů (lib/risk/instruments.ts – volume/cot/fundamentals/proxy), identita trhu (lib/instrument-info.ts),
// footprint (lib/chart/footprint.ts) a obchodní hodiny (lib/market-hours.ts). Čisté funkce – testy scripts/check-capabilities.mjs.
import {SEED,type Instrument} from './risk/instruments.ts';
import {isTechFx,dataSource} from './instrument-info.ts';
import {marketKind,isMarketOpen,type MarketKind} from './market-hours.ts';
import {fpSymbol} from './chart/footprint.ts';
export type Feature='volumeProfile'|'vwap'|'footprint'|'cot'|'fundamentals'|'scoreV3'|'seasonality'|'live';
export type Reason='no-volume'|'no-cot'|'no-fundamentals'|'license'|'not-implemented'|'market-closed'|'proxy';
export type Status='ok'|'partial'|'off';
export type Capability={feature:Feature;label:string;status:Status;reason:Reason|null;text:string};
export const FEATURE_LABELS:Record<Feature,string>={volumeProfile:'Volume profile',vwap:'VWAP',footprint:'Footprint',cot:'COT report',fundamentals:'Fundament (makro)',scoreV3:'Skóre v3',seasonality:'Sezonalita',live:'Živá cena'};
export const REASON_LABELS:Record<Reason,string>={'no-volume':'Bez dat o objemu','no-cot':'Bez COT','no-fundamentals':'Bez fundamentu',license:'Vyžaduje licenci dat','not-implemented':'Zatím neumíme','market-closed':'Trh je zavřený',proxy:'Cena z jiného instrumentu'};
export const FEATURES:Feature[]=['scoreV3','fundamentals','cot','seasonality','volumeProfile','vwap','footprint','live'];
const MODEL=['USD','EUR','GBP','CHF','JPY','CAD','AUD','NZD'];
const isModelPair=(id:string)=>{const m=/^([A-Z]{3})\/([A-Z]{3})$/.exec(id);return !!m&&MODEL.includes(m[1])&&MODEL.includes(m[2])};
/** Instrumenty registru, které berou cenu z trhu Tradee. */
const instrumentsOf=(market:string,list:readonly Instrument[])=>list.filter(i=>i.market===market);
const ok=(feature:Feature,text:string):Capability=>({feature,label:FEATURE_LABELS[feature],status:'ok',reason:null,text});
const no=(feature:Feature,reason:Reason,text:string,status:Status='off'):Capability=>({feature,label:FEATURE_LABELS[feature],status,reason,text});
/** Druh trhu pro texty (USD/CZK je FX, ale mimo model). */
export function kindOf(market:string):MarketKind|'techfx'{return isTechFx(market)?'techfx':marketKind(market)}

function volumeText(k:ReturnType<typeof kindOf>,market:string):string{
 if(k==='fx'||k==='techfx')return 'FX je mimoburzovní (OTC) trh – centrální objem obchodů neexistuje a Tradee ho nemá.';
 if(k==='currency')return 'Měnový index Tradee je vypočtený průměr párů, nemá vlastní obchody ani objem.';
 if(k==='index')return `Tradee kreslí hotovostní index (${market}), který objem obchodů nemá; futures s objemem (NQ, ES) Tradee nemá.`;
 if(k==='commodities')return 'Zdroj ceny komodit v Tradee neposílá spolehlivý objem pro všechny svíčky.';
 return 'K tomuto trhu Tradee nemá data o objemu.';
}
/** Schopnosti trhu Tradee (id jako EUR/USD, GC=F, ^NDX, AAPL, BTC-USD, USD). now = pro „trh je zavřený“; bez něj se nekontroluje. */
export function resolveCapabilities(market:string,o:{now?:number;list?:readonly Instrument[]}={}):Capability[]{
 const list=o.list??SEED,k=kindOf(market),regs=instrumentsOf(market,list);
 const hasVolume=k==='stock'||k==='crypto'?true:regs.some(i=>i.volume&&!i.proxy);
 const hasCot=k==='currency'||isModelPair(market)||regs.some(i=>i.cot);
 const hasFund=k==='currency'||isModelPair(market)||regs.some(i=>i.fundamentals);
 const out:Capability[]=[];
 // skóre v3: jen 8měnový model
 out.push(k==='currency'||isModelPair(market)?ok('scoreV3','Pár je v 8měnovém modelu – skóre v3 z 11 složek.')
  :no('scoreV3','no-fundamentals',k==='techfx'?'CZK není v 8měnovém modelu (žádné makro ani COT) – trh má jen technický model (trend a sezonalita).':'Skóre v3 počítá jen FX páry 8 hlavních měn; tady platí technický model (trend, sezonalita'+(hasCot?', COT':'')+').'));
 // fundament
 if(hasFund)out.push(ok('fundamentals','Makro data obou měn (sazby, inflace, HDP, PMI, trh práce, maloobchod).'));
 else if(k==='stock')out.push(no('fundamentals','license','Fundamenty firem (výsledky, valuace, odhady analytiků) vyžadují placený datový zdroj s licencí – Tradee je zatím nemá.'));
 else if(k==='techfx')out.push(no('fundamentals','no-fundamentals','CZK není v 8měnovém modelu – makro ČNB a ČSÚ Tradee do skóre nepočítá.'));
 else if(k==='commodities')out.push(no('fundamentals','not-implemented','Fundament nabídky a poptávky (zásoby, produkce, OPEC) Tradee zatím nesleduje.'));
 else if(k==='index')out.push(no('fundamentals','not-implemented','Fundament indexu (zisky firem, valuace) Tradee zatím nepočítá.'));
 else out.push(no('fundamentals','no-fundamentals','Krypto nemá makro fundament v tom smyslu, v jakém ho Tradee počítá u měn.'));
 // COT
 if(hasCot)out.push(ok('cot',k==='commodities'?'CFTC Disaggregated – do technického modelu vstupuje managed money.':'CFTC TFF (leveraged funds) a Legacy jako kontext.'));
 else if(k==='stock')out.push(no('cot','no-cot','Akcie se v COT reportu CFTC nevykazují – COT je jen pro futures.'));
 else if(k==='techfx')out.push(no('cot','no-cot','Koruna nemá v COT reportu CFTC vlastní futures kontrakt.'));
 else out.push(no('cot','not-implemented','Ověřený odpovídající futures kontrakt v COT zatím není připojený, do modelu se COT nepočítá.'));
 out.push(k==='currency'?no('seasonality','not-implemented','Sezonalita se počítá pro obchodovatelné trhy, ne pro vypočtený měnový index.'):ok('seasonality',k==='fx'||k==='techfx'?'Výnosy v měsíci za posledních 10 let.':'Výnosy v měsíci za dostupnou historii (alespoň 5 let).'));
 // objem
 out.push(hasVolume?ok('volumeProfile','Profil z objemu svíček (POC, value area).'):no('volumeProfile','no-volume',volumeText(k,market)+' Profil se proto počítá z času na ceně (TPO).','partial'));
 out.push(hasVolume?ok('vwap','VWAP z objemu svíček od začátku seance.'):no('vwap','no-volume',volumeText(k,market)+' VWAP bez objemu nedává smysl.'));
 if(fpSymbol(market))out.push(ok('footprint','Obchody z Binance (aggTrades) – nákupy a prodeje na cenových hladinách.'));
 else if(k==='stock')out.push(no('footprint','license','Footprint potřebuje jednotlivé obchody (tick data) amerických burz – ta jsou za placenou licencí.'));
 else if(!hasVolume)out.push(no('footprint','no-volume',volumeText(k,market)));
 else out.push(no('footprint','not-implemented','Footprint zatím umíme jen pro BTC, ETH a SOL (obchody z Binance).'));
 // živá cena
 const src=dataSource(market),proxy=regs.some(i=>i.proxy);
 if(o.now!==undefined&&k!=='currency'&&!isMarketOpen(market,k==='techfx'?'fx':k,o.now))out.push(no('live','market-closed','Trh je teď zavřený – cena se obnoví po otevření.'));
 else if(proxy&&src?.type!=='spot')out.push(no('live','proxy',`${src?.short||'Cena'} – obchodované CFD / futures u brokera se od ní liší.`,'partial'));
 else out.push(ok('live',src?src.short:'Cena z Tradee.'));
 return out;
}
export function capabilityFor(market:string,feature:Feature,o:{now?:number;list?:readonly Instrument[]}={}):Capability{
 return resolveCapabilities(market,o).find(c=>c.feature===feature)!;
}
/** Oznámení o změně poskytovatele dat (komponenta ProviderNotice): platí, když trh spadá pod změnu a ta ještě nevypršela. */
export type ProviderChange={id:string;markets:string[]|'all';from:string;to:string;since:string;until?:string;text:string};
export function activeChanges(market:string,changes:readonly ProviderChange[],now:number):ProviderChange[]{
 const day=new Date(now).toISOString().slice(0,10);
 return changes.filter(c=>(c.markets==='all'||c.markets.includes(market))&&c.since<=day&&(!c.until||day<=c.until));
}
