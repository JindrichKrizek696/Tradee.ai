// Kontrola rozboru PMI z Trading Economics: node --experimental-strip-types scripts/check-te-pmi.mjs
import {parseTEDescription,teMetaDescription,TE_PAGES} from '../lib/macro/te-pmi.ts';
let bad=0;const check=(n,ok,x)=>{console.log((ok?'ok   ':'FAIL ')+n+(ok?'':' → '+JSON.stringify(x)));if(!ok)bad++};
const NOW=Date.parse('2026-10-12T12:00:00Z');

// Fixtury: skutečné meta description stažené 12. 10. 2026
const F={
 usM:'Business Confidence in the United States decreased to 54.50 points in September from 54.60 points in August of 2026. This page provides the latest reported value for - United States ISM Purchasing Managers Index (PMI) - plus previous releases, historical high and low, short-term forecast and long-term prediction, economic calendar, survey consensus and news.',
 usS:'Non Manufacturing PMI in the United States decreased to 54.90 points in September from 55.40 points in August of 2026. This page provides the latest reported value for - United States ISM Non Manufacturing PMI - plus previous releases, historical high and low, short-term forecast and long-term prediction, economic calendar, survey consensus and news.',
 spM:'Manufacturing PMI in the United States increased to 55.90 points in September from 53.90 points in August of 2026. This page provides the latest reported value for - United States Manufacturing PMI - plus previous releases, historical high and low, short-term forecast and long-term prediction, economic calendar, survey consensus and news.',
 spS:'Services PMI in the United States increased to 58.80 points in September from 56.50 points in August of 2026. This page provides the latest reported value for - United States Services PMI - plus previous releases, historical high and low, short-term forecast and long-term prediction, economic calendar, survey consensus and news.',
 euS:'Services PMI In the Euro Area increased to 53 points in September from 51.60 points in August of 2026. This page provides the latest reported value for - Euro Area Services PMI - plus previous releases, historical high and low, short-term forecast and long-term prediction, economic calendar, survey consensus and news.',
 chS:'Services PMI in Switzerland increased to 59.80 points in September from 58.30 points in August of 2026. This page provides - Switzerland Services PMI- actual values, historical data, forecast, chart, statistics, economic calendar and news.',
 auS:'Services PMI in Australia decreased to 51.90 points in September from 53.20 points in August of 2026. This page provides the latest reported value for - Australia Performance Services Index - plus previous releases, historical high and low, short-term forecast and long-term prediction, economic calendar, survey consensus and news.',
 caS:'Services PMI in Canada increased to 48.30 points in September from 46.80 points in August of 2026. This page includes a chart with historical data for Canada Services PMI.',
 nzM:'Manufacturing PMI in New Zealand decreased to 53.10 points in August from 54.30 points in July of 2026. This page provides - New Zealand Manufacturing Pmi - actual values, historical data, forecast, chart, statistics, economic calendar and news.',
};
let x=parseTEDescription(F.usM,NOW);
check('ISM výroba: hodnota, předchozí, období, řada',x&&x.value===54.5&&x.previous===54.6&&x.period==='2026-09'&&x.series==='United States ISM Purchasing Managers Index (PMI)',x);
x=parseTEDescription(F.usS,NOW);check('ISM služby',x&&x.value===54.9&&x.previous===55.4&&x.period==='2026-09',x);
x=parseTEDescription(F.euS,NOW);check('celé číslo „53 points“ a „In the Euro Area“',x&&x.value===53&&x.previous===51.6,x);
x=parseTEDescription(F.chS,NOW);check('kratší popis („This page provides - …“)',x&&x.value===59.8&&x.series==='Switzerland Services PMI',x);
x=parseTEDescription(F.caS,NOW);check('popis bez názvu řady',x&&x.value===48.3&&x.previous===46.8&&x.series==='',x);
x=parseTEDescription(F.nzM,NOW);check('NZ: srpen (zpoždění měsíc)',x&&x.value===53.1&&x.period==='2026-08',x);
// přelom roku: leden vydaný v únoru, rok z textu se ignoruje
x=parseTEDescription('Manufacturing PMI in Japan increased to 50.20 points in January from 49.80 points in December of 2026.',Date.parse('2027-02-03T00:00:00Z'));
check('přelom roku → 2027-01',x&&x.period==='2027-01'&&x.previous===49.8,x);
x=parseTEDescription('Manufacturing PMI in Japan decreased to 49.80 points in December from 50.10 points in November of 2026.',Date.parse('2027-01-05T00:00:00Z'));
check('prosinec stažený v lednu → 2026-12',x&&x.period==='2026-12',x);
x=parseTEDescription('Services PMI in Japan was unchanged at 51.30 points in September of 2026. This page provides',NOW);
check('beze změny → previous = value',x&&x.value===51.3&&x.previous===51.3&&x.period==='2026-09',x);
x=parseTEDescription('Services PMI in Japan rose to 51.30 points in September from 50.10 points in July of 2026.',NOW);
check('„from“ není předchozí měsíc → previous null',x&&x.previous===null,x);
x=parseTEDescription('Manufacturing PMI in Japan decreased to 48 points in October from 49.5 points in September of 2026.',Date.parse('2026-10-24T09:00:00Z'));
check('flash za běžný měsíc',x&&x.period==='2026-10'&&x.value===48,x);
check('slovní popis bez čísla → null',parseTEDescription('This page provides the latest reported value for - Japan Services PMI',NOW)===null&&parseTEDescription(null,NOW)===null);
// meta tag z HTML, libovolné pořadí atributů
check('meta description z HTML',teMetaDescription('<head><meta id="metaDesc" name="description" content="Services PMI in Japan &amp; x" /><meta name="keywords" content="a"></head>')==='Services PMI in Japan & x'&&teMetaDescription('<meta content="X y" name="description">')==='X y'&&teMetaDescription('<meta name="keywords" content="a">')===null);
x=parseTEDescription(F.spM,NOW);check('S&P Global USA výroba',x&&x.value===55.9&&x.previous===53.9&&x.series==='United States Manufacturing PMI',x);
// stránky: 8 měn × 2 + 2× ISM (USA, jen info), kontrola, že popisy odpovídají očekávané řadě
check('18 stránek, každá měna mpmi i spmi, USA navíc ISM',TE_PAGES.length===18&&TE_PAGES.filter(p=>p.id.startsWith('ism')).every(p=>p.currency==='USD'&&p.publisher==='ISM')&&['USD','EUR','GBP','JPY','CHF','AUD','NZD','CAD'].every(c=>['mpmi','spmi'].every(id=>TE_PAGES.some(p=>p.currency===c&&p.id===id))));
const page=(c,id)=>TE_PAGES.find(p=>p.currency===c&&p.id===id);
check('USD skóruje S&P Global, ne ISM',page('USD','mpmi').publisher==='S&P Global'&&page('USD','spmi').publisher==='S&P Global'&&page('USD','mpmi').path==='united-states/manufacturing-pmi'&&page('USD','spmi').path==='united-states/services-pmi');
check('expect: S&P stránky nepřijmou ISM a naopak',page('USD','mpmi').expect.test(F.spM)&&page('USD','spmi').expect.test(F.spS)&&!page('USD','mpmi').expect.test(F.usM)&&!page('USD','spmi').expect.test(F.usS)&&!page('USD','mpmi').expect.test(F.spS)&&!page('USD','spmi').expect.test(F.spM)&&page('USD','ismMpmi').expect.test(F.usM)&&page('USD','ismSpmi').expect.test(F.usS)&&!page('USD','ismMpmi').expect.test(F.spM)&&!page('USD','ismSpmi').expect.test(F.spS));
check('expect: ostatní',page('AUD','spmi').expect.test(F.auS)&&page('NZD','mpmi').expect.test(F.nzM)&&!page('EUR','spmi').expect.test(F.nzM));

if(bad){console.log(`\n${bad} FAIL`);process.exit(1)}
console.log('\nPASS: PMI z Trading Economics');
