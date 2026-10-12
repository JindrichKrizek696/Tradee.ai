// Kontrola obchodních hodin burz a krypta: node --experimental-strip-types scripts/check-market-hours.mjs
import {EXCHANGES,CRYPTO,venueState,exchanges,zoned,offset,pragueAt} from '../lib/market-hours.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const U=(mo,d,h,mi=0)=>Date.UTC(2026,mo-1,d,h,mi);
const V=id=>EXCHANGES.find(v=>v.id===id),st=(id,t)=>venueState(V(id),t);

// --- zóny a letní čas ---
check('offset: Praha léto/zima, Tokio, New York',offset('Europe/Prague',U(7,1,12))===120&&offset('Europe/Prague',U(1,15,12))===60&&offset('Asia/Tokyo',U(7,1,12))===540&&offset('America/New_York',U(7,1,12))===-240&&offset('America/New_York',U(1,15,12))===-300);
check('zoned: NY 9:30 před / po přechodu USA na letní čas (8. 3.)',zoned('America/New_York',2026,3,6,570)===U(3,6,14,30)&&zoned('America/New_York',2026,3,9,570)===U(3,9,13,30),[new Date(zoned('America/New_York',2026,3,9,570)).toISOString()]);
check('zoned: Frankfurt 9:00 před / po přechodu EU (29. 3. a 25. 10.)',zoned('Europe/Berlin',2026,3,27,540)===U(3,27,8)&&zoned('Europe/Berlin',2026,3,30,540)===U(3,30,7)&&zoned('Europe/Berlin',2026,10,26,540)===U(10,26,8));

// --- NYSE v týdnech, kdy USA a Evropa mají letní čas jinak ---
const nyMar4=st('nyse',U(3,4,12)),nyMar18=st('nyse',U(3,18,12)),nyOct28=st('nyse',U(10,28,12)),nyApr=st('nyse',U(4,1,12));
check('NYSE 4. 3. (obě zimní): otevírá 15:30 pražského času',!nyMar4.open&&nyMar4.label==='otevírá 15:30'&&nyMar4.segs[0][0]===930,nyMar4);
check('NYSE 18. 3. (USA už letní, EU ne): otevírá 14:30',nyMar18.label==='otevírá 14:30'&&nyMar18.next===U(3,18,13,30)&&nyMar18.segs[0][0]===870,nyMar18);
check('NYSE 1. 4. (obě letní): zase 15:30',nyApr.label==='otevírá 15:30'&&nyApr.segs[0][0]===930,nyApr);
check('NYSE 28. 10. (EU už zimní, USA ne): otevírá 14:30',nyOct28.label==='otevírá 14:30'&&nyOct28.next===U(10,28,13,30)&&nyOct28.segs[0][0]===870,nyOct28);
const nySun=st('nyse',U(3,8,12));
check('neděle přechodu USA: příští otevření v pondělí už podle letního času',!nySun.open&&nySun.next===U(3,9,13,30)&&nySun.label==='otevírá po 14:30',nySun);

// --- Evropa kolem přechodů ---
const xFri=st('xetra',U(3,27,16)),xAfter=st('xetra',U(3,27,16,30));
check('Xetra pátek před přechodem: otevřeno, zavírá za 30 min',xFri.open&&xFri.label==='zavírá za 30 min'&&xFri.next===U(3,27,16,30),xFri);
check('Xetra po zavření v pátek: otevírá po 9:00 (pondělí už letní čas)',!xAfter.open&&xAfter.next===U(3,30,7)&&xAfter.label==='otevírá po 9:00',xAfter);
const xFall=st('xetra',U(10,25,0,30)),lFall=st('lse',U(10,25,0,30));
check('noc přechodu EU na zimní čas: Xetra i LSE otevírají po 9:00 pražského',xFall.next===U(10,26,8)&&xFall.label==='otevírá po 9:00'&&lFall.next===U(10,26,8)&&lFall.label==='otevírá po 9:00',[xFall,lFall]);
check('LSE v létě 8:00 BST = 7:00 UTC (hranice: otevřeno od, zavřeno do)',st('lse',U(7,1,7)).open&&!st('lse',U(7,1,6,59)).open&&!st('lse',U(7,1,15,30)).open&&st('lse',U(7,1,15,29)).open);

// --- Tokio: polední pauza, bez letního času ---
const tAm=st('tse',U(10,12,2)),tLunch=st('tse',U(10,12,2,45)),tPm=st('tse',U(10,12,5)),tShut=st('tse',U(10,12,7));
check('TSE dopoledne: otevřeno, pauza za 30 min',tAm.open&&tAm.label==='pauza za 30 min',tAm);
check('TSE polední pauza: zavřeno, otevírá 5:30 pražského',!tLunch.open&&tLunch.lunch&&tLunch.next===U(10,12,3,30)&&tLunch.label==='polední pauza · otevírá 5:30',tLunch);
check('TSE odpoledne: zavírá za 1 h 30 min',tPm.open&&tPm.label==='zavírá za 1 h 30 min',tPm);
check('TSE po zavření: ne pauza, otevírá út 2:00',!tShut.open&&!tShut.lunch&&tShut.label==='otevírá út 2:00',tShut);
check('TSE osa: v létě 2:00 a 5:30 Prahy, v zimě 1:00 a 4:30',JSON.stringify(tAm.segs)==='[[120,150],[330,180]]'&&JSON.stringify(st('tse',U(1,14,2)).segs)==='[[60,150],[270,180]]',[tAm.segs,st('tse',U(1,14,2)).segs]);

// --- víkend, hranice, souhrn ---
const sat=exchanges(U(10,17,10));
check('sobota: všechny burzy zavřené, Tokio otevírá po 2:00',sat.open===0&&sat.label==='Burzy zavřené'&&sat.list.find(x=>x.id==='tse').label==='otevírá po 2:00'&&sat.list.every(x=>new Date(x.next).getUTCDay()===1),sat.list.map(x=>x.label));
const fri=st('nyse',U(10,16,19)),friLate=st('nyse',U(10,16,20,30));
check('NYSE pátek: zavírá za 1 h, po zavření až v pondělí',fri.open&&fri.label==='zavírá za 1 h'&&!friLate.open&&friLate.next===U(10,19,13,30)&&friLate.label==='otevírá po 15:30',[fri,friLate]);
check('NYSE hranice: 9:30 otevřeno, 16:00 zavřeno',st('nyse',U(10,12,13,30)).open&&!st('nyse',U(10,12,20)).open&&st('nyse',U(10,12,19,59)).label==='zavírá za 1 min');
const mon=exchanges(U(10,12,13,45));
check('pondělí 15:45 Prahy: otevřené Frankfurt, Londýn, New York',mon.open===3&&mon.label==='Burzy otevřené 3/4'&&!mon.list.find(x=>x.id==='tse').open,mon.list.map(x=>[x.id,x.open]));
check('krypto nonstop',CRYPTO.open&&CRYPTO.next===null&&JSON.stringify(CRYPTO.segs)==='[[0,1440]]');
check('pragueAt: dnes bez dne, jindy se zkratkou',pragueAt(U(10,12,13),U(10,12,8))==='15:00'&&pragueAt(U(10,13,13),U(10,12,8))==='út 15:00');
// náhodné časy: stav sedí s next (otevřeno → next je zavření v budoucnu, zavřeno → otevření), žádná výjimka
let bad=[];for(let i=0;i<2000;i++){const t=U(1,1,0)+Math.floor(i*365.25/2000*86400000)+i*7919;for(const v of EXCHANGES){const s=venueState(v,t),again=venueState(v,s.next);if(!(s.next>t)||again.open===s.open||venueState(v,s.next-1).open!==s.open)bad.push([v.id,new Date(t).toISOString()])}}
check('celý rok: v okamžiku next se stav opravdu přepne',bad.length===0,bad.slice(0,5));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
