// PMI (výroba, služby) pro 8 měn (USD = S&P Global; ISM navíc jen pro informaci) ze stránek Trading Economics → data/te-pmi.json. Volá scripts/refresh-vps.sh.
// node --experimental-strip-types scripts/refresh-te-pmi.mjs [--force] [--dry]
// Nízký objem (schváleno vlastníkem): 18 stránek sekvenčně s ~2 s pauzou, max. 2× denně (bez --force přeskočí, je-li soubor mladší 11 h).
// Při chybě stránky zůstává předchozí hodnota.
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {TE_PAGES,TE_BASE,teMetaDescription,parseTEDescription} from '../lib/macro/te-pmi.ts';
const force=process.argv.includes('--force'),dry=process.argv.includes('--dry');
const file=new URL('../data/te-pmi.json',import.meta.url);
const old=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{currencies:{}};
const now=Date.now();
const last=old.attemptedAt??old.updated;
if(!force&&!dry&&last&&now-Date.parse(last)<11*3600000){console.log('TE PMI: pokus před '+Math.round((now-Date.parse(last))/60000)+' min, přeskočeno');process.exit(0)}
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const currencies=structuredClone(old.currencies??{}),errors=[];let ok=0;
for(const [i,p] of TE_PAGES.entries()){
 if(i)await sleep(2000);
 const url=TE_BASE+p.path,ac=new AbortController(),t=setTimeout(()=>ac.abort(),15000);
 try{
  const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html','Accept-Language':'en-US,en;q=0.9'},signal:ac.signal});
  if(!r.ok)throw Error('HTTP '+r.status);
  const desc=teMetaDescription(await r.text());
  if(!desc||!p.expect.test(desc))throw Error('nečekaný popis: '+(desc??'chybí').slice(0,90));
  const x=parseTEDescription(desc,now);if(!x)throw Error('popis nejde rozebrat: '+desc.slice(0,90));
  (currencies[p.currency]??={})[p.id]={value:x.value,previous:x.previous,period:x.period,fetchedAt:new Date(now).toISOString().replace(/\.\d+Z$/,'Z'),url,publisher:p.publisher,series:x.series};
  ok++;
 }catch(e){errors.push(`${p.currency} ${p.id}: `+(e.name==='AbortError'?'timeout':e.message))}
 finally{clearTimeout(t)}
}
if(errors.length)console.log('!! '+errors.join('; '));
for(const c of ['USD','EUR','GBP','JPY','CHF','AUD','NZD','CAD'])console.log('  '+c+': '+['mpmi','spmi',...(c==='USD'?['ismMpmi','ismSpmi']:[])].map(k=>{const v=currencies[c]?.[k];return k+'='+(v?`${v.value} (${v.period}, předtím ${v.previous??'?'})`:'—')}).join(' · '));
if(dry){console.log(`dry: ${ok}/${TE_PAGES.length} stránek`);process.exit(0)}
// Čas pokusu se uloží i při neúspěchu (throttle), hodnoty zůstávají předchozí.
const iso=new Date(now).toISOString().replace(/\.\d+Z$/,'Z');
const tmp=new URL('../data/te-pmi.json.tmp',import.meta.url);
writeFileSync(tmp,JSON.stringify({updated:ok?iso:old.updated??null,attemptedAt:iso,source:'https://tradingeconomics.com',currencies},null,1)+'\n');
renameSync(tmp,file);
console.log(`TE PMI: uloženo ${ok}/${TE_PAGES.length} stránek`);
if(!ok)process.exit(1);
