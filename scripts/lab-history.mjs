// Laboratoř · sdílené načtení historie pro scripts/lab-known.mjs (a scripts/lab-evolve.mjs při zakládání populace):
// D1 svíčky + COT (stejně jako scripts/lab-sweep.mjs) a 3M sazby z FRED (carry).
//   source 'db'   = svíčky z market_bars (lib/bars/query.ts loadBars), COT z lab_cot
//   source 'yahoo'= svíčky přímo z Yahoo (denní od 2003, FX open = předchozí close jako loadBars), COT přímo z CFTC (Socrata)
//   cache = adresář pro stažená data (bars.json, cot.json, rates.json) – opakované běhy bez sítě (sdílí formát s lab-sweep --cache)
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';

export function loadEnv(...files){
 const load=f=>{try{return Object.fromEntries(readFileSync(new URL('../'+f,import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2')]))}catch{return {}}};
 return Object.assign({},...files.map(load));
}
export async function openDb(env){
 const {createDb}=await import('../lib/mysql.ts');
 return createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
}
export async function ownerId(d,env,optEmail){
 const ownerEmail=(optEmail||process.env.OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase();
 const owner=ownerEmail?await d.prepare('SELECT id,email FROM members WHERE LOWER(email)=?').bind(ownerEmail).first():null;
 return owner&&String(owner.email).trim().toLowerCase()===ownerEmail?{id:owner.id,email:ownerEmail}:null;
}
const cacheIO=cache=>{
 const file=n=>cache?cache.replace(/\/$/,'')+'/'+n:null;
 return {get:n=>{const f=file(n);return f&&existsSync(f)?JSON.parse(readFileSync(f,'utf8')):null},put:(n,v)=>{const f=file(n);if(f){mkdirSync(cache,{recursive:true});writeFileSync(f,JSON.stringify(v))}}};
};
// sazby z FRED (bez klíče); vrací {rows:{CCY:[{date,value}]}, missing:[...]}
export async function loadRates({cache,fetchFn=fetch}={}){
 const io=cacheIO(cache),hit=io.get('rates.json');if(hit)return hit;
 const {FRED_RATES,parseFredCsv}=await import('../lib/lab/known.ts');
 const rows={},missing=[];
 for(const [ccy,id] of Object.entries(FRED_RATES)){
  try{const r=await fetchFn('https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'Mozilla/5.0'}});if(!r.ok)throw Error('HTTP '+r.status);
   const x=parseFredCsv(await r.text());if(x.length)rows[ccy]=x;else missing.push(ccy)}catch(e){missing.push(ccy);console.warn('sazby',ccy,e.message)}
 }
 const out={rows,missing,at:new Date().toISOString()};
 if(!missing.length)io.put('rates.json',out);
 return out;
}
export async function loadHistory({source,markets,d=null,cache=null,now=Date.now(),log=console.log}){
 let bars={},cot={};
 if(source==='db'){
  const {loadBars}=await import('../lib/bars/query.ts');
  for(const id of markets)bars[id]=(await loadBars(d,id,'D1',0,now+86400000)).map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c}));
  try{const {loadCot}=await import('../lib/lab/store.ts');cot=await loadCot(d)}catch(e){console.warn('lab_cot nejde načíst –',e.code||e.message)}
  return {bars,cot};
 }
 const io=cacheIO(cache);
 bars=io.get('bars.json')||{};
 const missing=markets.filter(m=>!bars[m]?.length);
 if(missing.length){
  const {yahooSymbol}=await import('../lib/live.ts');
  const {fxCurrencies}=await import('../lib/markets.ts');
  const {parseBars,planUrl}=await import('../lib/bars/yahoo.ts');
  const {fixFxOpen}=await import('../lib/bars/query.ts');
  for(const id of missing){
   const sym=yahooSymbol(id,fxCurrencies);
   for(let a=0;;a++){try{const r=await fetch(planUrl(sym,{tf:'D1',interval:'1d',period1:Math.floor(Date.UTC(2003,0,1)/1000),period2:Math.floor(now/1000)}),{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);
     const b=parseBars(await r.json()).bars;bars[id]=(id.includes('/')?fixFxOpen(b):b).map(x=>({t:x.t,o:x.o,h:x.h,l:x.l,c:x.c}));break}catch(e){if(a>=3){console.warn('svíčky',id,e.message);bars[id]=[];break}await new Promise(r=>setTimeout(r,1500*2**a))}}
  }
  io.put('bars.json',bars);
 }
 cot=io.get('cot.json');
 if(!cot){
  // stejné kontrakty a sloupce jako scripts/lab-cot-history.mjs (TFF leveraged pro měny, Disaggregated managed money pro komodity)
  const TFF={CAD:'090741',JPY:'097741',EUR:'099741',AUD:'232741',USD:'098662',NZD:'112741',GBP:'096742',CHF:'092741'},DIS={'GC=F':'088691','SI=F':'084691','CL=F':'067651'};
  const socrata=async(ds,codes)=>{const out=[];for(let off=0;;off+=50000){const q=new URLSearchParams({'$where':`cftc_contract_market_code in (${codes.map(c=>`'${c}'`).join(',')}) AND report_date_as_yyyy_mm_dd >= '2006-01-01T00:00:00'`,'$order':'report_date_as_yyyy_mm_dd ASC','$limit':'50000','$offset':String(off)});
   const r=await fetch(`https://publicreporting.cftc.gov/resource/${ds}.json?${q}`,{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('CFTC HTTP '+r.status);const rows=await r.json();out.push(...rows);if(rows.length<50000)return out}};
  cot={};
  try{
   const add=(raw,map,grp,[l,s,sp])=>{for(const [m,code] of Object.entries(map)){const rows=raw.filter(r=>r.cftc_contract_market_code===code).map(r=>{const L=Number(r[l]),S=Number(r[s]),oi=Number(r.open_interest_all);return {date:String(r.report_date_as_yyyy_mm_dd).slice(0,10),openInterest:oi,groups:{[grp]:{long:L,short:S,spread:Number(r[sp]||0),net:L-S}}}}).filter(r=>r.openInterest>0&&Number.isFinite(r.groups[grp].net));
    if(rows.length)cot[m]={rows,group:grp,proxy:m==='USD'}}};
   add(await socrata('gpe5-46if',Object.values(TFF)),TFF,'leveraged',['lev_money_positions_long','lev_money_positions_short','lev_money_positions_spread']);
   add(await socrata('72hh-3qpy',Object.values(DIS)),DIS,'managedMoney',['m_money_positions_long_all','m_money_positions_short_all','m_money_positions_spread']);
   io.put('cot.json',cot);
  }catch(e){log('COT z CFTC nejde stáhnout –',e.message);cot={}}
 }
 return {bars,cot};
}
