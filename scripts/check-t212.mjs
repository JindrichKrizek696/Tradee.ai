// Kontrola importu z Trading 212: node --experimental-strip-types scripts/check-t212.mjs
// Fixture scripts/fixtures/t212-synthetic.csv má vymyšlená data (stejné sloupce jako export T212).
import {readFileSync} from 'node:fs';
import {parseCsv,parseTime,parseT212,planImport,t212Position,t212Ticket} from '../lib/import/t212.ts';
import {mapSymbol} from '../lib/checklists/core.ts';
import {currenciesOf} from '../lib/discipline/rules.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const throws=(fn,re)=>{try{fn();return false}catch(e){return re.test(e.message)}};
const near=(a,b)=>a!==null&&b!==null&&Math.abs(a-b)<1e-9;

// --- CSV
const c=parseCsv('﻿a,b,c\r\n1,"x, ""y""",3\n"multi\nline",,\n\n');
check('csv: BOM, uvozovky, čárka a nový řádek v poli, prázdné řádky',c.length===3&&c[0][0]==='a'&&c[1][1]==='x, "y"'&&c[2][0]==='multi\nline'&&c[2].length===3,c);
check('čas: UTC s offsetem i bez zóny',parseTime('2026-03-02 09:00:00+00:00')===Date.UTC(2026,2,2,9)&&parseTime('2026-03-02 10:00:00+01:00')===Date.UTC(2026,2,2,9)&&parseTime('2026-03-02 09:00:00')===Date.UTC(2026,2,2,9)&&parseTime('')===null,null);
check('chybné CSV → srozumitelná chyba',throws(()=>parseT212('foo,bar\n1,2'),/Trading 212/)&&throws(()=>parseT212(''),/prázdný/),null);

// --- fixture
const p=parseT212(readFileSync(new URL('./fixtures/t212-synthetic.csv',import.meta.url),'utf8'));
const by=(pid,part=0)=>p.trades.find(t=>t.positionId===pid&&t.part===part);
check('obchody: 5 (4 pozice, jedna částečně uzavřená)',p.trades.length===5,p.trades.map(t=>t.positionId));
check('otevřená pozice se nepočítá, jen hlásí',p.openPositions===1&&!p.trades.some(t=>t.symbol==='COCOA'),p.openPositions);
check('řazení podle uzavření',p.trades.every((t,i)=>!i||p.trades[i-1].closeTs<=t.closeTs),null);
check('měna a období',p.currencies.join()==='USD'&&p.period.from===Date.UTC(2026,2,1,10)&&p.period.to===Date.UTC(2026,2,6,14),p.period);

const a=by('91000000000001');
check('P1: symbol, směr, kusy, ceny, název s čárkou a uvozovkami',a.symbol==='EURUSD'&&a.side==='buy'&&a.units===1000&&a.entry===1.082&&a.exit===1.09&&a.instrument==='EUR/USD, spot "test"',a);
check('P1: časy otevření/uzavření',a.openTs===Date.UTC(2026,2,2,9)&&a.closeTs===Date.UTC(2026,2,2,15),a);
check('P1: počáteční SL/TP a posun SL',a.slInitial===1.08&&a.tpInitial===1.09&&a.slLast===1.085&&a.slChanges.length===1&&a.slChanges[0].old===1.08&&a.slChanges[0].new===1.085&&a.slChanges[0].ts===Date.UTC(2026,2,2,11)&&!a.tpChanges.length,a);
check('P1: výstup TP, vstup tržním příkazem, úplný',a.exitReason==='tp'&&a.openReason==='market'&&a.complete,a);
check('P1: výsledek a rozpad',a.result===8&&a.fxFee===-0.04&&a.overnight===0&&a.spread===0.2&&a.total===7.96,a);
check('P1: riziko, R:R a R',near(a.riskMoney,2)&&a.rrPlanned===4&&a.r===3.98,{risk:a.riskMoney,rr:a.rrPlanned,r:a.r});

const b=by('92000000000002');
check('P2: sell z čekajícího příkazu',b.side==='sell'&&b.openReason==='pending',b);
check('P2: SL aktivní při vstupu = poslední zadaný před vstupem',b.slInitial===79.5&&b.tpInitial===75&&!b.slChanges.length,b);
check('P2: výstup SL, swap v celkovém výsledku',b.exitReason==='sl'&&b.overnight===-3&&b.fxFee===-0.1&&b.total===-18.1,b);
check('P2: R záporné, R:R 2',near(b.riskMoney,15)&&b.rrPlanned===2&&b.r===-1.21,{risk:b.riskMoney,rr:b.rrPlanned,r:b.r});

const n0=by('93000000000003',0),n1=by('93000000000003',1);
check('P3: částečné uzavření → 2 obchody',n0&&n1&&n0.parts===2&&n1.parts===2&&n0.units===50&&n1.units===50,{n0,n1});
check('P3: důvod výstupu každé části (ručně, TP)',n0.exitReason==='manual'&&n1.exitReason==='tp',[n0.exitReason,n1.exitReason]);
check('P3: R každé části z jejích kusů',near(n0.riskMoney,5)&&n0.r===1&&n1.r===2,[n0.r,n1.r]);

const x=by('94000000000004');
check('P4: pozice otevřená před obdobím exportu – bez SL a důvodu, neúplná',x.slInitial===null&&x.tpInitial===null&&x.exitReason===null&&x.openReason===null&&x.r===null&&!x.complete&&x.total===100,x);

check('součty: výsledek vč. swapu a poplatků',p.totals.count===5&&p.totals.total===104.86&&p.totals.result===108&&p.totals.fxFee===-0.14&&p.totals.overnight===-3&&p.totals.spread===1.7&&p.totals.wins===4&&p.totals.losses===1,p.totals);
check('hotovost: vklady, výběry, převody, úroky',p.cash.deposits===1000&&p.cash.withdrawals===200&&p.cash.transfersOut===50&&p.cash.transfersIn===0&&p.cash.interest===1.5,p.cash);

// --- deduplikace a tickety
check('ticket: Position ID, další části :rN',t212Ticket('9',0)==='9'&&t212Ticket('9',2)==='9:r2',null);
const first=planImport(p.trades,[]);
check('první import: vše nové, tickety podle částí',first.fresh.length===5&&!first.dup.length&&first.fresh.find(t=>t.positionId==='93000000000003'&&t.part===1).ticket==='93000000000003:r1',first.fresh.map(t=>t.ticket));
const again=planImport(p.trades,first.fresh.map(t=>({ticket:t.ticket,close_ts:t.closeTs})));
check('opakovaný import: vše duplicitní',!again.fresh.length&&again.dup.length===5,again);
const partial=planImport(p.trades,[{ticket:'93000000000003',close_ts:n0.closeTs},{ticket:'91000000000001',close_ts:a.closeTs}]);
check('překryv: známé části přeskočí, nová část dostane volný ticket',partial.dup.length===2&&partial.fresh.length===3&&partial.fresh.find(t=>t.positionId==='93000000000003').ticket==='93000000000003:r1',partial.fresh.map(t=>t.ticket));
const shifted=planImport([n1],[{ticket:'93000000000003',close_ts:n0.closeTs}]);
check('druhá část v novém exportu (první už v DB) → :r1',shifted.fresh.length===1&&shifted.fresh[0].ticket==='93000000000003:r1',shifted);

// --- řádek mt_positions
const pos=t212Position('mta_x',{...b,ticket:'92000000000002'});
check('pozice: id, net = celkový výsledek, swap, poplatek, spread',pos.position.id==='mta_x:92000000000002'&&pos.position.net===-18.1&&pos.position.swap===-3&&pos.position.fee===-0.1&&pos.position.profit===-15&&pos.position.spread_cost===0.3&&pos.position.status==='closed',pos.position);
check('pozice: SL/TP, důvody, R',pos.position.sl_initial===79.5&&pos.position.close_reason==='sl'&&pos.position.open_reason==='pending'&&pos.position.r_result===-1.21&&pos.position.risk_pct===null,pos.position);
const posA=t212Position('mta_x',{...a,ticket:'91000000000001'});
check('průběh: otevření, posun SL, uzavření',posA.changes.map(c=>c.kind).join()==='open,sl,close'&&posA.changes[1].new_value===1.085,posA.changes);
check('průběh: částečné uzavření',t212Position('mta_x',{...n0,ticket:'x'}).changes.at(-1).kind==='partial_close'&&t212Position('mta_x',{...n1,ticket:'y'}).changes.at(-1).kind==='close',null);

// --- mapování symbolů T212
const ids=['EUR/USD','GBP/USD','^NDX','^GSPC','GC=F','SI=F','CL=F','BZ=F','AAPL'];
check('mapování: XAGUSD, BRENT, CRUDE, TECH100, USA500, EURUSD, AAPL',mapSymbol('XAGUSD',ids,{})==='SI=F'&&mapSymbol('BRENT',ids,{})==='BZ=F'&&mapSymbol('CRUDE',ids,{})==='CL=F'&&mapSymbol('TECH100',ids,{})==='^NDX'&&mapSymbol('USA500',ids,{})==='^GSPC'&&mapSymbol('EURUSD',ids,{})==='EUR/USD'&&mapSymbol('AAPL',ids,{})==='AAPL',null);
check('mapování: NATGAS, COCOA, BAYN bez trhu; ruční přiřazení má přednost',mapSymbol('NATGAS',ids,{})===null&&mapSymbol('COCOA',ids,{})===null&&mapSymbol('BAYN',ids,{})===null&&mapSymbol('NATGAS',ids,{NATGAS:'CL=F'})==='CL=F',null);
check('zprávy: CRUDE = ropa',currenciesOf('CRUDE').join()==='OIL',null);

if(fails.length){console.log(`\n${fails.length} kontrol selhalo`);process.exit(1)}
console.log('\nVše v pořádku.');

// Pojistka: podvržený soubor s mnoha řádky jedné pozice se odmítne (žádná kvadratická práce)
{
 const {parseT212:p,MAX_PARTS_PER_POSITION:M}=await import('../lib/import/t212.ts');
 const fs=await import('node:fs');const src=fs.readFileSync(new URL('./fixtures/t212-synthetic.csv',import.meta.url),'utf8').replace(/^﻿/,'').split(/\r?\n/);
 const head=src[0],cols=head.split(','),row=cols.map(c=>c==='Record Type'?'Closed position':c==='Position ID'?'POSX':c==='Date (UTC)'||c.startsWith('Date opened')||c.startsWith('Date closed')?'2026-01-14 15:00:00+00:00':c==='Symbol'?'EURUSD':c==='Direction'?'Buy':c.startsWith('Units')||c.startsWith('Average')||c.startsWith('Close price')?'1':'');
 let threw=false;try{p([head,...Array(M+1).fill(row.join(','))].join('\n'))}catch{threw=true}
 if(!threw){console.log('FAIL pojistka počtu částí na pozici');process.exit(1)}else console.log('ok   pojistka počtu částí na pozici');
}
