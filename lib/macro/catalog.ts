// Katalog makro řad, které Tradee používá (stránka /makro). Čistá logika; kontrola: node --experimental-strip-types scripts/check-calendar-hist.mjs
// Zdroje jen z existujících souborů: ForexFactory export (+ historie kalendáře z DB), TE PMI, oficiální maloobchod a ověřené údaje agenta.
// Meziroční (y/y) a meziměsíční (m/m) změny jsou samostatné položky; každá položka má vydavatele, jednotku, SA/NSA a frekvenci.
import type {FFRow} from '../calendar-ff.ts';
import type {CalendarEvent} from '../calendar.ts';
import type {HistEvent,HistChange} from '../calendar-hist.ts';
import type {TEPmi} from './te-pmi.ts';
import type {RetailOfficial} from './retail.ts';

export type Concept='cpi'|'core-cpi'|'unemployment'|'employment'|'gdp'|'retail'|'pmi-mfg'|'pmi-svc'|'rate';
export const conceptLabels:Record<Concept,string>={cpi:'Inflace (CPI)','core-cpi':'Jádrová inflace',unemployment:'Nezaměstnanost',employment:'Zaměstnanost',gdp:'HDP',retail:'Maloobchod','pmi-mfg':'PMI výroba','pmi-svc':'PMI služby',rate:'Úroková sazba'};
// klíč ověřeného údaje agenta (fundamentals.json → observations[měna][klíč])
const OBS:Record<Concept,string>={cpi:'inflation','core-cpi':'inflation',unemployment:'employment',employment:'employment',gdp:'gdp',retail:'retailSales','pmi-mfg':'mpmi','pmi-svc':'spmi',rate:'rates'};
export type SeriesDef={id:string;currency:string;concept:Concept;label:string;change:string;ff:RegExp;publisher:string;via?:string;unit:string;sa:'SA'|'NSA'|'—';freq:string;url:string;note?:string};

type Row=[concept:Concept,label:string,change:string,ff:RegExp,publisher:string,unit:string,sa:SeriesDef['sa'],freq:string,url:string,note?:string,via?:string];
const M='měsíčně',Q='čtvrtletně',PMI_URL='https://www.pmi.spglobal.com/Public/Release/PressReleases',SP='S&P Global',TE='Trading Economics';
const DEFS:Record<string,Row[]>={
 USD:[
  ['cpi','CPI','y/y',/^CPI y\/y$/,'BLS','%','NSA',M,'https://www.bls.gov/cpi/'],
  ['cpi','CPI','m/m',/^CPI m\/m$/,'BLS','%','SA',M,'https://www.bls.gov/cpi/'],
  ['core-cpi','Jádrové CPI','y/y',/^Core CPI y\/y$/,'BLS','%','NSA',M,'https://www.bls.gov/cpi/'],
  ['core-cpi','Jádrové CPI','m/m',/^Core CPI m\/m$/,'BLS','%','SA',M,'https://www.bls.gov/cpi/'],
  ['unemployment','Míra nezaměstnanosti','úroveň',/^Unemployment Rate$/,'BLS','%','SA',M,'https://www.bls.gov/news.release/empsit.nr0.htm'],
  ['employment','Nonfarm payrolls (NFP)','změna',/^Non-Farm Employment Change$/,'BLS','tis. osob','SA',M,'https://www.bls.gov/news.release/empsit.nr0.htm','Předchozí dva měsíce se běžně revidují.'],
  ['gdp','HDP','q/q anualizovaně',/^(Advance |Prelim |Final )?GDP q\/q$/,'BEA','%','SA',Q,'https://www.bea.gov/data/gdp/gross-domestic-product','Tři odhady (advance, second, third) – pozdější je revize.'],
  ['retail','Maloobchodní tržby','m/m',/^Retail Sales m\/m$/,'Census','%','SA',M,'https://www.census.gov/retail/sales.html','Nominální tržby; předběžný odhad se reviduje další měsíc.'],
  ['pmi-mfg','PMI výroba','index',/^(Flash |Final )?Manufacturing PMI$/,SP,'index','SA',M,PMI_URL,'Flash a finální vydání; ISM je samostatná řada.',TE],
  ['pmi-mfg','ISM výroba','index',/^ISM Manufacturing PMI$/,'ISM','index','SA',M,'https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/'],
  ['pmi-svc','PMI služby','index',/^(Flash |Final )?Services PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['pmi-svc','ISM služby','index',/^ISM (Services|Non-Manufacturing) PMI$/,'ISM','index','SA',M,'https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/'],
  ['rate','Fed funds (horní mez)','úroveň',/^Federal Funds Rate$/,'Fed','%','—','8× ročně','https://www.federalreserve.gov/monetarypolicy/openmarket.htm'],
 ],
 EUR:[
  ['cpi','HICP (flash)','y/y',/^CPI Flash Estimate y\/y$/,'Eurostat','%','NSA',M,'https://ec.europa.eu/eurostat/web/hicp'],
  ['cpi','HICP (finální)','y/y',/^Final CPI y\/y$/,'Eurostat','%','NSA',M,'https://ec.europa.eu/eurostat/web/hicp','Finální vydání obvykle potvrzuje flash.'],
  ['core-cpi','Jádrová HICP (flash)','y/y',/^Core CPI Flash Estimate y\/y$/,'Eurostat','%','NSA',M,'https://ec.europa.eu/eurostat/web/hicp'],
  ['core-cpi','Jádrová HICP (finální)','y/y',/^Final Core CPI y\/y$/,'Eurostat','%','NSA',M,'https://ec.europa.eu/eurostat/web/hicp'],
  ['unemployment','Míra nezaměstnanosti','úroveň',/^Unemployment Rate$/,'Eurostat','%','SA',M,'https://ec.europa.eu/eurostat/web/lfs'],
  ['employment','Zaměstnanost','q/q',/^(Prelim |Flash )?Employment Change q\/q$/,'Eurostat','%','SA',Q,'https://ec.europa.eu/eurostat/web/national-accounts'],
  ['gdp','HDP','q/q',/^(Prelim |Flash |Revised |Final )*GDP q\/q$/,'Eurostat','%','SA',Q,'https://ec.europa.eu/eurostat/web/national-accounts','Předběžný flash a pozdější odhady.'],
  ['retail','Maloobchod (objem)','m/m',/^Retail Sales m\/m$/,'Eurostat','%','SA',M,'https://ec.europa.eu/eurostat/databrowser/view/sts_trtu_m/default/table'],
  ['pmi-mfg','PMI výroba (HCOB)','index',/^(Flash |Final )?Manufacturing PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['pmi-svc','PMI služby (HCOB)','index',/^(Flash |Final )?Services PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['rate','Depozitní sazba / MRO','úroveň',/^(Main Refinancing Rate|Deposit Facility Rate)$/,'ECB','%','—','8× ročně','https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html'],
 ],
 GBP:[
  ['cpi','CPI','y/y',/^CPI y\/y$/,'ONS','%','NSA',M,'https://www.ons.gov.uk/economy/inflationandpriceindices'],
  ['cpi','CPI','m/m',/^CPI m\/m$/,'ONS','%','NSA',M,'https://www.ons.gov.uk/economy/inflationandpriceindices'],
  ['core-cpi','Jádrové CPI','y/y',/^Core CPI y\/y$/,'ONS','%','NSA',M,'https://www.ons.gov.uk/economy/inflationandpriceindices'],
  ['unemployment','Míra nezaměstnanosti (ILO)','úroveň, 3 měsíce',/^Unemployment Rate$/,'ONS','%','SA',M,'https://www.ons.gov.uk/employmentandlabourmarket'],
  ['employment','Claimant count','změna',/^Claimant Count Change$/,'ONS','tis. osob','SA',M,'https://www.ons.gov.uk/employmentandlabourmarket'],
  ['gdp','HDP','q/q',/^(Prelim |Revised |Final )?GDP q\/q$/,'ONS','%','SA',Q,'https://www.ons.gov.uk/economy/grossdomesticproductgdp'],
  ['gdp','HDP','m/m',/^GDP m\/m$/,'ONS','%','SA',M,'https://www.ons.gov.uk/economy/grossdomesticproductgdp'],
  ['retail','Maloobchod (objem)','m/m',/^Retail Sales m\/m$/,'ONS','%','SA',M,'https://www.ons.gov.uk/businessindustryandtrade/retailindustry'],
  ['pmi-mfg','PMI výroba','index',/^(Flash |Final )?Manufacturing PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['pmi-svc','PMI služby','index',/^(Flash |Final )?Services PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['rate','Bank Rate','úroveň',/^Official Bank Rate$/,'BoE','%','—','8× ročně','https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate'],
 ],
 CAD:[
  ['cpi','CPI','m/m',/^CPI m\/m$/,'StatCan','%','NSA',M,'https://www150.statcan.gc.ca/n1/en/subjects/prices_and_price_indexes/consumer_price_indexes'],
  ['cpi','CPI','y/y',/^CPI y\/y$/,'StatCan','%','NSA',M,'https://www150.statcan.gc.ca/n1/en/subjects/prices_and_price_indexes/consumer_price_indexes'],
  ['core-cpi','Jádrové CPI (trimmed)','y/y',/^Trimmed CPI y\/y$/,'StatCan / BoC','%','SA',M,'https://www.bankofcanada.ca/rates/price-indexes/cpi/'],
  ['core-cpi','Jádrové CPI (median)','y/y',/^Median CPI y\/y$/,'StatCan / BoC','%','SA',M,'https://www.bankofcanada.ca/rates/price-indexes/cpi/'],
  ['unemployment','Míra nezaměstnanosti','úroveň',/^Unemployment Rate$/,'StatCan (LFS)','%','SA',M,'https://www150.statcan.gc.ca/n1/en/surveys/3701'],
  ['employment','Změna zaměstnanosti','změna',/^Employment Change$/,'StatCan (LFS)','tis. osob','SA',M,'https://www150.statcan.gc.ca/n1/en/surveys/3701'],
  ['gdp','HDP','m/m',/^GDP m\/m$/,'StatCan','%','SA',M,'https://www150.statcan.gc.ca/n1/en/subjects/gdp'],
  ['gdp','HDP','q/q',/^GDP q\/q$/,'StatCan','%','SA',Q,'https://www150.statcan.gc.ca/n1/en/subjects/gdp'],
  ['retail','Maloobchodní tržby','m/m',/^Retail Sales m\/m$/,'StatCan','%','SA',M,'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2010000801'],
  ['pmi-mfg','PMI výroba','index',/^(Flash |Final )?Manufacturing PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['pmi-mfg','Ivey PMI','index',/^Ivey PMI$/,'Ivey Business School','index','SA',M,'https://www.ivey.uwo.ca/','Náhrada za výrobní PMI, když chybí.'],
  ['rate','Overnight rate','úroveň',/^Overnight Rate$/,'BoC','%','—','8× ročně','https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/'],
 ],
 AUD:[
  ['cpi','CPI (měsíční)','y/y',/^CPI y\/y$/,'ABS','%','NSA',M,'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation'],
  ['cpi','CPI','q/q',/^CPI q\/q$/,'ABS','%','NSA',Q,'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation'],
  ['core-cpi','Trimmed mean CPI','q/q',/^Trimmed Mean CPI q\/q$/,'ABS','%','SA',Q,'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation'],
  ['unemployment','Míra nezaměstnanosti','úroveň',/^Unemployment Rate$/,'ABS','%','SA',M,'https://www.abs.gov.au/statistics/labour/employment-and-unemployment/labour-force-australia'],
  ['employment','Změna zaměstnanosti','změna',/^Employment Change$/,'ABS','tis. osob','SA',M,'https://www.abs.gov.au/statistics/labour/employment-and-unemployment/labour-force-australia'],
  ['gdp','HDP','q/q',/^GDP q\/q$/,'ABS','%','SA',Q,'https://www.abs.gov.au/statistics/economy/national-accounts'],
  ['retail','Maloobchod / výdaje domácností','m/m',/^(Retail Sales|Household Spending) m\/m$/,'ABS','%','SA',M,'https://www.abs.gov.au/statistics/economy/finance/monthly-household-spending-indicator','ABS nahrazuje Retail Trade ukazatelem Household Spending.'],
  ['pmi-mfg','PMI výroba','index',/^(Flash |Final )?Manufacturing PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['pmi-svc','PMI služby','index',/^(Flash |Final )?Services PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['rate','Cash rate','úroveň',/^Cash Rate$/,'RBA','%','—','8× ročně','https://www.rba.gov.au/statistics/cash-rate/'],
 ],
 NZD:[
  ['cpi','CPI','q/q',/^CPI q\/q$/,'Stats NZ','%','NSA',Q,'https://www.stats.govt.nz/topics/prices-and-inflation'],
  ['cpi','CPI','y/y',/^CPI y\/y$/,'Stats NZ','%','NSA',Q,'https://www.stats.govt.nz/topics/prices-and-inflation'],
  ['unemployment','Míra nezaměstnanosti','úroveň',/^Unemployment Rate$/,'Stats NZ','%','SA',Q,'https://www.stats.govt.nz/topics/employment'],
  ['employment','Změna zaměstnanosti','q/q',/^Employment Change q\/q$/,'Stats NZ','%','SA',Q,'https://www.stats.govt.nz/topics/employment'],
  ['gdp','HDP','q/q',/^GDP q\/q$/,'Stats NZ','%','SA',Q,'https://www.stats.govt.nz/topics/economic-indicators'],
  ['retail','Maloobchod (objem)','q/q',/^Retail Sales q\/q$/,'Stats NZ','%','SA',Q,'https://www.stats.govt.nz/indicators/retail-trade-survey'],
  ['pmi-mfg','BusinessNZ PMI','index',/^Business ?NZ Manufacturing (PMI|Index)$/,'BusinessNZ','index','SA',M,'https://businessnz.org.nz/'],
  ['pmi-svc','BusinessNZ PSI','index',/^Business ?NZ Services (PMI|Index)$/,'BusinessNZ','index','SA',M,'https://businessnz.org.nz/'],
  ['rate','Official cash rate','úroveň',/^Official Cash Rate$/,'RBNZ','%','—','7× ročně','https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/the-official-cash-rate'],
 ],
 JPY:[
  ['cpi','Národní jádrové CPI','y/y',/^National Core CPI y\/y$/,'e-Stat (Statistics Bureau)','%','NSA',M,'https://www.stat.go.jp/english/data/cpi/','Japonské „core“ = bez čerstvých potravin.'],
  ['core-cpi','Tokio jádrové CPI','y/y',/^Tokyo Core CPI y\/y$/,'e-Stat (Statistics Bureau)','%','NSA',M,'https://www.stat.go.jp/english/data/cpi/','Předstihový údaj pro celé Japonsko.'],
  ['unemployment','Míra nezaměstnanosti','úroveň',/^Unemployment Rate$/,'e-Stat (Statistics Bureau)','%','SA',M,'https://www.stat.go.jp/english/data/roudou/'],
  ['gdp','HDP','q/q',/^(Prelim |Final )?GDP q\/q$/,'Cabinet Office','%','SA',Q,'https://www.esri.cao.go.jp/en/sna/menu.html'],
  ['retail','Maloobchodní tržby','y/y',/^Retail Sales y\/y$/,'METI','%','NSA',M,'https://www.meti.go.jp/english/statistics/tyo/syoudou/'],
  ['pmi-mfg','PMI výroba','index',/^(Flash |Final )?Manufacturing PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['pmi-svc','PMI služby','index',/^(Flash |Final )?Services PMI$/,SP,'index','SA',M,PMI_URL,undefined,TE],
  ['rate','Sazba BoJ','úroveň',/^BOJ Policy Rate$/,'BoJ','%','—','8× ročně','https://www.boj.or.jp/en/mopo/index.htm'],
 ],
 CHF:[
  ['cpi','CPI','m/m',/^CPI m\/m$/,'FSO (BFS)','%','NSA',M,'https://www.bfs.admin.ch/bfs/en/home/statistics/prices/consumer-price-index.html'],
  ['cpi','CPI','y/y',/^CPI y\/y$/,'FSO (BFS)','%','NSA',M,'https://www.bfs.admin.ch/bfs/en/home/statistics/prices/consumer-price-index.html'],
  ['unemployment','Míra nezaměstnanosti (SECO)','úroveň',/^Unemployment Rate$/,'SECO','%','SA',M,'https://www.seco.admin.ch/','Registrovaná nezaměstnanost, ne ILO.'],
  ['gdp','HDP','q/q',/^GDP q\/q$/,'SECO','%','SA',Q,'https://www.seco.admin.ch/seco/en/home/wirtschaftslage---wirtschaftspolitik/Wirtschaftslage/bip-quartalsschaetzungen-.html'],
  ['retail','Maloobchod (reálně)','y/y',/^Retail Sales y\/y$/,'FSO (BFS)','%','NSA',M,'https://www.bfs.admin.ch/bfs/en/home/statistics/industry-services/services/retail-trade.html'],
  ['pmi-mfg','procure.ch PMI','index',/^Manufacturing PMI$/,'procure.ch','index','SA',M,'https://www.procure.ch/'],
  ['pmi-svc','procure.ch PMI služby','index',/^Services PMI$/,'procure.ch','index','SA',M,'https://www.procure.ch/'],
  ['rate','Sazba SNB','úroveň',/^SNB Policy Rate$/,'SNB','%','—','4× ročně','https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy'],
 ],
};
export const CATALOG_CURRENCIES=Object.keys(DEFS);
const slug=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const SERIES:SeriesDef[]=Object.entries(DEFS).flatMap(([currency,rows])=>rows.map(([concept,label,change,ff,publisher,unit,sa,freq,url,note,via])=>({id:currency+'-'+slug(label+'-'+change),currency,concept,label,change,ff,publisher,via,unit,sa,freq,url,note})));

export type CatalogValue={value:string;period:string|null;releasedAt:number|null;basis:'derived'|'previous'|'official'|'observation';source:string;url:string|null};
export type CatalogItem=SeriesDef&{last:CatalogValue|null;next:{at:number;title:string;forecast:string|null}|null;revision:string|null;ffTitles:string[]};
type Obs={value:string|null;period?:string|null;sourceUrl?:string|null;checkedAt?:string|null};
export type CatalogInput={ffRows:FFRow[];hist?:HistEvent[];changes?:HistChange[];calendar?:CalendarEvent[];observations?:Record<string,Record<string,Obs>>;tePmi?:TEPmi;retail?:RetailOfficial};

type R={id:string|null;currency:string;title:string;at:number;forecast:string|null;previous:string|null;actual:string|null;actualFirst:string|null};
const PMI_KEY:Partial<Record<Concept,'mpmi'|'spmi'>>={'pmi-mfg':'mpmi','pmi-svc':'spmi'};
const cz=(n:number)=>n.toLocaleString('cs-CZ',{maximumFractionDigits:2});

/** Sestaví položky katalogu: poslední hodnota (odvozená, uvedená jako „předchozí“, oficiální nebo ověřená agentem), příští vydání a revize. */
export function buildCatalog(inp:CatalogInput,now:number,defs:SeriesDef[]=SERIES):CatalogItem[]{
 // řádky z DB mají přednost před souborem (mají odvozenou skutečnost)
 const rows=new Map<string,R>();
 for(const r of inp.ffRows){const at=Date.parse(r.at);if(Number.isFinite(at)&&r.impact!=='Holiday')rows.set(r.currency+'|'+r.title+'|'+at,{id:null,currency:r.currency,title:r.title,at,forecast:r.forecast,previous:r.previous,actual:null,actualFirst:null})}
 for(const e of inp.hist??[])rows.set(e.currency+'|'+e.title+'|'+e.at,{id:e.id,currency:e.currency,title:e.title,at:e.at,forecast:e.forecast,previous:e.previous,actual:e.actual,actualFirst:e.actualFirst});
 const all=[...rows.values()].sort((a,b)=>a.at-b.at);
 return defs.map(d=>{
  const mine=all.filter(r=>r.currency===d.currency&&d.ff.test(r.title)),past=mine.filter(r=>r.at<=now),future=mine.filter(r=>r.at>now);
  let last:CatalogValue|null=null,revision:string|null=null;
  // poslední vydání se známou skutečností: z DB, nebo previous následujícího řádku téhož titulu
  for(let i=past.length-1;i>=0&&!last;i--){const r=past[i],next=mine.find(x=>x.title===r.title&&x.at>r.at),v=r.actual??next?.previous??null;
   if(v){last={value:v,period:null,releasedAt:r.at,basis:'derived',source:'ForexFactory (skutečnost odvozená z dalšího vydání)',url:'https://www.forexfactory.com/calendar'};
    if(r.actualFirst&&r.actual&&r.actualFirst!==r.actual)revision=`Revidováno z ${r.actualFirst} na ${r.actual}.`;
    const ch=r.id?(inp.changes??[]).filter(c=>c.eventId===r.id&&c.kind==='revision'):[];if(!revision&&ch.length)revision=`Revidováno z ${ch[0].old} na ${ch.at(-1)!.new}.`}}
  if(!last){const r=past.at(-1);if(r?.previous){const prior=mine.filter(x=>x.title===r.title&&x.at<r.at).at(-1);last={value:r.previous,period:null,releasedAt:prior?.at??null,basis:'previous',source:'ForexFactory (hodnota předchozího období u vydání '+new Date(r.at).toISOString().slice(0,10)+')',url:'https://www.forexfactory.com/calendar'}}}
  // oficiální hodnoty ze souborů mají přednost, pokud jsou novější
  const pk=PMI_KEY[d.concept],te=pk&&d.via===TE?inp.tePmi?.currencies?.[d.currency]?.[pk]:undefined;
  if(te)last={value:cz(te.value),period:te.period,releasedAt:null,basis:'official',source:`${te.publisher} přes ${TE} (${te.series})`,url:te.url};
  const rt=d.concept==='retail'?inp.retail?.currencies?.[d.currency]:undefined;
  if(rt&&rt.kind===(d.change==='m/m'?'m/m':d.change==='q/q'?'q/q':'x'))last={value:(rt.value>0?'+':'')+cz(rt.value)+' %',period:rt.period,releasedAt:rt.releasedAt?Date.parse(rt.releasedAt):null,basis:'official',source:`${rt.source} (${rt.series})`,url:rt.url};
  if(!last){const o=inp.observations?.[d.currency]?.[OBS[d.concept]];if(o?.value)last={value:o.value,period:o.period??null,releasedAt:null,basis:'observation',source:'Ověřený údaj (zdroj v odkazu)',url:o.sourceUrl??null}}
  const nf=future[0];let next=nf?{at:nf.at,title:nf.title,forecast:nf.forecast}:null;
  if(!next&&inp.calendar){const e=inp.calendar.find(e=>Date.parse(e.at)>now&&e.ff?.currency===d.currency&&d.ff.test(e.ff.title));if(e)next={at:Date.parse(e.at),title:e.title,forecast:e.forecast??null}}
  return {...d,last,next,revision,ffTitles:[...new Set(mine.map(r=>r.title))]};
 });
}
