// Laboratoř · Simulace 100 000 Kč: jeden krok (výstupy, pak vstupy) všech variant A/B/C/D (lib/lab/paper.ts PAPER_VARIANTS) pro vlastníka (OWNER_EMAIL → members.id), zápis do lab_paper_*.
// Cron: scripts/refresh-live.sh hned po živých cenách (každých 15 min, flock /tmp/tradee-lab-paper.lock; chyba nesmí shodit živé ceny).
// node --experimental-strip-types scripts/lab-paper.mjs [--dry] [--why] [--near] [--owner-email x@y]   (--near = u C vypíše, proč který trh nesplnil vstup)
//   --dry = nic neukládá, jen vypíše, co by udělal; bez .mariadb.env vezme živé ceny a denní svíčky přímo z Yahoo (prázdný účet).
// Idempotentní: id vstupu = slot 15 min + trh (INSERT IGNORE), výstup jen u ještě otevřeného obchodu, snímek equity podle slotu.
import {readFileSync,existsSync} from 'node:fs';
import {marketScore,instruments,fxCurrencies} from '../lib/markets.ts';
import {highNews} from '../lib/discipline/news.ts';
import {paperStep,toPaperSignal,slotOf,fmtPx,signed,marketGroup,contraSetup,PAPER_VARIANTS,VARIANT_IDS} from '../lib/lab/paper.ts';
import {cotForInstrument} from '../lib/lab/study.ts';
import {cotFromMarketJson} from '../lib/lab/store.ts';

const args=process.argv.slice(2),dry=args.includes('--dry'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const read=n=>JSON.parse(readFileSync(new URL('../data/'+n,import.meta.url),'utf8'));
const now=Date.now(),DAY=86400000,H=3600000;
const variants=VARIANT_IDS.map(v=>PAPER_VARIANTS[v]);

// skóre stejně jako aplikace / capture-score-history.mjs
const f=read('fundamentals.json');
const data={...f,ffMacro:read('ff-macro.json'),tePmi:read('te-pmi.json'),retailOfficial:read('retail-official.json')},core=read('score-market.json'),extra=read('expanded-market.json');
const market={...core,prices:{...core.prices,...extra.prices},legacy:extra.legacy};
const tradable=instruments.filter(i=>i.group!=='currency'); // měnové indexy nejdou obchodovat
const names=Object.fromEntries(tradable.map(i=>[i.id,i.name]));
const signals={};
for(const i of tradable){try{signals[i.id]=toPaperSignal(marketScore(data,market,i.id,now))}catch(e){console.warn('skóre',i.id,e.message)}}
const news=highNews(read('calendar.json').events,f.events,f.sources);
const minScore=Math.min(...variants.filter(v=>v.kind==='score').map(v=>v.rules.minScore));
const strong=Object.entries(signals).filter(([,s])=>s.score!==null&&Math.abs(s.score)>=minScore).map(([id])=>id);
// kontra (C): celý vesmír trhů varianty – trend potřebuje 200 denních svíček (~400 kalendářních dní)
const contraIds=tradable.map(i=>i.id).filter(id=>variants.some(v=>v.kind==='contra'&&v.groups.includes(marketGroup(id))));
const needD1=[...new Set([...strong,...contraIds])];

// ---- zdroje: DB (VPS) nebo Yahoo (lokální --dry)
const envFile=new URL('../.mariadb.env',import.meta.url);
let d=null,uid=null,cotSrc=null;const accounts={},tradesOf={},quotes={},h1={},points={},d1={};
for(const v of VARIANT_IDS){accounts[v]=null;tradesOf[v]=[]}
if(existsSync(envFile)){
 const env=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
 const {createDb}=await import('../lib/mysql.ts');
 d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
 const ownerEmail=(opt('--owner-email')||process.env.OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase();
 const owner=ownerEmail?await d.prepare('SELECT id FROM members WHERE LOWER(email)=?').bind(ownerEmail).first():null;
 if(!owner){console.log('lab-paper: vlastník nenalezen (OWNER_EMAIL / --owner-email) – nic nedělám');process.exit(0)}
 uid=owner.id;
 const ps=await import('../lib/lab/paper-store.ts');
 // každá varianta má vlastní účet; B/C/D vzniknou při prvním běhu (start = teď)
 for(const v of VARIANT_IDS){accounts[v]=dry?await ps.getAccount(d,uid,v):await ps.ensureAccount(d,uid,now,v);tradesOf[v]=accounts[v]?await ps.listTrades(d,uid,{variant:v}):[]}
 const {liveQuotes}=await import('../lib/live-store.ts');
 for(const [id,q] of Object.entries((await liveQuotes(d)).quotes))quotes[id]={price:q.price,marketTime:q.marketTime};
 const {loadBars}=await import('../lib/bars/query.ts');
 const openAll=VARIANT_IDS.flatMap(v=>tradesOf[v].filter(t=>t.closed===null)),since=new Map();
 for(const t of openAll)since.set(t.instrument,Math.min(since.get(t.instrument)??Infinity,t.opened));
 for(const [id,from] of since){
  h1[id]=await loadBars(d,id,'H1',from-H,now+H);
  points[id]=(await d.prepare('SELECT ts,price FROM market_intraday WHERE instrument=? AND ts>? ORDER BY ts').bind(id,from).all()).results.map(r=>[Number(r.ts),Number(r.price)]);
 }
 for(const id of new Set([...needD1,...since.keys()]))d1[id]=await loadBars(d,id,'D1',now-400*DAY,now+DAY);
 // COT: lab_cot (plná historie), jinak záloha z JSON souborů
 try{const {loadCot}=await import('../lib/lab/store.ts');const src=await loadCot(d);if(Object.keys(src).length)cotSrc=src}catch(e){console.warn('lab-paper: lab_cot nejde načíst –',e.code||e.message)}
}else{
 if(!dry){console.error('lab-paper: chybí .mariadb.env (lokálně použij --dry)');process.exit(1)}
 const {yahooSymbol,parseChart}=await import('../lib/live.ts');
 const {parseBars,planUrl}=await import('../lib/bars/yahoo.ts');
 const get=async url=>{const ac=new AbortController(),t=setTimeout(()=>ac.abort(),15000);try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}};
 for(const id of needD1){
  const sym=yahooSymbol(id,fxCurrencies);if(!sym)continue;
  try{const q=parseChart(await get('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sym)+'?range=1d&interval=15m'));if(q)quotes[id]={price:q.price,marketTime:q.marketTime}}catch(e){console.warn('cena',id,e.message)}
  try{d1[id]=parseBars(await get(planUrl(sym,{tf:'D1',interval:'1d',range:'2y'}))).bars}catch(e){console.warn('svíčky',id,e.message)}
 }
}
cotSrc??=cotFromMarketJson(core,extra.legacy);
const cot={};for(const id of contraIds){const fn=cotForInstrument(cotSrc,id),v=fn?fn(now):undefined;if(v!==undefined)cot[id]=v}

const slot=slotOf(now),results={};
for(const V of variants){
 const a=accounts[V.id];
 if(a&&!a.active){results[V.id]=null;continue}
 results[V.id]=paperStep({now,startEquity:a?.startEquity??V.rules.startEquity,trades:tradesOf[V.id],signals,quotes,h1,points,d1,news,names,variant:V,cot});
}
if(dry||!d){
 console.log(`lab-paper ${dry?'DRY':''} ${new Date(now).toISOString()} · silných signálů ${strong.length} · trhů pro kontra ${contraIds.length} (COT u ${Object.keys(cot).length})`);
 for(const V of variants){
  const step=results[V.id];
  console.log(`\n== ${V.id} – ${V.name} (${V.rulesVersion}) · účet ${accounts[V.id]?'nalezen':'zatím není'} · otevřeno ${tradesOf[V.id].filter(t=>t.closed===null).length}`);
  if(!step){console.log('vypnutá');continue}
  for(const c of step.closes)console.log('ZAVŘEL BY',c.id,c.exitReason,signed(c.r,2)+' R',c.pnlCzk+' Kč');
  for(const t of step.opens)console.log('OTEVŘEL BY',t.instrument.padEnd(9),t.direction.padEnd(5),V.kind==='contra'?'natažení '+signed(t.partsAtEntry.contra.extAtr,2).padStart(6)+' ATR':'skóre '+signed(t.scoreAtEntry,1).padStart(6),'jistota',String(t.confidence).padStart(3)+' %','vstup',fmtPx(t.entry),'SL',fmtPx(t.sl),'TP',fmtPx(t.tp),'riziko',t.riskCzk+' Kč');
  for(const s of step.skipped)console.log('přeskočen  ',s.instrument.padEnd(9),signed(s.score,1).padStart(6),'–',s.reason);
  if(V.kind==='contra'&&args.includes('--near'))for(const id of contraIds){const q=quotes[id];if(!q)continue;const r=contraSetup(d1[id]||[],now,q.price,cot[id],V.rules);if(!r.setup)console.log('  kontra ne',id.padEnd(9),r.reason)}
  if(args.includes('--why'))for(const t of step.opens)console.log('\n'+t.why);
  console.log(`zůstatek ${step.balance} Kč, otevřený P&L ${step.openPnl} Kč, pozic ${step.openCount}`);
 }
 process.exit(0);
}
const ps=await import('../lib/lab/paper-store.ts');
let changed=false;const out=[];
for(const V of variants){const step=results[V.id];if(!step){out.push(`${V.id} vypnutá`);continue}
 await ps.applyStep(d,uid,now,slot,step,V.id);
 if(step.opens.length||step.closes.length)changed=true;
 out.push(`${V.id}: +${step.opens.length}/−${step.closes.length}, pozic ${step.openCount}, zůstatek ${step.balance} Kč, otevřený P&L ${step.openPnl} Kč`);
}
if(changed){try{const {refreshSummary}=await import('../lib/lab/store.ts');await refreshSummary(d,uid)}catch(e){console.error('lab-paper: shrnutí pro AI',e.message)}}
console.log('lab-paper ok · '+out.join(' · '));
