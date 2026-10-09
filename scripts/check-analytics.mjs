// Kontrola analytiky deníku: node --experimental-strip-types scripts/check-analytics.mjs
import {sessionOf,sessionOfHour,bySession,byMarketType,marketTypeOf,heatmap,holdStats,median,insights,weekdayOf} from '../lib/journal/analytics.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
let n=0;
const tr=(o={})=>({id:'mt:'+(++n),source:'mt',symbol:'EURUSD',instrument:'EUR/USD',openTs:Date.UTC(2026,9,5,7,0),closeTs:Date.UTC(2026,9,5,9,0),holdMs:7200000,pnl:10,r:null,tags:[],...o});
// --- seance (hranice a DST)
const h=[[0,'asia'],[7,'asia'],[8,'london'],[12,'london'],[13,'overlap'],[16,'overlap'],[17,'ny'],[21,'ny'],[22,'off'],[23,'off']];
check('seance: hranice hodin',h.every(([x,k])=>sessionOfHour(x)===k),h.filter(([x,k])=>sessionOfHour(x)!==k));
check('seance: léto (CEST) 06:00Z = 08:00 → Londýn',sessionOf(Date.UTC(2026,9,5,6,0))==='london');
check('seance: zima (CET) 06:00Z = 07:00 → Asie',sessionOf(Date.UTC(2026,0,12,6,0))==='asia');
check('seance: přechod na letní čas 29. 3. 2026, 00:30Z = 01:30 → Asie',sessionOf(Date.UTC(2026,2,29,0,30))==='asia');
check('seance: 29. 3. 2026 05:59Z = 07:59 CEST → Asie, 06:00Z = 08:00 → Londýn',sessionOf(Date.UTC(2026,2,29,5,59))==='asia'&&sessionOf(Date.UTC(2026,2,29,6,0))==='london');
check('seance: přechod na zimní čas 25. 10. 2026, 20:59Z = 21:59 CET → NY, 21:00Z = 22:00 → Mimo',sessionOf(Date.UTC(2026,9,25,20,59))==='ny'&&sessionOf(Date.UTC(2026,9,25,21,0))==='off');
const ss=bySession([tr(),tr({pnl:-5,r:-1}),tr({openTs:Date.UTC(2026,9,5,12,0),pnl:30,r:2}),tr({openTs:null,holdMs:null})]);
check('seance: 5 skupin v pořadí, ruční bez času se nepočítá',ss.length===5&&ss.map(b=>b.key).join()==='asia,london,overlap,ny,off'&&ss.reduce((s,b)=>s+b.count,0)===3,ss);
check('seance: Londýn 2 obchody, win rate 50 %, součet 5',ss[1].count===2&&ss[1].winRate===50&&ss[1].total===5&&ss[1].avgR===-1,ss[1]);
check('seance: Překryv = jediný obchod, avgR 2',ss[2].count===1&&ss[2].avgR===2);
check('seance: prázdná skupina má winRate null',ss[0].count===0&&ss[0].winRate===null);
// --- typ trhu
const mt=[['EUR/USD','EURUSD','fx'],['USD',null,'fx'],['^NDX','NAS100','index'],['AAPL','AAPL','stock'],['BTC-USD','BTCUSD','crypto'],['JPM','JPM','stock'],[null,'XAUUSD','commodity'],[null,'USOIL.cash','commodity'],[null,'XYZ','other'],[null,'','other']];
check('typ trhu: mapování',mt.every(([i,s,k])=>marketTypeOf(i,s||'')===k),mt.filter(([i,s,k])=>marketTypeOf(i,s||'')!==k));
const bm=byMarketType([tr(),tr({instrument:'^NDX',symbol:'NAS100',pnl:-4}),tr({instrument:null,symbol:'XAUUSD',pnl:3}),tr({instrument:null,symbol:'ZZZ',openTs:null,holdMs:null,source:'manual',pnl:1})]);
check('typ trhu: jen neprázdné, ruční zahrnuty, pořadí',bm.map(b=>b.key).join()==='fx,index,commodity,other'&&bm[3].count===1,bm);
// --- heatmapa (úterý 6. 10. 2026 13:00 UTC = 15:00 Praha)
const tue=Date.UTC(2026,9,6,13,0);
check('den v týdnu: pondělí = 0, neděle = 6',weekdayOf(Date.UTC(2026,9,5,10))===0&&weekdayOf(Date.UTC(2026,9,11,10))===6);
const hm=heatmap([tr({openTs:tue,pnl:100}),tr({openTs:tue+600000,pnl:20}),tr({openTs:tue,pnl:-50}),tr({openTs:Date.UTC(2026,9,5,22,30)}),tr({openTs:null})]);
check('heatmapa: Út 15:00 = 3 obchody, +70',hm.cells[1][15].count===3&&hm.cells[1][15].total===70,hm.cells[1][15]);
check('heatmapa: pondělí 00:30 Praha (22:30Z v létě → 00:30 úterý!)',hm.cells[1][0].count===1);
check('heatmapa: maxima, 7×24, ruční mimo',hm.maxCount===3&&hm.maxAbs===70&&hm.cells.length===7&&hm.cells.every(r=>r.length===24));
const hx=heatmap([tr({openTs:tue,closeTs:tue+3*3600000,pnl:40}),tr({openTs:null,closeTs:tue+3*3600000,source:'manual',pnl:5}),tr({openTs:tue,closeTs:Date.UTC(2026,9,9,14,0),pnl:-10})],'exit');
check('heatmapa výstupů: Út 18:00 = 1 (ruční mimo), Pá 16:00 = 1',hx.cells[1][18].count===1&&hx.cells[1][18].total===40&&hx.cells[4][16].count===1&&hx.cells[4][16].total===-10,[hx.cells[1][18],hx.cells[4][16]]);
// --- doba držení
check('medián: lichý, sudý, prázdný',median([3,1,2])===2&&median([1,2,3,10])===3&&median([])===null);
const min=60000;
const hs=holdStats([tr({holdMs:10*min,pnl:1}),tr({holdMs:15*min,pnl:1}),tr({holdMs:59*min,pnl:-1}),tr({holdMs:60*min,pnl:2}),tr({holdMs:4*60*min,pnl:-3}),tr({holdMs:24*60*min,pnl:5}),tr({holdMs:null,openTs:null,pnl:7})]);
check('držení: koše < 15 / 15–60 / 1–4 h / 4–24 h / > 1 den',hs.buckets.map(b=>b.count).join()==='1,2,1,1,1',hs.buckets);
check('držení: P&L koše 15–60 min = 0',hs.buckets[1].total===0&&hs.buckets[4].total===5);
check('držení: výherní vs ztrátové (bez obchodů bez času)',hs.winners.count===4&&hs.losers.count===2&&hs.losers.avgMs===Math.round((59*min+240*min)/2)&&hs.losers.medianMs===Math.round((59*min+240*min)/2),hs);
// --- postřehy
check('postřehy: málo dat → prázdno',insights([tr(),tr(),tr(),tr()],'USD').length===0);
const many=(k,o)=>Array.from({length:k},()=>tr(o));
const lon={openTs:Date.UTC(2026,9,5,7,0)},fri={openTs:Date.UTC(2026,9,9,15,0)}; // Pá 17:00 Praha → blok 16–20
const set=[...many(5,{...lon,pnl:80,r:1}),...many(2,{...lon,pnl:-30}),...many(5,{...fri,pnl:-24,holdMs:6*3600000}),...many(5,{...lon,pnl:5,holdMs:3600000})];
const ins=insights(set,'USD');
check('postřehy: nejlepší seance se jménem, součtem a win rate',ins[0].startsWith('Nejlépe ti jde Londýn (')&&ins[0].includes('+')&&ins[0].includes('$')&&/\d+ %\)\.$/.test(ins[0]),ins);
check('postřehy: ztrátové držíš N× déle',ins.some(s=>/^Ztrátové obchody držíš \d+(,\d)?× déle než ziskové\.$/.test(s)),ins);
check('postřehy: nejhorší den × blok',ins.some(s=>s.startsWith('Pátky 16:00–20:00 jsou ve ztrátě (')),ins);
check('postřehy: nejvýš 4',insights([...set,...many(6,{...fri,openTs:Date.UTC(2026,9,6,13),instrument:'^NDX',symbol:'NAS100',pnl:200})],'USD').length<=4);
check('postřehy: hold poměr < 1,5× se nehlásí',!insights([...many(5,{pnl:10,holdMs:3600000}),...many(5,{pnl:-10,holdMs:4000000})],'USD').some(s=>s.includes('déle')));
check('postřehy: skupina pod 5 obchodů se ignoruje',!insights([...many(4,{...fri,pnl:-500}),...many(5,lon)],'USD').some(s=>s.includes('Pátky')));
if(fails.length){console.log('\n'+fails.length+' selhalo');process.exit(1)}console.log('\nvše ok');
