// Laboratoř · Simulace 100 000 Kč: jeden krok (výstupy, pak vstupy) všech variant A/B/C/D (lib/lab/paper.ts PAPER_VARIANTS), S01… ze sweepu a agentů populace G01… (pravidla z lab_paper_accounts.rules; archivovaný agent jen dobíhá otevřené pozice) pro vlastníka (OWNER_EMAIL → members.id), zápis do lab_paper_*.
// Cron: scripts/refresh-live.sh hned po živých cenách (každých 15 min, flock /tmp/tradee-lab-paper.lock; chyba nesmí shodit živé ceny).
// node --experimental-strip-types scripts/lab-paper.mjs [--dry] [--why] [--near] [--owner-email x@y] [--try-combo N]   (--near = u C vypíše, proč který trh nesplnil vstup;
//   --try-combo N = jen s --dry: přidá dočasnou variantu S99 z kombinace N sweepu, nic se neukládá; --try-agents = jen s --dry bez DB: dočasná populace G01…G20)
//   --dry = nic neukládá, jen vypíše, co by udělal; bez .mariadb.env vezme živé ceny a denní svíčky přímo z Yahoo (prázdný účet).
// Idempotentní: id vstupu = slot 15 min + trh (INSERT IGNORE), výstup jen u ještě otevřeného obchodu, snímek equity podle slotu.
import {readFileSync,existsSync} from 'node:fs';
import {marketScore,instruments,fxCurrencies} from '../lib/markets.ts';
import {highNews} from '../lib/discipline/news.ts';
import {paperStep,toPaperSignal,slotOf,fmtPx,signed,marketGroup,contraSetup,sweepVariant,PAPER_VARIANTS,VARIANT_IDS} from '../lib/lab/paper.ts';
import {comboAt,SWEEP_SIZE} from '../lib/lab/sweep.ts';
import {cotForInstrument} from '../lib/lab/study.ts';
import {cotFromMarketJson} from '../lib/lab/store.ts';
import {cotPctForInstrument,rateSeries,knownHistoryDays} from '../lib/lab/known.ts';
import {isAgentVariant} from '../lib/lab/agents.ts';

const args=process.argv.slice(2),dry=args.includes('--dry'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const read=n=>JSON.parse(readFileSync(new URL('../data/'+n,import.meta.url),'utf8'));
const now=Date.now(),DAY=86400000,H=3600000;
let variants=VARIANT_IDS.map(v=>PAPER_VARIANTS[v]);

// skóre stejně jako aplikace / capture-score-history.mjs
const f=read('fundamentals.json');
const data={...f,ffMacro:read('ff-macro.json'),tePmi:read('te-pmi.json'),retailOfficial:read('retail-official.json')},core=read('score-market.json'),extra=read('expanded-market.json');
const market={...core,prices:{...core.prices,...extra.prices},legacy:extra.legacy};
const tradable=instruments.filter(i=>i.group!=='currency'&&i.model); // měnové indexy nejdou obchodovat; FX mimo 8měnový model (USD/CZK) do vesmíru Laboratoře nepatří
const names=Object.fromEntries(tradable.map(i=>[i.id,i.name]));
const signals={};
for(const i of tradable){try{signals[i.id]=toPaperSignal(marketScore(data,market,i.id,now))}catch(e){console.warn('skóre',i.id,e.message)}}
const news=highNews(read('calendar.json').events,f.events,f.sources);
let minScore,strong,contraIds,needD1,techIds,histDays;
// agenti se známou strategií: celý vesmír trhů agenta, historie podle rodiny (sezonalita ~17 let, TSMOM/MA200 ~1,5 roku)
const techOf=V=>V.kind==='agent'&&V.genome&&V.genome.family!=='score';
const plan=()=>{
 minScore=Math.min(...variants.filter(v=>v.kind!=='contra').map(v=>v.rules.minScore));
 strong=Object.entries(signals).filter(([,s])=>s.score!==null&&Math.abs(s.score)>=minScore).map(([id])=>id);
 // kontra (C): celý vesmír trhů varianty – trend potřebuje 200 denních svíček (~400 kalendářních dní)
 contraIds=tradable.map(i=>i.id).filter(id=>variants.some(v=>v.kind==='contra'&&v.groups.includes(marketGroup(id))));
 techIds=[...new Set(variants.filter(techOf).flatMap(V=>V.markets||[]))];
 histDays={};for(const V of variants.filter(techOf))for(const id of V.markets||[])histDays[id]=Math.max(histDays[id]??0,knownHistoryDays(V.genome.family));
 needD1=[...new Set([...strong,...contraIds,...techIds])];
};
plan();
// --try-agents (jen --dry bez DB): přidá dočasnou populaci G01…G20 ze seedPopulation (náhodné v mezích), nic se neukládá
if(args.includes('--try-agents')){
 if(!dry){console.error('lab-paper: --try-agents jen s --dry');process.exit(1)}
 const {seedPopulation,agentId}=await import('../lib/lab/agents.ts');const {agentVariant}=await import('../lib/lab/paper.ts');
 variants=[...variants,...seedPopulation({sweep:[],known:[]},Number(opt('--seed')??42)).map((a,i)=>agentVariant(agentId(i+1),a.genome))];plan();
}

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
 // každá varianta má vlastní účet; B/C/D vzniknou při prvním běhu (start = teď); S01… jen ty, které vlastník pustil ze sweepu
 for(const v of VARIANT_IDS){accounts[v]=dry?await ps.getAccount(d,uid,v):await ps.ensureAccount(d,uid,now,v);tradesOf[v]=accounts[v]?await ps.listTrades(d,uid,{variant:v}):[]}
 const accs=await ps.listAccounts(d,uid);
 variants=[...ps.variantsOf(accs),...ps.agentVariantsOf(accs)];
 for(const V of variants)if(!(V.id in accounts)){accounts[V.id]=accs.find(a=>a.variant===V.id)??null;tradesOf[V.id]=await ps.listTrades(d,uid,{variant:V.id})}
 plan();
 const {liveQuotes}=await import('../lib/live-store.ts');
 for(const [id,q] of Object.entries((await liveQuotes(d)).quotes))quotes[id]={price:q.price,marketTime:q.marketTime};
 const {loadBars}=await import('../lib/bars/query.ts');
 const openAll=variants.flatMap(V=>tradesOf[V.id].filter(t=>t.closed===null)),since=new Map();
 for(const t of openAll)since.set(t.instrument,Math.min(since.get(t.instrument)??Infinity,t.opened));
 for(const [id,from] of since){
  h1[id]=await loadBars(d,id,'H1',from-H,now+H);
  points[id]=(await d.prepare('SELECT ts,price FROM market_intraday WHERE instrument=? AND ts>? ORDER BY ts').bind(id,from).all()).results.map(r=>[Number(r.ts),Number(r.price)]);
 }
 for(const id of new Set([...needD1,...since.keys()]))d1[id]=await loadBars(d,id,'D1',now-Math.max(400,histDays[id]??0)*DAY,now+DAY);
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
  try{d1[id]=parseBars(await get(planUrl(sym,{tf:'D1',interval:'1d',range:(histDays[id]??0)>800?'20y':'2y'}))).bars}catch(e){console.warn('svíčky',id,e.message)}
 }
}
const tryCombo=opt('--try-combo');
if(tryCombo!==null){if(!dry){console.error('lab-paper: --try-combo jen s --dry');process.exit(1)}const n=Number(tryCombo);if(!(n>=0&&n<SWEEP_SIZE)){console.error('lab-paper: neplatná kombinace');process.exit(1)}
 const V=sweepVariant('S99',comboAt(n));variants=[...variants,V];accounts.S99=null;tradesOf.S99=[];plan();
 if(!d)for(const id of needD1)if(!d1[id]){const {yahooSymbol}=await import('../lib/live.ts');const {parseBars,planUrl}=await import('../lib/bars/yahoo.ts');const sym=yahooSymbol(id,fxCurrencies);if(!sym)continue;
  try{const r=await fetch(planUrl(sym,{tf:'D1',interval:'1d',range:'2y'}),{headers:{'User-Agent':'Mozilla/5.0'}});d1[id]=parseBars(await r.json()).bars;const q=await (await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sym)+'?range=1d&interval=15m',{headers:{'User-Agent':'Mozilla/5.0'}})).json();const {parseChart}=await import('../lib/live.ts');const p=parseChart(q);if(p)quotes[id]={price:p.price,marketTime:p.marketTime}}catch(e){console.warn('svíčky',id,e.message)}}
}
cotSrc??=cotFromMarketJson(core,extra.legacy);
const cot={};for(const id of contraIds){const fn=cotForInstrument(cotSrc,id),v=fn?fn(now):undefined;if(v!==undefined)cot[id]=v}
// agenti: COT percentil (rodina cot) a sazby z FRED (rodina carry; cache ~/.cache/tradee-lab/rates.json, obnova jednou denně)
const known={cotPct:{},rates:null};
const fams=new Set(variants.filter(techOf).map(V=>V.genome.family));
if(fams.has('cot'))for(const id of techIds)known.cotPct[id]=cotPctForInstrument(cotSrc,id);
if(fams.has('carry')){
 try{
  const {homedir}=await import('node:os');const {statSync,mkdirSync,writeFileSync}=await import('node:fs');
  const dir=homedir()+'/.cache/tradee-lab',file=dir+'/rates.json';let raw=null;
  try{if(Date.now()-statSync(file).mtimeMs<86400000)raw=JSON.parse(readFileSync(file,'utf8'))}catch{}
  if(!raw){const {loadRates}=await import('./lab-history.mjs');raw=await loadRates({});if(Object.keys(raw.rows).length){mkdirSync(dir,{recursive:true});writeFileSync(file,JSON.stringify(raw))}}
  known.rates=Object.fromEntries(Object.entries(raw.rows).map(([k,v])=>[k,rateSeries(v)]));
 }catch(e){console.warn('lab-paper: sazby pro carry nejdou načíst –',e.message)}
}

for(const V of variants){accounts[V.id]??=null;tradesOf[V.id]??=[]}
const slot=slotOf(now),results={};
for(const V of variants){
 const a=accounts[V.id];
 // archivovaný agent: žádné nové vstupy, jen dobíhají otevřené pozice (pak se už nic nezapisuje); ostatní vypnuté varianty nic
 const winding=a&&!a.active&&isAgentVariant(V.id)&&tradesOf[V.id].some(t=>t.closed===null);
 if(a&&!a.active&&!winding){results[V.id]=null;continue}
 results[V.id]=paperStep({now,startEquity:a?.startEquity??V.rules.startEquity,trades:tradesOf[V.id],signals,quotes,h1,points,d1,news,names,variant:V,cot,known,noEntries:!!winding});
}
if(dry||!d){
 console.log(`lab-paper ${dry?'DRY':''} ${new Date(now).toISOString()} · silných signálů ${strong.length} · trhů pro kontra ${contraIds.length} (COT u ${Object.keys(cot).length})`);
 for(const V of variants){
  const step=results[V.id];
  console.log(`\n== ${V.id} – ${V.name} (${V.rulesVersion}) · účet ${accounts[V.id]?'nalezen':'zatím není'} · otevřeno ${tradesOf[V.id].filter(t=>t.closed===null).length}`);
  if(!step){console.log('vypnutá');continue}
  for(const c of step.closes)console.log('ZAVŘEL BY',c.id,c.exitReason,signed(c.r,2)+' R',c.pnlCzk+' Kč');
  for(const t of step.opens)console.log('OTEVŘEL BY',t.instrument.padEnd(9),t.direction.padEnd(5),V.kind==='contra'&&t.partsAtEntry.contra?'natažení '+signed(t.partsAtEntry.contra.extAtr,2).padStart(6)+' ATR':'skóre '+signed(t.scoreAtEntry,1).padStart(6),'jistota',String(t.confidence).padStart(3)+' %','vstup',fmtPx(t.entry),'SL',fmtPx(t.sl),'TP',fmtPx(t.tp),'riziko',t.riskCzk+' Kč');
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
// Uzavřené obchody → hned upozornění jen vlastníkovi (mail přes Resend + push na jeho odběry)
// agenti populace (G…) se neposílají jednotlivě – 20 agentů by zahltilo schránku; jejich obchody jsou v týdenní analýze a v Laboratoři
const closedNow=variants.filter(V=>!isAgentVariant(V.id)).flatMap(V=>(results[V.id]?.closes||[]).map(c=>({V,c,t:tradesOf[V.id].find(t=>t.id===c.id)})));
if(closedNow.length&&!dry){
 try{
  const ld=f=>{try{return Object.fromEntries(readFileSync(new URL('../'+f,import.meta.url),'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim().replace(/^(["'])(.*)\1$/,'$2')]))}catch{return {}}};
  const ne={...ld('.auth.env'),...ld('.notify.env')},to=(process.env.OWNER_EMAIL||ne.OWNER_EMAIL||'').trim();
  const cz=n=>(n<0?'−':'+')+Math.abs(Math.round(n)).toLocaleString('cs-CZ');
  const REASON={sl:'stop-loss',tp:'take-profit',time:'časový limit',signal:'zeslábl signál',mean:'návrat k GMA50'};
  const line=({V,c,t})=>`${V.id} · ${t?.instrument??c.id} ${t?.direction==='short'?'short':'long'} → ${REASON[c.exitReason]||c.exitReason}: ${c.r>=0?'+':'−'}${Math.abs(c.r).toFixed(2)} R, ${cz(c.pnlCzk)} Kč`;
  const subject=closedNow.length===1?`Simulace: ${line(closedNow[0])}`:`Simulace: uzavřeno ${closedNow.length} obchodů (${cz(closedNow.reduce((a,x)=>a+x.c.pnlCzk,0))} Kč)`;
  const esc=x=>String(x??'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const html=`<div style="font-family:system-ui,sans-serif;max-width:560px">${closedNow.map(x=>`<h3 style="margin:18px 0 6px">${esc(line(x))}</h3><p style="margin:0 0 6px;color:#555"><b>Proč jsem šel dovnitř:</b> ${esc(x.t?.why)}</p><p style="margin:0;color:#555"><b>Výsledek:</b> ${esc(x.c.resultNote)}</p>`).join('')}<p style="margin-top:20px"><a href="https://tradee.eu/laborator#paper">Otevřít Simulaci</a></p></div>`;
  const text=closedNow.map(x=>`${line(x)}\nProč: ${x.t?.why??''}\nVýsledek: ${x.c.resultNote}`).join('\n\n');
  // Nastavení → Upozornění → Laboratoř (jen vlastník); bez řádku vše zapnuto
  const {channelsFor}=await import('../lib/notify/prefs.ts'),lab=await channelsFor(d,uid,'lab');
  if(lab.mail&&ne.RESEND_API_KEY&&to){const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+ne.RESEND_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({from:ne.MAIL_FROM||'Tradee <info@dejny.eu>',to:[to],subject,html,text})});if(!r.ok)console.log('lab-paper: mail HTTP',r.status)}
  if(lab.push&&ne.VAPID_PUBLIC_KEY&&ne.VAPID_PRIVATE_KEY&&ne.VAPID_SUBJECT){
   const webpush=(await import('web-push')).default;webpush.setVapidDetails(ne.VAPID_SUBJECT,ne.VAPID_PUBLIC_KEY,ne.VAPID_PRIVATE_KEY);
   const subs=(await d.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=?').bind(uid).all()).results;
   const body=JSON.stringify({title:'Tradee · Simulace',body:subject.replace(/^Simulace: /,''),url:'https://tradee.eu/laborator#paper',tag:'lab-close'});
   for(const sub of subs){try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},body,{TTL:86400,timeout:10000})}catch{}}
  }
 }catch(e){console.error('lab-paper: upozornění',e.message)}
}
if(changed){try{const {refreshSummary}=await import('../lib/lab/store.ts');await refreshSummary(d,uid)}catch(e){console.error('lab-paper: shrnutí pro AI',e.message)}}
console.log('lab-paper ok · '+out.join(' · '));
