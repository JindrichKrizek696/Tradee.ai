// Prognózy FX: Trading Economics (7 stránek měn + přehled prognóz, 8 požadavků, ~2 s pauza) a ING Think (1 stránka) → data/forecasts.json.
// node --experimental-strip-types scripts/refresh-forecasts.mjs [--force] [--dry] [--no-db]
// Nízký objem (schváleno vlastníkem): TE i ING nejvýš 1× za 20 h (bez --force přeskočí). Při chybě zdroje zůstává předchozí hodnota.
// ING: tabulka je i v HTML stránky think.ing.com/forecasts (stejná jako v měsíčním PDF), PDF se proto nerozebírá; rok vydání se bere z odkazu na PDF.
// Je-li k dispozici .mariadb.env (VPS), každá stažená předpověď se uloží i do forecast_snapshots (migrace 0029) pro vyhodnocení přesnosti.
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {TE_PAGES,TE_BASE,TE_OVERVIEW,ING_URL,htmlText,parseTePage,orientTe,parseTeOverview,parseIngFx,buildTe,buildIng,periodEnd} from '../lib/forecasts/core.ts';
const force=process.argv.includes('--force'),dry=process.argv.includes('--dry'),noDb=process.argv.includes('--no-db');
const file=new URL('../data/forecasts.json',import.meta.url);
const old=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{updated:null,pairs:{}};
const now=Date.now(),iso=new Date(now).toISOString().replace(/\.\d+Z$/,'Z'),today=iso.slice(0,10);
const due=k=>force||dry||!old[k]||now-Date.parse(old[k])>=20*3600000;
const doTe=due('attemptedAt'),doIng=due('ingAttemptedAt');
if(!doTe&&!doIng){console.log('Prognózy: poslední pokus před méně než 20 h, přeskočeno');process.exit(0)}
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){const ac=new AbortController(),t=setTimeout(()=>ac.abort(),20000);try{const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html','Accept-Language':'en-US,en;q=0.9'},signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.text()}finally{clearTimeout(t)}}
const pairs=structuredClone(old.pairs??{}),errors=[],snaps=[];
let teOk=0,ingOk=0;
if(doTe){
 const majors={};
 for(const [i,p] of TE_PAGES.entries()){
  if(i)await sleep(2000);
  const url=TE_BASE+p.path;
  try{
   const x=parseTePage(htmlText(await get(url)));if(!x)throw Error('text stránky nejde rozebrat');
   const o=orientTe(x,p.pair);if(!o)throw Error('kotace '+x.quote+' neodpovídá '+p.pair);
   if(Math.abs(o.q/o.current-1)>0.15||Math.abs(o.y12/o.current-1)>0.3)throw Error('nepravděpodobná prognóza '+JSON.stringify(o));
   majors[p.pair]={current:o.current,q:o.q,y12:o.y12,asOf:x.asOf,url};
  }catch(e){errors.push('TE '+p.pair+': '+(e.name==='AbortError'?'timeout':e.message))}
 }
 let overview=null;
 try{await sleep(2000);overview=parseTeOverview(await get(TE_BASE+TE_OVERVIEW));if(!overview)throw Error('přehled nejde rozebrat')}catch(e){errors.push('TE přehled: '+e.message)}
 if(Object.keys(majors).length){
  const te=buildTe(majors,overview,today,TE_BASE+TE_OVERVIEW);
  for(const [pair,v] of Object.entries(te)){(pairs[pair]??={}).te=v;teOk++}
  for(const [pair,v] of Object.entries(te)){
   const mk=(h,pt)=>pt&&snaps.push({source:'te',pair,horizon:h,madeAt:today,horizonEnd:periodEnd(pt.period),value:pt.value,spot:v.current??null,derived:v.derived?1:0});
   (v.quarters??(v.q?[v.q]:[])).forEach((pt,i)=>mk('q'+(i+1),pt));
   if(v.y12)snaps.push({source:'te',pair,horizon:'y12',madeAt:today,horizonEnd:new Date(Date.UTC(+today.slice(0,4)+1,+today.slice(5,7)-1,+today.slice(8,10))).toISOString().slice(0,10),value:v.y12.value,spot:v.current??null,derived:0});
  }
 }
}
if(doIng){
 try{
  const html=await get(ING_URL),y=html.match(/pdf-forecasts\/[A-Za-z]+_(\d{4})_INGF\.pdf/);
  const t=parseIngFx(htmlText(html.replace(/<(td|th|tr|p|div|br)\b/gi,' <$1')),y?Number(y[1]):new Date(now).getUTCFullYear());
  if(!t)throw Error('tabulka FX nejde rozebrat');
  const ing=buildIng(t,ING_URL,today);
  for(const [pair,v] of Object.entries(ing)){
   (pairs[pair]??={}).ing=v;ingOk++;
   for(const n of [1,2,3,4]){const pt=v['q'+n];if(pt)snaps.push({source:'ing',pair,horizon:'q'+n,madeAt:v.asOf,horizonEnd:periodEnd(pt.period),value:pt.value,spot:pairs[pair].te?.current??null,derived:v.derived?1:0})}
  }
 }catch(e){errors.push('ING: '+(e.name==='AbortError'?'timeout':e.message))}
}
if(errors.length)console.log('!! '+errors.join('; '));
for(const p of ['EUR/USD','USD/JPY','AUD/NZD']){const v=pairs[p];console.log('  '+p+': TE q='+(v?.te?.q?.value??'—')+' y12='+(v?.te?.y12?.value??'—')+' · ING q1='+(v?.ing?.q1?.value??'—'))}
console.log(`TE ${teOk}/28 párů · ING ${ingOk}/28 párů · snímků ${snaps.length}`);
if(dry)process.exit(0);
// Čas pokusu se ukládá i při neúspěchu (throttle), hodnoty zůstávají předchozí.
const out={updated:(teOk||ingOk)?iso:old.updated??null,attemptedAt:doTe?iso:old.attemptedAt,ingAttemptedAt:doIng?iso:old.ingAttemptedAt,source:{te:TE_BASE+TE_OVERVIEW,ing:ING_URL},pairs};
const tmp=new URL('../data/forecasts.json.tmp',import.meta.url);
writeFileSync(tmp,JSON.stringify(out,null,1)+'\n');renameSync(tmp,file);
if(!noDb&&snaps.length&&existsSync(new URL('../.mariadb.env',import.meta.url))){
 try{
  const {createDb}=await import('../lib/mysql.ts');
  const env=Object.fromEntries(readFileSync(new URL('../.mariadb.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
  const d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
  let n=0;
  for(let i=0;i<snaps.length;i+=100){const ch=snaps.slice(i,i+100);
   const r=await d.prepare('INSERT IGNORE INTO forecast_snapshots(source,pair,horizon,made_at,horizon_end,value,spot_at_made,derived) VALUES '+ch.map(()=>'(?,?,?,?,?,?,?,?)').join(',')).bind(...ch.flatMap(s=>[s.source,s.pair,s.horizon,s.madeAt,s.horizonEnd,s.value,s.spot,s.derived])).run();n+=r.meta.changes}
  console.log(`DB: ${n} nových snímků`);
 }catch(e){console.log('!! DB snímky: '+e.message+' (po migraci 0029 se uloží při dalším běhu)')}
}
if(!teOk&&!ingOk)process.exit(1);
