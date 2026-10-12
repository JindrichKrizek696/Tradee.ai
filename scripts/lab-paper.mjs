// Laboratoř · Simulace 100 000 Kč: jeden krok (výstupy, pak vstupy) pro vlastníka (OWNER_EMAIL → members.id), zápis do lab_paper_*.
// Cron: scripts/refresh-live.sh hned po živých cenách (každých 15 min, flock /tmp/tradee-lab-paper.lock; chyba nesmí shodit živé ceny).
// node --experimental-strip-types scripts/lab-paper.mjs [--dry] [--owner-email x@y]
//   --dry = nic neukládá, jen vypíše, co by udělal; bez .mariadb.env vezme živé ceny a denní svíčky přímo z Yahoo (prázdný účet).
// Idempotentní: id vstupu = slot 15 min + trh (INSERT IGNORE), výstup jen u ještě otevřeného obchodu, snímek equity podle slotu.
import {readFileSync,existsSync} from 'node:fs';
import {marketScore,instruments,fxCurrencies} from '../lib/markets.ts';
import {highNews} from '../lib/discipline/news.ts';
import {paperStep,toPaperSignal,slotOf,fmtPx,signed,PAPER_RULES} from '../lib/lab/paper.ts';

const args=process.argv.slice(2),dry=args.includes('--dry'),opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null};
const read=n=>JSON.parse(readFileSync(new URL('../data/'+n,import.meta.url),'utf8'));
const now=Date.now(),DAY=86400000,H=3600000;

// skóre stejně jako aplikace / capture-score-history.mjs
const f=read('fundamentals.json');
const data={...f,ffMacro:read('ff-macro.json'),tePmi:read('te-pmi.json'),retailOfficial:read('retail-official.json')},core=read('score-market.json'),extra=read('expanded-market.json');
const market={...core,prices:{...core.prices,...extra.prices},legacy:extra.legacy};
const tradable=instruments.filter(i=>i.group!=='currency'); // měnové indexy nejdou obchodovat
const names=Object.fromEntries(tradable.map(i=>[i.id,i.name]));
const signals={};
for(const i of tradable){try{signals[i.id]=toPaperSignal(marketScore(data,market,i.id,now))}catch(e){console.warn('skóre',i.id,e.message)}}
const news=highNews(read('calendar.json').events,f.events,f.sources);
const strong=Object.entries(signals).filter(([,s])=>s.score!==null&&Math.abs(s.score)>=PAPER_RULES.minScore).map(([id])=>id);

// ---- zdroje: DB (VPS) nebo Yahoo (lokální --dry)
const envFile=new URL('../.mariadb.env',import.meta.url);
let d=null,uid=null,account=null,trades=[],quotes={},h1={},points={},d1={};
if(existsSync(envFile)){
 const env=Object.fromEntries(readFileSync(envFile,'utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
 const {createDb}=await import('../lib/mysql.ts');
 d=createDb({host:env.MARIADB_HOST,port:Number(env.MARIADB_PORT||3306),user:env.MARIADB_USER,password:env.MARIADB_PASSWORD,database:env.MARIADB_DB});
 const ownerEmail=(opt('--owner-email')||process.env.OWNER_EMAIL||env.OWNER_EMAIL||'').trim().toLowerCase();
 const owner=ownerEmail?await d.prepare('SELECT id FROM members WHERE LOWER(email)=?').bind(ownerEmail).first():null;
 if(!owner){console.log('lab-paper: vlastník nenalezen (OWNER_EMAIL / --owner-email) – nic nedělám');process.exit(0)}
 uid=owner.id;
 const ps=await import('../lib/lab/paper-store.ts');
 account=dry?await ps.getAccount(d,uid):await ps.ensureAccount(d,uid,now);
 if(account&&!account.active){console.log('lab-paper: simulace je vypnutá');process.exit(0)}
 trades=account?await ps.listTrades(d,uid):[];
 const {liveQuotes}=await import('../lib/live-store.ts');
 for(const [id,q] of Object.entries((await liveQuotes(d)).quotes))quotes[id]={price:q.price,marketTime:q.marketTime};
 const {loadBars}=await import('../lib/bars/query.ts');
 for(const t of trades.filter(t=>t.closed===null)){
  h1[t.instrument]=await loadBars(d,t.instrument,'H1',t.opened-H,now+H);
  points[t.instrument]=(await d.prepare('SELECT ts,price FROM market_intraday WHERE instrument=? AND ts>? ORDER BY ts').bind(t.instrument,t.opened).all()).results.map(r=>[Number(r.ts),Number(r.price)]);
 }
 for(const id of strong)d1[id]=await loadBars(d,id,'D1',now-150*DAY,now+DAY);
}else{
 if(!dry){console.error('lab-paper: chybí .mariadb.env (lokálně použij --dry)');process.exit(1)}
 const {yahooSymbol,parseChart}=await import('../lib/live.ts');
 const {parseBars,planUrl}=await import('../lib/bars/yahoo.ts');
 const get=async url=>{const ac=new AbortController(),t=setTimeout(()=>ac.abort(),15000);try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}};
 for(const id of strong){
  const sym=yahooSymbol(id,fxCurrencies);if(!sym)continue;
  try{const q=parseChart(await get('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sym)+'?range=1d&interval=15m'));if(q)quotes[id]={price:q.price,marketTime:q.marketTime}}catch(e){console.warn('cena',id,e.message)}
  try{d1[id]=parseBars(await get(planUrl(sym,{tf:'D1',interval:'1d',range:'6mo'}))).bars}catch(e){console.warn('svíčky',id,e.message)}
 }
}

const step=paperStep({now,startEquity:account?.startEquity??PAPER_RULES.startEquity,trades,signals,quotes,h1,points,d1,news,names});
const slot=slotOf(now);
if(dry||!d){
 console.log(`lab-paper ${dry?'DRY':''} ${new Date(now).toISOString()} · účet ${account?'nalezen':'zatím není'} · otevřeno ${trades.filter(t=>t.closed===null).length} · silných signálů ${strong.length}`);
 for(const c of step.closes)console.log('ZAVŘEL BY',c.id,c.exitReason,signed(c.r,2)+' R',c.pnlCzk+' Kč');
 for(const t of step.opens)console.log('OTEVŘEL BY',t.instrument.padEnd(9),t.direction.padEnd(5),'skóre',signed(t.scoreAtEntry,1).padStart(6),'jistota',String(t.confidence).padStart(3)+' %','vstup',fmtPx(t.entry),'SL',fmtPx(t.sl),'TP',fmtPx(t.tp),'riziko',t.riskCzk+' Kč');
 for(const s of step.skipped)console.log('přeskočen  ',s.instrument.padEnd(9),signed(s.score,1).padStart(6),'–',s.reason);
 if(args.includes('--why'))for(const t of step.opens)console.log('\n'+t.why);
 console.log(`zůstatek ${step.balance} Kč, otevřený P&L ${step.openPnl} Kč, pozic ${step.openCount}`);
 process.exit(0);
}
const ps=await import('../lib/lab/paper-store.ts');
await ps.applyStep(d,uid,now,slot,step);
if(step.opens.length||step.closes.length){try{const {refreshSummary}=await import('../lib/lab/store.ts');await refreshSummary(d,uid)}catch(e){console.error('lab-paper: shrnutí pro AI',e.message)}}
console.log(`lab-paper ok: otevřeno ${step.opens.length}, zavřeno ${step.closes.length}, pozic ${step.openCount}, zůstatek ${step.balance} Kč, otevřený P&L ${step.openPnl} Kč`);
