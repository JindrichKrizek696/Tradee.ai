// Kontrola etapy 3A (graf): zóny (stav, knot vs. zavření, vnoření), Fib šablona, seance s DST, záložky a rozvržení, indikátory, VWAP bez objemu.
// node --experimental-strip-types scripts/check-chart-workspace.mjs
import {readFileSync} from 'node:fs';
import {evalZone,zoneEdges,zoneParent,nestZones,htfVisible,htfLabel,stateText,zoneKindFor,zoneScenario,zoneAlert,parseZoneMeta,penetration} from '../lib/chart/zones.ts';
import {fibLevels,FIB_THIRDS,FIB_DEFAULT,BUILTIN_PRESETS,applyLook,styleOf,levelsOn,parseDrawings,bulk,byLayer,duplicateOf,eqLabel,capsOf,MANUAL_TYPES,MANUAL_NOTE,DRAW_LABELS} from '../lib/chart/drawings.ts';
import {sessionWindows,sessionBox,SESSION_PRESETS} from '../lib/chart/sessions.ts';
import {wallMs,zonedToUtc,tzOffset,nyTradingDay,nyTradingWeek,tzLabel} from '../lib/chart/tz.ts';
import {sma,ema,rsi,atr,vwap,anchoredVwap,pdhl,dailyOpen,weeklyOpen,hasVolume,studyStatus,readStudies,periodic} from '../lib/chart/indicators.ts';
import {VIEW_DEFAULT,readView,newTab,addTab,duplicateTab,renameTab,moveTab,closeTab,restoreTab,mergeDrawings,applyLayout,layoutView,layoutChanged,dirtyTabs,parseWorkspace,validateWorkspace,validateLayouts,parseLayouts,viewKey,tabTitle,emptyWorkspace,MAX_TABS,MAX_CLOSED,SAVE_LABELS,updateTab} from '../lib/chart/workspace.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const near=(a,b,eps=1e-9)=>a!==null&&b!==null&&Math.abs(a-b)<=eps;
const H=3600000,t0=Date.UTC(2026,0,5,0);
const bar=(i,h,l,c)=>({t:t0+i*H,h,l,c});

// ---------- zóny ----------
// poptávka 100–110: proximální 110, distální 100
const E=zoneEdges('demand',[{p:100},{p:110}]);
check('zóna: poptávka – proximální horní, distální dolní',E.proximal===110&&E.distal===100&&E.hi===110&&E.lo===100,E);
const S=zoneEdges('supply',[{p:120},{p:130}]);
check('zóna: nabídka – proximální dolní, distální horní',S.proximal===120&&S.distal===130,S);
check('zóna: průnik 0 = proximální, 1 = distální',penetration('demand',E,110)===0&&penetration('demand',E,100)===1&&penetration('demand',E,105)===.5&&penetration('supply',S,125)===.5&&penetration('demand',E,111)<0);
const from=t0;// báze zóny končí v t0, vyhodnocení od další svíčky
const zb=[bar(0,150,140,145),bar(1,130,115,120),bar(2,125,108,118),bar(3,120,104,112),bar(4,115,99,103),bar(5,104,95,98)];
const ev=(rule,pct,bars=zb,extra={})=>evalZone({k:'demand',rule,pct,...extra},E,from,bars);
const w0=ev('touch',undefined,zb.slice(0,2));
check('zóna: bez dotyku = čekám',w0.state==='waiting'&&w0.history.length===0&&w0.depth===0,w0);
const tch=ev('touch',undefined,zb.slice(0,3));
check('zóna: pravidlo dotyk – knot na proximální = mitigována (20 %)',tch.state==='mitigated'&&near(tch.depth,.2)&&stateText(tch)==='mitigována 20 %'&&tch.history[0].t===zb[2].t,tch);
const cl=ev('close',undefined,zb.slice(0,3));
check('zóna: pravidlo zavření – jen knot v zóně = dotčena',cl.state==='touched'&&cl.history.length===1&&cl.history[0].state==='touched',cl);
const cl2=ev('close',undefined,zb.slice(0,4));
check('zóna: pravidlo zavření – zavření v zóně (112 < 110? ne) zůstane dotčena',cl2.state==='touched',cl2);
const cl3=ev('close',undefined,zb.slice(0,5));
check('zóna: pravidlo zavření – zavření 103 v zóně = mitigována, knot 99 = 100 %',cl3.state==='mitigated'&&cl3.depth===1&&cl3.history.map(h=>h.state).join()==='touched,mitigated',cl3);
const wickOnly=ev('touch',undefined,zb.slice(0,5));
check('zóna: knot pod distální (99) bez zavření pod ní ≠ zneplatnění',wickOnly.state==='mitigated'&&wickOnly.depth===1,wickOnly);
const inv=ev('touch',undefined,zb);
check('zóna: zavření pod distální (98) = zneplatněna',inv.state==='invalid'&&inv.history[inv.history.length-1].state==='invalid'&&inv.history[inv.history.length-1].t===zb[5].t,inv);
const p50=ev('pct',50,zb.slice(0,4));
check('zóna: pravidlo 50 % – průnik 60 % (104) = mitigována',p50.state==='mitigated'&&near(p50.depth,.6),p50);
const p70=ev('pct',70,zb.slice(0,4));
check('zóna: pravidlo 70 % – průnik 60 % = jen dotčena',p70.state==='touched'&&near(p70.depth,.6),p70);
const arch=ev('touch',undefined,zb,{arch:zb[3].t});
check('zóna: archiv zastaví vyhodnocení a zapíše se do historie',arch.state==='archived'&&arch.history.map(h=>h.state).join()==='mitigated,archived',arch);
const sup=evalZone({k:'supply',rule:'close'},S,from,[bar(1,121,110,115),bar(2,128,118,124),bar(3,135,120,131)]);
check('zóna: nabídka – knot dotčena, zavření v zóně mitigována, zavření nad distální zneplatněna',sup.history.map(h=>h.state).join()==='touched,mitigated,invalid',sup);
check('zóna: svíčky před koncem báze se ignorují',ev('touch',undefined,[{t:t0-H,h:200,l:50,c:60}]).state==='waiting');
check('zóna: historie mimo načtené svíčky = partial',ev('touch',undefined,zb).partial===false&&evalZone({k:'demand',rule:'touch'},E,t0+20*H,[bar(25,150,140,145)]).partial===true);
check('zóna: druh podle ceny',zoneKindFor([{p:100},{p:110}],120)==='demand'&&zoneKindFor([{p:130},{p:140}],120)==='supply');
// vnoření
const zs=[{id:'d1',tf:'D1',hi:120,lo:90},{id:'h4',tf:'H4',hi:110,lo:100},{id:'h1',tf:'H1',hi:108,lo:104},{id:'w1',tf:'W1',hi:150,lo:80},{id:'x',tf:'H1',hi:130,lo:125},{id:'h4b',tf:'H4',hi:109,lo:103}];
check('vnoření: H1 v H4 (nejbližší vyšší TF, nejužší)',zoneParent(zs[2],zs)==='h4b',zoneParent(zs[2],zs));
check('vnoření: H4 v D1, D1 ve W1, W1 nikde',zoneParent(zs[1],zs)==='d1'&&zoneParent(zs[0],zs)==='w1'&&zoneParent(zs[3],zs)===null);
check('vnoření: částečný překryv ≠ vnoření',zoneParent(zs[4],zs)==='w1'&&zoneParent({id:'y',tf:'H1',hi:125,lo:115},[zs[0],{id:'y',tf:'H1',hi:125,lo:115}])===null);
check('vnoření: ruční rodič má přednost',zoneParent({...zs[2],par:'d1'},zs)==='d1'&&zoneParent({...zs[2],par:'neni'},zs)==='h4b');
check('vnoření: mapa',nestZones(zs).get('h4')==='d1'&&!nestZones(zs).has('w1'));
check('HTF zóny: D1 na H1 jen se zapnutým přepínačem, popisek „D1 zóna“',htfVisible('D1','H1',true)&&!htfVisible('D1','H1',false)&&htfVisible('H1','D1',false)&&htfLabel('D1','H1')==='D1 zóna'&&htfLabel('H1','H1')===null);
const sc=zoneScenario('EUR/USD','demand',E,'H4',v=>String(v));
check('zóna → scénář: long, vstup v zóně, zneplatnění na distální',sc.bias==='long'&&sc.levels.entryFrom===100&&sc.levels.entryTo===110&&sc.levels.invalidation===100&&sc.hypothesis.includes('H4'),sc);
const al=zoneAlert('EUR/USD','supply',S,'D1',v=>String(v));
check('zóna → alert: dotyk proximální hrany',al.kind==='touch'&&al.level===120,al);
check('zóna: validace metadat',!!parseZoneMeta({k:'demand',rule:'pct',pct:50,at:Date.now()})&&parseZoneMeta({k:'x',rule:'touch',at:1})===null&&parseZoneMeta({k:'demand',rule:'pct',pct:0,at:Date.now()})===null&&parseZoneMeta({k:'demand',rule:'touch',at:Date.now(),al:'bad'})===null);
const zd={id:'abc123def456',type:'zone',a:[{t:t0,p:110},{t:t0+H,p:100}],color:'bull',otf:'H4',zn:{k:'demand',rule:'touch',at:t0}};
check('kresba zóny: parse s metadaty, bez metadat chyba',parseDrawings([zd]).ok&&!parseDrawings([{...zd,zn:undefined}]).ok&&parseDrawings([zd]).drawings[0].otf==='H4',parseDrawings([zd]));
check('kresba: neplatný TF vzniku a vrstva',!parseDrawings([{...zd,otf:'X9'}]).ok&&!parseDrawings([{...zd,z:5}]).ok&&parseDrawings([{...zd,z:2}]).drawings[0].z===2);

// ---------- Fibonacci šablona ----------
const tp=BUILTIN_PRESETS.find(p=>p.id==='tpl-thirds');
const on=levelsOn(FIB_THIRDS);
check('Fib šablona: třetiny a záporné extenze zapnuté',on.join()==='-1,-0.618,-0.272,0,0.333,0.5,0.666,1',on);
const L=fibLevels({t:0,p:110},{t:1,p:100},on);
const at=v=>L.find(x=>x.level===v).price;
check('Fib šablona: ceny hladin (1 = první bod 110, 0 = druhý 100)',near(at(.333),103.33)&&near(at(.5),105)&&near(at(.666),106.66)&&near(at(1),110)&&near(at(0),100)&&near(at(-1),90)&&near(at(-.272),97.28)&&near(at(-.618),93.82),L);
const fd=applyLook({id:'f1',type:'fib',a:[{t:0,p:110},{t:1,p:100}],color:'brand',otf:'H1'},tp);
check('Fib šablona: kresba dostane explicitní hladiny a kotvy zůstanou',JSON.stringify(fd.s.lv)===JSON.stringify(FIB_THIRDS)&&fd.a[0].p===110&&fd.otf==='H1');
const snapshot=JSON.stringify(fd);tp.s.lv[3].v=.4;
check('Fib šablona: změna šablony nepřepíše existující kresbu',JSON.stringify(fd)===snapshot&&styleOf(fd).lv[3].v!==.4);
tp.s.lv[3].v=FIB_THIRDS[3].v;
check('Fib: výchozí kresba bez šablony má výchozí hladiny',styleOf({type:'fib',color:'brand'}).lv===FIB_DEFAULT);

// ---------- kresby: vrstvy, hromadné akce, kopie, ruční značky ----------
const ds=[{id:'a',type:'hline',a:[{t:0,p:1}],color:'brand'},{id:'b',type:'rect',a:[{t:0,p:1},{t:1,p:2}],color:'bull',z:2},{id:'c',type:'trend',a:[{t:0,p:1},{t:1,p:2}],color:'bear',z:0}];
check('vrstvy: pozadí → hlavní → popředí',byLayer(ds).map(d=>d.id).join()==='c,a,b');
const bk=bulk(ds,['a','b'],{op:'hide'});
check('hromadně: skrýt / zamknout / smazat / vrstva',bk[0].hide&&bk[1].hide&&!bk[2].hide&&bulk(ds,['c'],{op:'delete'}).length===2&&bulk(ds,['a'],{op:'layer',z:0})[0].z===0&&!('z' in bulk(ds,['b'],{op:'layer',z:1})[1])&&bulk(bulk(ds,['a'],{op:'lock'}),['a'],{op:'unlock'})[0].lock===undefined);
const dup=duplicateOf({...zd,lock:true,zn:{...zd.zn,scn:'scn_1',al:'al_x',arch:5}},'new1',999);
check('kopie: nové ID, odemčená, zóna bez scénáře/alertu/archivu',dup.id==='new1'&&!dup.lock&&!dup.zn.scn&&!dup.zn.al&&!dup.zn.arch&&dup.zn.at===999&&dup.a!==zd.a);
check('ruční značky: EQH/EQL podle blízkosti high/low',eqLabel(1.1,{high:1.1001,low:1.09})==='EQH'&&eqLabel(1.09,{high:1.1,low:1.0901})==='EQL'&&eqLabel(1,null)==='EQ');
check('ruční značky: typy a poznámka',MANUAL_TYPES.join()==='eqhl,fvg,mss'&&MANUAL_NOTE==='ruční značka ≠ ověřený setup'&&capsOf('fvg').fill&&!!DRAW_LABELS.mss);
check('ruční značky: parse FVG/EQ/MSS',parseDrawings(['eqhl','fvg','mss'].map((type,i)=>({id:'m'+i,type,a:[{t:0,p:1},{t:1,p:2}],color:'amber'}))).ok);

// ---------- časová pásma a seance s DST ----------
check('tz: Praha zima +1 h, léto +2 h, NY zima −5 h, léto −4 h',tzOffset(Date.UTC(2026,0,15),'Europe/Prague')===H&&tzOffset(Date.UTC(2026,6,15),'Europe/Prague')===2*H&&tzOffset(Date.UTC(2026,0,15),'America/New_York')===-5*H&&tzOffset(Date.UTC(2026,6,15),'America/New_York')===-4*H);
check('tz: místní → UTC',zonedToUtc(2026,3,9,7,0,'America/New_York')===Date.UTC(2026,2,9,11)&&zonedToUtc(2026,3,6,7,0,'America/New_York')===Date.UTC(2026,2,6,12)&&zonedToUtc(2026,7,1,9,0,'Asia/Tokyo')===Date.UTC(2026,6,1,0));
const win=(id,y,m,d)=>sessionWindows(id,Date.UTC(y,m-1,d,0),Date.UTC(y,m-1,d,23,59)).find(w=>new Date(w.start).getUTCDate()===d||new Date(w.end).getUTCDate()===d);
// USA přechází na letní čas 8. 3. 2026, Evropa 29. 3. 2026; zpět Evropa 25. 10., USA 1. 11. 2026
check('DST: NY killzóna 6. 3. (EST) 12:00 UTC',win('nykz',2026,3,6).start===Date.UTC(2026,2,6,12)&&win('nykz',2026,3,6).end===Date.UTC(2026,2,6,15));
check('DST: NY killzóna 9. 3. (EDT, Evropa ještě zima) 11:00 UTC = 12:00 Praha',win('nykz',2026,3,9).start===Date.UTC(2026,2,9,11)&&wallMs(win('nykz',2026,3,9).start,'Europe/Prague')===Date.UTC(2026,2,9,12));
check('DST: NY killzóna 30. 3. (obě léto) 13:00 Praha',wallMs(win('nykz',2026,3,30).start,'Europe/Prague')===Date.UTC(2026,2,30,13));
check('DST: Londýn 27. 3. (GMT) 08:00 UTC, 30. 3. (BST) 07:00 UTC',win('london',2026,3,27).start===Date.UTC(2026,2,27,8)&&win('london',2026,3,30).start===Date.UTC(2026,2,30,7));
check('DST: podzim – 26. 10. NY 08:00 = 12:00 UTC (EDT), 2. 11. = 13:00 UTC (EST)',win('ny',2026,10,26).start===Date.UTC(2026,9,26,12)&&win('ny',2026,11,2).start===Date.UTC(2026,10,2,13));
check('DST: Londýn killzóna podle času NY – 9. 3. 02:00 EDT = 06:00 UTC',win('lkz',2026,3,9).start===Date.UTC(2026,2,9,6));
check('DST: Asie (Tokio bez DST) vždy 00:00 UTC',win('asia',2026,1,15).start===Date.UTC(2026,0,15,0)&&win('asia',2026,7,15).start===Date.UTC(2026,6,15,0));
check('seance: víkend bez okna',sessionWindows('london',Date.UTC(2026,2,7),Date.UTC(2026,2,8,23)).length===0);
const lb=[{t:Date.UTC(2026,2,30,6),h:9,l:1},{t:Date.UTC(2026,2,30,7),h:5,l:3},{t:Date.UTC(2026,2,30,12),h:7,l:2},{t:Date.UTC(2026,2,30,16),h:20,l:0}];
const box=sessionBox(win('lbox',2026,3,30),lb);
check('box Londýna 30. 3.: high/low svíček 07:00–16:00 UTC',box.hi===7&&box.lo===2&&box.n===2,box);
check('box bez svíček = null',sessionBox({id:'nybox',start:0,end:1},lb)===null);
check('seance: všechny presety mají pásmo',Object.values(SESSION_PRESETS).every(p=>p.tz&&p.from&&p.to));
check('tz: popisek osy v pásmu',tzLabel(Date.UTC(2026,0,5,14,30),'America/New_York','time')==='09:30'&&tzLabel(Date.UTC(2026,0,5,14,30),'UTC','datetime')==='5. 1. 2026 14:30');
check('NY obchodní den: 16:59 NY a 17:00 NY patří do různých dnů',nyTradingDay(Date.UTC(2026,0,6,21,59))!==nyTradingDay(Date.UTC(2026,0,6,22,0))&&nyTradingDay(Date.UTC(2026,0,6,22,0))===nyTradingDay(Date.UTC(2026,0,7,12)));
check('NY obchodní týden začíná v neděli 17:00 NY',nyTradingWeek(Date.UTC(2026,0,4,21,59))!==nyTradingWeek(Date.UTC(2026,0,4,22,0))&&nyTradingWeek(Date.UTC(2026,0,4,22,0))===nyTradingWeek(Date.UTC(2026,0,9,20)));

// ---------- indikátory vs. referenční hodnoty ----------
const cs=[44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64];
const s3=sma([1,2,3,4,5],3);
check('SMA(3): null, null, 2, 3, 4',s3.join()===',,2,3,4',s3);
const e3=ema([1,2,3,4,5,6],3);
check('EMA(3): seed SMA 2, pak k = 0,5 → 3, 4, 5',e3[2]===2&&e3[3]===3&&e3[5]===5&&e3[1]===null,e3);
const r=rsi(cs,14);
// referenční RSI(14) Wilder pro tuto řadu (klasický příklad): 70,46 a 66,25
check('RSI(14) referenční hodnoty 70,46 / 66,25',near(r[14],70.46,.02)&&near(r[15],66.25,.03)&&r[13]===null,r.slice(13,17));
check('RSI: jen růst = 100, beze změny = 50',rsi([1,2,3,4,5],3)[4]===100&&rsi([2,2,2,2],2)[3]===50);
const ab=[{t:0,o:10,h:12,l:9,c:11},{t:1,o:11,h:13,l:10,c:12},{t:2,o:12,h:12.5,l:8,c:9},{t:3,o:9,h:10,l:7,c:8}];
const a2=atr(ab,2);
check('ATR(2): TR 3, 3, 4,5, 3 → ATR 3, 3,75, 3,375',a2[0]===null&&a2[1]===3&&near(a2[2],3.75)&&near(a2[3],3.375),a2);
const vb=[{t:Date.UTC(2026,0,6,14),o:10,h:11,l:9,c:10,v:100},{t:Date.UTC(2026,0,6,15),o:10,h:13,l:11,c:12,v:300},{t:Date.UTC(2026,0,6,23),o:12,h:12,l:12,c:12,v:50}];
const vw=vwap(vb);
check('VWAP: (10·100 + 12·300)/400 = 11,5; reset v 17:00 NY',vw.status==='ok'&&vw.values[0]===10&&near(vw.values[1],11.5)&&vw.values[2]===12,vw);
const nv=vb.map(({v,...b})=>b);
check('VWAP bez objemu = nedostupné – trh nemá objem',vwap(nv).status==='novolume'&&anchoredVwap(nv,vb[0].t).status==='novolume'&&studyStatus(vwap(nv))==='nedostupné – trh nemá objem'&&!hasVolume(nv));
const av=anchoredVwap(vb,vb[1].t+1000);
check('anchored VWAP od svíčky kotvy',av.status==='ok'&&av.values[0]===null&&av.values[1]===12&&near(av.values[2],(12*300+12*50)/350),av);
check('anchored VWAP: kotva před svíčkami = nedostatek dat',anchoredVwap(vb,vb[0].t-H).status==='nodata'&&studyStatus({status:'nodata'})==='nedostatek dat');
const pb=[{t:Date.UTC(2026,0,6,14),o:1,h:5,l:1,c:2},{t:Date.UTC(2026,0,6,20),o:2,h:6,l:0.5,c:3},{t:Date.UTC(2026,0,6,23),o:3,h:4,l:2,c:3},{t:Date.UTC(2026,0,7,15),o:3,h:9,l:3,c:8}];
const pd=pdhl(pb);
check('PDH/PDL: předchozí obchodní den (do 17:00 NY)',pd.status==='ok'&&pd.high[0]===null&&pd.high[2]===6&&pd.low[2]===.5&&pd.high[3]===6,pd);
check('PDH/PDL: jeden den = nedostatek dat',pdhl(pb.slice(0,2)).status==='nodata');
const dop=dailyOpen(pb,0),do17=dailyOpen(pb,17),wo=weeklyOpen(pb);
check('denní open: NY půlnoc vs. 17:00 NY, týdenní open',dop.join()==='1,1,1,3'&&do17.join()==='1,1,3,3'&&wo.join()==='1,1,1,1',[dop,do17,wo]);
check('nedostatek dat: perioda delší než svíčky',periodic(sma([1,2],5),5,2).status==='nodata'&&periodic(sma([1,2,3],2),2,3).status==='ok');
check('indikátory: parametry se uloží a ořežou',readStudies({sma:{on:true,n:9},rsi:{on:true,n:1},avwap:{on:true,at:123},dwo:{on:true,at:17}}).sma.n===9&&readStudies({rsi:{n:1}}).rsi.n===14&&readStudies({avwap:{at:123}}).avwap.at===123&&readStudies({dwo:{at:17}}).dwo.at===17);

// ---------- záložky a rozvržení ----------
const ids=['EUR/USD','GC=F','BTC-USD'];
let ws=emptyWorkspace();
ws=addTab(ws,newTab('t1','EUR/USD'));ws=addTab(ws,newTab('t2','GC=F',{...VIEW_DEFAULT,tf:'D1'}));
check('záložky: nová je aktivní, název z trhu a TF',ws.active==='t2'&&tabTitle(ws.tabs[1])==='GC=F · D1');
ws=duplicateTab(ws,'t1','t3');
check('záložky: kopie hned za původní, nezávislý pohled',ws.tabs.map(t=>t.id).join()==='t1,t3,t2'&&ws.active==='t3'&&ws.tabs[1].view!==ws.tabs[0].view);
ws=renameTab(ws,'t3','  Můj   EURUSD  ');
check('záložky: přejmenování (mezery, délka)',ws.tabs[1].name==='Můj EURUSD'&&tabTitle(ws.tabs[1])==='Můj EURUSD'&&renameTab(ws,'t3','x'.repeat(99)).tabs[1].name.length===40);
ws=moveTab(ws,2,0);
check('záložky: přesun tažením',ws.tabs.map(t=>t.id).join()==='t2,t1,t3');
const drw=[{id:'d1',type:'hline',a:[{t:0,p:1}],color:'brand'},{id:'d2',type:'hline',a:[{t:0,p:2}],color:'bull'}];
ws=closeTab(ws,'t3',drw,1000);
check('záložky: zavření → nedávno zavřené se snímkem kreseb, aktivní soused',ws.tabs.length===2&&ws.closed[0].tab.id==='t3'&&ws.closed[0].drawings.length===2&&ws.active==='t1',ws.active);
const rs=restoreTab(ws,0);
check('záložky: obnovení vrátí záložku i snímek kreseb',rs.ws.tabs.length===3&&rs.ws.active==='t3'&&rs.ws.closed.length===0&&rs.drawings.length===2&&rs.ws.tabs[2].name==='Můj EURUSD');
const mg=mergeDrawings([drw[1]],rs.drawings);
check('záložky: doplní jen chybějící kresby (podle ID), nic nepřepíše',mg.added===1&&mg.drawings.map(d=>d.id).join()==='d2,d1');
let many=emptyWorkspace();for(let i=0;i<25;i++)many=addTab(many,newTab('m'+i,'EUR/USD'));
check('záložky: nejvýš 20',many.tabs.length===MAX_TABS);
for(let i=0;i<15;i++)many=closeTab(many,'m'+i,[],i);
check('záložky: nejvýš 10 zavřených, nejnovější první',many.closed.length===MAX_CLOSED&&many.closed[0].tab.id==='m14');
// perzistence: uložit → načíst = stejné
const saved=JSON.parse(JSON.stringify(rs.ws));
const back=parseWorkspace(saved,ids);
check('perzistence: JSON → parse beze ztráty',viewKey(back)===viewKey(rs.ws),back);
check('perzistence: neznámý trh a duplicitní ID se zahodí',parseWorkspace({tabs:[{id:'a',instrument:'XXX'},{id:'b',instrument:'EUR/USD'},{id:'b',instrument:'GC=F'}]},ids).tabs.length===1);
check('perzistence: PUT validace',validateWorkspace(saved,ids).ok&&!validateWorkspace({tabs:[{id:'a',instrument:'XXX'}]},ids).ok&&!validateWorkspace({tabs:'x'},ids).ok&&!validateWorkspace({tabs:Array.from({length:21},(_,i)=>({id:'q'+i,instrument:'EUR/USD'}))},ids).ok);
check('perzistence: poškozený pohled → výchozí hodnoty',readView({tf:'X',type:'nope',sessions:['london','bad'],tz:'Mars/X',studies:{sma:{on:true,n:5}}}).tf==='H4'&&readView({sessions:['london','bad']}).sessions.join()==='london'&&readView({tz:'Mars/X'}).tz==='Europe/Prague'&&readView({studies:{sma:{on:true,n:5}}}).studies.sma.n===5);
const dirty=dirtyTabs(saved,updateTab(rs.ws,'t1',{view:{tf:'M15'}}));
check('neuložené změny: tečka jen u změněné záložky',dirty.size===1&&dirty.has('t1')&&dirtyTabs(saved,rs.ws).size===0&&dirtyTabs(null,rs.ws).size===3);
check('stav ukládání: texty',SAVE_LABELS.saved==='Uloženo'&&SAVE_LABELS.saving==='Ukládám…'&&SAVE_LABELS.error==='Chyba synchronizace – zkusit znovu');
const lay={id:'L1',name:'Intraday',view:layoutView({...VIEW_DEFAULT,log:true,sessions:['nykz'],studies:readStudies({ema:{on:true,n:21}}),tree:true,tools:['zone','fib']}),strategy:{strategyId:'str_1',versionId:'v1_str_1',label:'Pullback v1'}};
const t1=rs.ws.tabs.find(t=>t.id==='t1'),ap=applyLayout({...t1,view:{...t1.view,tf:'M5'}},lay);
check('rozvržení: použití přepíše panely/indikátory/seance, TF a trh zůstanou',ap.layoutId==='L1'&&ap.view.log&&ap.view.sessions.join()==='nykz'&&ap.view.studies.ema.n===21&&ap.view.tf==='M5'&&ap.instrument==='EUR/USD'&&ap.view.tools.join()==='zone,fib');
check('rozvržení: změna v záložce = odchylka od rozvržení',!layoutChanged(ap,lay)&&layoutChanged({...ap,view:{...ap.view,log:false}},lay)&&!layoutChanged({...ap,view:{...ap.view,tf:'H1'}},lay));
check('rozvržení: validace (název, duplicity), strategie volitelně',validateLayouts([lay]).ok&&!validateLayouts([lay,{...lay,id:'L2'}]).ok&&!validateLayouts([{...lay,name:''}]).ok&&parseLayouts([{...lay,strategy:{strategyId:'bad id'}}])[0].strategy===null&&parseLayouts([lay])[0].strategy.versionId==='v1_str_1');

// ---------- migrace ----------
const mig=readFileSync(new URL('../drizzle/mariadb/0041_chart_workspace.sql',import.meta.url),'utf8');
check('migrace 0041: chart_tabs a chart_layouts',mig.includes('CREATE TABLE IF NOT EXISTS chart_tabs')&&mig.includes('CREATE TABLE IF NOT EXISTS chart_layouts')&&mig.includes('--> statement-breakpoint'));

if(fails.length){console.log(`\n${fails.length} FAIL`);process.exit(1)}
console.log('\nvše ok');
