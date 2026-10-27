// Kontrola „Známé strategie“ + „Populace agentů“ + AI analytik (lib/lab/known.ts, agents.ts, agents-report.ts, agents-store.ts, paper.ts):
// bez look-ahead a správnost signálů na syntetických řadách, simulace, genom (meze, validace), mutace (meze, determinismus),
// fitness a pravidla vyřazení (nikdy < 8 obchodů, archiv ne mazání), max 20 aktivních, neměnnost agentů, přístup jen vlastník, report.
// node --experimental-strip-types scripts/check-lab-agents.mjs
import {readFileSync} from 'node:fs';
import {knownSignals,simulateKnown,runKnown,knownFlips,cotPctForInstrument,percentileSeries,rateSeries,rateAt,rateDiff,parseFredCsv,monthStarts,knownLive,
 KNOWN_COMBOS,KNOWN_SIZE,KNOWN_FAMILIES,knownNeighbours,knownIndex} from '../lib/lab/known.ts';
import {buildContext,sweepDay} from '../lib/lab/sweep.ts';
import {validateGenome,canonicalGenome,randomGenome,mutateGenome,mutateUnique,genomeKey,fitnessOf,canKill,planEvolution,seedPopulation,sweepToGenome,knownToGenome,
 isAgentVariant,agentId,nextAgentIds,evolutionSeed,AGENT_CRYPTO,GENOME_BOUNDS,GENOME_HOLDS,MAX_ACTIVE_AGENTS} from '../lib/lab/agents.ts';
import {mulberry32} from '../lib/lab/sweep.ts';
import {agentVariant,agentRules,paperStep,checkExit,isVariantId,isSweepVariant,SWEEP_VARIANT_IDS,rOf} from '../lib/lab/paper.ts';
import {buildAgentReport,agentRow,agentsSummaryMd,analysisVerdict,analysisTitle} from '../lib/lab/agents-report.ts';
import {labGate} from '../lib/lab/access.ts';
import {instruments} from '../lib/markets.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)?.slice(0,400)));if(!ok)fails.push(name)};
const DAY=86400000,D0=Date.UTC(2000,0,3);
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');

// ---- syntetické řady
const bars=(closes,o={})=>({t:closes.map((_,i)=>D0+i*DAY),h:closes.map((c,i)=>o.h?o.h(c,i):c*1.002),l:closes.map((c,i)=>o.l?o.l(c,i):c*.998),c:closes});
const rnd=mulberry32(7);
const walk=Array.from({length:6000},(_,i)=>0);for(let i=1;i<walk.length;i++)walk[i]=walk[i-1]+(rnd()-.5)*.02+Math.sin(i/300)*.002;
const W=walk.map(x=>100*Math.exp(x));
const cotFn=t=>{const k=Math.floor((t-D0)/(7*DAY));return (k*37)%101};
const ratesSrc={USD:{times:[D0-30*DAY,D0+300*DAY,D0+2000*DAY],vals:[5,5,1]},JPY:{times:[D0-30*DAY,D0+300*DAY,D0+600*DAY,D0+900*DAY,D0+1200*DAY,D0+1500*DAY,D0+1800*DAY],vals:[0,0,0,0,0,0,0]},EUR:{times:[D0-30*DAY,D0+300*DAY],vals:[2,2]}};

// ---- 1) bez look-ahead: signál svíčky i se nezmění, když se odříznou všechny pozdější svíčky (všechny rodiny a varianty)
{
 const B=bars(W.slice(0,4200));
 for(const f of KNOWN_FAMILIES)for(const v of f.v){
  const x={id:f.id==='carry'?'USD/JPY':'EUR/USD',cotPct:cotFn,rates:ratesSrc},full=knownSignals(f.id,v,B,x);
  const cuts=[260,700,1500,2600,3100,3700,4199];let ok=true,where=null;
  for(const n of cuts){const p=knownSignals(f.id,v,{t:B.t.slice(0,n+1),h:B.h.slice(0,n+1),l:B.l.slice(0,n+1),c:B.c.slice(0,n+1)},x);
   for(let i=Math.max(0,n-40);i<=n;i++)if(p.ent[i]!==full.ent[i]||p.exL[i]!==full.exL[i]||p.exS[i]!==full.exS[i]){ok=false;where={n,i};break}if(!ok)break}
  check(`bez look-ahead: ${f.id} ${v} (prefix = celá řada)`,ok,where);
 }
 // budoucí šok nemění minulé signály
 const shocked=[...W.slice(0,3000)];for(let i=2500;i<3000;i++)shocked[i]*=1.5;
 const a=knownSignals('donchian','20/10',bars(W.slice(0,3000)),{id:'EUR/USD'}),b=knownSignals('donchian','20/10',bars(shocked),{id:'EUR/USD'});
 check('bez look-ahead: šok od svíčky 2500 nemění signály do 2499',[...a.ent.slice(0,2500)].every((x,i)=>x===b.ent[i])&&[...a.exL.slice(0,2500)].every((x,i)=>x===b.exL[i]));
}

// ---- 2) správnost signálů
{
 // Donchian 20/10: rovně 1,0, svíčka 30 = 1,05 → průraz nahoru (close nad maximem předchozích 20), pak pád pod minimum 10 → výstup longu
 const c=Array(60).fill(1);c[30]=1.05;for(let i=31;i<40;i++)c[i]=1.04;c[40]=.99;
 const s=knownSignals('donchian','20/10',bars(c,{h:x=>x,l:x=>x}),{id:'EUR/USD'});
 check('Donchian: průraz = +1 na svíčce průrazu, ne dřív',s.ent[30]===1&&s.ent.slice(0,30).every(x=>x===0),[...s.ent.slice(25,35)]);
 check('Donchian: výstup longu, když close < minimum předchozích 10',s.exL[40]===1&&s.exL[35]===0);
 check('Donchian: průraz dolů = −1',knownSignals('donchian','20/10',bars(c.map((x,i)=>i===30?.95:x),{h:x=>x,l:x=>x}),{id:'EUR/USD'}).ent[30]===-1);
 // MA cross 10/50: pokles, pak růst → zlatý kříž jen jednou (event), výstup longu dokud SMA10 < SMA50
 const m=[...Array(100).fill(0).map((_,i)=>2-i*.005),...Array(100).fill(0).map((_,i)=>1.5+i*.01)];
 const ms=knownSignals('macross','10/50',bars(m),{id:'EUR/USD'}),ups=[...ms.ent].map((x,i)=>x===1?i:-1).filter(i=>i>=0);
 check('MA cross: jediný vstup long na svíčce křížení',ups.length===1&&ms.ent[ups[0]-1]===0&&ms.exL[ups[0]-1]===1&&ms.exL[ups[0]]===0,ups);
 // TSMOM: rostoucí trh → +1 jen na prvních svíčkách měsíce (po 252 svíčkách)
 const up=Array.from({length:700},(_,i)=>100*Math.exp(i*.001)),tb=bars(up),ts=knownSignals('tsmom','12-1',tb,{id:'GC=F'}),st=monthStarts(tb.t);
 const nz=[...ts.ent].map((x,i)=>x?i:-1).filter(i=>i>=0);
 check('TSMOM: +1 jen na začátku měsíce a až po 12 měsících dat',nz.length>5&&nz.every(i=>st[i]===1&&i>=252&&ts.ent[i]===1),nz.slice(0,5));
 check('TSMOM: klesající trh → −1',knownSignals('tsmom','12-1',bars(up.map(x=>1e4/x)),{id:'GC=F'}).ent.some(x=>x===-1));
 // RSI(2): uptrend nad SMA200 a dva prudké poklesy → long; výstup longu, když close > SMA5
 const r=Array.from({length:260},(_,i)=>100+i*.2);r[250]=r[249]-3;r[251]=r[250]-3;r[252]=r[251]+8;
 const rs=knownSignals('rsi','rsi2',bars(r),{id:'^GSPC'});
 check('RSI(2): přeprodání v uptrendu → +1, návrat nad SMA5 → výstup longu',rs.ent[251]===1&&rs.ent[240]===0&&rs.exL[252]===1,[rs.ent[250],rs.ent[251],rs.exL[252]]);
 const rd=r.map(x=>1e4/x),rsd=knownSignals('rsi','rsi2',bars(rd),{id:'^GSPC'});
 check('RSI(2): v downtrendu se long nebere (filtr MA200), short po překoupení',!rsd.ent.some(x=>x===1)&&rsd.ent[251]===-1);
 // Bollinger: klid a propad pod pásmo → +1, návrat ke středu → výstup
 const bo=Array.from({length:80},(_,i)=>1+.001*Math.sin(i));bo[60]=.97;bo[61]=1.001;
 const bs=knownSignals('bollinger','20/2',bars(bo),{id:'EUR/USD'});
 check('Bollinger: close pod SMA20 − 2σ → +1, návrat nad SMA20 → výstup',bs.ent[60]===1&&bs.ent[59]===0&&bs.exL[61]===1);
 // Keltner: průraz nad EMA20 + 1,5 ATR → +1
 const ke=Array(80).fill(1).map((x,i)=>x+.0005*(i%2));ke[70]=1.03;
 const kk=knownSignals('keltner','20/1.5',bars(ke),{id:'EUR/USD'});
 check('Keltner: close nad EMA20 + 1,5 × ATR20 → +1',kk.ent[70]===1&&kk.ent[69]===0);
 // carry: USD 5 %, JPY 0 % → USD/JPY long; změna sazby (měsíc M) platí až od M+2
 const series=rateSeries([{date:'2000-01-01',value:5},{date:'2000-06-01',value:-1}]);
 check('carry: sazba za červen platí až od 1. 8. (ne 1. 7.)',rateAt(series,Date.UTC(2000,6,15))===5&&rateAt(series,Date.UTC(2000,7,1))===-1&&rateAt(series,Date.UTC(2000,1,1))===undefined);
 const cb=bars(Array(400).fill(100)),cs=knownSignals('carry','diff2',cb,{id:'USD/JPY',rates:ratesSrc}),cst=monthStarts(cb.t);
 check('carry: rozdíl ≥ 2 → +1 jen na začátku měsíce; EUR/USD (2 vs 5) → −1',[...cs.ent].every((x,i)=>x===(cst[i]?1:0))&&knownSignals('carry','diff2',cb,{id:'EUR/USD',rates:ratesSrc}).ent.some(x=>x===-1));
 check('carry: bez sazeb nic, FRED CSV parser',knownSignals('carry','diff1',cb,{id:'USD/JPY',rates:null}).ent.every(x=>x===0)&&parseFredCsv('observation_date,X\n2020-01-01,1.5\n2020-02-01,.\n2020-03-01,2').length===2&&rateDiff(ratesSrc,'GC=F',D0)===undefined);
 // COT: percentil ≥ 90 → short (kontra), ≤ 10 → long
 const cc=knownSignals('cot','90/10',bars(Array(40).fill(1)),{id:'EUR/USD',cotPct:t=>((t-D0)/DAY)%3===0?95:((t-D0)/DAY)%3===1?5:50});
 check('COT: percentil 95 → −1, 5 → +1, 50 → nic',cc.ent[2]===-1&&cc.ent[0]===1&&cc.ent[1]===0,[...cc.ent.slice(0,3)]);
 check('COT percentil: 3 roky, aspoň 104 týdnů, rank ≤',percentileSeries([1,2,3],3,3)[2]===100&&percentileSeries([1,2,3],3,3)[1]===null&&Math.abs(percentileSeries([3,2,1],3,3)[2]-100/3)<1e-9);
 const cot={EUR:{group:'leveraged',rows:Array.from({length:200},(_,k)=>({date:new Date(Date.UTC(2010,0,5)+k*7*DAY).toISOString().slice(0,10),openInterest:100,groups:{leveraged:{long:50+(k%10),short:50,net:k%10}}}))},
  USD:{group:'leveraged',proxy:true,rows:[]}};
 const pf=cotPctForInstrument(cot,'EUR/USD'),pr=cotPctForInstrument(cot,'USD/CHF');
 const t150=Date.UTC(2010,0,5)+150*7*DAY;
 check('COT: řádek platí až po zveřejnění (úterý + 6 d 21:00), USD index jako proxy se nepoužije',pf&&pf(t150)===undefined===false&&pf(t150+6*DAY)!==undefined&&pf(t150+6*DAY+21*3600000)!==undefined&&pr===null);
 // sezonalita: březen každý rok +5 %, ostatní měsíce mírně dolů → +1 na první svíčce března, až po 10 letech
 const sb=[];let px=100;for(let i=0;i<16*365;i++){const d=new Date(sweepDay(D0+i*DAY)*DAY);px*=d.getUTCMonth()===2?1.0016:.99985;sb.push(px)}
 const sbar=bars(sb),ss=knownSignals('season','10y',sbar,{id:'EUR/USD'}),sst=monthStarts(sbar.t);
 const marchStarts=[...ss.ent].map((x,i)=>sst[i]&&new Date(sweepDay(sbar.t[i])*DAY).getUTCMonth()===2?i:-1).filter(i=>i>=0);
 const yearOf=i=>new Date(sweepDay(sbar.t[i])*DAY).getUTCFullYear();
 check('sezonalita: +1 v březnu až když je 10 předchozích celých let, jinak 0',marchStarts.every(i=>ss.ent[i]===(yearOf(i)-2000>=10?1:0))&&marchStarts.some(i=>ss.ent[i]===1),marchStarts.map(i=>[yearOf(i),ss.ent[i]]));
 check('sezonalita: výstup na začátku dalšího měsíce',(()=>{const i=marchStarts.find(j=>ss.ent[j]===1),n=[...sst].findIndex((x,k)=>k>i&&x===1);return ss.exL[n]===1})());
}

// ---- 3) simulace: vstup na open další svíčky, SL = −1 R, výstup signálem na open, IS/OOS, náhoda deterministická
{
 const n=60,t=Array.from({length:n},(_,i)=>Date.UTC(2015,0,5)+i*DAY);
 const mk=(id,c)=>({id,kind:'fx',hs:0,n,t:Float64Array.from(t),day:Int32Array.from(t,x=>sweepDay(x)),o:Float64Array.from(c),h:Float64Array.from(c,x=>x*1.001),l:Float64Array.from(c,x=>x*.999),c:Float64Array.from(c),
  atr:new Float64Array(n).fill(.01),g20:new Float64Array(n),g50:new Float64Array(n),trend:new Float64Array(n),score:new Float64Array(n),ext:new Float64Array(n),cot:false});
 const c=Array(n).fill(1);for(let i=11;i<n;i++)c[i]=1+(i-10)*.002;
 const M=mk('EUR/USD',c),ctx=buildContext([M],{from:'2015-01-05',split:'2015-02-01'});
 const sig={ent:new Int8Array(n),exL:new Uint8Array(n),exS:new Uint8Array(n),str:new Float64Array(n)};sig.ent[10]=1;sig.exL[20]=1;
 const r=simulateKnown(ctx,[sig],{slAtr:2,hold:60,set:'fx'},{trades:true}),tr=r.trades[0];
 check('simulace: vstup na open svíčky po signálu, výstup signálem na open další svíčky',r.trades.length===1&&tr.entryBar===11&&tr.exitBar===21&&tr.reason==='signal'&&Math.abs(tr.r-(c[21]-c[11])/.02)<1e-9,tr);
 const s2={...sig,exL:new Uint8Array(n)},c2=[...c];c2[15]=.97;const M2=mk('EUR/USD',c2),r2=simulateKnown(buildContext([M2],{from:'2015-01-05',split:'2015-02-01'}),[s2],{slAtr:2,hold:60,set:'fx'},{trades:true});
 check('simulace: gap přes SL = výstup za open (horší než −1 R)',r2.trades[0].reason==='sl'&&r2.trades[0].r<-1,r2.trades[0]);
 const r3=simulateKnown(ctx,[{...sig,exL:new Uint8Array(n)}],{slAtr:2,hold:5,set:'fx'},{trades:true});
 check('simulace: časový limit po 5 svíčkách',r3.trades[0].reason==='time'&&r3.trades[0].exitBar===16,r3.trades[0]);
 check('simulace: IS/OOS podle data vstupu',r.is.n===1&&r.oos.n===0);
 const f1=knownFlips([sig],5),f2=knownFlips([sig],5);
 check('náhodné směry: deterministické se seedem, jedna hodnota na epizodu',f1[0].every((x,i)=>x===f2[0][i])&&f1[0][10]!==0);
 check(`grid: ${KNOWN_SIZE} kombinací, index ↔ kombinace, sousedé ve stejné rodině`,KNOWN_SIZE===KNOWN_COMBOS.length&&KNOWN_COMBOS.every((c,i)=>knownIndex(c)===i)&&knownNeighbours(0).every(j=>KNOWN_COMBOS[j].family===KNOWN_COMBOS[0].family&&KNOWN_COMBOS[j].set===KNOWN_COMBOS[0].set));
 // celý běh nad syntetikou: stejný seed = stejný výsledek, carry bez sazeb přeskočen s důvodem
 const big=['EUR/USD','GBP/USD','GC=F'].map((id,k)=>{const cl=W.slice(k*300,k*300+4000);const tt=cl.map((_,i)=>Date.UTC(2010,0,4)+i*DAY);
  return {...mk(id,cl),n:cl.length,t:Float64Array.from(tt),day:Int32Array.from(tt,x=>sweepDay(x)),o:Float64Array.from(cl),h:Float64Array.from(cl,x=>x*1.003),l:Float64Array.from(cl,x=>x*.997),c:Float64Array.from(cl),atr:new Float64Array(cl.length).fill(.6),kind:id.includes('/')?'fx':'commodities'}});
 const bctx=buildContext(big,{to:Date.UTC(2020,0,1)}),data={sig:(f,v)=>bctx.markets.map(m=>knownSignals(f,v,m,{id:m.id,cotPct:cotFn,rates:null}))};
 const A=runKnown(bctx,data,{shuffles:3,seed:9,now:0,skip:{carry:'Carry přeskočeno: bez sazeb.'}}),B=runKnown(bctx,data,{shuffles:3,seed:9,now:0,skip:{carry:'Carry přeskočeno: bez sazeb.'}});
 check('celý běh: deterministický (stejný seed = stejné řádky i hranice náhody)',JSON.stringify(A.rows)===JSON.stringify(B.rows)&&JSON.stringify(A.families.map(f=>f.chance))===JSON.stringify(B.families.map(f=>f.chance)));
 check('celý běh: carry přeskočeno s důvodem, ostatní rodiny mají kombinace',A.families.find(f=>f.id==='carry').skipped.includes('bez sazeb')&&A.families.filter(f=>f.id!=='carry').every(f=>f.combos.length>0));
 check('celý běh: robustní ⇒ IS i OOS > 0 a OOS ≥ 30 obchodů',A.rows.every(r=>!r.robust||(r.is.avgR>0&&r.oos.avgR>0&&r.oos.trades>=30&&r.nb>0)));
}

// ---- 4) genom: meze a validace
{
 const r=mulberry32(1),gs=Array.from({length:500},()=>randomGenome(r));
 check('genom: 500 náhodných projde validací (kanonický tvar)',gs.every(g=>{const v=validateGenome(g);return v.ok&&genomeKey(v.genome)===genomeKey(g)}),gs.find(g=>!validateGenome(g).ok));
 const g=gs.find(x=>x.family==='score');
 const bad=[{...g,threshold:85},{...g,threshold:47},{...g,slAtr:5},{...g,riskPct:1.2},{...g,riskPct:.3},{...g,maxOpen:9},{...g,hold:7},{...g,set:'stocks'},{...g,family:'x'},{...g,family:'carry',v:'diff1',set:'all'},{...g,family:'cot',v:'90/10',set:'crypto'},{...g,family:'rsi',v:'rsi9'},{...g,family:'donchian',v:'20/10',entry:'pullback'},{...g,corrCap:1},null];
 check('genom: mimo meze / nedovolené kombinace odmítnuty',bad.every(b=>!validateGenome(b).ok),bad.map(b=>validateGenome(b).ok));
 check('genom: riziko 0,5–1 %, SL 1–4 ATR, max pozic 2–8',GENOME_BOUNDS.riskPct.min===.5&&GENOME_BOUNDS.riskPct.max===1&&GENOME_BOUNDS.slAtr.min===1&&GENOME_BOUNDS.maxOpen.max===8);
 check('genom: kanonický tvar – nepoužité geny nemění klíč',genomeKey({...g,family:'donchian',v:'20/10',entry:'immediate',threshold:30})===genomeKey({...g,family:'donchian',v:'20/10',entry:'immediate',threshold:70}));
 check('id agentů: G01…G999, S01…S20 dál platí, jiné ne',isAgentVariant('G01')&&isAgentVariant('G20')&&isAgentVariant('G100')&&!isAgentVariant('G00')&&!isAgentVariant('G1')&&!isAgentVariant('G1000')&&isVariantId('G07')&&isVariantId('S20')&&!isVariantId('S21')&&SWEEP_VARIANT_IDS.length===20&&isSweepVariant('S01')&&!isSweepVariant('G01'));
 check('id agentů: další id za nejvyšším (i archivovaným), nikdy znovu',nextAgentIds(['G01','G20','G05','A','S01'],3).join()==='G21,G22,G23'&&agentId(7)==='G07'&&agentId(120)==='G120');
 check('krypto trhy agentů = krypto v lib/markets',AGENT_CRYPTO.join()===instruments.filter(i=>i.group==='crypto').map(i=>i.id).join());
}

// ---- 5) mutace: v mezích, deterministická, malá
{
 const r=mulberry32(3);let ok=true,small=true,bad=null;
 for(let k=0;k<2000;k++){const p=randomGenome(r),m=mutateGenome(p,k*13+1),v=validateGenome(m.genome);if(!v.ok){ok=false;bad={p,m};break}if(m.changes.length>2)small=false}
 check('mutace: 2000 mutací zůstane v mezích (validace)',ok,bad);
 check('mutace: nejvýš 2 změněné geny',small);
 const p=randomGenome(mulberry32(11),'score'),a=mutateGenome(p,42),b=mutateGenome(p,42),c=mutateGenome(p,43);
 check('mutace: stejný seed = stejný potomek, jiný seed jinak',JSON.stringify(a)===JSON.stringify(b)&&JSON.stringify(a.genome)!==JSON.stringify(c.genome)||JSON.stringify(a.changes)!==JSON.stringify(c.changes));
 const taken=new Set([genomeKey(p)]),u=mutateUnique(p,5,taken);
 check('mutace: potomek se liší od rodiče a existujících',u&&!taken.has(genomeKey(u.genome))&&u.changes.length>0);
 check('mutace: číselný gen jen o 1–2 kroky',(()=>{for(let s=0;s<500;s++){const m=mutateGenome({...p,family:'score'},s);for(const ch of m.changes){const [k,rest]=ch.split(': ');if(k in GENOME_BOUNDS){const [x,y]=rest.split(' → ').map(Number);if(Math.abs(x-y)>2*GENOME_BOUNDS[k].step+1e-9)return false}}}return true})());
 check('seed evoluce: deterministický podle generace, rodiče a pořadí',evolutionSeed(3,'G05',0)===evolutionSeed(3,'G05',0)&&evolutionSeed(3,'G05',0)!==evolutionSeed(4,'G05',0));
}

// ---- 6) fitness a pravidla vyřazení / evoluce
{
 check('fitness = týden R + 0,5 × průměr R × √n − 0,2 × (DD % nad 5)',Math.abs(fitnessOf({weekR:2,avgR:.4,trades:16,maxDdPct:-10})-1.8)<1e-9&&fitnessOf({weekR:-1,avgR:null,trades:0,maxDdPct:-3})===-1);
 check('vyřazení: nikdy < 8 obchodů (ani s průměrem −1 R), ani < 20',!canKill({trades:7,avgR:-1})&&!canKill({trades:19,avgR:-.5})&&canKill({trades:20,avgR:-.11})&&!canKill({trades:40,avgR:-.1}));
 const G=(id,o={})=>({id,active:true,trades:30,weekR:0,totalR:0,avgR:.1,maxDdPct:-2,genome:randomGenome(mulberry32(agentNumOf(id))),gen:0,parent:null,...o});
 const agentNumOf=id=>Number(id.slice(1));
 const pop=Array.from({length:20},(_,i)=>G(agentId(i+1),{weekR:i/10,avgR:i<3?-.5:.1,trades:i<3?25:30}));
 pop[4]={...pop[4],trades:5,avgR:-2,weekR:-5}; // učí se – nevyřaditelný
 const plan=planEvolution(pop,{gen:1,allIds:pop.map(a=>a.id)});
 check('evoluce: plná populace → potomci jen místo vyřazených (3 vyřaditelní)',plan.children.length===3&&plan.retire.length===3&&plan.retire.every(r=>['G01','G02','G03'].includes(r.agent)),plan);
 check('evoluce: agent s < 8 obchody se nevyřadí',!plan.retire.some(r=>r.agent==='G05'));
 check('evoluce: rodiče = top 3 podle fitness, potomci mají nová id a rodiče',plan.children.map(c=>c.parent).join()==='G20,G19,G18'&&plan.children.map(c=>c.id).join()==='G21,G22,G23',plan.children.map(c=>[c.id,c.parent]));
 const after=pop.filter(a=>!plan.retire.some(r=>r.agent===a.id)).length+plan.children.length;
 check('evoluce: nejvýš 20 aktivních',after<=MAX_ACTIVE_AGENTS,after);
 const safe=pop.map(a=>({...a,avgR:.2}));const p2=planEvolution(safe,{gen:2,allIds:safe.map(a=>a.id)});
 check('evoluce: plno a nikdo vyřaditelný → žádný potomek ani archiv',p2.children.length===0&&p2.retire.length===0&&p2.notes.length>0);
 const few=pop.slice(0,15).map(a=>({...a,avgR:.2}));const p3=planEvolution(few,{gen:2,allIds:pop.map(a=>a.id)});
 check('evoluce: volná místa → potomci bez vyřazení, id za nejvyšším (i archivovaným)',p3.children.length===3&&p3.retire.length===0&&p3.children[0].id==='G21');
 const learners=pop.map(a=>({...a,trades:5}));const p4=planEvolution(learners,{gen:2,allIds:pop.map(a=>a.id)});
 check('evoluce: rodič potřebuje ≥ 8 obchodů a fitness > 0',p4.children.length===0);
 const keys=new Set(pop.map(a=>genomeKey(a.genome)));
 check('evoluce: potomek nekoliduje s genomem aktivního agenta',plan.children.every(c=>!keys.has(genomeKey(c.genome))));
 check('evoluce: deterministická',JSON.stringify(planEvolution(pop,{gen:1,allIds:pop.map(a=>a.id)}))===JSON.stringify(plan));
 // počáteční populace
 const sp=seedPopulation({sweep:[{threshold:50,entry:'immediate',slAtr:1.5,exit:'tp2',hold:10,corrCap:true,cooldown:false,set:'fx'}],known:KNOWN_FAMILIES.map(f=>({combo:KNOWN_COMBOS.find(c=>c.family===f.id),robust:f.id==='donchian'}))},42);
 check('populace: 20 agentů, unikátní genomy, všechny rodiny, platné',sp.length===20&&new Set(sp.map(a=>genomeKey(a.genome))).size===20&&['score',...KNOWN_FAMILIES.map(f=>f.id)].every(f=>sp.some(a=>a.genome.family===f))&&sp.every(a=>validateGenome(a.genome).ok));
 check('populace: ze sweepu a známých strategií + náhodní, s původem',sp[0].origin.includes('Hledání prahů')&&sp.some(a=>a.origin.includes('známá strategie Donchian')&&a.origin.includes('robustní'))&&sp.some(a=>a.origin.includes('náhodný')));
 check('populace: deterministická se seedem',JSON.stringify(seedPopulation({sweep:[],known:[]},5))===JSON.stringify(seedPopulation({sweep:[],known:[]},5)));
 check('převody: sweep → genom, známá → genom',sweepToGenome({threshold:60,entry:'contra',slAtr:2,exit:'signal',hold:20,corrCap:false,cooldown:true,set:'ci'}).exit==='signal'&&knownToGenome(KNOWN_COMBOS.find(c=>c.family==='tsmom')).hold===260);
}

// ---- 7) agent v simulaci: technický vstup, výstupy, archiv jen dobíhá, neměnnost
{
 const NOW=Date.UTC(2026,9,14,12),d1=[];let px=1;
 for(let i=120;i>=1;i--){const t=Date.UTC(2026,9,14)-i*DAY;px=i===1?1.05:1;d1.push({t,o:px,h:px*1.001,l:px*.999,c:px})} // poslední dokončená svíčka (13. 10.) = průraz
 const g=validateGenome({family:'donchian',v:'20/10',threshold:50,entry:'immediate',slAtr:2,exit:'signal',tpR:2,trailAtr:2.5,hold:20,set:'fx',corrCap:true,cooldown:false,maxOpen:5,riskPct:.5}).genome;
 const V=agentVariant('G01',g),q={'EUR/USD':{price:1.05,marketTime:NOW-60000}};
 const step=paperStep({now:NOW,startEquity:100000,trades:[],signals:{},quotes:q,d1:{'EUR/USD':d1},news:[],variant:V});
 const t=step.opens[0];
 check('agent Donchian: průraz na poslední dokončené svíčce → long, id a pravidla agenta, riziko 0,5 %',t&&t.direction==='long'&&t.id.startsWith('pG01')&&t.variant==='G01'&&t.rulesVersion==='agent-G01-v1'&&t.riskCzk===500&&t.why.includes('Donchian'),step);
 check('agent: rules z genomu (bez TP, trailing 0, max pozic, skupiny)',V.rules.tpAtr===0&&V.rules.trailAtr===0&&V.rules.maxOpen===5&&V.rules.minScore===101&&V.rules.signalExit===false&&V.kind==='agent');
 const none=paperStep({now:NOW,startEquity:100000,trades:[],signals:{},quotes:q,d1:{'EUR/USD':d1},news:[],variant:V,noEntries:true});
 check('archivovaný agent (noEntries): žádný nový vstup',none.opens.length===0);
 // výstup signálem strategie: příznak jen ze svíček zavřených PO vstupu; checkExit s forceExit → „signal“ za živou cenu
 const d2=[...d1,{t:d1[d1.length-1].t+DAY,o:1.05,h:1.05,l:.9,c:.9}];
 const kAfter=knownLive('donchian','20/10',d2,NOW+2*DAY,{id:'EUR/USD'},NOW),kBefore=knownLive('donchian','20/10',d1,NOW+DAY-1,{id:'EUR/USD'},NOW);
 check('agent: výstupní příznak strategie jen ze svíčky zavřené po vstupu',kAfter.exitLong===true&&kBefore.exitLong===false,[kAfter,kBefore]);
 const fx=checkExit(t,{now:NOW+DAY,quote:{price:1.049,marketTime:NOW+DAY-60000},rules:V.rules,forceExit:true});
 check('agent: forceExit → výstup „signal“ za živou cenu (nad SL)',fx&&fx.exitReason==='signal'&&fx.exit<1.049,fx);
 const ex=paperStep({now:NOW+2*DAY,startEquity:100000,trades:[{...t}],signals:{},quotes:{'EUR/USD':{price:1.049,marketTime:NOW+2*DAY-60000}},d1:{'EUR/USD':d2},news:[],variant:V,noEntries:true});
 check('agent v kroku simulace: výstup signálem strategie',ex.closes[0]?.exitReason==='signal'&&ex.closes[0].resultNote.includes('výstupní signál'),ex.closes);
 // trailing stop: SL nikdy horší než původní, posun z nejlepší ceny před svíčkou
 const tt={id:'x',instrument:'EUR/USD',direction:'long',opened:NOW,entry:1,sl:.98,tp:0,riskCzk:1000,confidence:50,scoreAtEntry:0,partsAtEntry:{method:'',coverage:0,alignment:0,freshness:0,atr:.01,parts:[]},why:'',closed:null,exit:null,exitReason:null,r:null,pnlCzk:null,pct:null,scoreAtExit:null,resultNote:null,rulesVersion:'agent-G02-v1'};
 const R=agentRules({...g,exit:'trail',trailAtr:2});
 const h1=[{t:NOW+3600000,h:1.05,l:1.0,c:1.04},{t:NOW+7200000,h:1.04,l:1.025,c:1.03}];
 const e1=checkExit(tt,{now:NOW+3*3600000,h1,rules:R});
 check('trailing: po maximu 1,05 stop 1,03 (2 × ATR 0,01) → výstup 1,03 = +1,5 R',e1&&e1.exitReason==='trail'&&Math.abs(e1.exit-1.03)<1e-12&&Math.abs(e1.r-1.5)<1e-9,e1);
 check('trailing: ve svíčce maxima se stop z nového maxima nepoužije (konzervativně)',checkExit(tt,{now:NOW+2*3600000,h1:[{t:NOW+3600000,h:1.05,l:1.031,c:1.04}],rules:R})===null);
 check('trailing vypnutý = původní SL',checkExit(tt,{now:NOW+3*3600000,h1,rules:{...R,trailAtr:0}})===null);
 check('neměnnost: rules_version agenta pevná, stejný genom = stejná pravidla',agentVariant('G01',g).rulesVersion==='agent-G01-v1'&&JSON.stringify(agentVariant('G01',g).rules)===JSON.stringify(V.rules));
 // obchodní hodiny: agent v sobotu (Yahoo kotuje FX orientačně) neotevře ani nezavře
 const SAT=Date.UTC(2026,9,17,12),dSat=d1.map(b=>({...b,t:b.t+3*DAY})),qSat={'EUR/USD':{price:1.05,marketTime:SAT-60000}};
 const wk=paperStep({now:SAT,startEquity:100000,trades:[],signals:{},quotes:qSat,d1:{'EUR/USD':dSat},news:[],variant:V});
 check('agent v sobotu: žádný vstup (zavřený trh), ve středu ano',wk.opens.length===0&&wk.skipped[0]?.reason==='trh je zavřený (obchodní hodiny)'&&step.opens.length===1,wk.skipped);
 const wkx=paperStep({now:SAT,startEquity:100000,trades:[{...t}],signals:{},quotes:{'EUR/USD':{price:.9,marketTime:SAT-60000}},d1:{'EUR/USD':d2},news:[],variant:V,noEntries:true});
 check('agent v sobotu: ani SL podle orientační ceny, ani výstupní signál',wkx.closes.length===0,wkx.closes);
}

// ---- 8) úložiště: neměnnost, archiv místo mazání, user_id; migrace 0030
{
 const store=src('lib/lab/agents-store.ts');
 check('store: agent jen INSERT IGNORE + chyba, když už existuje (pravidla se nepřepíšou)',/INSERT IGNORE INTO lab_paper_accounts[\s\S]*if\(!r\.meta\.changes\)throw Error/.test(store)&&!/UPDATE lab_paper_accounts SET[^'`]*rules/.test(store));
 check('store: archivace = UPDATE active=0, nic se nemaže',/UPDATE lab_paper_accounts SET active=0,updated=\? WHERE user_id=\? AND variant=\? AND active=1/.test(store)&&!/DELETE/i.test(store));
 check('store: všechny dotazy filtrují user_id',[...store.matchAll(/(?:FROM|UPDATE|INTO) (lab_\w+)[^'`]*/g)].every(m=>/user_id/.test(m[0])),[...store.matchAll(/(?:FROM|UPDATE|INTO) (lab_\w+)[^'`]*/g)].map(m=>m[0]).filter(x=>!/user_id/.test(x)));
 const ks=src('lib/lab/known-store.ts');
 check('known store: user_id všude, drží 10',[...ks.matchAll(/(?:FROM|UPDATE|INTO) lab_known[^'`]*/g)].every(m=>/user_id/.test(m[0]))&&/KNOWN_KEEP=10/.test(ks));
 const ps=src('lib/lab/paper-store.ts');
 check('restart agenta zakázán (resetPaper), odebrání jen S…',/isAgentVariant\(variant\)\)throw Error/.test(ps)&&/removeSweepVariant[\s\S]{0,120}if\(!isSweepVariant\(variant\)\)throw/.test(ps));
 // falešná DB: druhé založení stejného id = chyba, archivace nic nemaže
 const sqls=[];let exists=false;
 const fake={prepare:s=>({bind:(...a)=>({run:async()=>{sqls.push(s);if(s.startsWith('INSERT IGNORE INTO lab_paper_accounts')){const c=exists?0:1;exists=true;return {meta:{changes:c}}}if(s.startsWith('UPDATE lab_paper_accounts SET active=0'))return {meta:{changes:1}};return {meta:{changes:1}}},first:async()=>null,all:async()=>({results:[]})})})};
 const as=await import('../lib/lab/agents-store.ts');const g=randomGenome(mulberry32(2));
 await as.createAgent(fake,'u',Date.now(),'G01',g,{gen:0,parent:null,origin:'test',reason:'test'});
 let threw=false;try{await as.createAgent(fake,'u',Date.now(),'G01',randomGenome(mulberry32(3)),{gen:1,parent:null,origin:'test',reason:'test'})}catch{threw=true}
 await as.retireAgent(fake,'u',Date.now(),'G01',{gen:1,genome:g,reason:'test',fitness:-1});
 check('neměnnost: druhé založení G01 selže, archivace je UPDATE + log, žádný DELETE',threw&&sqls.some(s=>s.startsWith('INSERT INTO lab_evolution'))&&!sqls.some(s=>/DELETE/i.test(s)));
 let rt=false;try{const {resetPaper}=await import('../lib/lab/paper-store.ts');await resetPaper(fake,'u',Date.now(),'G01')}catch(e){rt=/neměnné|nejde/.test(e.message)}
 check('resetPaper(G01) vyhodí chybu',rt);
 const sql=src('drizzle/mariadb/0030_lab_agents.sql');
 const stm=sql.split('--> statement-breakpoint').map(x=>x.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').trim()).filter(Boolean);
 check('migrace 0030: lab_known + lab_evolution s user_id, jeden příkaz mezi breakpointy',stm.length===2&&stm.every(x=>(x.match(/;/g)||[]).length===1&&/user_id VARCHAR\(128\) NOT NULL/.test(x))&&/lab_evolution\([\s\S]*gen INT[\s\S]*agent VARCHAR\(4\)[\s\S]*parent VARCHAR\(4\) NULL[\s\S]*genome LONGTEXT[\s\S]*action VARCHAR\(16\)[\s\S]*reason TEXT[\s\S]*fitness DOUBLE/.test(sql));
}

// ---- 9) přístup: nové routy jen vlastník (404 i admin), jen GET bez vedlejších efektů; paper route agenty nerestartuje
{
 for(const r of ['known','agents']){
  const U='https://tradee.eu/api/laborator/'+r;
  check(`/api/laborator/${r}: admin, člen i nepřihlášený → 404, vlastník ano, ?as= cizí → 404`,[{id:'a',role:'admin',owner:false},{id:'m',role:'member',owner:false},null].every(u=>labGate(u,U).status===404)&&labGate({id:'o',role:'admin',owner:true},U).id==='o'&&labGate({id:'o',role:'admin',owner:true},U+'?as=x').status===404);
  const s=src(`app/api/laborator/${r}/route.ts`),h=s.split(/export async function /).slice(1);
  check(`route ${r}: jen GET a začíná labUser (404)`,h.length===1&&/^GET\(req:Request\)\{try\{const u=await labUser\(req\);if\(u instanceof Response\)return u;/.test(h[0])&&!/INSERT|UPDATE|DELETE|createAgent|retireAgent/.test(s));
 }
 const pr=src('app/api/laborator/paper/route.ts');
 check('paper route: agenta nejde restartovat ani odebrat',/if\(isAgentVariant\(variant\)\)throw Error/.test(pr)&&pr.indexOf('isAgentVariant(variant)')<pr.indexOf("b.action==='reset'"));
 const page=src('app/laborator/page.tsx');
 check('stránka Laboratoř: jen vlastník (notFound)',/if\(!labAllowed\(u\)\)notFound\(\)/.test(page));
 const lp=src('scripts/lab-paper.mjs');
 check('runner: agenti běží každých 15 min (agentVariantsOf), archivovaný jen dobíhá, maily jednotlivých obchodů agentů ne',/agentVariantsOf\(accs\)/.test(lp)&&/noEntries:!!winding/.test(lp)&&/filter\(V=>!isAgentVariant\(V\.id\)\)/.test(lp));
}

// ---- 10) report pro analytika, verdikt, AI analytik jen čte
{
 const NOW=Date.UTC(2026,9,18,16,30),g=randomGenome(mulberry32(4),'keltner');
 const tr=(o)=>({id:'t'+Math.random(),instrument:'EUR/USD',direction:'long',opened:NOW-3*DAY,entry:1,sl:.99,tp:0,riskCzk:1000,confidence:50,scoreAtEntry:0,partsAtEntry:{method:'',coverage:0,alignment:0,freshness:0,atr:.01,parts:[]},why:'Proč: průraz Keltnera',closed:NOW-DAY,exit:1.02,exitReason:'signal',r:2,pnlCzk:2000,pct:2,scoreAtExit:null,resultNote:'Výstup signálem',rulesVersion:'agent-G01-v1',variant:'G01',...o});
 const ts=[tr({}),tr({r:-1,pnlCzk:-1000,why:'Proč: nejhorší obchod',instrument:'GBP/USD'}),tr({closed:NOW-40*DAY,opened:NOW-45*DAY,r:.5,pnlCzk:500})];
 const a=agentRow({id:'G01',active:true,genome:g,meta:{gen:0,parent:null,origin:'test'},started:NOW-30*DAY,rulesVersion:'agent-G01-v1',startEquity:100000,trades:ts,equity:[{t:NOW-8*DAY,equity:100400}],openPnl:0},NOW);
 const b=agentRow({id:'G02',active:false,genome:randomGenome(mulberry32(5)),meta:{gen:1,parent:'G01',origin:'evoluce'},started:NOW-10*DAY,rulesVersion:'agent-G02-v1',startEquity:100000,trades:[],equity:[],openPnl:0},NOW);
 check('řádek agenta: týden R jen z obchodů uzavřených za 7 dní, P&L z křivky, učí se < 8',a.weekR===1&&a.weekTrades===2&&a.weekPnl===1500-400&&a.learning&&a.fitness===fitnessOf({weekR:1,avgR:a.stats.avgR,trades:3,maxDdPct:a.stats.maxDrawdownPct}),a);
 const md=buildAgentReport({now:NOW,agents:[a,b],trades:{G01:ts},evolution:[{gen:1,at:NOW,agent:'G02',parent:'G01',genome:null,action:'clone',reason:'potomek G01',fitness:null}],
  known:{created:'2026-10-18',rows:[{family:'donchian',label:'Donchian',skipped:null,key:JSON.stringify(KNOWN_COMBOS[0]),robust:true,beatsChance:true,isAvg:.1,oosAvg:.4,oosN:98,oosPf:1.6,oosDd:-15,chance:.2}]},
  sweep:null,variants:[{id:'A',name:'Základní',stats:a.stats,started:NOW-90*DAY}],open:[]});
 check('report: žebříček, archiv, nejlepší/nejhorší s „proč“, evoluce, známé strategie, varianty',['## Žebříček aktivních agentů (1)','G01 (učí se)','## Archivovaní agenti (1)','Proč: průraz Keltnera','Proč: nejhorší obchod','clone G02','Donchian','## Varianty simulace','Sweep ještě neproběhl'].every(x=>md.includes(x)),md.slice(0,600));
 check('report: obchody starší 30 dní se do „nejlepších“ nepočítají',!md.includes('+0,5 R · signal'));
 const bad=tr({id:'void1',instrument:'GBP/CAD',r:5,pnlCzk:5000,why:'Proč: víkendový obchod',voidReason:'zavřený trh při vstupu'});
 const av=agentRow({id:'G01',active:true,genome:g,meta:{gen:0,parent:null,origin:'test'},started:NOW-30*DAY,rulesVersion:'agent-G01-v1',startEquity:100000,trades:[...ts,bad],equity:[{t:NOW-8*DAY,equity:100400}],openPnl:0},NOW);
 check('void: fitness, týden i statistiky agenta bez neplatných obchodů',av.weekR===a.weekR&&av.weekTrades===a.weekTrades&&av.fitness===a.fitness&&JSON.stringify(av.stats)===JSON.stringify(a.stats),[av.weekR,av.stats]);
 const mdv=buildAgentReport({now:NOW,agents:[av],trades:{G01:[...ts,bad]},evolution:[],known:null,sweep:null,variants:[],open:[{...bad,closed:null}]});
 check('void: report analytika bez neplatných (nejlepší obchody, otevřené pozice)',!mdv.includes('víkendový obchod')&&mdv.includes('## Otevřené pozice (0)'),mdv.slice(0,400));
 check('shrnutí pro AI: krátký blok agentů',agentsSummaryMd([a,b],[]).includes('## Populace agentů')&&agentsSummaryMd([],[])==='');
 check('verdikt: řádek „**Verdikt:** …“, jinak první odstavec, max 600 znaků',analysisVerdict('# Nadpis\n**Verdikt:** Trend vede, reverze ztrácí.\n\n## Co funguje')==='Trend vede, reverze ztrácí.'&&analysisVerdict('## Verdikt\nNic moc.')==='Nic moc.'&&analysisVerdict('Prostý text.\nDalší')==='Prostý text.'&&analysisVerdict('x'.repeat(900)).length===598);
 check('název poznámky analýzy s datem (Praha)',analysisTitle(NOW)==='Týdenní analýza agentů 2026-10-18');
 const py=src('scripts/lab-analyst.py');
 check('analytik: claude -p smí jen číst report.md (bez Bash/Write/Edit/webu), dontAsk, JSON',/return \[f'Read\(\/\{work\}\/report\.md\)'\]/.test(py)&&['Bash','Write','Edit','WebSearch','WebFetch'].every(t=>py.includes(`'${t}'`))&&py.includes("'--permission-mode', 'dontAsk'")&&py.includes("'--output-format', 'json'")&&/NIC nemění|nic neměň/.test(py));
 check('analytik: prompt česky – co funguje, proč, statistická opatrnost, hypotézy, mutace, nic nemění',['Co funguje','Co nefunguje','Statistická opatrnost','Hypotézy na příští týden','Mutace k vyzkoušení','Nic sám neměníš','**Verdikt:**'].every(x=>py.includes(x)));
 check('analytik: běh jen v neděli 18 h Praha (cron 16:30 a 17:30 UTC)',/p\.weekday\(\) == 6 and p\.hour == 18/.test(py)&&py.includes("ZoneInfo('Europe/Prague')"));
 const save=src('scripts/lab-analyst-save.mjs');
 check('uložení: poznámka vlastníka + shrnutí pro AI + mail jen vlastníkovi',/createNote\(d,owner\.id/.test(save)&&/refreshSummary\(d,owner\.id\)/.test(save)&&(save.match(/to:\[/g)||[]).length===1&&save.includes('to:[owner.email]')&&save.indexOf('if(dry)')<save.indexOf('api.resend.com'));
 const ev=src('scripts/lab-evolve.mjs');
 check('evoluce skript: neděle 18 h Praha, duplicita v týdnu, --seed jen bez agentů',ev.includes("timeZone:'Europe/Prague'")&&/wd==='Sun'&&hour===18/.test(ev)&&/now-last\.at<20\*3600000/.test(ev)&&/if\(!agents\.length\)\{/.test(ev)&&!/DELETE/i.test(ev));
}

console.log(fails.length?`\n${fails.length} kontrol selhalo`:'\nVšechny kontroly agentů prošly.');
process.exit(fails.length?1:0);
