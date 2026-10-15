// Kontrola „Hledání prahů“ (lib/lab/sweep.ts): bez look-ahead, vstup na open další svíčky, SL dřív než TP, gapy, pullback, kontra,
// výstupy, ochlazení, limity portfolia, IS/OOS, okolí, hranice náhody (determinismus se seedem).
// node --experimental-strip-types scripts/check-lab-sweep.mjs
import {prepareMarket,buildContext,simulate,segMetrics,compositeScore,comboAt,comboIndex,neighbours,neighbourhood,median,flipsFor,runSweep,mulberry32,
 isRobust,F,ROW_FIELDS,SWEEP_SIZE,SWEEP_GRID,sweepDay,normalizeCombo,tpOf} from '../lib/lab/sweep.ts';
import {spreadPrice,DEFAULT_RULES} from '../lib/backtest/rules.ts';
import {readFileSync} from 'node:fs';
import {labGate} from '../lib/lab/access.ts';
import {packResult,unpackResult,sweepSummary} from '../lib/lab/sweep-store.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,e=1e-9)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=e;
const DAY=86400000,D0=Date.UTC(2014,11,29); // pondělí; svíčky po sobě jdoucí dny (víkendy nevadí)
const day=s=>Math.floor(Date.parse(s+'T00:00:00Z')/DAY);

// ---- ruční trh: pole se zadají přímo (signál, ATR…), ceny kolem 1,0000
function mk(id,n,o={}){
 const f=(v,i)=>typeof v==='function'?v(i):Array.isArray(v)?v[i]??NaN:v;
 const A=k=>Float64Array.from({length:n},(_,i)=>f(o[k],i));
 const t=Float64Array.from({length:n},(_,i)=>D0+i*DAY);
 const c=A('c'),open=o.o===undefined?c:A('o'),h=o.h===undefined?Float64Array.from(c,(x,i)=>Math.max(x,open[i])):A('h'),l=o.l===undefined?Float64Array.from(c,(x,i)=>Math.min(x,open[i])):A('l');
 return {id,kind:/\//.test(id)?'fx':id.startsWith('^')?'index':'commodities',hs:o.hs??0,n,t,day:Int32Array.from(t,x=>sweepDay(x)),o:open,h,l,c,
  atr:A('atr'),g20:o.g20===undefined?Float64Array.from(c):A('g20'),g50:A('g50'),trend:A('trend'),score:A('score'),ext:A('ext'),cot:false};
}
const P=(x={})=>({threshold:50,entry:'immediate',slAtr:1,exit:'tp2',hold:20,corrCap:false,cooldown:false,set:'all',...x});
const ctxOf=(ms,o={})=>buildContext(ms,{from:'2014-12-29',split:o.split||'2015-01-20',to:o.to});
const run=(ms,p,o)=>simulate(ctxOf(ms,o),P(p),{trades:true});

// ---- skóre kompozitu (váhy 15 : 15 : 5, renormalizace)
check('skóre: vše +2 = 100, jen trend +2 = 100, bez trendu null',compositeScore(2,2,2)===100&&compositeScore(2,null,null)===100&&compositeScore(null,2,2)===null);
check('skóre: trend +1, COT chybí, sezonalita −2 = (7,5 − 5)/20 = 12,5',compositeScore(1,null,-2)===12.5,compositeScore(1,null,-2));
check('skóre: trend +2, COT −2, sezonalita 0 = 0',compositeScore(2,-2,0)===0);
check('skóre: trend −1, COT +1, sezonalita +2 = 5/35·100',near(compositeScore(-1,1,2),14.3,1e-9),compositeScore(-1,1,2));

// ---- grid
check(`grid: ${SWEEP_SIZE} kombinací, index ↔ kombinace`,SWEEP_SIZE===6*3*3*4*3*2*2*3&&[0,1,77,4321,SWEEP_SIZE-1].every(i=>comboIndex(comboAt(i))===i));
check('normalizace kombinace z API: neznámá hodnota = null',normalizeCombo(comboAt(5))!==null&&normalizeCombo({...comboAt(5),threshold:55})===null&&normalizeCombo(null)===null);
{const i=comboIndex(P({threshold:50,slAtr:1.5,exit:'tp2',hold:10})),nb=neighbours(i).map(comboAt);
 check('sousedé: ±1 krok v prahu, SL, TP (R) a držení = 8',nb.length===8&&nb.filter(c=>c.threshold!==50).map(c=>c.threshold).sort().join()==='40,60'&&nb.filter(c=>c.exit!=='tp2').map(c=>c.exit).sort().join()==='tp1.5,tp3'&&nb.every(c=>c.entry==='immediate'&&c.set==='all'),nb);
 const e=neighbours(comboIndex(P({threshold:30,slAtr:1,exit:'signal',hold:5}))).map(comboAt);
 check('sousedé na okraji a u výstupu signálem (bez TP souseda)',e.length===3&&e.every(c=>c.exit==='signal'),e);
 const rows=new Array(SWEEP_SIZE).fill(null),row=(n,avg)=>{const r=new Array(ROW_FIELDS.length).fill(null);r[F.oosN]=n;r[F.oosAvg]=avg;return r};
 rows[i]=row(100,.3);neighbours(i).forEach((j,k)=>rows[j]=row(k<3?100:0,[-.1,.2,.5,9,9,9,9,9][k]));
 check('okolí = medián OOS průměru R kombinace a sousedů s obchody',neighbourhood(rows,i)===0.25,neighbourhood(rows,i));
 check('medián',median([3,1,2])===2&&median([4,1,2,3])===2.5&&median([])===null);
 const good=new Array(ROW_FIELDS.length).fill(null);Object.assign(good,{[F.isAvg]:.1,[F.oosAvg]:.2,[F.oosN]:60,[F.nb]:.05,[F.oosPf]:1.1});
 check('robustní: IS>0, OOS>0, ≥ 60 OOS obchodů, okolí > 0, PF ≥ 1,1',isRobust(good)&&!isRobust({...good,[F.oosN]:59})&&!isRobust(Object.assign([...good],{[F.isAvg]:-.01}))&&!isRobust(Object.assign([...good],{[F.oosPf]:1.09}))&&!isRobust(Object.assign([...good],{[F.nb]:0})));
}

// ---- provedení: vstup na open další svíčky, SL/TP úrovně, spread
{const n=30,m=mk('EUR/USD',n,{c:1,o:i=>i===6?1.002:1,atr:.01,trend:2,score:i=>i===5?60:0,hs:.0001});
 const r=run([m],P({exit:'tp2'})),t=r.trades[0];
 check('signál na zavření svíčky 5 → vstup na open svíčky 6 + ½ spread',r.trades.length===1&&t.signalBar===5&&t.entryBar===6&&near(t.entry,1.0021,1e-12)&&near(t.risk,.01,1e-12),t);
 check('bez pohybu ceny: výstup časem po 20 svíčkách na open (R ze spreadu)',t.reason==='time'&&t.exitBar===26&&near(t.r,(1-.0001-1.0021)/.01,1e-9),t);
 const s=run([m],P({threshold:70}));
 check('pod prahem žádný obchod',s.trades.length===0);
 const sh=run([mk('EUR/USD',n,{c:1,atr:.01,trend:-2,score:i=>i===5?-60:0})],P()).trades[0];
 check('short: směr podle znaménka skóre',sh.dir===-1&&sh.entryBar===6);
}
{// TP 2 R uvnitř svíčky; SL i TP v jedné svíčce → SL; gap přes SL → open
 const base={c:1,atr:.01,trend:2,score:i=>i===2?80:0};
 const tp=run([mk('EUR/USD',20,{...base,h:i=>i===5?1.03:1})],P({exit:'tp2'})).trades[0];
 check('TP 2 R: plnění na úrovni = +2 R',tp.reason==='tp'&&tp.exitBar===5&&near(tp.r,2,1e-9),tp);
 const both=run([mk('EUR/USD',20,{...base,h:i=>i===5?1.03:1,l:i=>i===5?.98:1})],P({exit:'tp2'})).trades[0];
 check('SL i TP v jedné svíčce → SL (−1 R)',both.reason==='sl'&&near(both.r,-1,1e-9),both);
 const gap=run([mk('EUR/USD',20,{...base,o:i=>i===6?.97:1,c:i=>i===6?.975:1,l:i=>i===6?.96:1})],P()).trades[0];
 check('gap přes SL na open → výstup za open (horší než −1 R)',gap.reason==='sl'&&gap.exitBar===6&&near(gap.exit,.97,1e-12)&&near(gap.r,-3,1e-9),gap);
 const gtp=run([mk('EUR/USD',20,{...base,o:i=>i===6?1.05:1,h:i=>i===6?1.05:1})],P({exit:'tp2'})).trades[0];
 check('gap přes TP na open → výstup za open (lepší než TP)',gtp.reason==='tp'&&near(gtp.r,5,1e-9),gtp);
 const entryBar=run([mk('EUR/USD',20,{...base,l:i=>i===3?.985:1})],P()).trades[0];
 check('svíčka vstupu se kontroluje na SL',entryBar.entryBar===3&&entryBar.exitBar===3&&entryBar.reason==='sl',entryBar);
}
{// výstup signálem: skóre klesne pod práh/2 → výstup na open další svíčky; TP se nepoužije
 const m=mk('EUR/USD',30,{c:i=>1+i*.001,atr:.01,trend:2,score:i=>i<2?0:i<8?60:i===8?24:60});
 const t=run([m],P({exit:'signal'})).trades[0];
 check('výstup signálem: skóre 24 < 25 na zavření svíčky 8 → open svíčky 9',t.reason==='signal'&&t.exitBar===9&&near(t.exit,1.009,1e-12),t);
 const keep=run([mk('EUR/USD',30,{c:1,atr:.01,trend:2,score:i=>i<2?0:i===8?25:60})],P({exit:'signal',hold:5})).trades[0];
 check('skóre = práh/2 drží; časový limit 5 svíček',keep.reason==='time'&&keep.exitBar===8,keep);
}
{// pullback: limit na GMA20 nebo 1 ATR proti signálu (co je blíž), 5 svíček, plnění limitem = v té svíčce jen SL
 const base={c:1.02,atr:.01,trend:2,score:i=>i===2?70:0,g20:1.015};
 const a=run([mk('EUR/USD',20,{...base,l:i=>i===5?1.014:1.02})],P({entry:'pullback'})).trades[0];
 check('pullback long: plnění na GMA20 (blíž než 1 ATR)',a&&a.entryBar===5&&near(a.entry,1.015,1e-12),a);
 const b=run([mk('EUR/USD',20,{...base,g20:1.0,l:i=>i===4?1.0095:1.02})],P({entry:'pullback'})).trades[0];
 check('pullback long: GMA20 daleko → limit 1 ATR pod close signálu',b&&b.entryBar===4&&near(b.entry,1.01,1e-12),b);
 const late=run([mk('EUR/USD',20,{...base,l:i=>i===8?1.0:1.02})],P({entry:'pullback'}));
 check('pullback: po 5 svíčkách bez dotyku propadne',late.trades.length===0,late.trades);
 const g=run([mk('EUR/USD',20,{...base,o:i=>i===3?1.01:1.02,c:i=>i===3?1.012:1.02,l:i=>i===3?1.01:1.02})],P({entry:'pullback'})).trades[0];
 check('pullback: gap pod limit → plnění za open',g&&g.entryBar===3&&near(g.entry,1.01,1e-12),g);
 const noTp=run([mk('EUR/USD',20,{...base,l:i=>i===5?1.014:1.02,h:i=>i===5?1.04:i===6?1.04:1.02})],P({entry:'pullback',exit:'tp1.5'})).trades[0];
 check('pullback: plnění limitem → TP až od další svíčky',noTp.entryBar===5&&noTp.exitBar===6&&noTp.reason==='tp',noTp);
}
{// kontra: trend ±2 ve směru skóre a natažení ≥ 2 ATR → obchod proti
 const m=mk('EUR/USD',20,{c:1,atr:.01,trend:2,score:i=>i===3?60:0,ext:i=>i===3?2.5:0});
 const t=run([m],P({entry:'contra'})).trades[0];
 check('kontra: skóre +60, trend +2, natažení 2,5 ATR → short',t&&t.dir===-1&&t.entryBar===4,t);
 check('kontra: natažení 1,9 ATR nebo trend +1 → nic',run([mk('EUR/USD',20,{c:1,atr:.01,trend:2,score:i=>i===3?60:0,ext:1.9})],P({entry:'contra'})).trades.length===0&&run([mk('EUR/USD',20,{c:1,atr:.01,trend:1,score:i=>i===3?60:0,ext:3})],P({entry:'contra'})).trades.length===0);
}
{// ochlazení po ztrátě 5 dní; bez ochlazení vstup hned další den
 const m=mk('EUR/USD',30,{c:1,atr:.01,trend:2,score:60,l:i=>i===3?.98:1});
 const off=run([m],P()).trades,on=run([m],P({cooldown:true})).trades;
 check('bez ochlazení: po SL ve svíčce 3 nový vstup na open svíčky 4',off[0].reason==='sl'&&off[0].exitBar===3&&off[1].entryBar===4,off.slice(0,2));
 check('ochlazení: po ztrátě 5 dní bez signálu (vstup až svíčka 9)',on[0].exitBar===3&&on[1].signalBar===8&&on[1].entryBar===9,on.slice(0,2));
}
{// portfolio: max 5 pozic, pořadí podle |skóre|; korelační limit 2 na měnu a směr / skupinu
 const ids=['EUR/USD','EUR/JPY','EUR/GBP','EUR/CHF','EUR/CAD','EUR/AUD','GBP/JPY'];
 const ms=ids.map((id,k)=>mk(id,20,{c:1,atr:.01,trend:2,score:i=>i===2?90-k:0}));
 const all=run(ms,P()).trades;
 check('max 5 otevřených, pořadí podle |skóre|',all.length===5&&all.map(t=>t.market).sort().join()===ids.slice(0,5).sort().join(),all.map(t=>t.market));
 const cap=run(ms,P({corrCap:true})).trades;
 check('korelační limit: nejvýš 2 long EUR (+ GBP/JPY)',cap.map(t=>t.market).sort().join()==='EUR/JPY,EUR/USD,GBP/JPY',cap.map(t=>t.market));
 const cm=['GC=F','SI=F','PL=F'].map((id,k)=>mk(id,20,{c:1,atr:.01,trend:2,score:i=>i===2?90-k:0})).concat(['^NDX','^GSPC'].map(id=>mk(id,20,{c:1,atr:.01,trend:2,score:i=>i===2?70:0})));
 const g=run(cm,P({corrCap:true,set:'ci'})).trades,g0=run(cm,P({set:'ci'})).trades;
 check('skupiny: nejvýš 2 kovy (3. kov odmítnut), bez limitu všech 5',g.map(t=>t.market).sort().join()==='GC=F,SI=F,^GSPC,^NDX'&&g0.length===5,[g.map(t=>t.market),g0.length]);
 check('sada trhů: FX sada nevidí komodity',run([...cm,ms[0]],P({set:'fx'})).trades.every(t=>t.market==='EUR/USD'));
}
{// IS/OOS podle data vstupu
 const m=mk('EUR/USD',60,{c:1,atr:.01,trend:2,score:60,l:i=>i%4===3?.98:1});
 const r=run([m],P({hold:2}),{split:'2015-01-15'}),isN=r.trades.filter(t=>t.entryDay<day('2015-01-15')).length;
 check('IS/OOS: obchody podle data vstupu, součet = celek',r.is.n===isN&&r.oos.n===r.trades.length-isN&&r.all.n===r.trades.length&&r.is.n>0&&r.oos.n>0,[r.is.n,r.oos.n,r.trades.length]);
 const sm=segMetrics(r.all),sum=r.trades.reduce((s,t)=>s+t.r,0);
 check('metriky: celkem R, průměr, PF, max DD v R',near(sm.totalR,Math.round(sum*100)/100,1e-9)&&near(sm.avgR,Math.round(sum/r.trades.length*1000)/1000,1e-9)&&sm.maxDd<=0&&sm.expectancy===sm.avgR,sm);
}

// ---- bez look-ahead: oříznutí budoucích svíček nemění signály ani rozhodnutí do té doby
const rnd=mulberry32(7);
function walk(n,p0,vol){const out=[];let p=p0;for(let i=0;i<n;i++){const o=p;p*=Math.exp((rnd()-.5)*vol);const h=Math.max(o,p)*(1+rnd()*vol/3),l=Math.min(o,p)*(1-rnd()*vol/3);out.push({t:Date.UTC(2010,0,4)+i*DAY,o,h,l,c:p})}return out}
{const raw={'EUR/USD':walk(2600,1.2,.012),'GBP/JPY':walk(2600,150,.014),'GC=F':walk(2600,1500,.02)};
 const cotRows=Array.from({length:400},(_,k)=>({t:Date.UTC(2009,0,6)+k*7*DAY,v:Math.sin(k/9)}));
 const cotFn=t=>{let v;for(const r of cotRows)if(r.t<=t)v=r.v;return v};
 const full=Object.entries(raw).map(([id,b])=>prepareMarket(id,b,id==='GC=F'?cotFn:null));
 const cut=Date.UTC(2010,0,4)+2000*DAY;
 const part=Object.entries(raw).map(([id,b])=>prepareMarket(id,b.filter(x=>x.t<cut),id==='GC=F'?cotFn:null));
 const same=full.every((m,k)=>{const q=part[k];for(let i=0;i<q.n;i++){for(const f of ['score','trend','atr','g20','g50','ext']){const a=m[f][i],b=q[f][i];if(!(a===b||(a!==a&&b!==b)))return false}}return true});
 check('bez look-ahead: skóre, trend, ATR, GMA a natažení do řezu stejné',same);
 const scored=full.reduce((s,m)=>s+m.score.filter(x=>x===x).length,0);
 check('syntetická data mají signály (test není prázdný)',scored>4000,scored);
 const o={from:'2011-01-01',split:'2013-01-01'},cutDay=sweepDay(cut);
 let ok=true,cnt=0;
 for(const p of [P({threshold:30}),P({threshold:40,entry:'pullback',exit:'signal',hold:10}),P({threshold:30,entry:'contra',exit:'tp1.5',hold:5,cooldown:true,corrCap:true})]){
  const a=simulate(buildContext(full,o),p,{trades:true}).trades.filter(t=>t.exitDay<cutDay-1),b=simulate(buildContext(part,o),p,{trades:true}).trades.filter(t=>t.exitDay<cutDay-1);
  cnt+=a.length;if(JSON.stringify(a)!==JSON.stringify(b))ok=false;
 }
 check('bez look-ahead: obchody uzavřené před řezem jsou s oříznutými daty stejné',ok&&cnt>20,cnt);

 // ---- hranice náhody: deterministická se seedem
 const ctx=buildContext(full,o),f1=flipsFor(ctx,42),f2=flipsFor(ctx,42),f3=flipsFor(ctx,43);
 check('náhodné směry: stejný seed = stejné, jiný seed = jiné',f1.every((a,k)=>a.join()===f2[k].join())&&f1.some((a,k)=>a.join()!==f3[k].join()));
 check('náhodné směry: znaménko se mění jen na hranici epizody signálu',f1.every((a,k)=>{const s=ctx.markets[k].score;for(let i=1;i<a.length;i++){const sg=x=>x>0?1:x<0?-1:0;if(a[i]!==a[i-1]&&sg(s[i])===sg(s[i-1]))return false}return true}));
 const combos=[0,1,2,500,1000,3000].map(i=>i%SWEEP_SIZE),r1=runSweep(ctx,{shuffles:3,seed:5,combos,now:0}),r2=runSweep(ctx,{shuffles:3,seed:5,combos,now:0});
 const strip=r=>JSON.stringify({...r,ms:0});
 check('runSweep: stejný seed → stejný výsledek vč. hranice náhody',strip(r1)===strip(r2)&&r1.chance.reps===3&&r1.chance.n===combos.length,r1.chance);
 const flipped=simulate(ctx,comboAt(0),{flip:f1}),plain=simulate(ctx,comboAt(0));
 check('náhodné směry mění výsledek, ne počet signálů výrazně',flipped.all.sum!==plain.all.sum&&Math.abs(flipped.all.n-plain.all.n)<=plain.all.n*.3,[flipped.all.n,plain.all.n]);
}

// ---- náklady
check('spread zlata 0,30 USD, stříbra 0,03 USD (výchozí backtest)',near(spreadPrice('GC=F',4000,DEFAULT_RULES),.3)&&near(spreadPrice('SI=F',40,DEFAULT_RULES),.03));
check('TP z výstupu',tpOf('tp1.5')===1.5&&tpOf('signal')===null&&SWEEP_GRID.exit.length===4);

// ---- přístup, API, úložiště, migrace
{
 const U='https://tradee.eu/api/laborator/sweep';
 check('/api/laborator/sweep: admin, člen i nepřihlášený → 404, vlastník ano',[{id:'a',role:'admin',owner:false},{id:'m',role:'member',owner:false},null].every(u=>labGate(u,U).status===404)&&labGate({id:'o',role:'admin',owner:true},U).id==='o'&&labGate({id:'o',role:'admin',owner:true},U+'?as=x').status===404);
 const src=readFileSync(new URL('../app/api/laborator/sweep/route.ts',import.meta.url),'utf8'),handlers=src.split(/export async function /).slice(1);
 check('route: každý handler začíná labUser (404)',handlers.length===2&&handlers.every(h=>/^(GET|POST)\(req:Request\)\{try\{const u=await labUser\(req\);if\(u instanceof Response\)return u;/.test(h)));
 check('route: „Pustit do simulace“ jen sameOrigin + sec-fetch-site a jen robustní kombinace',/POST[\s\S]*sameOrigin\(req\)[\s\S]*sec-fetch-site[\s\S]*row\[F\.robust\]!==1[\s\S]*createSweepVariant/.test(src)&&!/createSweepVariant/.test(handlers[0]));
 const store=readFileSync(new URL('../lib/lab/sweep-store.ts',import.meta.url),'utf8');
 check('store: dotazy na lab_sweeps filtrují user_id, drží 10',[...store.matchAll(/(?:FROM|UPDATE|INTO) lab_sweeps[^'`]*/g)].every(m=>/user_id/.test(m[0]))&&/SWEEP_KEEP=10/.test(store));
 const sql=readFileSync(new URL('../drizzle/mariadb/0028_lab_sweep.sql',import.meta.url),'utf8');
 check('migrace 0028: lab_sweeps s user_id, results LONGTEXT',/CREATE TABLE IF NOT EXISTS lab_sweeps\(/.test(sql)&&/user_id VARCHAR\(128\) NOT NULL/.test(sql)&&/results LONGTEXT NOT NULL/.test(sql)&&/INDEX lab_sweeps_user\(user_id,created\)/.test(sql));
 const fake={version:'x',computedAt:'',from:'2015-01-01',split:'2023-01-01',to:'2026-10-15',grid:SWEEP_GRID,dims:[],fields:ROW_FIELDS,rows:[[1,2,null]],markets:[],chance:{median:.4},robust:[0],notes:['ž'],ms:5};
 const packed=await packResult(fake),back=await unpackResult(packed);
 check('úložiště: gzip + base64 tam a zpět (i diakritika)',packed.startsWith('gz:')&&JSON.stringify(back)===JSON.stringify(fake)&&(await unpackResult(JSON.stringify(fake)))?.notes[0]==='ž'&&(await unpackResult('gz:xx'))===null);
 check('souhrn sweepu',sweepSummary(fake).robust===1&&sweepSummary(fake).chance===.4);
}

console.log(fails.length?`\n${fails.length} selhalo`:'\nvše ok');
process.exit(fails.length?1:0);
