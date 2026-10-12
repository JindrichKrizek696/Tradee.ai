// Maloobchod pro 8 měn z oficiálních bezplatných zdrojů → data/retail-official.json. Volá scripts/refresh-vps.sh.
// node --experimental-strip-types scripts/refresh-retail.mjs [--force] [--dry]
// METI (JPY) je za AWS WAF, který skripty občas zablokuje (HTTP 202 výzva) – pak zůstane předchozí hodnota; ručně: METI_XLSX=cesta/DB_YYYYMMS.xlsx.
// Bez --force se přeskočí, je-li poslední pokus mladší 12 h. Při chybě zdroje zůstává předchozí hodnota měny.
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {changeFromLevels,lastChange,parseFredCsv,parseEurostat,parseOns,parseStatcan,parseSdmxCsv,parseMeti} from '../lib/macro/retail.ts';
import {readXlsxSheet} from './lib-xlsx.mjs';
import {execFileSync} from 'node:child_process';
const force=process.argv.includes('--force'),dry=process.argv.includes('--dry');
const file=new URL('../data/retail-official.json',import.meta.url);
const old=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{currencies:{}};
const now=Date.now(),iso=new Date(now).toISOString().replace(/\.\d+Z$/,'Z');
const last=old.attemptedAt??old.updated;
if(!force&&!dry&&last&&now-Date.parse(last)<12*3600000){console.log('Maloobchod: pokus před '+Math.round((now-Date.parse(last))/60000)+' min, přeskočeno');process.exit(0)}
const BROWSER='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36';

async function get(url,opts={},retry=1){
 try{return await get1(url,opts)}
 catch(e){if(retry&&/HTTP 5\d\d|timeout/.test(e.message)){await new Promise(r=>setTimeout(r,5000));return get(url,opts,retry-1)}throw e}
}
async function get1(url,{as='text',ua,init}={}){
 const ac=new AbortController(),t=setTimeout(()=>ac.abort(),30000);
 try{
  const r=await fetch(url,{...init,headers:{...(ua?{'User-Agent':ua}:{}),...init?.headers},signal:ac.signal});
  if(!r.ok)throw Error('HTTP '+r.status);
  return as==='json'?await r.json():as==='buf'?Buffer.from(await r.arrayBuffer()):await r.text();
 }catch(e){throw e.name==='AbortError'?Error('timeout'):e}
 finally{clearTimeout(t)}
}
// METI za ochranou proti botům odmítá fetch z Node (TLS otisk), curl projde.
const curl=(url,as='text')=>{const b=execFileSync('curl',['-sS','-f','-L','-m','30','-A',BROWSER,url],{maxBuffer:64<<20});return as==='buf'?b:b.toString('utf8')};
const need=(x,what)=>{if(!x)throw Error('nelze spočítat: '+what);return x};

const OECD='https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_INDSERV,4.3/CHE+NZL.M+Q.TOVM.IX.G47.Y...?startPeriod='+(new Date(now).getUTCFullYear()-2)+'-01&format=csvfile';
let oecd=null;const oecdCsv=async()=>oecd??=await get(OECD);
const SRC={
 USD:async()=>{const pts=parseFredCsv(await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=RSAFS'));
  return {...need(changeFromLevels(pts),'RSAFS'),kind:'m/m',source:'FRED/Census',series:'Advance Retail Sales: Retail Trade and Food Services (RSAFS), nominální, SA',url:'https://fred.stlouisfed.org/series/RSAFS'}},
 EUR:async()=>{const j=await get('https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sts_trtu_m?geo=EA20&indic_bt=VOL_SLS&nace_r2=G47&s_adj=SCA&unit=PCH_PRE&lastTimePeriod=4&format=JSON',{as:'json'});
  return {...need(lastChange(parseEurostat(j)),'sts_trtu_m'),kind:'m/m',releasedAt:j.updated,source:'Eurostat',series:'Objem maloobchodních tržeb eurozóny (EA20, G47), SCA',url:'https://ec.europa.eu/eurostat/databrowser/view/sts_trtu_m/default/table'}},
 GBP:async()=>{const o=parseOns(await get('https://www.ons.gov.uk/businessindustryandtrade/retailindustry/timeseries/j5ek/drsi/data',{as:'json',ua:BROWSER}));
  return {...need(changeFromLevels(o.points),'J5EK'),kind:'m/m',releasedAt:o.releasedAt,source:'ONS',series:'Objem maloobchodních tržeb vč. pohonných hmot (J5EK), SA',url:'https://www.ons.gov.uk/businessindustryandtrade/retailindustry/timeseries/j5ek/drsi'}},
 CAD:async()=>{const o=parseStatcan(await get('https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods',{as:'json',init:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{productId:20100056,coordinate:'1.1.1.2.0.0.0.0.0.0',latestN:4}])}}));
  return {...need(changeFromLevels(o.points),'StatCan 20-10-0056'),kind:'m/m',releasedAt:o.releasedAt,source:'Statistics Canada',series:'Maloobchodní tržby celkem (tab. 20-10-0056-01), nominální, SA',url:'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2010005601'}},
 JPY:async()=>{if(process.env.METI_XLSX){const name=process.env.METI_XLSX.split('/').at(-1);const url='https://www.meti.go.jp/statistics/tyo/syoudou/result/excel/'+name; // ruční doplnění z ručně staženého souboru (WAF METI občas blokuje skripty)
   return {...need(lastChange(parseMeti(readXlsxSheet(readFileSync(process.env.METI_XLSX),'DB_MainA'))),'METI DB_MainA'),kind:'m/m',source:'METI',series:'Maloobchodní tržby (Current Survey of Commerce), nominální, SA'+(/S\.xlsx$/.test(name)?' · předběžné':''),url}}
  const idx=curl('https://www.meti.go.jp/english/statistics/tyo/syoudou/index.html');
  const f=/statistics\/tyo\/syoudou\/result\/excel\/(DB_\d{6}[A-Z]?\.xlsx)/.exec(idx);if(!f)throw Error('odkaz na xlsx nenalezen');
  const url='https://www.meti.go.jp/statistics/tyo/syoudou/result/excel/'+f[1];
  const rows=readXlsxSheet(curl(url,'buf'),'DB_MainA');
  return {...need(lastChange(parseMeti(rows)),'METI DB_MainA'),kind:'m/m',source:'METI',series:'Maloobchodní tržby (Current Survey of Commerce), nominální, SA'+(/S\.xlsx$/.test(f[1])?' · předběžné':''),url}},
 CHF:async()=>({...need(changeFromLevels(parseSdmxCsv(await oecdCsv(),{REF_AREA:'CHE',FREQ:'M'})),'OECD CHE'),kind:'m/m',source:'OECD (BFS)',series:'Objem maloobchodních tržeb Švýcarska (G47), SA',url:'https://data-explorer.oecd.org/vis?df[ds]=dsDisseminateFinalDMZ&df[id]=DSD_STES%40DF_INDSERV&df[ag]=OECD.SDD.STES'}),
 AUD:async()=>{const t=await get('https://data.api.abs.gov.au/rest/data/ABS,HSI_M,1.6.0/8.TOT.CUR.20.AUS.M?startPeriod='+(new Date(now).getUTCFullYear()-1)+'-01&format=csvfile');
  return {...need(lastChange(parseSdmxCsv(t,{MEASURE:'8',CATEGORY:'TOT',TSEST:'20',STATE:'AUS'})),'ABS HSI_M'),kind:'m/m',source:'ABS',series:'Monthly Household Spending Indicator, celkem, běžné ceny, SA',url:'https://www.abs.gov.au/statistics/economy/finance/monthly-household-spending-indicator/latest-release'}},
 NZD:async()=>({...need(changeFromLevels(parseSdmxCsv(await oecdCsv(),{REF_AREA:'NZL',FREQ:'Q'})),'OECD NZL'),kind:'q/q',source:'OECD (Stats NZ)',series:'Objem maloobchodních tržeb Nového Zélandu (G47), SA, čtvrtletně',url:'https://data-explorer.oecd.org/vis?df[ds]=dsDisseminateFinalDMZ&df[id]=DSD_STES%40DF_INDSERV&df[ag]=OECD.SDD.STES'}),
};

const currencies=structuredClone(old.currencies??{}),errors=[];let ok=0;
for(const [c,fn] of Object.entries(SRC)){
 try{const x=await fn();currencies[c]={value:x.value,previous:x.previous,unit:'%',kind:x.kind,period:x.period,...(x.releasedAt?{releasedAt:x.releasedAt}:{}),fetchedAt:iso,source:x.source,series:x.series,url:x.url};ok++}
 catch(e){errors.push(c+': '+e.message)}
}
if(errors.length)console.log('!! '+errors.join('; '));
for(const c of ['USD','EUR','GBP','JPY','CHF','AUD','NZD','CAD']){const v=currencies[c];console.log('  '+c+': '+(v?`${v.value} % ${v.kind} (${v.period}, předtím ${v.previous??'?'}) · ${v.source}`:'—'))}
if(dry){console.log(`dry: ${ok}/${Object.keys(SRC).length} zdrojů`);process.exit(0)}
const tmp=new URL('../data/retail-official.json.tmp',import.meta.url);
writeFileSync(tmp,JSON.stringify({updated:ok?iso:old.updated??null,attemptedAt:iso,currencies},null,1)+'\n');
renameSync(tmp,file);
console.log(`Maloobchod: uloženo ${ok}/${Object.keys(SRC).length} zdrojů`);
if(!ok)process.exit(1);
