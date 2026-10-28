// Kontrola cenových alertů: node --experimental-strip-types scripts/check-alerts.mjs
// Překřížení (nad / pod / dotyk) z poslední ceny, špičky z 1m svíček, cooldown a jednorázovost, expirace, zavřený trh, % změna, skóre,
// limit 50 aktivních, izolace uživatelů v dotazech, validace vstupu, parsery Yahoo / Binance, texty push a mailu, opakovaný běh bez dvojího odeslání.
import {validateAlert,hit,observe,decide,barsSince,inCooldown,statusOf,conditionLabel,fmtLevel,pushPayload,mailContent,MAX_ACTIVE,TOUCH_TOL} from '../lib/alerts/logic.ts';
import {parseYahoo1m,parseBinance,quoteSource,fetchQuotes} from '../lib/alerts/quotes.ts';
import {createAlert,updateAlert,listAlerts,getAlert,deleteAlert,listEvents,markRead,countActive} from '../lib/alerts/store.ts';
import {runCheck} from '../lib/alerts/engine.ts';
import {isMarketOpen} from '../lib/market-hours.ts';
import {instruments} from '../lib/markets.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const throws=(f,re)=>{try{f();return false}catch(e){return re?re.test(e.message):true}};
const GROUP=new Map(instruments.map(i=>[i.id,i.group])),known=id=>GROUP.get(id)??null;
const NOW=Date.parse('2026-10-28T10:00:30Z'); // středa, FX otevřený, NYSE zavřená (otevírá 13:30 UTC)
const A=(o={})=>({id:'a1',userId:'u1',instrument:'EUR/USD',kind:'above',level:1.125,pct:null,op:null,note:null,cooldownMin:null,expiresAt:null,channels:['push','mail'],active:true,ended:null,lastPrice:null,lastChecked:null,lastTriggered:null,created:0,updated:0,...o});
const Q=(price,bars=[],prevClose=1.12)=>({price,prevClose,marketTime:NOW,bars});
const B=(iso,h,l)=>({t:Date.parse(iso),h,l});
const O=(a,q,s=null)=>observe(a,q,s);

// ---------- překřížení
const last=Date.parse('2026-10-28T09:59:30Z');
check('nad: z 1,1240 na 1,1252 → spustí',hit(A(),1.124,{value:1.1252,hi:null,lo:null})===1.1252);
check('nad: minule už nad úrovní → nespustí',hit(A(),1.126,{value:1.127,hi:null,lo:null})===null);
check('nad: první kontrola (bez minulé ceny) nespustí',hit(A(),null,{value:1.13,hi:null,lo:null})===null);
check('nad: přesně na úrovni = překročeno',hit(A(),1.124,{value:1.125,hi:null,lo:null})===1.125);
check('pod: z 1,1260 na 1,1240 → spustí',hit(A({kind:'below'}),1.126,{value:1.124,hi:null,lo:null})===1.124);
check('pod: zůstává nad → nespustí',hit(A({kind:'below'}),1.126,{value:1.1255,hi:null,lo:null})===null);
check('pod: první kontrola nespustí',hit(A({kind:'below'}),null,{value:1.0,hi:null,lo:null})===null);
const tol=1.125*TOUCH_TOL;
check('dotyk: první kontrola v toleranci spustí',hit(A({kind:'touch'}),null,{value:1.125+tol*.5,hi:null,lo:null})!==null);
check('dotyk: první kontrola mimo toleranci nespustí',hit(A({kind:'touch'}),null,{value:1.125+tol*3,hi:null,lo:null})===null);
check('dotyk: přejetí zdola nahoru spustí',hit(A({kind:'touch'}),1.12,{value:1.13,hi:null,lo:null})!==null);
check('dotyk: přejetí shora dolů spustí',hit(A({kind:'touch'}),1.13,{value:1.12,hi:null,lo:null})!==null);
check('dotyk: obě ceny pod úrovní bez špičky nespustí',hit(A({kind:'touch'}),1.12,{value:1.121,hi:1.1215,lo:1.119})===null);
// ---------- špičky ze svíček mezi kontrolami
const qSpike=Q(1.1245,[B('2026-10-28T09:58:00Z',1.1300,1.1200),B('2026-10-28T09:59:00Z',1.1251,1.1238),B('2026-10-28T10:00:00Z',1.1246,1.1240)]);
const aSpike=A({lastPrice:1.124,lastChecked:last});
const oS=O(aSpike,qSpike);
check('barsSince: svíčky před poslední kontrolou (−60 s) se ignorují',barsSince(qSpike.bars,last).length===2&&oS.hi===1.1251,oS);
check('špička: high svíčky 1,1251 překročí 1,1250 i když cena teď 1,1245',hit(aSpike,aSpike.lastPrice,oS)===1.1251);
check('špička: stará svíčka (1,1300 před kontrolou) nespouští',hit(A({level:1.128,lastPrice:1.124,lastChecked:last}),1.124,O(A({lastChecked:last}),qSpike))===null);
check('špička dolů: low svíčky spustí „pod“',hit(A({kind:'below',level:1.1239}),1.1245,O(A({lastChecked:last}),qSpike))===1.1238);
check('první kontrola svíčky nebere',O(A(),qSpike).hi===null);
check('dotyk špičkou: high přes úroveň → hlásí úroveň',hit(A({kind:'touch',level:1.125}),1.1242,O(A({lastChecked:last}),qSpike))===1.125);
// ---------- rozhodnutí: cooldown, jednorázovost, expirace, zavřený trh
const q1=Q(1.1252,[]);
let s=decide(A({lastPrice:1.124,lastChecked:last}),q1,null,NOW,true);
check('jednorázový: trigger s oneShot',s.action==='trigger'&&s.oneShot===true&&s.price===1.1252,s);
s=decide(A({lastPrice:1.124,lastChecked:last,cooldownMin:60}),q1,null,NOW,true);
check('opakovaný: trigger bez oneShot',s.action==='trigger'&&s.oneShot===false,s);
s=decide(A({lastPrice:1.124,lastChecked:last,cooldownMin:60,lastTriggered:NOW-30*60000}),q1,null,NOW,true);
check('cooldown 60 min, spuštěn před 30 min → jen aktualizace ceny',s.action==='update'&&s.value===1.1252,s);
s=decide(A({lastPrice:1.124,lastChecked:last,cooldownMin:60,lastTriggered:NOW-61*60000}),q1,null,NOW,true);
check('cooldown uplynul → znovu spustí',s.action==='trigger',s);
check('inCooldown hranice',inCooldown({lastTriggered:NOW-15*60000+1,cooldownMin:15},NOW)&&!inCooldown({lastTriggered:NOW-15*60000,cooldownMin:15},NOW)&&!inCooldown({lastTriggered:NOW,cooldownMin:null},NOW));
s=decide(A({expiresAt:NOW-1,lastPrice:1.124}),q1,null,NOW,true);
check('vypršelý → expire (i když by spustil)',s.action==='expire',s);
check('vyprší přesně teď → expire',decide(A({expiresAt:NOW}),q1,null,NOW,true).action==='expire');
check('vyprší později → normálně',decide(A({expiresAt:NOW+60000,lastPrice:1.124}),q1,null,NOW,true).action==='trigger');
s=decide(A({instrument:'AAPL',level:250,lastPrice:245}),Q(251),null,NOW,isMarketOpen('AAPL','stock',NOW));
check('zavřený trh (AAPL ve 10:00 UTC) → přeskočit beze změny',s.action==='skip'&&s.reason==='trh zavřený',s);
check('krypto je otevřené i v sobotu',isMarketOpen('BTC-USD','crypto',Date.parse('2026-10-31T12:00:00Z'))&&!isMarketOpen('EUR/USD','fx',Date.parse('2026-10-31T12:00:00Z')));
check('neaktivní → skip',decide(A({active:false,lastPrice:1.124}),q1,null,NOW,true).action==='skip');
check('bez ceny → skip',decide(A({lastPrice:1.124}),null,null,NOW,true).action==='skip');
// ---------- % změna dnes
const P=o=>A({kind:'pct',level:null,pct:.5,op:'gte',...o});
check('% ≥ 0,5: z +0,3 na +0,62 → spustí',decide(P({lastPrice:.3}),Q(1.308,[],1.3),null,NOW,true).action==='trigger');
check('% ≥ 0,5: už minule splněno → jen update',decide(P({lastPrice:.7}),Q(1.308,[],1.3),null,NOW,true).action==='update');
check('% ≥ 0,5: první kontrola a platí → spustí (hrana od „nic“)',decide(P(),Q(1.308,[],1.3),null,NOW,true).action==='trigger');
check('% ≤ −1: −1,2 % spustí',decide(P({pct:-1,op:'lte',lastPrice:-.5}),Q(1.2844,[],1.3),null,NOW,true).action==='trigger');
check('% bez předchozího zavření → skip',decide(P(),Q(1.308,[],null),null,NOW,true).action==='skip');
check('% zavřený trh → skip',decide(P({lastPrice:.3}),Q(1.308,[],1.3),null,NOW,false).action==='skip');
// ---------- skóre
const SC=o=>A({instrument:'EUR',kind:'score',level:20,op:'above',...o});
check('skóre nad 20: z 15 na 22,4 → spustí',decide(SC({lastPrice:15}),null,22.4,NOW,false).action==='trigger');
check('skóre: zavřený trh nevadí, první kontrola nespustí',decide(SC(),null,25,NOW,false).action==='update');
check('skóre pod −10: z −5 na −12 → spustí',decide(SC({level:-10,op:'below',lastPrice:-5}),null,-12,NOW,false).action==='trigger');
check('skóre bez dat (null) → skip',decide(SC({lastPrice:15}),null,null,NOW,true).action==='skip');
// ---------- validace
const V=(o,ctx={})=>validateAlert({instrument:'EUR/USD',kind:'above',level:1.13,...o},{known,price:1.125,now:NOW,pushAvailable:true,...ctx});
check('validní vstup',V({}).value.level===1.13&&V({}).warnings.length===0,V({}));
check('čárka jako desetinná tečka',V({level:'1,1300'}).value.level===1.13);
check('NaN cena → chyba',throws(()=>V({level:'abc'}),/číslo/)&&throws(()=>V({level:NaN}))&&throws(()=>V({level:''})));
check('záporná / nulová cena → chyba',throws(()=>V({level:-1}),/kladné/)&&throws(()=>V({level:0})));
check('Infinity → chyba',throws(()=>V({level:Infinity})));
check('absurdní úroveň (10× od ceny) → varování, ne chyba',V({level:12}).warnings.some(w=>/řádově/.test(w)),V({level:12}).warnings);
check('úroveň 60 % od ceny → varování',V({level:1.8}).warnings.some(w=>/% od aktuální ceny/.test(w)));
check('„nad“ pod aktuální cenou → varování o novém překročení',V({level:1.12}).warnings.some(w=>/už je nad/.test(w)));
check('neznámý trh → chyba',throws(()=>V({instrument:'XXX/YYY'}),/Neznámý trh/));
check('měnový index jen skóre',throws(()=>V({instrument:'EUR'}),/skóre/)&&V({instrument:'EUR',kind:'score',level:10,op:'above'}).value.kind==='score');
check('neznámý typ → chyba',throws(()=>V({kind:'cross'}),/typ/));
check('% mimo ±50 / nula / bez směru → chyba',throws(()=>V({kind:'pct',pct:60,op:'gte'}))&&throws(()=>V({kind:'pct',pct:0,op:'gte'}))&&throws(()=>V({kind:'pct',pct:1})));
check('skóre mimo −100…100 → chyba',throws(()=>V({kind:'score',level:150,op:'above'}),/rozsahu/));
check('cooldown jen 15 min – 24 h, celé minuty',throws(()=>V({cooldownMin:10}))&&throws(()=>V({cooldownMin:2000}))&&throws(()=>V({cooldownMin:20.5}))&&V({cooldownMin:15}).value.cooldownMin===15&&V({cooldownMin:null}).value.cooldownMin===null);
check('vypršení v minulosti / nesmysl → chyba',throws(()=>V({expiresAt:NOW-1000}),/budoucnosti/)&&throws(()=>V({expiresAt:'zítra'})));
check('vypršení ISO v budoucnu',V({expiresAt:'2026-11-30T22:59:59Z'}).value.expiresAt===Date.parse('2026-11-30T22:59:59Z'));
check('kanály: prázdné → chyba; výchozí podle push',throws(()=>V({channels:[]}),/kanál/)&&V({}).value.channels.join()==='push,mail'&&V({},{pushAvailable:false}).value.channels.join()==='mail');
check('push bez odběru → varování',V({channels:['push']},{pushAvailable:false}).warnings.some(w=>/Push/.test(w)));
check('poznámka se ořízne na 500 a prázdná = null',V({note:'x'.repeat(600)}).value.note.length===500&&V({note:'   '}).value.note===null&&throws(()=>V({note:5})));
check('neplatné tělo',throws(()=>validateAlert(null,{known,now:NOW}))&&throws(()=>validateAlert([],{known,now:NOW})));
// ---------- stav
check('statusOf',statusOf({active:true,ended:null,expiresAt:null},NOW)==='active'&&statusOf({active:false,ended:null,expiresAt:null},NOW)==='paused'&&statusOf({active:false,ended:'triggered',expiresAt:null},NOW)==='triggered'&&statusOf({active:false,ended:'expired',expiresAt:null},NOW)==='expired'&&statusOf({active:true,ended:null,expiresAt:NOW-1},NOW)==='expired');
// ---------- texty
check('předmět mailu „Tradee alert: EUR/USD nad 1,1250“',mailContent('Dan',{id:'a1',instrument:'EUR/USD',name:'EUR/USD',kind:'above',level:1.125,pct:null,op:null,note:null,price:1.1252,oneShot:true}).subject==='Tradee alert: EUR/USD nad 1,1250');
check('formát cen: JPY 3 desetinná, BTC bez desetin',fmtLevel('USD/JPY',150.1234)==='150,123'&&fmtLevel('BTC-USD',70000)==='70 000'&&fmtLevel('AAPL',251.5)==='251,50');
check('popisky podmínek',conditionLabel({instrument:'GBP/USD',kind:'pct',pct:-1.5,op:'lte',level:null},'GBP/USD')==='GBP/USD dnes ≤ −1,5 %'&&conditionLabel({instrument:'EUR',kind:'score',level:-20,op:'below',pct:null},'EUR')==='EUR skóre pod −20');
const pp=pushPayload({id:'a1',instrument:'^NDX',name:'Nasdaq 100',kind:'below',level:18000,pct:null,op:null,note:'<b>',price:17990,oneShot:true});
check('push: odkaz na graf (zakódovaný), tag, poznámka',pp.url==='https://tradee.eu/graf/%5ENDX'&&pp.tag==='alert-a1'&&pp.body.includes('<b>')&&pp.title.startsWith('Tradee alert: Nasdaq 100 pod'),pp);
const mc=mailContent('<script>',{id:'a1',instrument:'EUR/USD',name:'EUR/USD',kind:'above',level:1.125,pct:null,op:null,note:'<img src=x>',price:1.1252,oneShot:false});
check('mail: HTML escapování, odkaz /graf, text opakování',!mc.html.includes('<img')&&mc.html.includes('&lt;img')&&mc.text.includes('https://tradee.eu/graf/EUR-USD')&&mc.text.includes('opakuje'));
check('měnový index: odkaz na analýzu',pushPayload({id:'x',instrument:'EUR',name:'EUR',group:'currency',kind:'score',level:20,pct:null,op:'above',note:null,price:22,oneShot:true}).url==='https://tradee.eu/#analyzer');
// ---------- parsery
const yj={chart:{result:[{meta:{regularMarketPrice:1.1252,chartPreviousClose:1.122,regularMarketTime:1792231200},timestamp:[1792231140,1792231200,1792231260],indicators:{quote:[{high:[1.1243,null,1.1253],low:[1.1236,null,1.1241],close:[1.124,null,1.125]}]}}]}};
const yq=parseYahoo1m(yj);
check('Yahoo 1m: cena, předchozí zavření, svíčky bez null',yq.price===1.1252&&yq.prevClose===1.122&&yq.bars.length===2&&yq.bars[1].h===1.1253&&yq.marketTime===1792231200000,yq);
check('Yahoo: prázdná / rozbitá odpověď → null',parseYahoo1m({chart:{result:null}})===null&&parseYahoo1m(null)===null&&parseYahoo1m({chart:{result:[{meta:{}}]}})===null);
const bq=parseBinance([[1792231140000,'69500','69720','69480','69600','1'],[1792231200000,'69600','70010','69550','69650','1']],[[1792195200000,'68800','70100','68000','69650','1']]);
check('Binance: poslední close, extrémy, otevření dne',bq.price===69650&&bq.bars.length===2&&bq.bars[1].h===70010&&bq.prevClose===68800,bq);
check('Binance: prázdné → null',parseBinance([],[])===null&&parseBinance('x',null)===null);
check('zdroje: krypto Binance, FX Yahoo =X, měnový index nic',quoteSource('BTC-USD').src==='binance'&&quoteSource('EUR/USD').symbol==='EURUSD=X'&&quoteSource('AAPL').symbol==='AAPL'&&quoteSource('EUR')===null);
const urls=[];
const fakeFetch=async u=>{urls.push(u);if(u.includes('binance'))return new Response(JSON.stringify(u.includes('1d')?[[0,'68800','0','0','0']]:[[1,'1','70010','69000','69650']]));if(u.includes('AAPL'))return new Response('x',{status:429});return new Response(JSON.stringify(yj))};
const fq=await fetchQuotes(['EUR/USD','BTC-USD','AAPL','GBP/USD','USD/JPY'],fakeFetch,{concurrency:2,limitMin:()=>3});
check('fetchQuotes: Yahoo 1m bez pre/post, Binance limit, chyba trhu → null',urls.some(u=>u.includes('EURUSD%3DX?interval=1m&range=1d&includePrePost=false'))&&urls.some(u=>u.includes('BTCUSDT&interval=1m&limit=4'))&&fq.quotes.get('AAPL')===null&&fq.errors.some(e=>e.startsWith('AAPL'))&&fq.quotes.get('BTC-USD').price===69650,{urls,errors:fq.errors});

// ---------- DB vrstva: izolace uživatelů a limit (falešná DB zaznamená SQL a parametry)
function fakeDb(state={active:0,subs:0,row:null}){
 const log=[];
 const db={log,prepare(sql){const make=p=>({bind:(...q)=>make(q),
  async run(){log.push({sql,p});return {success:true,meta:{changes:1,last_row_id:1}}},
  async first(){log.push({sql,p});if(/COUNT\(\*\) AS c FROM price_alerts/.test(sql))return {c:state.active};if(/push_subscriptions/.test(sql))return {c:state.subs};if(/COUNT\(\*\) AS c FROM alert_events/.test(sql))return {c:0};if(/FROM price_alerts WHERE id=\? AND user_id=\?/.test(sql))return p[1]===state.row?.user_id&&p[0]===state.row?.id?state.row:null;return null},
  async all(){log.push({sql,p});return {results:[],success:true,meta:{}}}});return make([])}};
 return db;
}
const ctx={known,now:NOW,price:1.125};
const row={id:'al_x',user_id:'u1',instrument:'EUR/USD',kind:'above',level:1.13,pct:null,op:null,note:null,repeat_cooldown_min:null,expires_at:null,channels:'push,mail',active:0,ended:'triggered',last_price:1.12,last_checked:'2026-10-28 09:00:00',last_triggered:'2026-10-28 09:00:00',created:'2026-10-27 09:00:00',updated:'2026-10-28 09:00:00'};
let D=fakeDb({active:MAX_ACTIVE,subs:1,row});
let limitErr='';try{await createAlert(D,'u1',{instrument:'EUR/USD',kind:'above',level:1.13},ctx)}catch(e){limitErr=e.message}
check('limit 50: 51. aktivní alert se nevytvoří',/nejvýš 50/.test(limitErr),limitErr);
D=fakeDb({active:MAX_ACTIVE-1,subs:0,row});
const created=await createAlert(D,'u1',{instrument:'EUR/USD',kind:'above',level:1.13},ctx);
check('49 aktivních: vytvoří se (pozastavený nový alert limit nepočítá)',D.log.some(l=>/INSERT INTO price_alerts/.test(l.sql)&&l.p[1]==='u1')&&Array.isArray(created.warnings));
D=fakeDb({active:0,subs:0,row});await createAlert(D,'u1',{instrument:'EUR/USD',kind:'above',level:1.13,active:false},ctx);
check('pozastavený nový alert: bez kontroly limitu',!D.log.some(l=>/active=1/.test(l.sql)));
D=fakeDb({active:MAX_ACTIVE,subs:0,row});limitErr='';try{await updateAlert(D,'u1','al_x',{active:true},ctx)}catch(e){limitErr=e.message}
check('limit 50 i při znovuzapnutí',/nejvýš 50/.test(limitErr),limitErr);
D=fakeDb({active:3,subs:0,row});const up=await updateAlert(D,'u1','al_x',{active:true,level:1.14},ctx);
const upd=D.log.find(l=>/^UPDATE price_alerts/.test(l.sql));
check('znovuzapnutí + nová úroveň: vynuluje poslední kontrolu a ended',!!up&&/last_price=NULL,last_checked=NULL/.test(upd.sql)&&upd.p.at(-1)==='u1'&&upd.p.at(-2)==='al_x'&&upd.p[10]===null,upd);
D=fakeDb({active:3,subs:0,row});await updateAlert(D,'u1','al_x',{note:'jen poznámka'},ctx);
const upd2=D.log.find(l=>/^UPDATE price_alerts/.test(l.sql));
check('úprava poznámky u spuštěného: podmínka beze změny → bez resetu, ended zůstává',!/last_price=NULL/.test(upd2.sql)&&upd2.p[10]==='triggered',upd2);
D=fakeDb({active:0,subs:0,row});
check('cizí alert: úprava vrátí null a nic nezapíše',await updateAlert(D,'u2','al_x',{level:1.2},ctx)===null&&!D.log.some(l=>/^UPDATE/.test(l.sql)));
// každý dotaz API vrstvy musí mít user_id=? s id přihlášeného
D=fakeDb({active:0,subs:0,row});
await listAlerts(D,'u9');await listAlerts(D,'u9','EUR/USD');await getAlert(D,'u9','al_x');await deleteAlert(D,'u9','al_x');await listEvents(D,'u9',{unread:true,alertId:'al_x'});await markRead(D,'u9',[1,2,'x',-1],NOW);await markRead(D,'u9',null,NOW);await countActive(D,'u9');await countActive(D,'u9','al_x');
await createAlert(D,'u9',{instrument:'EUR/USD',kind:'below',level:1.1},ctx).catch(()=>{});await updateAlert(D,'u9','al_x',{level:1},ctx);
const bad=D.log.filter(l=>!/user_id\s*=\s*\?|INSERT INTO price_alerts\(id,user_id/.test(l.sql)||!l.p.includes('u9'));
check('izolace: všech '+D.log.length+' dotazů filtruje / zapisuje user_id přihlášeného',bad.length===0&&D.log.length>=12,bad.map(b=>b.sql));
const mr=D.log.find(l=>/UPDATE alert_events SET read_at=\? WHERE user_id=\? AND read_at IS NULL AND id IN/.test(l.sql));
check('markRead: jen platná id, vlastní uživatel',mr&&mr.p.length===4&&mr.p[1]==='u9'&&mr.p[2]===1&&mr.p[3]===2,mr);

// ---------- celý běh: opakování bez dvojího odeslání, zavřený trh se nestahuje
function memDeps(alerts,quotes,scores={}){
 const sent=[],fetched=[],events=[];
 const deps={now:NOW,loadAlerts:async()=>alerts.filter(a=>a.active).map(a=>({...a})),
  fetchQuotes:async ids=>{fetched.push(...ids);return {quotes:new Map(ids.map(id=>[id,quotes[id]??null])),errors:[]}},
  scoreOf:id=>scores[id]??null,meta:id=>{const i=instruments.find(x=>x.id===id);return i?{name:i.name,group:i.group}:null},isOpen:(id,g,t)=>isMarketOpen(id,g,t),
  expire:async a=>{const o=alerts.find(x=>x.id===a.id);if(!o.active)return false;o.active=false;o.ended='expired';return true},
  touch:async(a,v)=>{const o=alerts.find(x=>x.id===a.id);o.lastPrice=v;o.lastChecked=NOW},
  // atomické „zabrání“: jen když se poslední spuštění nezměnilo od načtení
  claim:async(a,s)=>{const o=alerts.find(x=>x.id===a.id);if(!o.active||o.lastTriggered!==a.lastTriggered)return false;o.lastTriggered=NOW;o.lastPrice=s.value;o.lastChecked=NOW;if(s.oneShot){o.active=false;o.ended='triggered'}return true},
  record:async(a,s,label)=>{events.push({id:a.id,label,price:s.price});return events.length},
  deliver:async(a,f)=>{sent.push(f.id);return {push:true,mail:true}},delivered:async()=>{}};
 return {deps,sent,fetched,events};
}
const alerts=[A({id:'x1',lastPrice:1.124,lastChecked:last}),A({id:'x2',lastPrice:1.124,lastChecked:last,cooldownMin:30}),A({id:'x3',instrument:'AAPL',level:250,lastPrice:245}),A({id:'x4',instrument:'EUR',kind:'score',level:20,op:'above',lastPrice:15}),A({id:'x5',expiresAt:NOW-1})];
const m=memDeps(alerts,{'EUR/USD':Q(1.1252)},{EUR:22});
const S1=await runCheck(m.deps);
check('běh 1: 3 spuštění (jednorázový, opakovaný, skóre), 1 vypršel, AAPL zavřený',S1.triggered===3&&S1.expired===1&&S1.closed===1&&m.sent.length===3,S1);
check('běh 1: AAPL se při zavřeném trhu vůbec nestahuje',!m.fetched.includes('AAPL')&&m.fetched.includes('EUR/USD'),m.fetched);
const S2=await runCheck(m.deps);
check('běh 2 (stejná data): nic se znovu neodešle',S2.triggered===0&&m.sent.length===3,S2);
// souběh: dva běhy načtou stejný stav, zabrat ho smí jen jeden
const alerts2=[A({id:'y1',lastPrice:1.124,lastChecked:last})],m2=memDeps(alerts2,{'EUR/USD':Q(1.1252)});
const [r1,r2]=await Promise.all([runCheck(m2.deps),runCheck(m2.deps)]);
check('souběžné běhy: jedno odeslání',r1.triggered+r2.triggered===1&&m2.sent.length===1,{r1,r2});

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
