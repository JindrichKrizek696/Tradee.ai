// Slovník pojmů (/slovnik, komponenta <Term> a globální hledání): každý pojem, který Tradee v UI používá – jedna věta definice
// a krátký příklad. Čistá data bez závislostí (klient i testy). Kontrola: node --experimental-strip-types scripts/check-glossary.mjs
// Přidáváš <Term id="…"> do UI? Id musí být tady (test projde všechny soubory app/ a ohlásí neznámé id).
export type TermGroup='risk'|'cost'|'account'|'cot'|'macro'|'score'|'smc'|'volume'|'indicator'|'journal';
export const GROUPS:Record<TermGroup,string>={
 risk:'Riziko a výsledek',cost:'Kontrakty a náklady',account:'Účty a prop firmy',cot:'COT report',macro:'Makro a sezonalita',
 score:'Skóre Tradee',smc:'Struktura trhu a likvidita',volume:'Objem a profil',indicator:'Indikátory',journal:'Deník a proces',
};
export type GlossaryTerm={id:string;term:string;group:TermGroup;def:string;example:string;aliases?:string[];see?:string[]};
const T=(id:string,term:string,group:TermGroup,def:string,example:string,aliases?:string[],see?:string[]):GlossaryTerm=>({id,term,group,def,example,...(aliases?{aliases}:{}),...(see?{see}:{})});
export const GLOSSARY:GlossaryTerm[]=[
 // ---- riziko a výsledek
 T('r','R (násobek rizika)','risk','Výsledek obchodu vyjádřený v násobcích původního rizika – čistý zisk nebo ztráta děleno částkou, kterou jsi na začátku riskoval.','Riskuješ 100 USD a vyděláš 250 USD → +2,5 R; ztráta celé pozice na stopu je −1 R.',['r-multiple','násobek'],['riziko']),
 T('riziko','Riziko na obchod','risk','Částka (nebo % účtu), kterou ztratíš, když cena dojde na stop loss.','Účet 10 000 USD, riziko 1 % → při zásahu stopu ztratíš 100 USD.',['risk per trade'],['r','lot']),
 T('stop-loss','Stop loss (SL)','risk','Příkaz, který pozici uzavře se ztrátou na předem dané ceně, když se trh pohne proti tobě.','Long EUR/USD z 1,0850 se stopem 1,0820 = riziko 30 pipů.',['sl'],['riziko']),
 T('take-profit','Take profit (TP)','risk','Příkaz, který pozici uzavře se ziskem na předem dané ceně.','TP na 1,0910 u longu z 1,0850 = cíl 60 pipů, tedy 2 R při stopu 30 pipů.',['tp']),
 T('be-cenovy','BE cenový (break-even)','risk','Obchod uzavřený na vstupní ceně – cena se nepohnula ve tvůj prospěch, ale výsledek po nákladech může být mírně záporný.','Vstup i výstup 1,0850, po komisi −3 USD: cenově BE, účetně malá ztráta.',['breakeven','be'],['be-ucetni']),
 T('be-ucetni','BE účetní','risk','Obchod, jehož čistý výsledek po všech nákladech (spread, komise, swap) je přibližně nula.','Výstup o 0,4 pipu nad vstupem pokryje komisi → čistý výsledek 0 USD.',['net breakeven'],['be-cenovy']),
 T('rrr','Poměr risk/reward (RRR)','risk','Poměr mezi možným ziskem k cíli a rizikem ke stopu.','Stop 20 pipů a cíl 60 pipů → RRR 1 : 3.',['rr','risk reward']),
 T('expectancy','Očekávaná hodnota (expectancy)','risk','Průměrný výsledek jednoho obchodu v R přes delší vzorek: kolik systém v průměru vydělá nebo prodělá na obchod.','Úspěšnost 40 % s průměrem +2 R a ztrátami −1 R → 0,4×2 − 0,6×1 = +0,2 R na obchod.',['ev']),
 T('win-rate','Úspěšnost (win rate)','risk','Podíl ziskových obchodů ze všech uzavřených.','18 ziskových z 45 obchodů = úspěšnost 40 %.'),
 T('profit-factor','Profit factor','risk','Součet zisků dělený součtem ztrát; nad 1 znamená, že zisky převažují.','Zisky 3 000 USD, ztráty 2 000 USD → profit factor 1,5.'),
 // ---- kontrakty a náklady
 T('pip','Pip','cost','Ustálená jednotka pohybu FX páru – u většiny párů čtvrté desetinné místo, u párů s JPY druhé.','EUR/USD z 1,0850 na 1,0862 = 12 pipů; USD/JPY ze 150,20 na 150,45 = 25 pipů.',['pips'],['tick']),
 T('tick','Tick','cost','Nejmenší možný pohyb ceny instrumentu; každý tick má pevnou hodnotu na lot nebo kontrakt.','NQ se hýbe po 0,25 bodu, jeden tick = 5 USD na kontrakt.',['tik'],['pip','kontrakt']),
 T('lot','Lot','cost','Standardizovaná velikost pozice u FX a CFD – 1 lot FX je 100 000 jednotek základní měny.','0,10 lotu EUR/USD = 10 000 EUR; 1 pip má hodnotu asi 1 USD.',['loty','mini lot','mikro lot'],['kontrakt']),
 T('kontrakt','Kontrakt (futures)','cost','Jedna jednotka futures obchodovaná na burze s pevným multiplikátorem a hodnotou ticku.','1 kontrakt ES = 50 USD × index S&P 500; MES je desetina.',['futures','contract'],['tick','lot']),
 T('spread','Spread','cost','Rozdíl mezi nákupní (ask) a prodejní (bid) cenou – platíš ho při každém vstupu.','Bid 1,0850 a ask 1,0851 → spread 1 pip.',['bid ask']),
 T('swap','Swap','cost','Úrokový poplatek nebo připsání za držení FX/CFD pozice přes noc; vychází z rozdílu sazeb obou měn.','Long pár s vyšší sazbou základní měny může swap připisovat, short platit.',['rollover','overnight']),
 T('komise','Komise','cost','Poplatek brokerovi za obchod, obvykle za lot nebo kontrakt tam i zpět.','Komise 7 USD za lot a 0,5 lotu → 3,50 USD.',['commission']),
 T('slippage','Slippage (skluz)','cost','Rozdíl mezi cenou, kterou jsi chtěl, a cenou, za kterou se příkaz skutečně vyplnil.','Stop na 1,0820 se při zprávě vyplní na 1,0816 → skluz 4 pipy.',['skluz']),
 T('proxy-cena','Proxy cena','cost','Cena z jiného instrumentu, než který obchoduješ – Tradee kreslí např. futures GC=F místo CFD XAUUSD.','Zlato CFD u brokera a COMEX futures se liší o basis; úrovně ber orientačně.',['proxy']),
 // ---- účty a prop firmy
 T('drawdown','Drawdown','account','Pokles účtu od předchozího maxima nebo startu, v částce nebo procentech.','Účet z 10 500 na 9 900 USD → drawdown 600 USD (5,7 %).',['dd'],['drawdown-staticky','drawdown-trailing']),
 T('drawdown-staticky','Drawdown statický','account','Limit ztráty počítaný pořád od startovního zůstatku – hranice se neposouvá.','Start 100 000 USD a statický DD 10 % → účet nesmí klesnout pod 90 000 USD.',['static dd'],['drawdown-trailing']),
 T('drawdown-trailing','Drawdown trailing','account','Limit ztráty, který se posouvá nahoru s nejvyšším zůstatkem nebo equity (na konci dne nebo i během dne).','Max 104 000 USD a trailing 6 % → nová hranice 97 760 USD.',['trailing dd','trailing drawdown'],['drawdown-staticky']),
 T('denni-limit','Denní limit ztráty','account','Maximální ztráta za jeden obchodní den; reset podle času a zóny firmy.','Limit 5 % z 50 000 USD = 2 500 USD za den do resetu v 17:00 New York.',['daily loss','daily drawdown']),
 T('consistency','Pravidlo konzistence','account','Prop pravidlo, že nejlepší den smí tvořit nejvýš určité procento celkového zisku.','Konzistence 40 % a zisk 5 000 USD → nejlepší den max. 2 000 USD.',['consistency rule','konzistence']),
 T('equity','Equity','account','Zůstatek účtu včetně nerealizovaného zisku nebo ztráty otevřených pozic.','Zůstatek 10 000 USD a otevřená ztráta −150 USD → equity 9 850 USD.'),
 T('challenge','Challenge','account','Zkušební fáze u prop firmy, kde musíš dosáhnout cíle bez porušení limitů.','Cíl 8 %, denní limit 5 %, celkový DD 10 %, min. 4 obchodní dny.',['evaluation']),
 T('funded','Funded účet','account','Účet prop firmy po úspěšné challenge, kde obchoduješ s jejich kapitálem a dělíš se o zisk.','Funded 100k s trailing DD 6 % a výplatou 80 % zisku.'),
 // ---- COT
 T('cot','COT report','cot','Týdenní report americké CFTC o pozicích velkých účastníků futures trhů (stav k úterý, vychází v pátek).','Spekulanti drží net long 120 000 kontraktů EUR – o 15 000 víc než minulý týden.',['commitments of traders','cftc'],['cot-legacy','cot-tff','cot-disaggregated']),
 T('cot-legacy','COT Legacy','cot','Nejstarší podoba COT reportu se třemi skupinami: commercials, non-commercials a malí obchodníci.','Non-commercials EUR: long 210 000, short 95 000.',['legacy'],['commercials']),
 T('cot-tff','COT TFF (Traders in Financial Futures)','cot','Členění COT pro finanční futures: dealeři, asset manageři, leveraged funds a ostatní.','Do FX skóre Tradee vstupují leveraged funds (hedgové fondy, CTA).',['tff','leveraged funds']),
 T('cot-disaggregated','COT Disaggregated','cot','Členění COT pro komodity: producenti, swap dealeři, managed money a ostatní.','Managed money ve zlatě drží net long 180 000 kontraktů.',['disaggregated'],['managed-money']),
 T('commercials','Commercials','cot','Firmy, které futures používají k zajištění svého byznysu (exportéři, producenti), ne ke spekulaci.','Těžař prodává futures na zlato, aby si zajistil cenu budoucí produkce.',['hedgeři']),
 T('managed-money','Managed money','cot','Spekulativní fondy (CTA, hedgové fondy) v Disaggregated COT – sledují trend a sentiment.','Managed money v ropě přechází z net short do net long.',['fondy']),
 T('cot-index','COT index','cot','Kde leží dnešní čistá pozice mezi minimem a maximem za zvolené období (0–100).','COT index 92 = čistá pozice blízko maxima za 3 roky.',['cot index']),
 T('percentil','Percentil','cot','Kolik procent hodnot v historii je nižších než ta dnešní.','90. percentil = dnešní hodnota je vyšší než 90 % historie.',['percentile']),
 T('open-interest','Open interest','cot','Počet otevřených futures kontraktů na trhu.','Net pozice 50 000 při open interest 500 000 = 10 % trhu.',['oi']),
 // ---- makro a sezonalita
 T('sezonalita','Sezonalita','macro','Průměrné chování trhu v daném měsíci za posledních N let a jak konzistentní ten směr byl.','EUR/USD v prosinci rostl 7 z 10 let s průměrem +0,8 %.',['seasonality','sezóna']),
 T('pmi','PMI (index nákupních manažerů)','macro','Měsíční průzkum mezi nákupčími firem; hodnota nad 50 znamená růst, pod 50 pokles.','Výrobní PMI eurozóny 47,8 → výroba se zmenšuje.',['mpmi','spmi','ism']),
 T('cpi','CPI (index spotřebitelských cen)','macro','Měření inflace podle cen koše zboží a služeb; trh sleduje meziroční i jádrovou hodnotu.','US CPI 3,2 % r/r vs. očekávání 3,0 % → vyšší inflace, silnější USD.',['inflace','inflation','core cpi']),
 T('nfp','NFP (Non-Farm Payrolls)','macro','Měsíční změna počtu pracovních míst v USA mimo zemědělství; vychází první pátek v měsíci.','NFP +250 000 vs. očekávání 180 000 → silný trh práce.',['payrolls','zaměstnanost usa']),
 T('hdp','HDP (GDP)','macro','Hrubý domácí produkt – celková ekonomická aktivita; Tradee porovnává mezikvartální růst.','HDP eurozóny +0,3 % q/q vs. USA +0,7 % q/q.',['gdp']),
 T('urokove-sazby','Úrokové sazby','macro','Sazba centrální banky; zvyšování obvykle posiluje měnu, snižování oslabuje.','ECB zvýší o 0,25 p. b. a naznačí další zpřísnění → +2 pro EUR.',['sazba','rates']),
 T('zamestnanost','Zaměstnanost','macro','Stav pracovního trhu podle zpráv centrální banky a dat o nezaměstnanosti.','Napjatý trh práce drží banku restriktivní.',['employment','nezaměstnanost']),
 T('retail-sales','Retail Sales','macro','Měsíční změna maloobchodních tržeb – měřítko spotřeby domácností.','US Retail Sales +0,7 % m/m vs. +0,3 % očekávání.',['maloobchod']),
 T('retail-pozice','Retail pozice','macro','Kontrariánský ukazatel: jak drží pozice drobní obchodníci u brokerů; většina long bývá pro trh negativní.','78 % retailu long GBP/USD → signál spíš short.',['retail sentiment','sentiment']),
 T('no-trade-okno','No-trade okno','macro','Čas kolem důležité zprávy, kdy podle pravidel neotevíráš nové obchody.','Okno 15 min před a po NFP – vstup ve 14:25 je porušení.',['news window']),
 // ---- skóre
 T('skore-v3','Skóre v3','score','Fundamentální skóre FX páru −100 až +100 z 11 složek s vahami; kladné favorizuje základní měnu.','EUR/USD +38 = fundamenty mírně pro EUR proti USD.',['skóre','score'],['slozka-skore']),
 T('slozka-skore','Složka skóre','score','Jeden vstup skóre v3 (sazby, inflace, COT…) ohodnocený −2 až +2 a vážený podle důležitosti.','Sazby +2 s vahou 20 % přispějí +20 bodů ke skóre.',['component']),
 T('trend','Trend','score','Složka skóre podle polohy ceny vůči průměrům 50 a 200 dnů a jejich pořadí.','Cena nad SMA50 nad SMA200 → trend +2.',['denní trend']),
 T('technicky-model','Technický model','score','Skóre pro trhy mimo 8měnový model (akcie, indexy, krypto, komodity, CZK) jen z trendu, sezonality a případně COT.','USD/CZK: trend 70 % a sezonalita 30 %, bez fundamentu.'),
 T('menovy-index','Měnový index Tradee','score','Vlastní index měny jako průměr jejích párů vůči 7 ostatním měnám modelu – není to burzovní index jako DXY.','Index USD +12 = dolar v průměru silnější proti ostatním.',['měnový index']),
 // ---- struktura trhu (SMC/ICT)
 T('fvg','FVG (fair value gap)','smc','Mezera mezi knotem první a třetí svíčky tříčlenného pohybu, kterou prostřední svíčka „přeskočila“ – nevyvážená cena.','Svíčky 1–3: high svíčky 1 = 1,0850, low svíčky 3 = 1,0862 → FVG 1,0850–1,0862.',['imbalance','fair value gap']),
 T('order-block','Order block','smc','Poslední protisměrná svíčka před silným pohybem; obchodníci ji berou jako zónu možné reakce.','Poslední medvědí svíčka před průrazem nahoru = bullish order block.',['ob']),
 T('sd-zona','S/D zóna (supply/demand)','smc','Cenová oblast, odkud předtím přišla silná nabídka (supply) nebo poptávka (demand).','Demand zóna 1,0790–1,0805, odkud cena dvakrát vyrazila nahoru.',['supply demand','zóna']),
 T('mitigace','Mitigace','smc','Návrat ceny do zóny (FVG, order block), kde zůstaly nevyplněné příkazy, a reakce z ní.','Cena se vrátí do FVG, vyplní ho a pokračuje původním směrem.',['mitigation']),
 T('premium-discount','Premium / discount','smc','Horní (premium) a dolní (discount) polovina rozsahu pohybu; long se hledá spíš v discountu, short v premium.','Rozsah 1,0800–1,0900: pod 1,0850 discount, nad ním premium.',['equilibrium']),
 T('likvidita','Likvidita','smc','Shluky příkazů (stopy, čekající příkazy) nad maximy a pod minimy, které trh často vybírá.','Rovná maxima na 1,0900 = likvidita nad nimi.',['liquidity']),
 T('sweep','Sweep (vybrání likvidity)','smc','Krátký průraz maxima nebo minima, který spustí stopy, a rychlý návrat zpět.','Cena prorazí minimum 1,0800 o 5 pipů a uzavře zpět nad ním.',['liquidity grab','stop hunt']),
 T('mss','MSS (market structure shift)','smc','Změna struktury trhu – průraz posledního důležitého swingu proti dosavadnímu směru.','Po sérii nižších minim cena uzavře nad posledním nižším maximem.',['choch','bos']),
 T('displacement','Displacement','smc','Silný, rychlý pohyb s velkými těly svíček, který obvykle zanechá FVG.','Tři velké býčí svíčky za 15 minut přes celý ranní rozsah.'),
 T('po3','PO3 (power of three)','smc','Model dne nebo svíčky ve třech fázích: akumulace, manipulace a distribuce.','Asie konsoliduje, Londýn vybere minimum, New York jede nahoru.',['amd']),
 T('killzone','Killzone','smc','Časové okno s vysokou aktivitou (otevření Londýna nebo New Yorku), kdy se hledají vstupy.','Londýnská killzone 8:00–11:00 pražského času.',['kill zone','seance']),
 // ---- objem a profil
 T('poc','POC (point of control)','volume','Cena s největším zobchodovaným objemem (nebo časem) v profilu.','POC včerejška 1,0842 = cena, kde trh strávil nejvíc obchodů.',['point of control'],['npoc','value-area']),
 T('npoc','nPOC (naked POC)','volume','POC minulého období, ke kterému se cena ještě nevrátila.','Nevyplněný POC z pondělí na 1,0790 může přitahovat cenu.',['naked poc','virgin poc']),
 T('value-area','VAH / VAL (value area)','volume','Horní (VAH) a dolní (VAL) hranice pásma, kde proběhlo asi 70 % objemu.','VAL 1,0820, VAH 1,0870 – mimo pásmo je cena „drahá“ nebo „levná“.',['vah','val','value area']),
 T('vwap','VWAP','volume','Průměrná cena vážená objemem od začátku seance – měřítko „férové“ ceny dne.','Cena pod VWAP = dnešní kupující jsou v průměru ve ztrátě.',['volume weighted average price']),
 T('tpo','TPO (market profile)','volume','Profil z času: každé písmeno je 30 minut, kdy cena byla na dané úrovni.','Široké TPO na 1,0850 = trh tam strávil většinu dne.',['market profile']),
 T('footprint','Footprint','volume','Graf, který v každé svíčce ukazuje objem na nákupní a prodejní straně po cenových úrovních.','Na minimu svíčky 900 prodaných proti 150 nakoupeným = absorpce.',['order flow','delta']),
 T('volume-profile','Volume profile','volume','Histogram objemu podle ceny za zvolené období.','Profil týdne ukáže, kde se nejvíc obchodovalo.',['profil objemu'],['poc','value-area']),
 // ---- indikátory
 T('atr','ATR (average true range)','indicator','Průměrný skutečný rozsah svíček za N období – míra volatility.','ATR(14) na D1 = 70 pipů → stop 20 pipů je na denní graf úzký.',['volatilita']),
 T('ema','EMA','indicator','Exponenciální klouzavý průměr – novější ceny mají větší váhu, reaguje rychleji než SMA.','EMA 21 na H1 jako dynamická podpora v trendu.',['exponential moving average']),
 T('sma','SMA','indicator','Prostý klouzavý průměr cen za posledních N období.','SMA 200 na denním grafu jako hranice dlouhodobého trendu.',['simple moving average','klouzavý průměr']),
 T('rsi','RSI','indicator','Oscilátor 0–100 z poměru růstových a poklesových svíček; nad 70 překoupeno, pod 30 přeprodáno.','RSI(14) = 78 → trh je krátkodobě natažený.',['relative strength index']),
 T('fibonacci','Fibonacci retracement','indicator','Úrovně 38,2 %, 50 %, 61,8 % (a další) pohybu, kde se hledá korekce.','Pohyb 1,0800–1,0900: 61,8 % retracement na 1,0838.',['fibo','fib']),
 // ---- deník a proces
 T('proces-skore','Skóre procesu','journal','Jak dobře jsi dodržel plán (0–100 %) – hodnotí se dřív, než uvidíš výsledek obchodu.','Plán ano, trigger ano, velikost ano, správa částečně, stav ano → 90 %.',['process score','hodnocení procesu']),
 T('scenar','Scénář','journal','Plán obchodu předem: hypotéza, strategie, úrovně vstupu a invalidace, platnost.','Long EUR/USD, když udrží 1,0820 a potvrdí ho H1 svíčka; platí do pátku.',['plán obchodu']),
 T('invalidace','Invalidace','journal','Úroveň nebo podmínka, kdy scénář přestává platit.','Uzavření H4 pod 1,0790 → long scénář neplatí.',['invalidation']),
 T('setup','Setup','journal','Co musí být na grafu připravené, než začneš hledat vstup.','Sweep asijského minima a návrat do rozsahu.'),
 T('trigger','Trigger','journal','Přesný signál ke vstupu podle strategie.','MSS na M5 s FVG po sweepu.'),
 T('vynechany-obchod','Vynechaný obchod','journal','Obchod, který jsi podle pravidel vědomě neotevřel – v deníku se počítá jako správné rozhodnutí.','Podmínka nesplněna → vynechávám, zapíšu důvod.',['no trade','skip']),
 T('check-in','Check-in','journal','Krátký soukromý záznam stavu (energie, soustředění, nálada) nebo rozhodnutí kolem obchodu.','Před seancí: energie 4, soustředění 3, nálada 4.',['psychologie','stav']),
];
export const GLOSSARY_IDS=GLOSSARY.map(t=>t.id);
const BY_ID=new Map(GLOSSARY.map(t=>[t.id,t]));
export const getTerm=(id:string):GlossaryTerm|null=>BY_ID.get(id)??null;
/** Pojmy, které musí slovník mít (zadání etapy 3C) – test hlídá, že žádný nechybí. */
export const REQUIRED_IDS=['r','be-cenovy','be-ucetni','pip','tick','lot','kontrakt','spread','swap','drawdown-staticky','drawdown-trailing','consistency','cot','cot-legacy','cot-tff','cot-disaggregated','commercials','managed-money','cot-index','percentil','sezonalita','pmi','cpi','nfp','skore-v3','slozka-skore','fvg','order-block','sd-zona','mitigace','premium-discount','likvidita','sweep','mss','displacement','po3','killzone','poc','npoc','value-area','vwap','tpo','footprint','atr','ema','sma','rsi','fibonacci'] as const;
/** Složka skóre v3 (lib/score/v3.ts) → pojem ve slovníku. */
export const SCORE_TERMS:Record<string,string>={cot:'cot',gdp:'hdp',seasonality:'sezonalita',trend:'trend',retailSales:'retail-sales',retailPositions:'retail-pozice',mpmi:'pmi',spmi:'pmi',rates:'urokove-sazby',inflation:'cpi',employment:'zamestnanost'};
/** Blok strategie (lib/strategy/core.ts) → pojem. */
export const BLOCK_TERMS:Record<string,string>={setup:'setup',trigger:'trigger',invalidation:'invalidace',risk:'riziko',notrade:'no-trade-okno'};
const fold=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
/** Filtr stránky /slovnik: hledá v názvu, aliasech, definici i příkladu (bez diakritiky). */
export function filterTerms(q:string,list:readonly GlossaryTerm[]=GLOSSARY):GlossaryTerm[]{
 const words=fold(q).split(/\s+/).filter(Boolean);if(!words.length)return [...list];
 const hay=(t:GlossaryTerm)=>fold([t.term,t.id,...(t.aliases||[]),t.def,t.example].join(' '));
 const head=(t:GlossaryTerm)=>fold([t.term,t.id,...(t.aliases||[])].join(' '));
 return list.filter(t=>words.every(w=>hay(t).includes(w))).sort((a,b)=>Number(words.every(w=>head(b).includes(w)))-Number(words.every(w=>head(a).includes(w))));
}
