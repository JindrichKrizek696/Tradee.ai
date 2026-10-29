// Kontrola vysvětlení nedostupných funkcí: node --experimental-strip-types scripts/check-capabilities.mjs
// Resolver nad registrem instrumentů (objem, COT, fundament, licence, neimplementováno, zavřený trh, proxy cena), oznámení o změně
// poskytovatele dat a napojení v detailu trhu.
import {readFileSync} from 'node:fs';
import {resolveCapabilities,capabilityFor,activeChanges,FEATURES,REASON_LABELS} from '../lib/capabilities.ts';
import {SEED} from '../lib/risk/instruments.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const MON=Date.parse('2026-10-27T15:00:00Z'),SAT=Date.parse('2026-10-31T12:00:00Z');
const cap=(m,f,now)=>capabilityFor(m,f,{now});
const st=(m,f,now)=>{const c=cap(m,f,now);return c.status+(c.reason?':'+c.reason:'')};

// ---------- úplnost
for(const m of ['EUR/USD','USD/CZK','USD','GC=F','SI=F','CL=F','BZ=F','^NDX','^GSPC','AAPL','BTC-USD','ETH-USD']){
 const list=resolveCapabilities(m,{now:MON});
 check(`${m}: všech ${FEATURES.length} funkcí, každá s textem`,list.length===FEATURES.length&&FEATURES.every(f=>list.some(c=>c.feature===f))&&list.every(c=>c.text.length>10));
 check(`${m}: nedostupná funkce má důvod, dostupná ne`,list.every(c=>c.status==='ok'?c.reason===null:!!c.reason&&c.reason in REASON_LABELS));
}
// ---------- FX
check('EUR/USD: skóre v3, fundament i COT',st('EUR/USD','scoreV3')==='ok'&&st('EUR/USD','fundamentals')==='ok'&&st('EUR/USD','cot')==='ok');
check('EUR/USD: bez objemu → VWAP a footprint ne, profil jen TPO',st('EUR/USD','vwap')==='off:no-volume'&&st('EUR/USD','footprint')==='off:no-volume'&&st('EUR/USD','volumeProfile')==='partial:no-volume');
check('EUR/USD: text vysvětlí OTC a TPO',/OTC/.test(cap('EUR/USD','vwap').text)&&/TPO/.test(cap('EUR/USD','volumeProfile').text));
// CZK
check('USD/CZK: bez fundamentu a COT, bez skóre v3',st('USD/CZK','fundamentals')==='off:no-fundamentals'&&st('USD/CZK','cot')==='off:no-cot'&&st('USD/CZK','scoreV3')==='off:no-fundamentals');
check('USD/CZK: text o 8měnovém modelu',/8měnov/.test(cap('USD/CZK','fundamentals').text));
// akcie
check('AAPL: fundament a footprint vyžadují licenci',st('AAPL','fundamentals')==='off:license'&&st('AAPL','footprint')==='off:license');
check('AAPL: objem je → VWAP a profil ano, COT ne',st('AAPL','vwap')==='ok'&&st('AAPL','volumeProfile')==='ok'&&st('AAPL','cot')==='off:no-cot');
// krypto
check('BTC-USD: footprint z Binance, objem ano',st('BTC-USD','footprint')==='ok'&&st('BTC-USD','vwap')==='ok');
check('BTC-USD: živá cena i o víkendu',st('BTC-USD','live',SAT)==='ok');
// komodity a indexy z registru
check('GC=F: COT z registru (XAUUSD/GC), fundament zatím ne',st('GC=F','cot')==='ok'&&st('GC=F','fundamentals')==='off:not-implemented');
check('GC=F: objem z futures GC (ne proxy)',st('GC=F','vwap')==='ok');
check('BZ=F: COT nepřipojený',st('BZ=F','cot')==='off:not-implemented');
check('^NDX: hotovostní index bez objemu, text zmíní NQ',st('^NDX','vwap')==='off:no-volume'&&/NQ/.test(cap('^NDX','vwap').text));
check('^NDX: COT zatím ne',st('^NDX','cot')==='off:not-implemented');
// měnový index
check('USD index: skóre a COT ano, sezonalita ne, objem ne',st('USD','scoreV3')==='ok'&&st('USD','cot')==='ok'&&st('USD','seasonality')==='off:not-implemented'&&st('USD','vwap')==='off:no-volume');
// zavřený trh, proxy
check('víkend: EUR/USD, AAPL a zlato zavřené',st('EUR/USD','live',SAT)==='off:market-closed'&&st('AAPL','live',SAT)==='off:market-closed'&&st('GC=F','live',SAT)==='off:market-closed');
check('bez času se zavření nekontroluje',st('EUR/USD','live')==='ok');
check('proxy cena: zlato = futures místo CFD',st('GC=F','live',MON)==='partial:proxy'&&/CFD/.test(cap('GC=F','live',MON).text));
check('spot FX není proxy',st('EUR/USD','live',MON)==='ok');
// registr řídí výsledek
const custom=[...SEED.filter(i=>i.market!=='BZ=F'),{...SEED.find(i=>i.id==='UKOIL'),id:'BRN',kind:'futures',proxy:false,volume:true,cot:true}];
check('registr: Brent futures s objemem a COT → VWAP i COT ano',capabilityFor('BZ=F','vwap',{list:custom}).status==='ok'&&capabilityFor('BZ=F','cot',{list:custom}).status==='ok');

// ---------- změna poskytovatele dat
const ch=[{id:'a',markets:['EUR/USD'],from:'Yahoo',to:'Nový zdroj',since:'2026-10-01',until:'2026-11-30',text:'Ceny se mohou lišit.'},{id:'b',markets:'all',from:'X',to:'Y',since:'2026-12-01',text:''}];
check('změna zdroje: platí pro trh v období',activeChanges('EUR/USD',ch,MON).map(c=>c.id).join()==='a');
check('změna zdroje: jiný trh ne, budoucí ne',activeChanges('GBP/USD',ch,MON).length===0);
check('změna zdroje: „all“ od data',activeChanges('GBP/USD',ch,Date.parse('2026-12-02T10:00:00Z')).map(c=>c.id).join()==='b');
check('změna zdroje: po „until“ ne',activeChanges('EUR/USD',ch,Date.parse('2026-12-02T10:00:00Z')).every(c=>c.id!=='a'));
const pc=JSON.parse(readFileSync(new URL('../data/provider-changes.json',import.meta.url),'utf8'));
check('data/provider-changes.json je pole se správnými poli',Array.isArray(pc)&&pc.every(c=>typeof c.id==='string'&&typeof c.since==='string'&&(c.markets==='all'||Array.isArray(c.markets))));

// ---------- napojení
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8'),t=src('app/tradee.tsx');
check('detail trhu: přehled funkcí a změna zdroje',/<CapabilitiesPanel /.test(t)&&/<ProviderNotice /.test(t));
check('detail trhu: COT bez kontraktu → vysvětlení',/feature="cot"/.test(t)&&!/Ověřený odpovídající futures kontrakt není připojen\. COT se do technického modelu nepřičítá\./.test(t));
check('detail trhu: fundament (CZK, akcie…) → vysvětlení',/feature="fundamentals"/.test(t));
check('komponenta: role note a čitelný stav',/role="note"/.test(src('app/capabilities.tsx'))&&/sr-only/.test(src('app/capabilities.tsx')));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
