// Odhady a předchozí hodnoty z oficiálního exportu ForexFactory → data/ff-calendar.json. Cron hodinově přes scripts/refresh-ff.sh.
// node --experimental-strip-types scripts/refresh-ff.mjs [--force] [--dry] [--no-db]
// Po migraci 0040 a s .mariadb.env se každé stažení zapíše i do historie kalendáře (calendar_events_hist + calendar_revisions:
// posuny času, změny odhadu, odvozená skutečnost a revize) a do calendar_feed_status (i neúspěch → kalendář ukáže „nedostupné“).
// FF žádá nedotazovat agresivně: bez --force se přeskočí, když poslední stažení je mladší než 50 min.
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {parseFF,mergeFF} from '../lib/calendar-ff.ts';
import {deriveMacro} from '../lib/macro/ff-macro.ts';
const force=process.argv.includes('--force'),dry=process.argv.includes('--dry'),noDb=process.argv.includes('--no-db');
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
// Historie v DB: bez .mariadb.env nebo před migrací 0040 se tiše přeskočí (soubor data/ff-calendar.json se uloží vždy).
async function histDb(){
 if(noDb||dry||!existsSync(new URL('../.mariadb.env',import.meta.url)))return null;
 const {createDb}=await import('../lib/mysql.ts');
 const env=Object.fromEntries(readFileSync(new URL('../.mariadb.env',import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
 return createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
}
async function saveHistory(fresh,merged){
 try{
  const d=await histDb();if(!d)return;
  const store=await import('../lib/calendar-hist-store.ts'),{refreshPlan,planUpsert}=await import('../lib/calendar-hist.ts');
  if(!fresh.length){await store.setFeedStatus(d,now,false,errors.join('; ')||'prázdný export');console.log('DB: stav zdroje = nedostupné');return}
  const existing=await store.histBetween(d,now-400*86400000,now+60*86400000,20000);
  // starší řádky ze souboru (před oknem exportu), které v DB ještě nejsou → jen doplnit (první naplnění historie)
  const start=Math.min(...fresh.map(r=>Date.parse(r.at))),seed=planUpsert(existing,merged.filter(r=>Date.parse(r.at)<start),now).events.filter(e=>!existing.some(x=>x.id===e.id));
  const plan=refreshPlan([...existing,...seed],fresh,now),ids=new Set(plan.events.map(e=>e.id));
  await store.saveHist(d,[...plan.events,...seed.filter(e=>!ids.has(e.id))],plan.changes);
  await store.setFeedStatus(d,now,errors.length===0,errors.length?errors.join('; '):null);
  const by=k=>plan.changes.filter(c=>c.kind===k).length;
  console.log(`DB: ${plan.events.length+seed.length} událostí · posun času ${by('time')} · odhad ${by('forecast')} · skutečnost ${by('actual')} · revize ${by('revision')}`);
 }catch(e){console.log('!! DB historie kalendáře: '+e.message+' (po migraci 0040 se uloží při dalším běhu)')}
}
if(!fresh.length){await saveHistory([],[]);console.log('FF: nic nového, soubor beze změny');process.exit(errors.length?1:0)}
const rows=mergeFF(old.rows??[],fresh,now,120);
const macro=deriveMacro(rows,now);
if(dry){console.log('dry: '+rows.length+' řádků po sloučení');process.exit(0)}
const tmp=new URL('../data/ff-calendar.json.tmp',import.meta.url);
writeFileSync(tmp,JSON.stringify({generatedAt:new Date(now).toISOString().replace(/\.\d+Z$/,'Z'),source:'https://www.forexfactory.com/calendar',rows},null,1)+'\n');
renameSync(tmp,file);
console.log('FF: uloženo '+rows.length+' řádků');
await saveHistory(fresh,rows);
const mt=new URL('../data/ff-macro.json.tmp',import.meta.url);
writeFileSync(mt,JSON.stringify(macro,null,1)+'\n');
renameSync(mt,new URL('../data/ff-macro.json',import.meta.url));
for(const [c,v] of Object.entries(macro.currencies))console.log('  '+c+': '+['mpmi','spmi','retailSales'].map(k=>k+'='+(v[k]?v[k].value+' ('+v[k].basis+', '+v[k].period+')':'—')).join(' · '));
