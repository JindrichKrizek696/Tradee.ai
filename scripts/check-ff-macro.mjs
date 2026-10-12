// Kontrola odvození PMI a maloobchodu z ForexFactory: node --experimental-strip-types scripts/check-ff-macro.mjs
import {deriveMacro,parseNum} from '../lib/macro/ff-macro.ts';
let bad=0;const check=(n,ok,x)=>{if(!ok){bad++;console.log('CHYBA',n,x===undefined?'':JSON.stringify(x))}};
const NOW=Date.parse('2026-10-12T12:00:00Z');
const R=(at,currency,title,forecast,previous)=>({at,currency,title,forecast,previous});
check('parseNum',parseNum('49.8')===49.8&&parseNum('-0.6%')===-0.6&&parseNum('0.2%')===0.2&&parseNum('')===null&&parseNum(null)===null&&parseNum('1.2K')===null);

// final≈flash: vydané finální PMI (5. 10.) → září = forecast
let m=deriveMacro([R('2026-10-05T08:00:00Z','EUR','Final Services PMI','53.0','52.0')],NOW).currencies.EUR.spmi;
check('final≈flash',m&&m.value===53&&m.basis==='final≈flash'&&m.period==='2026-09'&&m.unit==='index'&&m.note.includes('finální září')&&m.note.includes('53,0'),m);
// nevydané finální: jen previous (srpen), forecast se nepoužije
m=deriveMacro([R('2026-10-20T08:00:00Z','EUR','Final Services PMI','53.0','52.0')],NOW).currencies.EUR.spmi;
check('nevydané final',m&&m.value===52&&m.basis==='previous'&&m.period==='2026-09',m);
// previous na pozdějším vydání (flash 23. 10. nevydaný, previous = září) přebije final≈flash za září (shoda období, potvrzené vyhrává)
m=deriveMacro([R('2026-10-05T08:00:00Z','EUR','Final Services PMI','53.0','52.0'),R('2026-10-23T08:00:00Z','EUR','Flash Services PMI','54.0','53.4')],NOW).currencies.EUR.spmi;
check('previous přebije',m&&m.value===53.4&&m.basis==='previous'&&m.period==='2026-09'&&m.note.includes('23. 10.'),m);
// final za říjen (vydáno 5. 11.) je novější období než previous za září
m=deriveMacro([R('2026-10-23T08:00:00Z','EUR','Flash Services PMI','54.0','53.4'),R('2026-11-05T08:00:00Z','EUR','Final Services PMI','54.5','53.4')],Date.parse('2026-11-06T00:00:00Z')).currencies.EUR.spmi;
check('novější final',m&&m.value===54.5&&m.period==='2026-10'&&m.basis==='final≈flash',m);
// ISM má přednost před S&P Final
let u=deriveMacro([R('2026-10-05T13:45:00Z','USD','Final Services PMI','58.7','58.7'),R('2026-10-05T14:00:00Z','USD','ISM Services PMI','55.1','55.4')],NOW).currencies.USD;
check('ISM přednost',u.spmi&&u.spmi.value===55.4&&u.spmi.basis==='previous'&&u.spmi.period==='2026-08',u.spmi);
u=deriveMacro([R('2026-10-05T13:45:00Z','USD','Final Services PMI','58.7','58.7')],NOW).currencies.USD;
check('USD bez ISM → S&P',u.spmi&&u.spmi.value===58.7&&u.spmi.basis==='final≈flash',u.spmi);
// EUR: předpony zemí se ignorují
let e=deriveMacro([R('2026-10-05T07:50:00Z','EUR','French Final Services PMI','51.4','51.4'),R('2026-10-05T07:55:00Z','EUR','German Final Services PMI','52.9','52.9'),R('2026-10-05T07:15:00Z','EUR','Spanish Services PMI','57.1','57.8')],NOW).currencies.EUR;
check('EUR bez předpon',e.spmi===undefined&&e.mpmi===undefined,e);
// chybějící řady
check('chybí řady',Object.keys(deriveMacro([],NOW).currencies).length===8&&Object.keys(deriveMacro([],NOW).currencies.JPY).length===0);
// CAD: Ivey není služby; výroba jen jako označená náhrada
let c=deriveMacro([R('2026-10-06T14:00:00Z','CAD','Ivey PMI','65.2','64.3')],NOW).currencies.CAD;
check('Ivey jen výroba',c.spmi===undefined&&c.mpmi&&c.mpmi.value===64.3&&c.mpmi.note.startsWith('Ivey PMI'),c);
c=deriveMacro([R('2026-10-06T14:00:00Z','CAD','Ivey PMI','65.2','64.3'),R('2026-10-01T13:30:00Z','CAD','Manufacturing PMI','50.2','49.0')],NOW).currencies.CAD;
check('CAD S&P před Ivey',c.mpmi&&c.mpmi.value===49&&!c.mpmi.note.includes('Ivey'),c.mpmi);
// maloobchod: EUR vydáno 6. 10. = srpen, previous = červenec; nikdy forecast
let rt=deriveMacro([R('2026-10-06T09:00:00Z','EUR','Retail Sales m/m','0.2%','-0.6%')],NOW).currencies.EUR.retailSales;
check('retail previous',rt&&rt.value===-0.6&&rt.unit==='%'&&rt.kind==='m/m'&&rt.period==='2026-07'&&rt.basis==='previous',rt);
rt=deriveMacro([R('2026-10-16T12:30:00Z','USD','Retail Sales m/m','0.4%','0.1%'),R('2026-10-16T12:30:00Z','USD','Core Retail Sales m/m','0.3%','0.2%')],NOW).currencies.USD.retailSales;
check('retail core ignorován',rt&&rt.value===0.1&&rt.period==='2026-08',rt);
rt=deriveMacro([R('2026-10-09T23:50:00Z','JPY','Retail Sales y/y','1.0%','1.2%')],NOW).currencies.JPY.retailSales;
check('retail y/y označen',rt&&rt.kind==='y/y'&&rt.value===1.2,rt);
// pouze forecast-pending (nevydané, bez previous)
rt=deriveMacro([R('2026-10-20T12:30:00Z','GBP','Final Services PMI','51.0',null)],NOW).currencies.GBP.spmi;
check('forecast-pending',rt&&rt.basis==='forecast-pending'&&rt.value===51,rt);
// starší než 120 dní se zahodí
check('120 dní',deriveMacro([R('2026-05-01T08:00:00Z','EUR','Final Services PMI','53.0','52.0')],NOW).currencies.EUR.spmi===undefined);
console.log(bad?'FF macro: '+bad+' chyb':'FF macro: vše ok');process.exit(bad?1:0);
