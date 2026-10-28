// Registr obchodovatelných instrumentů: specifikace kontraktu (tick, hodnota ticku, velikost lotu), odkud bereme cenu (Yahoo symbol)
// a zda je zdroj ceny jen „proxy“ (obchoduješ CFD XAUUSD, ale graf je z futures GC=F). Čisté funkce – testy scripts/check-risk.mjs.
// SEED je zdroj pravdy pro výchozí hodnoty; migrace 0037 ho vkládá do tabulky instruments (check-risk hlídá, že se shodují).
// Hodnoty jsou běžné výchozí – každý broker může mít jiné (velikost lotu u ropy, indexů…), proto jdou přepsat per účet (instrument_overrides).
export type InstrumentKind='spot'|'CFD'|'futures'|'index'|'stock'|'crypto';
export type SizeUnit='lot'|'kontrakt'|'ks';
export type Instrument={
 id:string;name:string;kind:InstrumentKind;
 /** burza / typ trhu u brokera (CME, COMEX, OTC FX, CFD broker…) */
 venue:string;
 /** měna kotace – v ní je hodnota ticku */
 quote:string;
 /** nejmenší pohyb ceny */
 tickSize:number;
 /** hodnota jednoho ticku za 1 lot / kontrakt v měně kotace */
 tickValue:number;
 /** velikost kontraktu (100 000 jednotek, 100 oz, multiplikátor futures…) – informativně, výpočet jede přes tick */
 contractSize:number;
 lotStep:number;minLot:number;
 /** pip / bod pro zobrazení hodnoty pipu (FX); null = nepoužívá se */
 pip:number|null;
 unit:SizeUnit;
 /** odkaz na obchodní hodiny (lib/market-hours.ts) */
 sessions:string;
 /** symbol ceny v Tradee (Yahoo) a id trhu Tradee; null = Tradee cenu nemá */
 dataSymbol:string|null;market:string|null;
 /** cena v Tradee pochází z jiného instrumentu, než který se obchoduje (futures/index místo CFD) */
 proxy:boolean;
 volume:boolean;cot:boolean;fundamentals:boolean;
 /** symboly brokerů, které na instrument mapujeme (velkými písmeny, bez přípon) */
 aliases:string[];
};
// ---- FX: 8 měn modelu, pořadí určuje základní měnu páru (EUR > GBP > AUD > NZD > USD > CAD > CHF > JPY)
const FX_ORDER=['EUR','GBP','AUD','NZD','USD','CAD','CHF','JPY'];
const fx=(b:string,q:string,model=true):Instrument=>{const jpy=q==='JPY',tick=jpy?0.001:0.00001;return {
 id:b+q,name:`${b}/${q}`,kind:'spot',venue:'OTC FX (spot/CFD)',quote:q,tickSize:tick,tickValue:Math.round(100000*tick*1e6)/1e6,contractSize:100000,lotStep:0.01,minLot:0.01,pip:jpy?0.01:0.0001,unit:'lot',sessions:'fx',
 dataSymbol:b+q+'=X',market:`${b}/${q}`,proxy:false,volume:false,cot:model,fundamentals:model,aliases:[b+q]}};
const FX_PAIRS:Instrument[]=[];
for(let i=0;i<FX_ORDER.length;i++)for(let j=i+1;j<FX_ORDER.length;j++)FX_PAIRS.push(fx(FX_ORDER[i],FX_ORDER[j]));
const usdczk:Instrument={...fx('USD','CZK',false),dataSymbol:'CZK=X',market:'USD/CZK'};
const cfd=(o:Partial<Instrument>&Pick<Instrument,'id'|'name'|'tickSize'|'tickValue'|'contractSize'>):Instrument=>({kind:'CFD',venue:'CFD broker',quote:'USD',lotStep:0.01,minLot:0.01,pip:null,unit:'lot',sessions:'cme',dataSymbol:null,market:null,proxy:true,volume:false,cot:false,fundamentals:false,aliases:[],...o});
const fut=(o:Partial<Instrument>&Pick<Instrument,'id'|'name'|'venue'|'tickSize'|'tickValue'|'contractSize'>):Instrument=>({kind:'futures',quote:'USD',lotStep:1,minLot:1,pip:null,unit:'kontrakt',sessions:'cme',dataSymbol:null,market:null,proxy:false,volume:true,cot:false,fundamentals:false,aliases:[],...o});
const stock=(id:string,name:string):Instrument=>({id,name,kind:'stock',venue:'US burza (akcie / CFD)',quote:'USD',tickSize:0.01,tickValue:0.01,contractSize:1,lotStep:1,minLot:1,pip:null,unit:'ks',sessions:'us_stocks',dataSymbol:id,market:id,proxy:false,volume:true,cot:false,fundamentals:false,aliases:[id.replace('-','.'),id.replace('-','')]});
const crypto=(id:string,name:string,market:string):Instrument=>({id,name,kind:'crypto',venue:'krypto (spot/CFD)',quote:'USD',tickSize:0.01,tickValue:0.01,contractSize:1,lotStep:0.001,minLot:0.001,pip:null,unit:'ks',sessions:'crypto',dataSymbol:market,market,proxy:false,volume:true,cot:false,fundamentals:false,aliases:[id,id.replace('USD','USDT')]});
export const SEED:Instrument[]=[
 ...FX_PAIRS,usdczk,
 // kovy a ropa jako CFD (cena v Tradee z COMEX/NYMEX futures → proxy)
 cfd({id:'XAUUSD',name:'Zlato CFD (XAUUSD)',tickSize:0.01,tickValue:1,contractSize:100,dataSymbol:'GC=F',market:'GC=F',cot:true,aliases:['XAUUSD','GOLD']}),
 cfd({id:'XAGUSD',name:'Stříbro CFD (XAGUSD)',tickSize:0.001,tickValue:5,contractSize:5000,dataSymbol:'SI=F',market:'SI=F',cot:true,aliases:['XAGUSD','SILVER']}),
 cfd({id:'USOIL',name:'Ropa WTI CFD',tickSize:0.01,tickValue:10,contractSize:1000,dataSymbol:'CL=F',market:'CL=F',cot:true,aliases:['USOIL','WTI','XTIUSD','USCRUDE']}),
 cfd({id:'UKOIL',name:'Ropa Brent CFD',tickSize:0.01,tickValue:10,contractSize:1000,dataSymbol:'BZ=F',market:'BZ=F',aliases:['UKOIL','BRENT','XBRUSD']}),
 // indexové CFD: 1 bod = 1 USD na lot (u brokerů se liší – uprav v přepisu účtu); cena v Tradee je hotovostní index
 cfd({id:'US100',name:'Nasdaq 100 CFD (US100)',tickSize:0.01,tickValue:0.01,contractSize:1,dataSymbol:'^NDX',market:'^NDX',sessions:'cme',aliases:['US100','NAS100','USTEC','NDX100','USTECH']}),
 cfd({id:'US500',name:'S&P 500 CFD (US500)',tickSize:0.01,tickValue:0.01,contractSize:1,dataSymbol:'^GSPC',market:'^GSPC',sessions:'cme',aliases:['US500','SPX500','SP500','USA500']}),
 // futures CME / COMEX / NYMEX
 fut({id:'NQ',name:'E-mini Nasdaq-100 (NQ)',venue:'CME',tickSize:0.25,tickValue:5,contractSize:20,dataSymbol:'^NDX',market:'^NDX',proxy:true,volume:false,aliases:['NQ']}),
 fut({id:'MNQ',name:'Micro E-mini Nasdaq-100 (MNQ)',venue:'CME',tickSize:0.25,tickValue:0.5,contractSize:2,dataSymbol:'^NDX',market:'^NDX',proxy:true,volume:false,aliases:['MNQ']}),
 fut({id:'ES',name:'E-mini S&P 500 (ES)',venue:'CME',tickSize:0.25,tickValue:12.5,contractSize:50,dataSymbol:'^GSPC',market:'^GSPC',proxy:true,volume:false,aliases:['ES']}),
 fut({id:'MES',name:'Micro E-mini S&P 500 (MES)',venue:'CME',tickSize:0.25,tickValue:1.25,contractSize:5,dataSymbol:'^GSPC',market:'^GSPC',proxy:true,volume:false,aliases:['MES']}),
 fut({id:'GC',name:'Zlato futures (GC)',venue:'COMEX',tickSize:0.1,tickValue:10,contractSize:100,dataSymbol:'GC=F',market:'GC=F',cot:true,aliases:['GC']}),
 fut({id:'MGC',name:'Micro zlato futures (MGC)',venue:'COMEX',tickSize:0.1,tickValue:1,contractSize:10,dataSymbol:'GC=F',market:'GC=F',cot:true,aliases:['MGC']}),
 fut({id:'CL',name:'Ropa WTI futures (CL)',venue:'NYMEX',tickSize:0.01,tickValue:10,contractSize:1000,dataSymbol:'CL=F',market:'CL=F',cot:true,aliases:['CL']}),
 // akcie a krypto z trhů Tradee
 ...([['AAPL','Apple'],['MSFT','Microsoft'],['NVDA','NVIDIA'],['AMZN','Amazon'],['GOOGL','Alphabet'],['META','Meta'],['TSLA','Tesla'],['BRK-B','Berkshire Hathaway'],['JPM','JPMorgan Chase'],['AVGO','Broadcom']] as const).map(([id,n])=>stock(id,n)),
 crypto('BTCUSD','Bitcoin','BTC-USD'),crypto('ETHUSD','Ethereum','ETH-USD'),crypto('SOLUSD','Solana','SOL-USD'),
];
export const KIND_LABELS:Record<InstrumentKind,string>={spot:'spot',CFD:'CFD',futures:'futures',index:'index',stock:'akcie',crypto:'krypto'};
export const UNIT_LABELS:Record<SizeUnit,[string,string,string]>={lot:['lot','loty','lotů'],kontrakt:['kontrakt','kontrakty','kontraktů'],ks:['kus','kusy','kusů']};
// ---- přepis brokera (per profil účtu): jen čísla, která se liší od výchozích; náklady (komise za lot tam i zpět v měně kotace, spread v ceně)
export type Override={tickSize?:number;tickValue?:number;contractSize?:number;lotStep?:number;minLot?:number;commission?:number;spread?:number;brokerSymbol?:string};
export type Spec=Instrument&{commission:number;spread:number;overridden:(keyof Override)[]};
const OV_NUM=['tickSize','tickValue','contractSize','lotStep','minLot','commission','spread'] as const;
const pos=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
/** Zkontroluje přepis z API. Prázdná pole se vynechají; chyba = text pro UI. */
export function parseOverride(raw:unknown):{ok:true;value:Override}|{ok:false;error:string}{
 const o=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;if(!o)return {ok:false,error:'Neplatný přepis instrumentu.'};
 const v:Override={};
 for(const k of OV_NUM){const x=o[k];if(x===undefined||x===null||x==='')continue;const n=typeof x==='string'?Number(x.replace(',','.')):x;
  if(k==='commission'||k==='spread'){if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e6)return {ok:false,error:k==='commission'?'Komise musí být 0 nebo kladné číslo.':'Spread musí být 0 nebo kladné číslo.'};v[k]=n}
  else{if(!pos(n)||(n as number)>1e9)return {ok:false,error:'Tick, hodnota ticku, kontrakt a loty musí být kladná čísla.'};v[k]=n as number}}
 if(o.brokerSymbol!==undefined&&o.brokerSymbol!==null&&o.brokerSymbol!==''){if(typeof o.brokerSymbol!=='string'||o.brokerSymbol.trim().length>32)return {ok:false,error:'Symbol brokera může mít nejvýš 32 znaků.'};v.brokerSymbol=o.brokerSymbol.trim()}
 if(v.minLot!==undefined&&v.lotStep!==undefined&&v.minLot<v.lotStep-1e-12)return {ok:false,error:'Minimální objem nesmí být menší než krok objemu.'};
 return {ok:true,value:v};
}
/** Instrument + přepis brokera → specifikace pro výpočet. */
export function applyOverride(i:Instrument,ov?:Override|null):Spec{
 const o=ov||{},overridden=(Object.keys(o) as (keyof Override)[]).filter(k=>o[k]!==undefined);
 return {...i,tickSize:o.tickSize??i.tickSize,tickValue:o.tickValue??i.tickValue,contractSize:o.contractSize??i.contractSize,lotStep:o.lotStep??i.lotStep,minLot:o.minLot??i.minLot,commission:o.commission??0,spread:o.spread??0,aliases:o.brokerSymbol?[o.brokerSymbol.toUpperCase(),...i.aliases]:i.aliases,overridden};
}
// ---- mapování symbolů brokera a trhů Tradee
/** EURUSD.m, #XAUUSD, US100.cash, EURUSD-ecn → EURUSD / XAUUSD / US100 */
export const cleanSymbol=(s:string)=>String(s||'').trim().toUpperCase().replace(/^[#.!_]+/,'').split(/[.#_+\-\s]/)[0].replace(/(MICRO|MINI|PRO|ECN|RAW|CASH|SPOT)$/,'');
export function findInstrument(list:Instrument[],symbol:string):Instrument|null{
 const raw=String(symbol||'').trim().toUpperCase();
 const byId=list.find(i=>i.id===raw);if(byId)return byId;
 const c=cleanSymbol(raw);if(!c)return null;
 return list.find(i=>i.id===c)||list.find(i=>i.aliases.includes(c))||null;
}
// trh Tradee → výchozí obchodovaný instrument (CFD před futures, protože ho má většina retailových účtů)
const MARKET_DEFAULT:Record<string,string>={'GC=F':'XAUUSD','SI=F':'XAGUSD','CL=F':'USOIL','BZ=F':'UKOIL','^NDX':'US100','^GSPC':'US500'};
export function instrumentsForMarket(list:Instrument[],market:string):Instrument[]{
 const def=MARKET_DEFAULT[market];
 return list.filter(i=>i.market===market).sort((a,b)=>(a.id===def?-1:0)-(b.id===def?-1:0));
}
export const defaultInstrumentFor=(list:Instrument[],market:string):Instrument|null=>instrumentsForMarket(list,market)[0]??null;
/** Řádek tabulky instruments (DB) → Instrument; vadná čísla → null (řádek se přeskočí). */
export function rowToInstrument(r:Record<string,unknown>):Instrument|null{
 const n=(k:string)=>Number(r[k]),str=(k:string)=>r[k]===null||r[k]===undefined?null:String(r[k]);
 const kind=String(r.kind) as InstrumentKind,unit=String(r.unit) as SizeUnit;
 if(!(kind in KIND_LABELS)||!(unit in UNIT_LABELS)||![n('tick_size'),n('tick_value'),n('contract_size'),n('lot_step'),n('min_lot')].every(x=>Number.isFinite(x)&&x>0))return null;
 return {id:String(r.id),name:String(r.name),kind,venue:String(r.venue||''),quote:String(r.quote_ccy),tickSize:n('tick_size'),tickValue:n('tick_value'),contractSize:n('contract_size'),lotStep:n('lot_step'),minLot:n('min_lot'),pip:r.pip===null||r.pip===undefined?null:n('pip'),unit,sessions:String(r.sessions||''),dataSymbol:str('data_symbol'),market:str('market_id'),proxy:!!Number(r.proxy),volume:!!Number(r.has_volume),cot:!!Number(r.has_cot),fundamentals:!!Number(r.has_fundamentals),aliases:String(r.aliases||'').split(',').map(s=>s.trim()).filter(Boolean)};
}
/** DB řádky přes výchozí seznam: DB vyhrává, chybějící doplní SEED (aplikace funguje i před migrací). */
export function mergeInstruments(rows:Instrument[]):Instrument[]{
 const by=new Map(SEED.map(i=>[i.id,i]));for(const r of rows)by.set(r.id,r);
 return [...by.values()];
}
/** INSERT seedu pro migraci (scripts/check-risk.mjs ho porovná se souborem migrace). */
export function seedSql(list:Instrument[]=SEED):string{
 const q=(v:string|null)=>v===null?'NULL':"'"+v.replace(/'/g,"''")+"'",b=(x:boolean)=>x?1:0;
 return 'INSERT IGNORE INTO instruments(id,name,kind,venue,quote_ccy,tick_size,tick_value,contract_size,lot_step,min_lot,pip,unit,sessions,data_symbol,market_id,proxy,has_volume,has_cot,has_fundamentals,aliases) VALUES\n'+
  list.map(i=>`(${q(i.id)},${q(i.name)},${q(i.kind)},${q(i.venue)},${q(i.quote)},${i.tickSize},${i.tickValue},${i.contractSize},${i.lotStep},${i.minLot},${i.pip===null?'NULL':i.pip},${q(i.unit)},${q(i.sessions)},${q(i.dataSymbol)},${q(i.market)},${b(i.proxy)},${b(i.volume)},${b(i.cot)},${b(i.fundamentals)},${q(i.aliases.join(','))})`).join(',\n')+';';
}
