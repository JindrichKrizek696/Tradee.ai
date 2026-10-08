// Kontrola deníku obchodů: node --experimental-strip-types scripts/check-journal.mjs
import {toJournalTrades,mtRowToTrade,manualRowToTrade,cleanTags,cleanNote,parseJournalId,checkUpload,splitTags} from '../lib/journal/rows.ts';
import {fmtHold,fmtR,fmtDate,pragueOffsetMs,tradesWord} from '../lib/journal/format.ts';
import {makeRates} from '../lib/fx.ts';
import {filterTrades,sanitizeFilter,sortTrades,summary,equityCurve,maxDrawdown,breakdown,pragueHour,DEFAULT_FILTER} from '../lib/journal/stats.ts';
import {chartTime,snapper,candles,levelSteps,tradeMarkers,pricePrecision} from '../lib/journal/chart-data.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const throws=(fn,re)=>{try{fn();return false}catch(e){return re.test(e.message)}};

// --- řádky
const rates=makeRates([{date:'2026-10-01',currency:'USD',per_eur:1.1},{date:'2026-10-01',currency:'CZK',per_eur:24.2}]);
const mtRow={id:'mta_1:10',account_id:'mta_1',symbol:'EURUSD',side:'buy',open_ts:Date.UTC(2026,9,5,7,0),close_ts:Date.UTC(2026,9,5,9,30),volume_max:0.5,net:994,r_result:1.99,rr_planned:2,risk_pct:1,risk_money:500,mfe_money:1100,mae_money:-100,tags:'test',tags_manual:'breakout,test',has_note:1,files:2,acc_currency:'USD',acc_name:'',acc_login:'12345678'};
const t=mtRowToTrade(mtRow,'CZK',rates);
check('mt: id, zdroj, účet',t.id==='mt:mta_1:10'&&t.source==='mt'&&t.accountId==='mta_1'&&t.account==='••••5678',t);
check('mt: přepočet do měny souhrnu',t.pnl===Math.round(994/1.1*24.2*100)/100&&t.converted&&t.net===994&&t.accountCurrency==='USD',t);
check('mt: datum = den zavření v Praze',t.date==='2026-10-05');
check('mt: R, MFE/MAE v R',t.r===1.99&&t.rr===2&&t.mfeR===2.2&&t.maeR===-0.2,[t.r,t.mfeR,t.maeR]);
check('mt: držení',t.holdMs===2.5*3600000);
check('mt: tagy bez duplicit',JSON.stringify(t.tags)==='["test","breakout"]',t.tags);
check('mt: poznámka a soubory',t.hasNote&&t.files===2);
const noRisk=mtRowToTrade({...mtRow,risk_money:null,r_result:null,rr_planned:null},'USD',rates);
check('mt: bez SL → R a MFE v R null',noRisk.r===null&&noRisk.mfeR===null&&noRisk.maeR===null);
const usc=mtRowToTrade({...mtRow,acc_currency:'XYZ'},'USD',rates);
check('mt: neznámá měna → hodnota účtu, converted false',usc.pnl===994&&!usc.converted);
check('mt: pojmenovaný účet',mtRowToTrade({...mtRow,acc_name:'Demo'},'USD',rates).account==='Demo');
const man=manualRowToTrade({id:'u1',date:'2026-10-04',instrument:'DAX',pnl:-120.5,note:'fomo',created:'2026-10-04T10:00:00Z'});
check('ruční: tvar',man.id==='man:u1'&&man.source==='manual'&&man.accountId==='manual'&&man.side===null&&man.r===null&&man.holdMs===null&&man.openTs===null&&man.pnl===-120.5&&man.date==='2026-10-04'&&man.note==='fomo'&&man.hasNote&&man.converted,man);
const all=toJournalTrades([mtRow],[{id:'u1',date:'2026-10-04',instrument:'DAX',pnl:-120.5,note:'',created:'x'}],'USD',rates);
check('seznam: od nejnovějšího',all.map(x=>x.id).join()==='mt:mta_1:10,man:u1');
check('splitTags',JSON.stringify(splitTags('a,b','','b, c'))==='["a","b","c"]');

// --- validace
check('tagy: normalizace',JSON.stringify(cleanTags(['#Breakout',' london ','breakout']))==='["breakout","london"]');
check('tagy: diakritika',JSON.stringify(cleanTags(['Průraz']))==='["průraz"]');
check('tagy: 11 je moc',throws(()=>cleanTags(Array.from({length:11},(_,i)=>'tag'+i)),/10/));
check('tagy: krátký',throws(()=>cleanTags(['a']),/2–30/));
check('tagy: mezera',throws(()=>cleanTags(['two words']),/2–30/));
check('tagy: ne pole',throws(()=>cleanTags('x'),/seznam/));
check('tagy: prázdný seznam',cleanTags([]).length===0);
check('poznámka: ořez',cleanNote('  ahoj ',500)==='ahoj');
check('poznámka: moc dlouhá',throws(()=>cleanNote('x'.repeat(501),500),/500/));
check('poznámka: ne text',throws(()=>cleanNote(5,500),/text/));
check('id: mt',JSON.stringify(parseJournalId('mt:mta_1:10'))==='{"kind":"mt","id":"mta_1:10"}');
check('id: mt zakódované',parseJournalId('mt%3Amta_1%3A10:r2')?.id==='mta_1:10:r2');
check('id: mt s # (ticket protokolu)',parseJournalId('mt:a:1#2')?.id==='a:1#2');
check('id: ruční',JSON.stringify(parseJournalId('man:6f1c-22'))==='{"kind":"man","id":"6f1c-22"}');
check('id: nesmysl',parseJournalId('x:1')===null&&parseJournalId('mt:')===null&&parseJournalId('mt:a b')===null);
check('upload: ok',checkUpload({type:'image/png',size:1000},0)===null);
check('upload: typ',/PNG/.test(checkUpload({type:'text/html',size:10},0)||''));
check('upload: 5 MB',checkUpload({type:'image/webp',size:5*1024*1024},4)===null&&/5 MB/.test(checkUpload({type:'image/jpeg',size:5*1024*1024+1},0)||''));
check('upload: prázdný',/prázdný/.test(checkUpload({type:'image/png',size:0},0)||''));
check('upload: šestý',/5 screenshot/.test(checkUpload({type:'image/png',size:10},5)||''));

// --- formátování
check('držení',['0 min','59 min','1 h','1 h 30 min','1 d 1 h','2 d'].join()===[0,59*60000,3600000,90*60000,25*3600000,48*3600000].map(fmtHold).join(),[0,59*60000,3600000,90*60000,25*3600000,48*3600000].map(fmtHold));
check('držení: null',fmtHold(null)==='–');
check('R',fmtR(1.5)==='+1,5 R'&&fmtR(null)==='–'&&fmtR(0)==='0 R',[fmtR(1.5),fmtR(0)]);
check('datum',fmtDate('2026-10-05')==='5. 10. 2026');
check('offset Praha zima/léto',pragueOffsetMs(Date.UTC(2026,0,10,12))===3600000&&pragueOffsetMs(Date.UTC(2026,6,10,12))===7200000);
check('offset Praha přes přechod',pragueOffsetMs(Date.UTC(2026,2,29,0,30))===3600000&&pragueOffsetMs(Date.UTC(2026,2,29,1,30))===7200000);
check('slova',tradesWord(1)==='obchod je'&&tradesWord(3)==='obchody jsou'&&tradesWord(5)==='obchodů je');

// --- statistiky
const base={source:'mt',accountId:'a1',account:'Demo',symbol:'EURUSD',side:'buy',volume:1,net:0,accountCurrency:'USD',converted:true,rr:null,riskPct:null,mfeR:null,maeR:null,tags:[],hasNote:false,files:0};
const mk=(id,day,pnl,x={})=>{const closeTs=Date.UTC(2026,9,day,10);return {...base,id,date:new Date(closeTs).toISOString().slice(0,10),openTs:closeTs-3600000,closeTs,holdMs:3600000,pnl,r:null,...x}};
const A=mk('a',1,100,{r:1,tags:['breakout']}),B=mk('b',2,-50,{r:-0.5,tags:['breakout','london'],side:'sell'}),C=mk('c',3,-50,{symbol:'GBPUSD'}),Dm={...mk('d',4,200),source:'manual',accountId:'manual',side:null,openTs:null,holdMs:null},E=mk('e',5,0,{r:0});
const list=[E,Dm,C,B,A];
const s=summary(list);
check('souhrn: počty',s.count===5&&s.wins===2&&s.losses===2&&s.winRate===40,s);
check('souhrn: peníze',s.total===200&&s.grossWin===300&&s.grossLoss===100&&s.profitFactor===3&&s.expectancy===40&&s.avgWin===150&&s.avgLoss===-50&&s.best===200&&s.worst===-50,s);
check('souhrn: R jen s rizikem',s.expectancyR===0.17&&s.rCount===3&&s.noRisk===1,s);
check('souhrn: série a drawdown',s.maxWinStreak===1&&s.maxLossStreak===2&&s.maxDrawdown===100,s);
check('souhrn: držení bez ručních',s.avgHoldMs===3600000);
check('souhrn: bez ztrát PF null',summary([A]).profitFactor===null);
const s0=summary([]);
check('souhrn: prázdný',s0.count===0&&s0.winRate===null&&s0.expectancy===null&&s0.maxDrawdown===0&&s0.best===null,s0);
check('křivka',JSON.stringify(equityCurve(list).map(p=>p.value))==='[100,50,0,200,200]');
check('drawdown od nuly',maxDrawdown([{value:-30},{value:-10}])===30);
const bt1=breakdown([A,B,C],'tag');
check('rozpad tag',bt1.length===3&&bt1[0].key==='breakout'&&bt1[0].count===2&&bt1[0].total===50&&bt1[0].winRate===50&&bt1[0].expectancyR===0.25&&bt1.some(g=>g.key===''&&g.label==='bez tagu'),bt1);
const bs=breakdown(list,'side');
check('rozpad směr bez ručních',bs.reduce((n,g)=>n+g.count,0)===4&&bs.find(g=>g.key==='sell').count===1,bs);
check('hodina: zima/léto',pragueHour(Date.UTC(2026,0,5,8))===9&&pragueHour(Date.UTC(2026,6,6,8))===10);
check('hodina: přechod na letní čas',pragueHour(Date.UTC(2026,2,29,0,30))===1&&pragueHour(Date.UTC(2026,2,29,1,30))===3);
const late={...mk('l',5,10),openTs:Date.UTC(2026,9,4,22,30)};   // 5. 10. 00:30 v Praze = pondělí
const bw=breakdown([late,{...Dm,date:'2026-10-05'}],'weekday');
check('rozpad den: podle Prahy, ruční podle data',bw.length===1&&bw[0].label==='Po'&&bw[0].count===2,bw);
const bh=breakdown([A,Dm],'hour');
check('rozpad hodina jen MT',bh.length===1&&bh[0].label==='11:00',bh);
const hold=[1,14.99,15,59,60,239,240,1439,1440,10079,10080].map(m=>({...A,id:'h'+m,holdMs:m*60000}));
check('rozpad držení',breakdown(hold,'hold').map(g=>g.label+':'+g.count).join()==='< 15 min:2,15 min – 1 h:2,1–4 h:2,4–24 h:2,1–7 d:2,> 7 d:1',breakdown(hold,'hold'));

// --- filtry a řazení
const now=Date.UTC(2026,9,7,10);
const F=(x)=>({...DEFAULT_FILTER,...x});
const sep30={...A,id:'s',date:'2026-09-30'},oct1={...A,id:'o',date:'2026-10-01'};
check('filtr: tento měsíc',filterTrades([sep30,oct1],F({period:'month'}),now).map(x=>x.id).join()==='o');
check('filtr: 30 dní',filterTrades([{...A,id:'x',date:'2026-09-07'},{...A,id:'y',date:'2026-09-08'}],F({period:'30d'}),now).map(x=>x.id).join()==='y');
check('filtr: vlastní včetně krajů',filterTrades([sep30,oct1,{...A,id:'n',date:'2026-10-02'}],F({period:'custom',from:'2026-09-30',to:'2026-10-01'}),now).length===2);
check('filtr: směr vyřadí ruční',filterTrades(list,F({side:'buy'}),now).every(x=>x.side==='buy'));
check('filtr: zisk bez nul',filterTrades(list,F({result:'win'}),now).map(x=>x.id).sort().join()==='a,d');
check('filtr: tag, účet, pár, zdroj',filterTrades(list,F({tag:'london'}),now).length===1&&filterTrades(list,F({account:'manual'}),now).length===1&&filterTrades(list,F({symbol:'GBPUSD'}),now).length===1&&filterTrades(list,F({source:'manual'}),now).length===1);
const san=sanitizeFilter(F({account:'gone',tag:'old',symbol:'XAUUSD',period:'30d'}),list,[{id:'a1',name:'Demo',platform:'mt5',currency:'USD'}]);
check('filtr: neexistující účet/tag/pár se zruší',san.account==='all'&&san.tag==='all'&&san.symbol==='all'&&san.period==='30d',san);
check('filtr: platné hodnoty zůstanou',JSON.stringify(sanitizeFilter(F({account:'a1',tag:'london'}),list,[{id:'a1',name:'Demo',platform:'mt5',currency:'USD'}]))===JSON.stringify(F({account:'a1',tag:'london'})));
check('filtr: ruční účet zůstane',sanitizeFilter(F({account:'manual'}),[...list,{...list[0],source:'manual'}],[]).account==='manual');
check('filtr: ruční účet bez ručních obchodů → all',sanitizeFilter(F({account:'manual'}),list.filter(t=>t.source!=='manual'),[]).account==='all');
check('řazení: R, null na konci',sortTrades(list,'r',-1).map(x=>x.id).join()==='a,e,b,d,c'&&sortTrades(list,'r',1).map(x=>x.id).join()==='b,e,a,d,c',[sortTrades(list,'r',-1).map(x=>x.id),sortTrades(list,'r',1).map(x=>x.id)]);
check('řazení: pár',sortTrades([C,A],'symbol',1)[0].id==='a');

// --- data grafu (časy jsou posunuté na pražský čas, v sekundách)
const b0=Date.UTC(2026,9,5,7,0);
const bars=[[b0+60000,1,2,0.5,1.5],[b0,1,2,0.5,1.5],[b0+120000,1,2,0.5,1.5],[b0+60000,1,2,0.5,1.5]];
const cs=candles(bars);
check('svíčky: seřazené a bez duplicit',cs.length===3&&cs[0].time===chartTime(b0)&&cs[0].time===(b0+7200000)/1000,cs);
const snap=snapper(cs.map(c=>c.time));
check('snap: dolů na svíčku, před první na první',snap(chartTime(b0+90000))===chartTime(b0+60000)&&snap(chartTime(b0-600000))===chartTime(b0));
const ch=[{ts:b0+65000,kind:'sl',old_value:0.9,new_value:0.95,price:1,volume:null,reason:null},{ts:b0+70000,kind:'tp',old_value:null,new_value:1.8,price:1,volume:null,reason:null},{ts:b0+100000,kind:'sl',old_value:0.95,new_value:null,price:1,volume:null,reason:null}];
const sl=levelSteps('sl',0.9,ch,b0,b0+120000,snap);
check('SL schody: start, posun, zrušení, konec',JSON.stringify(sl)===JSON.stringify([{time:chartTime(b0),value:0.9},{time:chartTime(b0+60000)},{time:chartTime(b0+120000)}]),sl);
const tp=levelSteps('tp',null,ch,b0,b0+120000,snap);
check('TP schody: bez počátečního TP',JSON.stringify(tp)===JSON.stringify([{time:chartTime(b0)},{time:chartTime(b0+60000),value:1.8},{time:chartTime(b0+120000),value:1.8}]),tp);
const mk2=tradeMarkers('sell',[{ts:b0+120000,kind:'close',old_value:null,new_value:null,price:1.1,volume:0.5,reason:'tp'},{ts:b0,kind:'open',old_value:null,new_value:null,price:1.2,volume:1,reason:'client'},{ts:b0+60000,kind:'partial_close',old_value:null,new_value:null,price:1.15,volume:0.5,reason:'client'},{ts:b0+60000,kind:'sl',old_value:1,new_value:2,price:1,volume:null,reason:null}],snap);
check('značky: pořadí, tvar u sell',mk2.length===3&&mk2[0].text==='Vstup 1'&&mk2[0].shape==='arrowDown'&&mk2[0].position==='aboveBar'&&mk2[2].shape==='arrowUp'&&mk2[2].text==='Výstup 0.5',mk2);

check('přesnost cen',pricePrecision([0.47108,0.4679,0.47])===5&&pricePrecision([157.123,157.1])===3&&pricePrecision([2650,2651.5])===1&&pricePrecision([1e-7])===6&&pricePrecision([])===0,[pricePrecision([0.47108,0.4679]),pricePrecision([157.123])]);
if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
