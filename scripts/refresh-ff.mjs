// Odhady a předchozí hodnoty z oficiálního exportu ForexFactory → data/ff-calendar.json. Cron hodinově přes scripts/refresh-ff.sh.
// node --experimental-strip-types scripts/refresh-ff.mjs [--force] [--dry]
// FF žádá nedotazovat agresivně: bez --force se přeskočí, když poslední stažení je mladší než 50 min.
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {parseFF,mergeFF} from '../lib/calendar-ff.ts';
const force=process.argv.includes('--force'),dry=process.argv.includes('--dry');
const file=new URL('../data/ff-calendar.json',import.meta.url);
const old=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{rows:[]};
const now=Date.now();
if(!force&&!dry&&old.generatedAt&&now-Date.parse(old.generatedAt)<50*60000){console.log('FF: stahováno před '+Math.round((now-Date.parse(old.generatedAt))/60000)+' min, přeskočeno');process.exit(0)}
const fresh=[],errors=[];
for(const w of ['thisweek','nextweek']){
 const ac=new AbortController(),t=setTimeout(()=>ac.abort(),15000);
 try{
  const r=await fetch(`https://nfs.faireconomy.media/ff_calendar_${w}.json`,{headers:{'User-Agent':'Mozilla/5.0'},signal:ac.signal});
  if(r.status===404){console.log(w+': zatím nevystaveno (404)');continue}
  if(!r.ok)throw Error('HTTP '+r.status);
  const rows=parseFF(await r.json());
  console.log(w+': '+rows.length+' řádků');fresh.push(...rows);
 }catch(e){errors.push(w+': '+(e.name==='AbortError'?'timeout':e.message))}
 finally{clearTimeout(t)}
}
if(errors.length)console.log('!! '+errors.join('; '));
if(!fresh.length){console.log('FF: nic nového, soubor beze změny');process.exit(errors.length?1:0)}
const rows=mergeFF(old.rows??[],fresh,now);
if(dry){console.log('dry: '+rows.length+' řádků po sloučení');process.exit(0)}
const tmp=new URL('../data/ff-calendar.json.tmp',import.meta.url);
writeFileSync(tmp,JSON.stringify({generatedAt:new Date(now).toISOString().replace(/\.\d+Z$/,'Z'),source:'https://www.forexfactory.com/calendar',rows},null,1)+'\n');
renameSync(tmp,file);
console.log('FF: uloženo '+rows.length+' řádků');
