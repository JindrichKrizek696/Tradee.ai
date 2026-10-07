// Kontrola deníku obchodů: node --experimental-strip-types scripts/check-journal.mjs
import {toJournalTrades,mtRowToTrade,manualRowToTrade,cleanTags,cleanNote,parseJournalId,checkUpload,splitTags} from '../lib/journal/rows.ts';
import {fmtHold,fmtR,fmtDate,pragueOffsetMs,tradesWord} from '../lib/journal/format.ts';
import {makeRates} from '../lib/fx.ts';
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

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
