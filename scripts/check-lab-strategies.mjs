// Kontrola obecného enginu strategií (lib/lab/rules-def.ts, strat-blocks.ts, strat-engine.ts) na SYNTETICKÝCH řadách:
// každý blok + bez pohledu do budoucna (useknutí budoucích svíček nemění minulost), mitigace zón knotem / close, seance s letním časem,
// sweep → MSS, dvě nohy (strop rizika), částečný výstup + BE, náklady, limity portfolia, IS/OOS, hranice náhody, validace schématu,
// živá simulace agentů R…, jen vlastník u nových rout. Názvy strategií v testu jsou neutrální („zone-swing“, „sweep-reversal“).
// node --experimental-strip-types scripts/check-lab-strategies.mjs
import {readFileSync} from 'node:fs';
import * as B from '../lib/lab/strat-blocks.ts';
import {validateDef,parseDefJson,applyOverrides,defRuns,BLOCKS,BLOCK_IDS,defOutline} from '../lib/lab/rules-def.ts';
import {prepare,compile,simulate,splitOf,evaluate,isRobustRun,runStrategy,liveSetups,portfolioBlock,clockDeadline,mulberry32} from '../lib/lab/strat-engine.ts';
import {ruleVariant,paperStep,checkExit,isRuleVariant,isVariantId,RULE_VARIANT_IDS} from '../lib/lab/paper.ts';
import {labGate} from '../lib/lab/access.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,e=1e-9)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=e;
const H=3600000,DAY=86400000;
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
// náhodná procházka (deterministická)
function walk(n,seed,t0,step,vol=.004,p0=1.2){const r=mulberry32(seed);let p=p0;const out=[];
 for(let i=0;i<n;i++){const o=p;p=p*(1+(r()-.5)*vol*2);const c=p;out.push({t:t0+i*step,o,h:Math.max(o,c)*(1+r()*vol*.6),l:Math.min(o,c)*(1-r()*vol*.6),c})}return out}
const S=(bars,tf='D1')=>B.series(bars,tf);
const mk=(rows,t0=Date.UTC(2020,0,6),step=DAY)=>rows.map(([o,h,l,c],i)=>({t:t0+i*step,o,h,l,c}));
const sameF=(a,b,k)=>{for(let i=0;i<k;i++){const x=a[i],y=b[i];if(!(x===y||(Number.isNaN(x)&&Number.isNaN(y))))return i}return -1};
const sameOut=(a,b,k)=>{let i=sameF(a.L,b.L,k);if(i>=0)return 'L@'+i;i=sameF(a.S,b.S,k);if(i>=0)return 'S@'+i;
 for(const side of ['lvL','lvS'])for(const key of Object.keys(a[side])){i=sameF(a[side][key],b[side][key],k);if(i>=0)return side+'.'+key+'@'+i}
 if(a.unknown||b.unknown){i=sameF(a.unknown||[],b.unknown||[],k);if(i>=0)return 'unknown@'+i}return null};

// ======================= 1) vyšší TF a uzavřené svíčky
{
 const t0=Date.UTC(2024,0,8); // pondělí 00:00 UTC
 const h1=Array.from({length:12},(_,i)=>({t:t0+i*H,o:1,h:1+i/100,l:1,c:1+i/200}));
 const a=B.aggregate(h1,H,B.tfKey('H4','H1'));
 check('H4 z H1: koš 00–04 hotový až svíčkou 03:00, do té doby předchozí (−1)',a.bars.length===3&&a.done[0]===-1&&a.done[2]===-1&&a.done[3]===0&&a.done[4]===0&&a.done[7]===1&&a.bars[0].h===1.03&&a.bars[1].o===1,[...a.done]);
 // D1 z H1: den FX končí 17:00 New York (zima = 22:00 UTC)
 const d0=Date.UTC(2024,0,8,18),hh=Array.from({length:30},(_,i)=>({t:d0+i*H,o:1,h:1,l:1,c:1}));
 const ad=B.aggregate(hh,H,B.tfKey('D1','H1')),i21=hh.findIndex(b=>b.t===Date.UTC(2024,0,8,21));
 check('D1 z H1: svíčka 21:00–22:00 UTC (16–17 NY, zima) uzavře obchodní den',ad.done[i21]===ad.bucket[i21]&&ad.done[i21-1]===ad.bucket[i21]-1&&ad.bucket[i21+1]===ad.bucket[i21]+1);
 const s0=Date.UTC(2024,6,8,18),hs=Array.from({length:30},(_,i)=>({t:s0+i*H,o:1,h:1,l:1,c:1})),as=B.aggregate(hs,H,B.tfKey('D1','H1')),i20=hs.findIndex(b=>b.t===Date.UTC(2024,6,8,20));
 check('D1 z H1: v létě končí den už svíčkou 20:00–21:00 UTC (17:00 EDT)',as.done[i20]===as.bucket[i20]&&as.bucket[i20+1]===as.bucket[i20]+1);
 // W1 z D1 (Yahoo FX D1 v 22:00 UTC předchozího dne): pátek týden NEUZAVŘE, pondělí ano
 const fx=Array.from({length:12},(_,i)=>({t:Date.UTC(2024,0,7,22)+i*DAY,o:1,h:1,l:1,c:1})).filter(b=>{const w=new Date(b.t+2*H).getUTCDay();return w>0&&w<6});
 const aw=B.aggregate(fx,DAY,B.tfKey('W1','D1')),fri=fx.findIndex(b=>new Date(b.t+2*H).getUTCDay()===5),mon2=fri+1;
 check('W1 z D1: pátek týden neuzavře (−1), další pondělí ano (týden 0)',aw.done[fri]===-1&&aw.done[mon2]===0&&aw.bucket[mon2]===1,[...aw.done]);
 const mn=B.aggregate(walk(80,3,Date.UTC(2024,0,1,22),DAY),DAY,B.tfKey('MN','D1'));
 check('MN z D1: měsíc je hotový až svíčkou dalšího měsíce (31 dní jako délka)',B.TF_MS.MN===31*DAY&&mn.done[0]===-1&&mn.bars.length>=3);
}

// ======================= 2) swingy, trend, premium/discount, fib
{
 const rows=[[1,1.1,.9,1],[1,1.2,.95,1.1],[1.1,1.5,1.05,1.4],[1.4,1.3,1.1,1.2],[1.2,1.25,1.0,1.1],[1.1,1.15,.8,.9],[.9,1.1,.85,1],[1,1.2,.95,1.1],[1.1,1.7,1.05,1.6],[1.6,1.65,1.3,1.4],[1.4,1.5,1.2,1.3],[1.3,1.4,1.0,1.1],[1.1,1.3,1.05,1.2],[1.2,1.25,1.1,1.15]];
 const s=S(mk(rows)),sw=B.swings(s.h,s.l,2);
 const hi=sw.filter(x=>x.high).map(x=>x.i),lo=sw.filter(x=>!x.high).map(x=>x.i);
 check('fraktál N=2: swing high na 2 a 8, swing low na 5 a 11, potvrzení j+2',hi.join()==='2,8'&&lo.join()==='5,11'&&sw.every(x=>x.conf===x.i+2),sw);
 const st=B.structure(s,2);
 check('struktura: swing high 2 známý až od svíčky 4 (ne dřív)',Number.isNaN(st.hi[3])&&st.hi[4]===1.5);
 check('trend: HH (1,7 > 1,5) + HL (1,0 > 0,8) po potvrzení obou = +1',st.trend[12]===0&&st.trend[13]===1,[...st.trend]);
 check('premium/discount: pozice v rozsahu swingu',near(B.pdPosition(1.25,1.5,1),.5)&&B.pdPosition(1,1,1)===null);
 check('Fibonacci: 61,8 % býčího impulzu 1→2 = 1,382',near(B.fibLevel(2,1,.618,true),1.382)&&near(B.fibLevel(2,1,.618,false),1.618));
 check('kulaté číslo: nejbližší násobek kroku',B.nearestRound(1.10237,.005)===1.1&&B.nearestRound(1.1026,.005)===1.105);
}

// ======================= 3) zóny: vznik, mitigace knotem vs close, zneplatnění, vnoření
{
 // swing high (svíčka 2) potvrzený na 4, base svíčky 6–7 (malá těla), impulz 8 zavře nad swing high → poptávková zóna
 const rows=[[1,1.02,.98,1],[1,1.04,.99,1.03],[1.03,1.1,1.02,1.08],[1.08,1.09,1.0,1.02],[1.02,1.04,.97,.99],[.99,.995,.955,.96],[.97,.985,.955,.968],[.968,.98,.958,.972],[.972,1.2,.97,1.18],
  [1.18,1.19,1.10,1.12],[1.12,1.13,.966,1.05],[1.05,1.06,.99,1.0],[1.0,1.01,.94,.95]];
 const s=S(mk(rows)),z=B.findZones(s,{impulseK:1,atrPeriod:3,swingN:2,requireBreak:true,proximal:'body',maxBase:3,baseBodyRatio:.6},'zone');
 const dz=z.find(x=>x.side===1);
 check('zóna: impulz s průrazem swing high → poptávka z base svíček 6–7 (proximal = horní tělo .972, distal = low .955)',!!dz&&dz.created===8&&dz.baseFrom===6&&dz.baseTo===7&&near(dz.proximal,.972)&&near(dz.distal,.955),z);
 const pct=(i,m)=>B.trackZone(dz,s,i,{mitigation:m,invalidate:'close',maxMitigationPct:30});
 check('svíčka 9 nad zónou → čerstvá',pct(9,'wick').status==='fresh');
 const w=pct(10,'wick'),c=pct(10,'close');
 check('knot svíčky 10 do 35 % zóny: mitigace knotem = mitigated, close (nad zónou) = fresh',w.status==='mitigated'&&near(w.pct,(.972-.966)/(.972-.955)*100,1e-6)&&c.status==='fresh',{w,c});
 check('close pod distal (svíčka 12) → zneplatněná',pct(12,'wick').status==='invalidated'&&pct(12,'wick').invalidAt===12);
 const ob=B.findZones(s,{impulseK:1,atrPeriod:3,swingN:2,requireBreak:true,proximal:'wick',lookback:3},'ob');
 check('order block = poslední opačná svíčka před impulzem (7 je bílá → 6)',ob.some(x=>x.side===1&&x.created===8&&x.baseFrom===6&&x.proximal===.985));
 const blk=B.zoneBlock(s,z,{maxAge:50,status:'fresh',mitigation:'wick',maxMitigationPct:30,invalidate:'close',maxDistAtr:0,atrPeriod:3});
 check('výběr zóny: fresh platí 8–9, po mitigaci knotem (10) už ne',blk.L[8]===1&&blk.L[9]===1&&blk.L[10]===0&&near(blk.lvL.proximal[9],.972));
 const blkC=B.zoneBlock(s,z,{maxAge:50,status:'fresh',mitigation:'close',maxMitigationPct:30,invalidate:'close',maxDistAtr:0,atrPeriod:3});
 check('výběr zóny s mitigací close: svíčka 10 zónu nechá čerstvou',blkC.L[10]===1);
 check('vnoření: contain / overlap',B.nestedOk({proximal:1.02,distal:1.01},{proximal:1.03,distal:1.0},'contain')&&!B.nestedOk({proximal:1.04,distal:1.01},{proximal:1.03,distal:1.0},'contain')&&B.nestedOk({proximal:1.04,distal:1.01},{proximal:1.03,distal:1.0},'overlap')&&!B.nestedOk({proximal:1.1,distal:1.05},{proximal:1.03,distal:1.0},'overlap'));
}

// ======================= 4) FVG, svíčkové formace
{
 const rows=[[1,1.01,.99,1],[1,1.05,1,1.04],[1.04,1.1,1.03,1.09],[1.09,1.1,1.02,1.03],[1.03,1.04,1.0,1.01]];
 const s=S(mk(rows)),g=B.findFvgs(s,0,3);
 check('FVG býčí: low[2] 1,03 > high[0] 1,01 → mezera 1,01–1,03',g.length===1&&g[0].i===2&&g[0].side===1&&g[0].top===1.03&&g[0].bottom===1.01,g);
 const fb=B.fvgBlock(s,{minAtr:0,atrPeriod:3,maxAge:10,maxFillPct:50});
 check('FVG: vyplnění 50 % (low 1,02) ještě platí, 100 % (low 1,00) už ne',fb.L[3]===1&&fb.L[4]===0&&fb.L[1]===0);
 const e=S(mk([[1.05,1.06,1.0,1.01],[1.0,1.08,.99,1.07]]));
 check('pohlcení býčí / ne medvědí',B.isEngulf(e,1,1,false)&&!B.isEngulf(e,1,-1,false)&&B.isEngulf(e,1,1,true));
 const p=S(mk([[1.0,1.01,.9,1.005]]));
 check('pin bar býčí (dlouhý spodní knot, malé tělo, close nahoře)',B.isPin(p,0,1,{wickRatio:.6,bodyRatio:.3,closePos:.66})&&!B.isPin(p,0,-1,{wickRatio:.6,bodyRatio:.3,closePos:.66}));
}

// ======================= 5) seance a letní čas
{
 const L=B.inSession,lon={tz:'Europe/London',from:'08:00',to:'17:00'},ny={tz:'America/New_York',from:'08:00',to:'17:00'},asia={tz:'Asia/Tokyo',from:'09:00',to:'18:00'};
 check('Londýn: 07:30 UTC v létě uvnitř (BST), v zimě ne',L(Date.UTC(2024,6,10,7,30),lon)&&!L(Date.UTC(2024,0,10,7,30),lon));
 check('New York: 12:30 UTC v létě uvnitř (EDT), v zimě ne',L(Date.UTC(2024,6,10,12,30),ny)&&!L(Date.UTC(2024,0,10,12,30),ny));
 check('březnový rozjezd: 12. 3. 2024 NY už letní (12:00 UTC uvnitř), Londýn ještě zimní (07:30 UTC mimo)',L(Date.UTC(2024,2,12,12,0),ny)&&!L(Date.UTC(2024,2,12,7,30),lon));
 check('Tokio bez letního času: 00:00–09:00 UTC',L(Date.UTC(2024,6,10,0,0),asia)&&L(Date.UTC(2024,0,10,8,59),asia)&&!L(Date.UTC(2024,0,10,9,0),asia));
 // rozsah seance: Asie 00–09 UTC, poslední UZAVŘENÁ seance je známá až po zavření svíčky 08:00–09:00
 const t0=Date.UTC(2024,0,10,0),bars=Array.from({length:14},(_,i)=>({t:t0+i*H,o:1,h:1.01+(i===3?.05:0),l:.99-(i===5?.04:0),c:1}));
 const sl=B.sessionLevels(S(bars,'H1'),asia);
 check('rozsah Asie: během seance jen běžící (cur), poslední uzavřená až od svíčky 08:00',Number.isNaN(sl.lastH[7])&&near(sl.lastH[8],1.06)&&near(sl.lastL[8],.95)&&near(sl.curH[4],1.06)&&sl.curOpenT[4]===t0,{l7:sl.lastH[7],l8:sl.lastH[8]});
 const sw=B.sessionKey(Date.UTC(2024,0,10,23),{tz:'Europe/London',from:'22:00',to:'02:00'}),sw2=B.sessionKey(Date.UTC(2024,0,11,1),{tz:'Europe/London',from:'22:00',to:'02:00'});
 check('seance přes půlnoc: 23:00 a 01:00 patří do stejného výskytu',sw===sw2);
 const dl=clockDeadline('America/New_York','16:00',Date.UTC(2024,6,10,12));
 check('časový výstup v 16:00 New York = 20:00 UTC v létě; po něm další den',dl===Date.UTC(2024,6,10,20)&&clockDeadline('America/New_York','16:00',Date.UTC(2024,6,10,21))===Date.UTC(2024,6,11,20)&&clockDeadline('America/New_York','16:00',Date.UTC(2024,0,10,12))===Date.UTC(2024,0,10,21));
}

// ======================= 6) předchozí den, sweep → MSS
{
 // D1: sweep minima předchozího dne a návrat; pak MSS nad swing high s displacementem
 const rows=[[1.0,1.02,.98,1.0],[1.0,1.06,.99,1.05],[1.05,1.07,1.0,1.02],[1.02,1.03,.97,.98],[.98,1.0,.96,.99],[.99,1.01,.97,1.0],[1.0,1.01,.95,.995],[.995,1.1,.99,1.09],[1.09,1.1,1.05,1.06]];
 const s=S(mk(rows)),pd=B.prevDayLevels(s,'D1');
 check('předchozí den u D1 = svíčka i−1',pd.low[6]===.97&&pd.high[6]===1.01&&Number.isNaN(pd.low[0]));
 const sw=B.sweepSeries(s,pd.high,pd.low,1);
 check('sweep: svíčka 6 knotem pod minimem 5 (,97) a close nad ním (,995) → long, extrém ,95',sw.L[6]===1&&sw.lvL.level[6]===.97&&sw.lvL.extreme[6]===.95&&sw.L[5]===0);
 const mss=B.mssBlock(s,{swingN:1,displacementK:.8,atrPeriod:3,requireSweep:true,within:3,lookback:1},sw);
 const st=B.structure(s,1);
 check('MSS: svíčka 7 zavře nad posledním swing high '+st.hi[6]+' s displacementem do 3 svíček po sweepu',mss.L[7]===1&&mss.lvL.level[7]===st.hi[6]&&mss.lvL.extreme[7]===.95,{L:[...mss.L],hi:st.hi[6]});
 const noSweep=B.newOut(s.n,['level','extreme']);
 check('MSS bez předchozího sweepu (requireSweep) neplatí',B.mssBlock(s,{swingN:1,displacementK:.8,atrPeriod:3,requireSweep:true,within:3,lookback:1},noSweep).L[7]===0);
 const lu=B.levelUse(s,pd.high,pd.low,'break',0,3);
 check('úroveň: break = close nad maximem předchozího dne',lu.L[7]===1&&lu.L[6]===0);
}

// ======================= 7) COT (available_at), sezonalita, DXY, relativní síla, zprávy
{
 check('COT zveřejnění: úterý + 3 dny 15:30 New York (léto 19:30 UTC, zima 20:30 UTC)',B.cotAvailableAt('2024-07-09')===Date.UTC(2024,6,12,19,30)&&B.cotAvailableAt('2024-01-09')===Date.UTC(2024,0,12,20,30));
 const rows=Array.from({length:30},(_,k)=>{const d=new Date(Date.UTC(2023,0,3)+k*7*DAY).toISOString().slice(0,10);return {date:d,availableAt:B.cotAvailableAt(d),net:k}});
 const fn=B.cotIndexFn(rows,10),last=rows[29];
 check('COT index: řádek platí až od zveřejnění (minutu předtím předchozí týden)',fn(last.availableAt)===100&&near(fn(last.availableAt-60000),100)&&fn(last.availableAt-60000)!==undefined);
 const fn2=B.cotIndexFn(rows.map((r,k)=>({...r,net:k===29?0:k})),10);
 check('COT index: nový extrém dole = 0, před zveřejněním ještě 100',fn2(last.availableAt)===0&&fn2(last.availableAt-1)===100);
 check('COT index: starší než 14 dní = bez dat',fn(last.availableAt+15*DAY)===undefined);
 const pair=B.cotForMarket({EUR:rows,JPY:rows.map(r=>({...r,net:-r.net}))},'EUR/JPY',10);
 check('COT pár: (base − quote + 100)/2; USD strana chybí → druhá měna',pair(last.availableAt)===100&&B.cotForMarket({EUR:rows},'EUR/USD',10)(last.availableAt)===100&&B.cotForMarket({JPY:rows},'USD/JPY',10)(last.availableAt)===0);
 // sezonalita: březen vždy +, ale rok 2024 extrémně − → stat pro 2024 ho nesmí znát
 const d1=[];let p=100;for(let y=2010;y<=2024;y++)for(let m=0;m<12;m++)for(let dd=1;dd<=20;dd++){const r=m===2?(y===2024?-.02:.005):0;p*=1+r;d1.push({t:Date.UTC(y,m,dd,22),o:p,h:p,l:p,c:p})}
 const tab=B.monthTable(d1),st=B.seasonStat(tab,2024,2,10);
 check('sezonalita: měsíc roku Y jen z let Y−10…Y−1 (extrém roku Y se nepoužije)',st&&st.avg>0&&st.hit===1&&st.n===10,st);
 check('DXY vztah: EUR/USD obráceně, USD/JPY přímo, zlato obráceně, kříž bez vztahu',B.dxyRelation('EUR/USD','auto')===-1&&B.dxyRelation('USD/JPY','auto')===1&&B.dxyRelation('GC=F','auto')===-1&&B.dxyRelation('EUR/GBP','auto')===0);
 const pairs={};for(const [id] of B.DXY_WEIGHTS)pairs[id]=walk(50,id.length,Date.UTC(2024,0,1),DAY,.003,id.startsWith('USD')?1.3:1.1);
 const dx=B.syntheticDxy(pairs);check('syntetický DXY: řada ze 5 párů',dx.length===50&&dx.every(b=>b.c>0));
 const a=S(mk([[1,1,1,1],[1,1.1,1,1.1]],Date.UTC(2024,0,10,8),H),'H1'),o=S(mk([[2,2,2,2],[2,2.02,2,2.02]],Date.UTC(2024,0,10,8),H),'H1');
 const rs=B.relStrength(a,o,Float64Array.from([a.t[0],a.t[0]]),1);
 check('relativní síla: +10 % proti +1 % od otevření → long (rozdíl ≥ 1 %)',rs.L[1]===1&&rs.S[1]===0);
 const nb=B.newsBlock(a,'EUR/USD',(i,t)=>t===a.t[1]+H?true:undefined,{minutes:30,minSignal:3});
 check('zprávy: mimo pokrytí kalendáře = bez dat (splněno, počítá se), zpráva v okně = blok',nb.unknown[0]===1&&nb.L[0]===1&&nb.L[1]===0&&nb.unknown[1]===0);
}

// ======================= 8) bez pohledu do budoucna: všechny bloky přes engine (H1 data, vyšší TF, externí data)
const ALL_DEF={name:'zone-swing',version:1,markets:['EUR/USD'],data:'H1',tf:{context:'D1',zone:'H4',entry:'H1'},
 conditions:[
  {id:'tr',block:'trend_swing',tf:'context',params:{n:2}},
  {id:'ma',block:'ma',role:'optional',params:{period:20,mode:'slope'}},
  {id:'atr',block:'atr_regime',role:'optional',tf:'zone',params:{avg:20}},
  {id:'z',block:'zone',role:'optional',tf:'zone',params:{impulseK:.6,requireBreak:false,status:'valid',maxBase:2,baseBodyRatio:.7,maxAge:500}},
  {id:'z2',block:'zone',role:'required',params:{impulseK:.6,requireBreak:false,status:'valid',maxBase:2,baseBodyRatio:.7}},
  {id:'nz',block:'nested_zone',role:'optional',params:{inner:'z2',outer:'z',mode:'overlap'}},
  {id:'ob',block:'order_block',role:'optional',tf:'zone',params:{impulseK:.6,requireBreak:false,status:'valid'}},
  {id:'pd',block:'premium_discount',role:'optional',tf:'context',params:{}},
  {id:'fvg',block:'fvg',role:'optional',params:{maxAge:30}},
  {id:'fib',block:'fib_band',role:'optional',tf:'zone',params:{}},
  {id:'rn',block:'round_number',role:'optional',params:{step:.005}},
  {id:'pdl',block:'prev_day',role:'optional',params:{use:'near',k:1}},
  {id:'ses',block:'session_range',role:'optional',params:{session:'asia',use:'break'}},
  {id:'sw',block:'sweep',role:'optional',params:{level:'london',lookback:3}},
  {id:'mss',block:'mss',role:'optional',params:{sweepLevel:'prev_day',displacementK:.5}},
  {id:'eng',block:'engulfing',role:'optional',params:{lookback:2}},
  {id:'pin',block:'pin_bar',role:'optional',params:{}},
  {id:'rs',block:'rel_strength',role:'optional',params:{other:'GBP/USD',session:'london'}},
  {id:'nw',block:'news_blackout',role:'optional',params:{}},
  {id:'cot',block:'cot_index',role:'optional',params:{weeks:20}},
  {id:'sea',block:'seasonality',role:'optional',params:{years:3}},
  {id:'dxy',block:'dxy_trend',role:'optional',params:{period:20}},
  {id:'mn',block:'ma',role:'optional',tf:'MN',params:{period:2}},
  {id:'w1',block:'ma',role:'optional',tf:'W1',params:{period:3}},
 ],
 entry:{type:'limit',from:'z2',key:'proximal',validBars:6},stop:{from:'z2',key:'distal',atrK:.1},targets:{type:'r',r:2,partial:{atR:1,pct:50}},
 management:{beAtR:1.5,timeExitBars:40},risk:{basePct:1,byRating:[{min:3,pct:1.5}]},filters:{maxTradesPerDay:3,news:{minutes:30,minSignal:3}}};
const H0=Date.UTC(2023,1,1),NH=6000;
const eu=walk(NH,11,H0,H,.0025),gu=walk(NH,12,H0,H,.0025,1.3);
const cotRows=Array.from({length:60},(_,k)=>{const d=new Date(Date.UTC(2023,0,3)+k*7*DAY).toISOString().slice(0,10);return {date:d,availableAt:B.cotAvailableAt(d),net:Math.sin(k/4)*1000}});
const newsFn=(inst,t)=>t<H0+200*DAY?((Math.floor(t/H)%37)===0):undefined;
const d1eu=walk(4000,13,Date.UTC(2014,0,1,22),DAY,.006);
const ctx={cot:{EUR:cotRows},news:newsFn,dxy:walk(NH,14,H0,H,.002,100),extra:{'GBP/USD':gu},d1:{'EUR/USD':d1eu}};
{
 const v=validateDef(ALL_DEF);check('testovací definice se všemi bloky je platná',v.ok,v.errors);
 const def=v.ok?v.def:null;
 check('test pokrývá všechny bloky katalogu',BLOCK_IDS.every(b=>ALL_DEF.conditions.some(c=>c.block===b)),BLOCK_IDS.filter(b=>!ALL_DEF.conditions.some(c=>c.block===b)));
 if(def){
  const full=prepare('EUR/USD',eu,'H1'),cf=compile(def,full,ctx);
  let bad=null;
  for(const cut of [500,1777,3333,5100]){
   const tr=prepare('EUR/USD',eu.slice(0,cut),'H1'),ct=compile(def,tr,{...ctx,extra:{'GBP/USD':gu.slice(0,cut)}});
   def.conditions.forEach((c,k)=>{if(bad)return;const d=sameOut(cf.outs[k],ct.outs[k],cut);if(d)bad=`${c.id} (${c.block}) řez ${cut}: ${d}`});
  }
  check('useknutí budoucích svíček nemění minulé výstupy ŽÁDNÉHO bloku (H1, H4, D1, W1, MN, COT, zprávy, DXY, relativní síla)',bad===null,bad);
  const fired=def.conditions.map((c,k)=>[c.id,cf.outs[k].L.reduce((a,b)=>a+b,0)+cf.outs[k].S.reduce((a,b)=>a+b,0)]).filter(([,n])=>n===0).map(([id])=>id);
  check('každý blok na náhodné řadě aspoň jednou platí (test není prázdný)',fired.length===0,fired);
  // engine: obchody uzavřené před řezem jsou stejné
  const sim=(bars,eb)=>simulate(def,[prepare('EUR/USD',bars,'H1')],[compile(def,prepare('EUR/USD',bars,'H1'),{...ctx,extra:{'GBP/USD':eb}})],ctx);
  const A=sim(eu,gu),cut=4000,Bt=sim(eu.slice(0,cut),gu.slice(0,cut)),T=eu[cut-1].t;
  const key=t=>[t.entryT,t.exitT,t.side,t.r.toFixed(10),t.reason].join();
  const a1=A.trades.filter(t=>t.exitT<T-H&&t.reason!=='end').map(key),b1=Bt.trades.filter(t=>t.exitT<T-H&&t.reason!=='end').map(key);
  check(`engine: obchody uzavřené před řezem jsou stejné (${a1.length} obchodů)`,a1.length>5&&a1.join('|')===b1.join('|'),{a:a1.length,b:b1.length});
  // živá simulace: nastavení z dokončených svíček – svíčka, která ještě běží, se nepoužije
  const now=eu[3000].t+30*60000,ls=liveSetups(def,'EUR/USD',eu,ctx,now),ls2=liveSetups(def,'EUR/USD',eu.slice(0,3000),ctx,now);
  check('živá nastavení: běžící svíčka (a budoucí) se ignoruje',JSON.stringify(ls)===JSON.stringify(ls2));
 }
}

// ======================= 9) mechanika obchodu (ruční signál, D1)
const BASE={name:'sweep-reversal',version:1,markets:['EUR/USD'],data:'D1',tf:{context:'D1',zone:'D1',entry:'D1'},conditions:[{id:'x',block:'zone'}],
 entry:{type:'market_on_close'},stop:{from:'x',key:'distal'},targets:{type:'r',r:2},costs:{spreadMult:0}};
const defOf=(o={})=>{const v=validateDef({...BASE,...o});if(!v.ok)throw Error(v.errors.join('; '));return v.def};
// řada s ručním signálem long na svíčce sig a úrovněmi (proximal, distal, mid)
function runHand(rows,o={}){
 const def=defOf(o.def),bars=mk(rows),pm=prepare(o.id||'EUR/USD',bars,'D1');pm.hs=o.hs??0;
 const out=B.newOut(bars.length,['proximal','distal','mid']),sig=o.sig??5;out.L[sig]=1;
 for(const [k,v] of Object.entries(o.lv||{distal:.99}))out.lvL[k][sig]=v;
 return {def,pm,cp:{outs:[out],req:[0],opt:[],idx:new Map([['x',0]])}};
}
const sim1=(rows,o={})=>{const x=runHand(rows,o);return simulate(x.def,[x.pm],[x.cp],{},o.sim||{})};
const flat=n=>Array.from({length:n},()=>[1,1,1,1]);
{
 // částečný výstup + BE: vstup 1,00 (close svíčky 5), SL ,99 (1 R = ,01), TP1 1,01 (50 %), cíl 1,02
 const pb={targets:{type:'r',r:2,partial:{atR:1,pct:50,moveToBE:true}}};
 const a=sim1([...flat(6),[1,1.011,.995,1.008],[1.005,1.006,.999,1.0],[1,1,1,1]],{def:pb});
 check('částečný výstup: polovina na +1 R, zbytek stop na BE → +0,5 R (důvod be)',a.trades.length===1&&near(a.trades[0].r,.5)&&a.trades[0].reason==='be'&&a.trades[0].partial,a.trades);
 const b=sim1([...flat(6),[1,1.011,.98,1.0],[1,1,1,1]],{def:pb});
 check('TP1 i SL v jedné svíčce: konzervativně celé SL = −1 R',b.trades.length===1&&near(b.trades[0].r,-1)&&!b.trades[0].partial,b.trades);
 const c=sim1([...flat(6),[1,1.011,.98,1.0],[1,1,1,1]],{def:{...pb,management:{ambiguity:'optimistic'}}});
 check('optimisticky: TP1 dřív, pak SL zbytku = +0,5 − 0,5 = 0 R',c.trades.length===1&&near(c.trades[0].r,0),c.trades);
 const d=sim1([...flat(6),[1,1.011,.995,1.008],[1.008,1.025,1.004,1.02],[1,1,1,1]],{def:pb});
 check('částečný výstup a pak cíl 2 R: 0,5 × 1 + 0,5 × 2 = 1,5 R',near(d.trades[0].r,1.5)&&d.trades[0].reason==='tp');
 const e=sim1([...flat(6),[1,1.012,.995,1.01],[1.01,1.011,.999,1.0],[1,1,1,1]],{def:{management:{beAtR:1}}});
 check('BE od +1 R (bez částečného): stop na vstup od další svíčky → 0 R',e.trades.length===1&&near(e.trades[0].r,0)&&e.trades[0].reason==='be');
}
{
 // dvě nohy: ,995 a ,99 (po 50 %), společný stop ,98
 const tl={entry:{type:'limit',validBars:5,legs:[{from:'x',key:'proximal',share:.5},{from:'x',key:'mid',share:.5}]},stop:{from:'x',key:'distal'}};
 const lv={proximal:.995,mid:.99,distal:.98};
 const a=sim1([...flat(6),[1,1,.994,.996],[.996,.997,.989,.99],[.99,.99,.97,.975],[1,1,1,1]],{def:tl,lv});
 check('dvě nohy plněné a SL: celkem přesně −1 R (strop rizika)',a.trades.length===1&&a.trades[0].legs===2&&near(a.trades[0].r,-1),a.trades);
 const b=sim1([...flat(6),[1,1,.994,.996],[.996,1.02,.995,1.018],[1.0,1.0,.985,.99],[1,1,1,1]],{def:tl,lv});
 // cíl 2 R od průměrného vstupu ,9925 (riziko ,0125) = 1,0175; noha 1: (1,0175 − ,995)/,015 = 1,5 R × 0,5
 check('jen první noha + cíl: 0,5 × 1,5 R = 0,75 R; neplněná noha se po zavření zruší',b.trades.length===1&&b.trades[0].legs===1&&near(b.trades[0].r,.75),b.trades);
 const c=sim1([...flat(6),[1,1,.999,1],[1,1,.999,1],[1,1,.999,1],[1,1,.999,1],[1,1,.999,1],[1,1,.98,.99]],{def:tl,lv});
 check('limit po platnosti (5 svíček) vyprší → žádný obchod',c.trades.length===0&&c.skips['limit vypršel']===1,c);
 const dd=sim1([...flat(6),[1,1.03,.99,1.02],[1,1,1,1]],{def:{entry:{type:'limit',from:'x',key:'proximal',validBars:3},stop:{from:'x',key:'distal'}},lv:{proximal:.995,distal:.98}});
 check('plnění limitem uvnitř svíčky: v té svíčce jen SL, ne TP (cíl 1,025 trefen ve stejné svíčce)',dd.trades.length===1&&dd.trades[0].reason==='end'&&dd.trades[0].entryT===mk(flat(7))[6].t,dd.trades);
 const ee=sim1([...flat(6),[1,1,.97,.975],[1,1,1,1]],{def:{entry:{type:'limit',from:'x',key:'proximal',validBars:3},stop:{from:'x',key:'distal'}},lv:{proximal:.995,distal:.98}});
 check('plnění limitem a SL v téže svíčce → −1 R',ee.trades.length===1&&near(ee.trades[0].r,-1));
 const gp=sim1([...flat(6),[.99,.992,.985,.99],[1,1,1,1]],{def:{entry:{type:'limit',from:'x',key:'proximal',validBars:3},stop:{from:'x',key:'distal'}},lv:{proximal:.995,distal:.98}});
 check('gap pod limit: plnění za open (,99), R z této ceny',gp.trades.length===1&&gp.trades[0].reason==='end'&&near(gp.trades[0].r,(1-.99)/(.99-.98)));
}
{
 // náklady: spread ½ = ,0001 na vstupu i výstupu, komise v R
 const a=sim1([...flat(6),[1,1,.98,.99],[1,1,1,1]],{hs:.0001,def:{costs:{spreadMult:1}}});
 check('náklady: zásah SL = přesně −1 R i se spreadem',near(a.trades[0].r,-1,1e-12),a.trades);
 const b=sim1([...flat(6),[1,1.03,.995,1.02],[1,1,1,1]],{hs:.0001,def:{costs:{spreadMult:1,commissionR:.05}}});
 check('náklady: cíl 2 R se spreadem = (1,0199 − 1,0001)/,0102 − komise 0,05',near(b.trades[0].r,(1.0199-1.0001)/.0102-.05,1e-9),b.trades);
 const c=sim1([...flat(6),[1,1.03,.995,1.02],[1,1,1,1]],{hs:.0001,def:{costs:{spreadMult:2}}});
 check('náklady: spreadMult 2 zdvojí spread',near(c.trades[0].r,(1.0198-1.0002)/.0104,1e-9));
 const g=sim1([...flat(6),[.985,.99,.98,.985],[1,1,1,1]]);
 check('gap pod SL na open → výstup za open (horší než −1 R)',near(g.trades[0].r,-1.5)&&g.trades[0].reason==='sl');
 const amb=sim1([...flat(6),[1,1.03,.98,1],[1,1,1,1]]),opt=sim1([...flat(6),[1,1.03,.98,1],[1,1,1,1]],{def:{management:{ambiguity:'optimistic'}}});
 check('SL i TP v jedné svíčce: konzervativně SL, optimisticky TP',near(amb.trades[0].r,-1)&&near(opt.trades[0].r,2));
 const tx=sim1([...flat(6),[1,1.005,.995,1.001],[1,1.005,.995,1.002],[1,1.005,.995,1.003],[1,1,1,1]],{def:{management:{timeExitBars:3}}});
 check('časový výstup: po 3 svíčkách na close (1,003 → +0,3 R)',tx.trades[0].reason==='time'&&near(tx.trades[0].r,.3)&&tx.trades[0].exitT===mk(flat(10))[8].t);
}
{
 // portfolio: dva trhy, limit 1 obchod za den; stop-den po ztrátě
 const x1=runHand([...flat(6),[1,1.001,.999,1],[1,1,1,1]],{}),x2=runHand([...flat(6),[1,1.001,.999,1],[1,1,1,1]],{id:'GBP/USD'});
 const d1=defOf({filters:{maxTradesPerDay:1}}),r1=simulate(d1,[x1.pm,x2.pm],[x1.cp,x2.cp],{});
 check('limit 1 obchod za den: ze dvou signálů ve stejný den jen první',r1.trades.length===1&&r1.trades[0].market==='EUR/USD'&&r1.skips['limit 1 obchodů za den']===1,r1);
 const r2=simulate(defOf({filters:{maxOpen:1}}),[x1.pm,x2.pm],[x1.cp,x2.cp],{});
 check('maxOpen 1: druhá pozice se neotevře',r2.trades.length===1);
 // trh A prohraje uvnitř svíčky 3, trh B má signál na zavření svíčky 3 (stejný obchodní den NY) → stop-den
 const a=runHand([...flat(3),[1,1,.98,.99],...flat(3)],{sig:2}),b=runHand([...flat(4),[1,1.001,.999,1],...flat(2)],{sig:3,id:'GBP/USD'});
 const r3=simulate(defOf({filters:{stopAfterLosses:1}}),[a.pm,b.pm],[a.cp,b.cp],{});
 check('stop-den po 1 ztrátě: ztráta známá na konci svíčky blokuje vstup na jejím zavření',r3.trades.length===1&&r3.trades[0].r<0&&r3.skips['stop-den po 1 ztrátách']===1,r3);
 const r4=simulate(defOf({filters:{dailyLossR:.5}}),[a.pm,b.pm],[a.cp,b.cp],{});
 check('denní limit ztráty 0,5 R blokuje další vstup',r4.trades.length===1&&r4.skips['denní limit ztráty 0.5 R']===1,r4.skips);
 const f={...defOf().filters,maxTradesPerWeek:2};
 const T=Date.UTC(2024,0,10,15);
 check('portfolioBlock: týdenní limit a ztráty známé až od knownAt',portfolioBlock(f,[{entryT:T-DAY,knownAt:null,r:null},{entryT:T-2*DAY,knownAt:T-DAY,r:1}],T,0)!==null&&portfolioBlock({...f,maxTradesPerWeek:null,stopAfterLosses:1},[{entryT:T-H,knownAt:T+H,r:-1}],T,0)===null);
}
{
 // vstupní okno seance (H1): signál mimo Londýn se neotevře
 const def=validateDef({...BASE,data:'H1',tf:{context:'H1',zone:'H1',entry:'H1'},filters:{sessions:['london']}}).def;
 const rows=Array.from({length:12},()=>[1,1,1,1]),bars=mk(rows,Date.UTC(2024,0,10,0),H),pm=prepare('EUR/USD',bars,'H1');pm.hs=0;
 const out=B.newOut(12,['proximal','distal','mid']);out.L[3]=1;out.lvL.distal[3]=.99;out.L[9]=1;out.lvL.distal[9]=.99;
 const r=simulate(def,[pm],[{outs:[out],req:[0],opt:[],idx:new Map([['x',0]])}],{});
 check('vstupní okno Londýn (zima 08–17 UTC): signál 03:00 ne, 09:00 ano',r.trades.length===1&&r.trades[0].entryT===Date.UTC(2024,0,10,10),r.trades);
 const nf=validateDef({...BASE,data:'H1',tf:{context:'H1',zone:'H1',entry:'H1'},filters:{news:{minutes:30,minSignal:3}}}).def;
 const r2=simulate(nf,[pm],[{outs:[out],req:[0],opt:[],idx:new Map([['x',0]])}],{news:(i,t)=>t===Date.UTC(2024,0,10,4)?true:undefined});
 check('filtr zpráv v čase vstupu (mimo pokrytí kalendáře neblokuje)',r2.trades.length===1&&r2.trades[0].entryT===Date.UTC(2024,0,10,10)&&r2.skips['mimo vstupní okno / zprávy']===1,r2);
}

// ======================= 10) IS / OOS, robustnost, hranice náhody
{
 const pmD=prepare('EUR/USD',walk(300,1,Date.UTC(2020,0,1),DAY),'D1'),sp=splitOf('D1',[pmD]);
 check('D1: IS od 2015-01-01, OOS od 2023-01-01',sp.from===Date.UTC(2015,0,1)&&sp.split===Date.UTC(2023,0,1));
 const pmH=prepare('EUR/USD',walk(2000,1,Date.UTC(2024,0,1),H),'H1'),sh=splitOf('H1',[pmH]),lo=Date.UTC(2024,0,1)+30*DAY,hi=Date.UTC(2024,0,1)+1999*H;
 check('H1: OOS = posledních 30 % období (po měsíci zahřátí)',sh.from===lo&&sh.split===lo+Math.floor((hi-lo)*.7));
 const tr=(entryT,r)=>({market:'EUR/USD',side:1,sigT:entryT,entryT,exitT:entryT+DAY,r,reason:'tp',rating:0,riskPct:1,legs:1,partial:false});
 const ev=evaluate([tr(Date.UTC(2014,5,1),5),tr(Date.UTC(2016,0,1),1),tr(Date.UTC(2023,5,1),-1),tr(Date.UTC(2024,0,1),2)],['EUR/USD'],Date.UTC(2015,0,1),Date.UTC(2023,0,1));
 check('IS/OOS podle času vstupu, obchody před IS se nepočítají; křivka s rizikem 1 %',ev.metrics.is.trades===1&&ev.metrics.oos.trades===2&&ev.metrics.oos.avgR===.5&&near(ev.returnPct,Math.round(((1.01*.99*1.02)-1)*1e4)/100,1e-9)&&ev.perMarket[0].oos.trades===2,ev.metrics);
 const m=x=>({trades:x.n,winRate:50,avgR:x.avg,totalR:0,pf:x.pf,maxDd:0,expectancy:x.avg});
 const good={is:m({n:100,avg:.1,pf:1.2}),oos:m({n:60,avg:.2,pf:1.1}),all:m({n:160,avg:.1,pf:1.2})};
 check('robustní: IS>0, OOS>0, ≥ 60 OOS obchodů, okolí > 0, PF ≥ 1,1',isRobustRun(good,.1)&&!isRobustRun(good,0)&&!isRobustRun({...good,oos:m({n:59,avg:.2,pf:1.2})},.1)&&!isRobustRun({...good,oos:m({n:60,avg:.2,pf:1.09})},.1));
 const def=validateDef({...ALL_DEF,variants:[{name:'cíl 3 R',overrides:{'targets.r':3}},{name:'bez partial',overrides:{'targets.partial':null}}]}).def;
 const run=o=>runStrategy(def,[{id:'EUR/USD',bars:eu},{id:'GBP/USD',bars:gu}],ctx,{shuffles:3,seed:o,now:Date.UTC(2024,0,1)});
 const r1=run(7),r2=run(7),r3=run(8);
 check('běh: základ + 2 varianty, metriky IS/OOS, trhy, křivka',r1.variants.length===3&&r1.variants[0].name==='základ'&&r1.variants[1].name==='cíl 3 R'&&r1.variants[0].perMarket.length===2&&r1.variants[0].equity.length>1&&r1.splitRule.startsWith('H1'));
 check('hranice náhody: deterministická se seedem, jiný seed jiné hodnoty',JSON.stringify(r1.chance)===JSON.stringify(r2.chance)&&r1.chance.values.length===3&&JSON.stringify(r1.chance.values)!==JSON.stringify(r3.chance.values),[r1.chance,r3.chance]);
 check('varianty mění výsledek (cíl 3 R ≠ základ)',JSON.stringify(r1.variants[0].metrics)!==JSON.stringify(r1.variants[1].metrics));
 check('poznámka o pokrytí zpráv je ve výsledku',r1.notes.some(n=>/kalendář pokrývá/.test(n)));
 // náhoda: stejné vstupy (čas), jen směr náhodný
 const x=runHand([...flat(6),[1,1.03,.98,1.0],[1,1,1,1]],{});
 const ks=[1,2,3,4,5,6].map(sd=>simulate(x.def,[x.pm],[x.cp],{},{flipSeed:sd}).trades[0]);
 check('náhoda: čas vstupu stejný, směr náhodný (obě strany se vyskytnou), zrcadlený stop → −1 R',ks.every(t=>t.entryT===ks[0].entryT)&&ks.some(t=>t.side===1)&&ks.some(t=>t.side===-1)&&ks.every(t=>near(t.r,-1)),ks.map(t=>[t.side,t.r]));
}

// ======================= 11) schéma definice – chyby validace (bez hodnot z definice)
{
 const bad=(o,re,name)=>{const v=validateDef(o);check('validace: '+name,!v.ok&&v.errors.some(e=>re.test(e)),v.ok?'prošlo':v.errors)};
 bad(null,/JSON objekt/,'není objekt');
 bad({...BASE,name:''},/^name:/,'chybí název');
 bad({...BASE,markets:[]},/^markets:/,'prázdné trhy');
 bad({...BASE,data:'M5'},/^data:/,'neznámá data');
 bad({...BASE,tf:{context:'D1',zone:'H4',entry:'D1'}},/^tf\.zone:/,'zóna pod vstupním TF');
 bad({...BASE,tf:{context:'D1',zone:'D1',entry:'H1'}},/^tf\.entry:/,'vstupní TF ≠ data');
 bad({...BASE,conditions:[{id:'x',block:'magic'}]},/conditions\[0\]\.block: neznámá/,'neznámý blok');
 bad({...BASE,conditions:[{id:'x',block:'zone',params:{impulseK:99}}]},/params\.impulseK: mimo rozsah/,'parametr mimo rozsah');
 bad({...BASE,conditions:[{id:'x',block:'zone',params:{foo:1}}]},/params\.foo: neznámý/,'neznámý parametr');
 bad({...BASE,conditions:[{id:'x',block:'zone',role:'optional'}]},/aspoň jedna podmínka musí být required/,'žádná povinná podmínka');
 bad({...BASE,conditions:[{id:'x',block:'zone'},{id:'x',block:'fvg'}]},/duplicitní id/,'duplicitní id podmínky');
 bad({...BASE,conditions:[{id:'x',block:'zone'},{id:'n',block:'nested_zone',params:{inner:'x',outer:'y'}}]},/params\.outer: musí odkazovat/,'odkaz na neexistující podmínku');
 bad({...BASE,conditions:[{id:'x',block:'zone'},{id:'s',block:'session_range'}]},/seance potřebují data H1/,'seance s D1 daty');
 bad({...BASE,conditions:[{id:'x',block:'zone'},{id:'c',block:'cot_index',tf:'W1'}]},/jen na tf\.entry/,'externí data jen na vstupním TF');
 bad({...BASE,entry:{type:'limit',from:'x',key:'high'}},/entry\.key: blok tuto úroveň nedává/,'úroveň, kterou blok nedává');
 bad({...BASE,entry:{type:'limit',legs:[{from:'x',key:'proximal',share:.5},{from:'x',key:'distal',share:.4}]}},/součet share musí být 1/,'nohy nedávají 100 %');
 bad({...BASE,stop:{from:'entry'}},/stop\.atrK: u stopu od vstupu/,'stop od vstupu bez ATR');
 bad({...BASE,targets:{type:'r',r:2,partial:{atR:2,pct:50}}},/partial\.atR: musí být menší/,'TP1 za cílem');
 bad({...BASE,filters:{sessions:['london']}},/potřebují data H1/,'vstupní okno s D1');
 bad({...BASE,filters:{dayTz:'Mars/Olympus'}},/dayTz: neplatná/,'neplatná zóna');
 bad({...BASE,management:{timeExitClock:{tz:'Europe/London',at:'25:00'}}},/timeExitClock/,'neplatný čas');
 bad({...BASE,extra:1},/^extra: neznámé pole/,'neznámé pole');
 bad({...BASE,variants:[{name:'v',overrides:{'conditions.nope.params.k':1}}]},/variants\[0\]: conditions\.nope/,'varianta na neznámou podmínku');
 bad({...BASE,variants:[{name:'v',overrides:{'targets.r':999}}]},/variants\[0\]: targets\.r: mimo rozsah/,'varianta mimo rozsah');
 const secret='TAJNA-HODNOTA-123';
 const v=validateDef({...BASE,name:secret,markets:[secret],conditions:[{id:'x',block:secret,params:{x:secret}}],data:secret});
 check('chyby nikdy neopakují hodnoty z definice',!v.ok&&v.errors.every(e=>!e.includes(secret)),v.errors);
 check('JSON syntaktická chyba',(()=>{const r=parseDefJson('{"name":');return !r.ok&&/JSON: syntaktická/.test(r.errors[0])})());
 const ok=validateDef(BASE);
 check('výchozí hodnoty doplněné (risk 1 %, dayTz New York, bez variant), validace normalizované definice je idempotentní',ok.ok&&ok.def.risk.basePct===1&&ok.def.filters.dayTz==='America/New_York'&&validateDef(ok.def).ok&&JSON.stringify(validateDef(ok.def).def)===JSON.stringify(ok.def));
 const ov=applyOverrides(ok.def,{'conditions.x.params.impulseK':2,'targets.r':3});
 check('varianta: přepis parametru podmínky a cíle',ov.ok&&ov.def.conditions[0].params.impulseK===2&&ov.def.targets.r===3&&ok.def.targets.r===2);
 check('applyOverrides odmítne __proto__',!applyOverrides(ok.def,{'__proto__.x':1}).ok);
 check('defRuns: základ + varianty',defRuns(validateDef({...BASE,variants:[{name:'a',overrides:{'targets.r':3}}]}).def).length===2);
 check('obecný popis neobsahuje názvy podmínek ani parametry',defOutline(ok.def).every(l=>!/impulseK|"x"/.test(l)));
 check('katalog: každý blok má popisek a parametry s výchozími hodnotami',BLOCK_IDS.every(b=>BLOCKS[b].label&&Object.values(BLOCKS[b].params).every(p=>p.t==='ref'||'def' in p)));
}

// ======================= 12) živá simulace – agent R…
{
 check('id agentů strategií: R01…R40, jiné ne; S/G/A dál platí',RULE_VARIANT_IDS.length===40&&isRuleVariant('R01')&&isRuleVariant('R40')&&!isRuleVariant('R41')&&!isRuleVariant('R1')&&isVariantId('R07')&&isVariantId('S01')&&isVariantId('G01')&&isVariantId('A'));
 const def=defOf({markets:['EUR/USD','GBP/USD'],targets:{type:'r',r:2,partial:{atR:1,pct:50,moveToBE:true}},risk:{basePct:1}});
 const V=ruleVariant('R01','11111111-2222-3333-4444-555555555555',def);
 check('varianta R: kind rule, verze v rules_version (≤ 20 znaků), trhy z definice, text bez parametrů',V.kind==='rule'&&V.rulesVersion==='rule-R01-v1'&&V.rulesVersion.length<=20&&V.markets.join()==='EUR/USD,GBP/USD'&&V.text.every(t=>!/impulseK/.test(t)));
 const now=Date.UTC(2024,0,10,12);
 const su={key:'k1:1',side:1,type:'market_on_close',sigT:now-10*60000,legs:[{L:1.1,share:1}],stop:1.09,target:1.12,tp1:1.11,risk:.01,rating:1,riskPct:1,sat:['Zóna nabídky / poptávky (D1)'],expiresT:now+DAY};
 const base={now,startEquity:100000,trades:[],signals:{},quotes:{'EUR/USD':{price:1.1,marketTime:now-60000}},d1:{},news:[],variant:V};
 const r=paperStep({...base,ruleSetups:{'EUR/USD':[su]}});
 check('R: vstup za živou cenu, částečný výstup = 2 řádky (50 % na TP1, zbytek na cíl se stopem na BE)',r.opens.length===2&&r.opens[0].tp===1.11&&r.opens[1].tp===1.12&&near(r.opens[0].riskCzk,500)&&near(r.opens[1].riskCzk,500)&&r.opens[1].partsAtEntry.rule.beAtR>0&&r.opens.every(t=>t.sl===1.09&&t.variant==='R01'),r.opens);
 check('R: poznámka „proč“ z obecných popisků splněných podmínek',/Proč: splněno 1 podmínek – Zóna nabídky/.test(r.opens[0].why));
 const again=paperStep({...base,trades:r.opens,ruleSetups:{'EUR/USD':[su]}});
 check('R: stejné nastavení se neotevře znovu (pozice běží)',again.opens.length===0);
 const closed=r.opens.map(t=>({...t,closed:now+H,exit:1.09,exitReason:'sl',r:-1,pnlCzk:-t.riskCzk,pct:-1}));
 const after=paperStep({...base,now:now+2*H,trades:closed,ruleSetups:{'EUR/USD':[su]}});
 check('R: po zavření se stejné nastavení už neobchoduje',after.opens.length===0&&after.skipped.some(s=>/už bylo obchodováno/.test(s.reason)));
 const lim={...su,key:'k2:1',type:'limit',legs:[{L:1.095,share:1}]};
 const w=paperStep({...base,ruleSetups:{'EUR/USD':[lim]}});
 check('R: limit čeká, dokud živá cena nedosáhne úrovně',w.opens.length===0&&w.skipped.some(s=>/limit: čeká/.test(s.reason)));
 const f=paperStep({...base,quotes:{'EUR/USD':{price:1.094,marketTime:now-60000}},ruleSetups:{'EUR/USD':[lim]}});
 check('R: limit dosažený → vstup',f.opens.length===2);
 const wk=paperStep({...base,now:Date.UTC(2024,0,13,12),quotes:{'EUR/USD':{price:1.1,marketTime:Date.UTC(2024,0,13,11,59)}},ruleSetups:{'EUR/USD':[{...su,expiresT:Date.UTC(2024,0,14)}]}});
 check('R: zavřený trh (sobota) → bez vstupu',wk.opens.length===0&&wk.skipped.some(s=>/zavřený/.test(s.reason)));
 const lt=paperStep({...base,variant:ruleVariant('R02','x',defOf({markets:['EUR/USD','GBP/USD'],filters:{maxTradesPerDay:1}})),quotes:{'EUR/USD':{price:1.1,marketTime:now-60000},'GBP/USD':{price:1.1,marketTime:now-60000}},ruleSetups:{'EUR/USD':[su],'GBP/USD':[{...su,key:'k3:1'}]}});
 check('R: limit obchodů za den počítá nastavení (ne řádky)',lt.opens.length===1&&lt.skipped.some(s=>/limit 1 obchodů za den/.test(s.reason)),lt.skipped);
 // BE v checkExit: řádek b po TP1 (1,11) má stop na vstupu
 const b=r.opens[1],path=[{t:now+H,h:1.111,l:1.105,c:1.108},{t:now+2*H,h:1.106,l:1.099,c:1.1}];
 const ex=checkExit(b,{now:now+3*H,h1:path,quote:{price:1.1,marketTime:now+3*H-60000},rules:V.rules});
 check('R: zbytek po TP1 skončí na BE (0 R, důvod be)',ex&&ex.exitReason==='be'&&near(ex.r,0,1e-9),ex);
 const tm=checkExit({...r.opens[0],partsAtEntry:{...r.opens[0].partsAtEntry,rule:{...r.opens[0].partsAtEntry.rule,maxHoldMs:2*H}}},{now:now+3*H,quote:{price:1.1,marketTime:now+3*H-60000},rules:V.rules});
 check('R: časový výstup podle max. doby držení',tm&&tm.exitReason==='time');
}

// ======================= 13) jen vlastník, úložiště, runner
{
 const U='https://tradee.eu/api/laborator/strategies',owner={id:'g:1',role:'admin',owner:true},admin={id:'g:2',role:'admin',owner:false};
 check('labGate: vlastník projde, admin i nepřihlášený 404',labGate(owner,U)===owner&&labGate(admin,U).status===404&&labGate(null,U).status===404&&labGate(owner,U+'?as=g:2').status===404);
 const rt=src('app/api/laborator/strategies/route.ts'),hs=rt.split(/export async function /).slice(1);
 check('route strategies: GET a POST, každý začíná labUser (404)',hs.length===2&&hs.every(h=>/^(GET|POST)\(req:Request\)\{try\{const u=await labUser\(req\);if\(u instanceof Response\)return u;/.test(h)));
 check('route strategies: POST jen z vlastní stránky (sameOrigin + sec-fetch-site)',/sameOrigin\(req\)/.test(hs[1])&&/sec-fetch-site/.test(hs[1]));
 check('route strategies: data vždy podle u.id, nikdy ?as=',!/searchParams\.get\('as'\)/.test(rt)&&/u\.id/.test(rt));
 const st=src('lib/lab/strat-store.ts');
 check('store: všechny dotazy na lab_strategy_* filtrují user_id',[...st.matchAll(/(?:FROM|UPDATE|INTO) (lab_strategy_\w+)[^'`]*/g)].every(m=>/user_id/.test(m[0]))&&/RUNS_KEEP=5/.test(st));
 const pr=src('app/api/laborator/paper/route.ts');
 check('paper route: odebrání R… jen přes removeRuleVariant, agenti G… dál neměnní',/isRuleVariant\(variant\)\)await removeRuleVariant/.test(pr)&&/isAgentVariant\(variant\)\)throw Error/.test(pr));
 const sc=src('scripts/lab-strategies.mjs');
 check('runner: import jen ze souboru MIMO repozitář',/real===ROOT\|\|real\.startsWith\(ROOT\+sep\)/.test(sc)&&/process\.exit\(1\)/.test(sc));
 check('runner: nevypisuje obsah definic (žádný log textu / JSONu definice)',!/console\.(log|error|warn)\([^)]*(x\.text|JSON\.stringify\((def|raw|x)\b|readFileSync)/.test(sc)&&!/writeFileSync/.test(sc));
 const mig=src('drizzle/mariadb/0035_lab_strategy_defs.sql');
 check('migrace 0035: tabulky lab_strategy_defs / runs s user_id, available_at v lab_cot, breakpointy',/CREATE TABLE IF NOT EXISTS lab_strategy_defs/.test(mig)&&/CREATE TABLE IF NOT EXISTS lab_strategy_runs/.test(mig)&&/available_at/.test(mig)&&mig.split('--> statement-breakpoint').length===4&&(mig.match(/user_id VARCHAR\(128\) NOT NULL/g)||[]).length===2);
 const tab=src('app/laborator/lab-page.tsx');
 check('Laboratoř: záložka Strategie',/\['strategies','Strategie'\]/.test(tab)&&/<StrategiesTab\/>/.test(tab));
}

{
 // chybějící externí data: povinný COT bez dat signál nepustí, zprávy mimo pokrytí kalendáře ano
 const d=validateDef({...ALL_DEF,conditions:[{id:'z2',block:'zone',params:{impulseK:.6,requireBreak:false,status:'valid',maxBase:2,baseBodyRatio:.7}},{id:'c',block:'cot_index'}],entry:{type:'market_on_close'},stop:{from:'z2',key:'distal'},targets:{type:'r',r:2},filters:{}}).def;
 const pm=prepare('EUR/USD',eu,'H1'),cp=compile(d,pm,{}),sim=simulate(d,[pm],[cp],{});
 const dn=validateDef({...ALL_DEF,conditions:[{id:'z2',block:'zone',params:{impulseK:.6,requireBreak:false,status:'valid',maxBase:2,baseBodyRatio:.7}},{id:'n',block:'news_blackout'}],entry:{type:'market_on_close'},stop:{from:'z2',key:'distal'},targets:{type:'r',r:2},filters:{}}).def;
 const sn=simulate(dn,[pm],[compile(dn,pm,{})],{});
 check('bez dat: povinný COT neplatí (0 signálů), zprávy bez kalendáře neblokují (signály, počítané jako bez dat)',sim.signals===0&&sn.signals>0&&sn.unknown.news_blackout===sn.signals,{cot:sim.signals,news:sn.signals,u:sn.unknown});
}

console.log(fails.length?`\n${fails.length} chyb`:'\nvše v pořádku');
process.exit(fails.length?1:0);
