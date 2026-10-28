// Kontrola strategií s verzemi, tří-stavového checklistu, scénářů a vynechaných obchodů: node --experimental-strip-types scripts/check-strategy-versions.mjs
import {readFileSync} from 'node:fs';
import {emptyContent,validateContent,parseContent,planSave,decisionItems,evaluate,buildSnapshot,legacyChecklistContent,legacyStrategyName,legacyVersionId,validateOrigin,sameContent,newItemId} from '../lib/strategy/core.ts';
import {canMove,effectiveStatus,moveStatus,validateScenario,validateLevels,suggestScenarios,nearestEvent,instrumentCurrencies,levelsFromDrawing,validateNoTrade,planStats,timeline,compareExecution,scenarioLink,isDay} from '../lib/strategy/scenario.ts';
import * as store from '../lib/strategy/store.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const j=x=>JSON.stringify(x);
const IDS=['EUR/USD','USD/JPY','GBP/USD','USD','^NDX','GC=F','CL=F','BTC-USD','AAPL'];
const NOW=Date.parse('2026-10-20T10:00:00Z'),H=3600e3;

// ---------- obsah strategie
const raw={models:['Model 1',' Pullback ','model 1'],blocks:{}};
check('validace: duplicitní model (bez ohledu na velikost) je chyba',typeof validateContent(raw,IDS)==='string');
const c1=validateContent({models:['Model 1','Pullback'],scope:{markets:['EUR/USD','XXX','EUR/USD'],timeframes:['H1','M5','Z9'],sessions:['london','mars'],style:'day'},noTrade:{newsBefore:'15',newsAfter:999,days:[5,5,9,1]},
 blocks:{context:{text:' Trend na D1 \r\n',conditions:[{text:'Cena nad 200 SMA',role:'required'},{text:'Silná měna proti slabé',role:'supportive'},{text:'Pozor na víkend',role:'note'}]},
  setup:{conditions:[{id:'aaaaaaaa',text:'Zóna nabídky / poptávky',role:'required',model:'model 1',examples:[{kind:'valid',text:'Čistá reakce'},{kind:'valid',text:'Druhý dotyk'},{kind:'invalid',text:'Průraz bez reakce'},{kind:'valid',text:''}]},{id:'aaaaaaaa',text:'Pullback do EMA',role:'supportive',model:'Pullback'}]},
  trigger:{conditions:[{text:'Svíčkový vzor',role:'xxx'}]},review:{conditions:[{text:'Dodržel jsem plán?',role:'required'}]}}},IDS);
check('validace: kanonický obsah',typeof c1!=='string'&&j(c1.models)==='["Model 1","Pullback"]'&&j(c1.scope)===j({markets:['EUR/USD'],timeframes:['M5','H1'],sessions:['london'],style:'day'})&&j(c1.noTrade)===j({newsBefore:15,newsAfter:240,days:[1,5]}),c1);
check('validace: model podmínky se normalizuje, neznámá role → podpůrná, duplicitní id se přečísluje',c1.blocks.setup.conditions[0].model==='Model 1'&&c1.blocks.trigger.conditions[0].role==='supportive'&&c1.blocks.setup.conditions[0].id==='aaaaaaaa'&&c1.blocks.setup.conditions[1].id!=='aaaaaaaa'&&c1.blocks.context.text==='Trend na D1',c1.blocks);
check('validace: příklady 2 platné + 1 neplatný, prázdné se zahodí',c1.blocks.setup.conditions[0].examples.length===3);
check('validace: 3 platné příklady = chyba',typeof validateContent({blocks:{setup:{conditions:[{text:'x',examples:[{kind:'valid',text:'a'},{kind:'valid',text:'b'},{kind:'valid',text:'c'}]}]}}},IDS)==='string');
check('validace: neznámý model u podmínky = chyba',typeof validateContent({models:['A'],blocks:{setup:{conditions:[{text:'x',model:'B'}]}}},IDS)==='string');
check('validace: prázdná podmínka a moc podmínek = chyba',typeof validateContent({blocks:{setup:{conditions:[{text:' '}]}}},IDS)==='string'&&typeof validateContent({blocks:{setup:{conditions:Array.from({length:26},(_,i)=>({text:'p'+i}))}}},IDS)==='string');
check('validace: fileId jen ve tvaru plf_',(()=>{const r=validateContent({blocks:{setup:{conditions:[{text:'x',examples:[{kind:'valid',text:'',fileId:'plf_'+'a'.repeat(24)},{kind:'invalid',text:'',fileId:'../etc'}]}]}}},IDS);return r.blocks.setup.conditions[0].examples.length===1&&r.blocks.setup.conditions[0].examples[0].fileId.startsWith('plf_')})());
check('parseContent: poškozený JSON → prázdný obsah, stabilní roundtrip',sameContent(parseContent('{rozbité'),emptyContent())&&sameContent(parseContent(JSON.stringify(c1)),c1));
check('původ: od mentora s volitelným jménem, ostatní bez jména',j(validateOrigin('mentor',' Mentor A '))===j({origin:'mentor',mentor:'Mentor A'})&&j(validateOrigin('own','x'))===j({origin:'own',mentor:null})&&typeof validateOrigin('kurz',null)==='string'&&validateOrigin(undefined).origin==='own');

// ---------- verzování: použitá verze je neměnná
const c2=validateContent({...c1,blocks:{...c1.blocks,trigger:{text:'Nový trigger',conditions:[]}}},IDS);
check('verze: první uložení = v1',j(planSave(null,c1,''))===j({action:'create',version:1}));
check('verze: beze změny = nic',planSave({version:3,used:true,content:c1},c1,'').action==='none');
check('verze: nepoužitá se přepíše',planSave({version:1,used:false,content:c1},c2,'').action==='update');
check('verze: použitá + změna bez popisu = chyba','error' in planSave({version:1,used:true,content:c1},c2,'  '));
check('verze: použitá + změna s popisem = nová verze',j(planSave({version:4,used:true,content:c1},c2,'Upravený trigger'))===j({action:'create',version:5}));
check('verze: příliš dlouhý popis změny',('error' in planSave({version:1,used:true,content:c1},c2,'x'.repeat(301))));

// ---------- checklist při rozhodování (tři stavy)
const items=decisionItems(c1,'Model 1');
check('checklist: bez bloku Review a bez poznámek; společné + zvolený model',items.every(i=>i.block!=='review'&&i.role!=='note')&&items.some(i=>i.text==='Zóna nabídky / poptávky')&&!items.some(i=>i.text==='Pullback do EMA'),items.map(i=>i.text));
check('checklist: bez modelu jen společné podmínky',decisionItems(c1,null).every(i=>i.model===null));
const E=(...s)=>evaluate(s.map(([role,state])=>({role,state})));
const allGreen=E(['required','met'],['supportive','met'],['supportive','met']);
check('vyhodnocení: vše splněno = ready, skóre 1',allGreen.verdict==='ready'&&allGreen.score===1);
const redReq=E(['required','unmet'],['supportive','met'],['supportive','met'],['supportive','met']);
check('vyhodnocení: nesplněná povinná = blokováno, i když je zbytek zelený',redReq.verdict==='blocked'&&redReq.requiredUnmet===1&&redReq.score===1,redReq);
const unk=E(['required','unknown'],['supportive','met'],['supportive','unmet'],['supportive','unknown']);
check('vyhodnocení: „nevím“ u povinné = neúplné; skóre jen ze splněných podpůrných',unk.verdict==='incomplete'&&unk.requiredUnknown===1&&Math.abs(unk.score-0.33)<0.001&&unk.supportiveUnknown===1,unk);
check('vyhodnocení: bez podpůrných je skóre null',E(['required','met']).score===null&&E().verdict==='ready');
const strat={id:'str_1',name:'Ukázková strategie'},ver={id:'v1_str_1',version:1,content:c1};
const reqId=items.find(i=>i.role==='required'&&i.block==='context').id;
const snap=buildSnapshot(strat,ver,'Model 1',{[reqId]:'unmet',hack:'met'},{chartUrl:'https://example.com/chart/1',note:' Čekám na retest '},NOW);
check('snímek: verze, model, neznámé stavy = nevím, cizí id ignoruje, chyba povinné',snap.versionId==='v1_str_1'&&snap.version===1&&snap.model==='Model 1'&&snap.items.length===items.length&&snap.items.filter(i=>i.state==='unknown').length===items.length-1&&snap.eval.verdict==='blocked'&&snap.note==='Čekám na retest'&&snap.at===NOW,snap);
check('snímek: neznámý model a špatný odkaz = chyba',typeof buildSnapshot(strat,ver,'Model 9',{},{},NOW)==='string'&&typeof buildSnapshot(strat,ver,null,{},{chartUrl:'javascript:alert(1)'},NOW)==='string');

// ---------- scénáře: přechody a vypršení
check('přechody: otevřený → uzavřené stavy',canMove('waiting','active')&&canMove('active','entered')&&canMove('waiting','skipped')&&canMove('active','invalidated')&&canMove('active','waiting'));
check('přechody: vstoupeno je konečné, vynechaný jde znovu otevřít',!canMove('entered','waiting')&&!canMove('entered','skipped')&&canMove('skipped','waiting')&&canMove('expired','waiting')&&!canMove('skipped','entered'));
const sc={status:'active',validUntil:NOW+H};
check('vypršení: po platnosti je otevřený scénář vypršelý',effectiveStatus(sc,NOW)==='active'&&effectiveStatus(sc,NOW+H)==='expired'&&effectiveStatus({status:'entered',validUntil:NOW},NOW+H)==='entered'&&effectiveStatus({status:'waiting',validUntil:null},NOW+1e12)==='waiting');
check('vypršení: vypršelý nejde přepnout na vstoupeno, znovuotevření chce prodloužit platnost',typeof moveStatus(sc,'entered',NOW+2*H)==='string'&&typeof moveStatus({status:'expired',validUntil:NOW},'waiting',NOW+H)==='string'&&moveStatus({status:'expired',validUntil:NOW+5*H},'waiting',NOW+H)===null&&moveStatus(sc,'entered',NOW)===null);
const vs=validateScenario({instrument:'EUR/USD',bias:'long',hypothesis:' Favorizuji long, pokud cena udrží zónu ',levels:{entryFrom:'1,0850',entryTo:1.0820,invalidation:1.079,targets:[1.09,'1.095']},validUntil:NOW+24*H,reviewAt:new Date(NOW+12*H).toISOString(),alertId:'al_abc'},IDS,NOW);
check('scénář: validace a úrovně (zóna od nižší, čárka jako desetinná)',typeof vs!=='string'&&vs.hypothesis.startsWith('Favorizuji')&&j(vs.levels)===j({entryFrom:1.082,entryTo:1.085,invalidation:1.079,targets:[1.09,1.095]})&&vs.reviewAt===NOW+12*H&&vs.alertId==='al_abc',vs);
check('scénář: chyby (trh, směr, hypotéza, platnost v minulosti, úroveň)',['instrument','bias','hypothesis'].every(k=>typeof validateScenario({instrument:'EUR/USD',bias:'long',hypothesis:'x',[k]:''},IDS,NOW)==='string')&&typeof validateScenario({instrument:'EUR/USD',bias:'long',hypothesis:'x',validUntil:NOW-1},IDS,NOW)==='string'&&typeof validateLevels({entryFrom:'abc'})==='string'&&typeof validateLevels({targets:[1,2,3,4,5,6]})==='string');
check('scénář: částečná úprava mění jen poslaná pole',j(validateScenario({note:' a '},IDS,NOW,true))===j({note:'a'}));

// ---------- návrh scénáře k obchodu
const S=(id,o)=>({id,instrument:'EUR/USD',bias:'long',status:'active',created:NOW-5*H,validUntil:NOW+5*H,closedAt:null,...o});
const list=[S('a'),S('b',{bias:'both',created:NOW-H}),S('c',{bias:'short'}),S('d',{instrument:'USD/JPY'}),S('e',{created:NOW+H}),S('f',{validUntil:NOW-H,status:'expired'}),S('g',{status:'invalidated',closedAt:NOW-2*H}),S('h',{status:'skipped',closedAt:NOW+2*H}),S('i',{status:'entered'})];
const sug=suggestScenarios({instrument:'EUR/USD',side:'buy',openTs:NOW},list);
check('návrh: stejný trh, směr sedí, platný při vstupu; přesný směr před „obojí“',j(sug)===j(['a','h','i','b']),sug);
check('návrh: short obchod dostane short a obojí',j(suggestScenarios({instrument:'EUR/USD',side:'sell',openTs:NOW},list))===j(['c','b']));
check('návrh: bez trhu nebo času nic',suggestScenarios({instrument:null,side:'buy',openTs:NOW},list).length===0&&suggestScenarios({instrument:'EUR/USD',side:'buy',openTs:null},list).length===0);

// ---------- nejbližší zpráva, kresba z grafu, odkaz z alertu
check('měny instrumentu',j(instrumentCurrencies('EUR/USD'))==='["EUR","USD"]'&&j(instrumentCurrencies('USD'))==='["USD"]'&&j(instrumentCurrencies('CL=F'))==='["USD","OIL"]'&&j(instrumentCurrencies('^NDX'))==='["USD"]');
const news=[{at:NOW-H,title:'Minulá',currencies:['EUR']},{at:NOW+3*H,title:'NFP',currencies:['USD']},{at:NOW+2*H,title:'ECB',currencies:['EUR']},{at:NOW+H,title:'BoJ',currencies:['JPY']},{at:NOW+30*864e5,title:'Daleko',currencies:['EUR']}];
check('nejbližší zpráva pro měny trhu',nearestEvent(news,'EUR/USD',NOW).title==='ECB'&&nearestEvent(news,'^NDX',NOW).title==='NFP'&&nearestEvent(news,'AAPL',NOW+4*H)===null);
check('kresba: obdélník = zóna, pozice = vstup/stop/cíl + směr, čára = cena, jiné nic',j(levelsFromDrawing({type:'rect',a:[{t:1,p:1.2},{t:2,p:1.1}]}).levels)===j({entryFrom:1.1,entryTo:1.2,invalidation:null,targets:[]})&&j(levelsFromDrawing({type:'short',a:[{p:10},{p:11},{p:8}]}))===j({bias:'short',levels:{entryFrom:10,entryTo:10,invalidation:11,targets:[8]}})&&levelsFromDrawing({type:'hline',a:[{p:5}]}).levels.entryFrom===5&&levelsFromDrawing({type:'trend',a:[{p:1},{p:2}]})===null&&levelsFromDrawing(null)===null);
check('odkaz z alertu na scénář',scenarioLink('https://tradee.eu','scn_x')==='https://tradee.eu/scenare#scn_x');

// ---------- vynechané obchody a statistiky
const nt=validateNoTrade({reason:'news',instrument:'EUR/USD',direction:'short',note:' NFP za 10 min '},IDS,NOW);
check('vynechaný obchod: validace',nt.reason==='news'&&nt.note==='NFP za 10 min'&&nt.at===NOW&&nt.direction==='short');
check('vynechaný obchod: chyby',typeof validateNoTrade({reason:'pnl'},IDS,NOW)==='string'&&typeof validateNoTrade({reason:'other',instrument:'XXX'},IDS,NOW)==='string'&&typeof validateNoTrade({reason:'other',at:NOW+3*864e5},IDS,NOW)==='string');
const ev=(u)=>({requiredUnmet:u,requiredUnknown:0});
const st=planStats([{reason:'condition'},{reason:'news',eval:ev(1)},{reason:'emotion'}],[{status:'pause'},{status:'waiting'},{status:'pause'}],[{eval:ev(0)},{eval:ev(0)},{eval:ev(1)},{eval:null}]);
check('statistiky: počty podle důvodu a dnů',st.count===3&&st.byReason.condition===1&&st.byReason.news===1&&st.byReason.emotion===1&&st.byReason.risk===0&&st.days.pause===2&&st.days.waiting===1,st);
check('statistiky: dodržení = obchody bez nesplněné povinné + vynechání kvůli pravidlu',st.plans===3&&st.followed===2&&st.broken===1&&st.skipsOnRule===2&&st.adherence===80,st);
check('statistiky: bez dat adherence null',planStats([],[],[]).adherence===null);
const dayOf=ms=>new Date(ms).toISOString().slice(0,10);
const tl=timeline([{id:1,at:Date.parse('2026-10-19T09:00:00Z')},{id:2,at:Date.parse('2026-10-20T08:00:00Z')},{id:3,at:Date.parse('2026-10-20T11:00:00Z')}],[{day:'2026-10-18',status:'pause',note:'Nemoc'},{day:'2026-10-20',status:'skipping',note:''}],dayOf);
check('časová osa Deníku: dny sestupně, stav dne a záznamy',j(tl.map(t=>[t.day,t.status,t.items.map(i=>i.id)]))===j([['2026-10-20','skipping',[3,2]],['2026-10-19',null,[1]],['2026-10-18','pause',[]]]),tl);
const cmp=compareExecution({bias:'long',levels:{entryFrom:1.08,entryTo:1.09,invalidation:1.075,targets:[1.1]},snapshot:snap},{side:'buy',openPrice:1.085,sl:1.075,tp:1.1,closePrice:1.1});
check('plán vs. provedení: směr, zóna, stop, povinné',cmp.find(x=>x.key==='dir').ok===true&&cmp.find(x=>x.key==='entry').ok===true&&cmp.find(x=>x.key==='sl').ok===true&&cmp.find(x=>x.key==='req').ok===false,cmp);
check('plán vs. provedení: vstup mimo zónu a bez SL',(()=>{const c=compareExecution({bias:'short',levels:{entryFrom:1.08,entryTo:1.09,invalidation:1.095,targets:[]},snapshot:null},{side:'buy',openPrice:1.07,sl:null,tp:null,closePrice:null});return c.find(x=>x.key==='dir').ok===false&&c.find(x=>x.key==='entry').ok===false&&c.find(x=>x.key==='sl').ok===false})());
check('den YYYY-MM-DD',isDay('2026-10-20')&&!isDay('2026-13-45x')&&!isDay(null));

// ---------- převod starých dat
const legacy=legacyChecklistContent({name:'Před vstupem',items:[{id:'abcd1234',text:' Trend '},{id:'abcd1234',text:'SL nastaven'},{id:'x',text:''}],markets:['EUR/USD','XXX']},IDS);
check('převod checklistu: body = podpůrné podmínky Setupu se stejným id, trhy do Rozsahu',j(legacy.scope.markets)==='["EUR/USD"]'&&legacy.blocks.setup.conditions.length===2&&legacy.blocks.setup.conditions[0].id==='abcd1234'&&legacy.blocks.setup.conditions[1].id!=='abcd1234'&&legacy.blocks.setup.conditions.every(c=>c.role==='supportive'&&c.model===null)&&legacy.blocks.setup.conditions[0].text==='Trend',legacy);
check('převod checklistu: výsledek projde validací beze změny',sameContent(validateContent(legacy,IDS),legacy));
check('převod: název bez kolize, s příponou při kolizi',legacyStrategyName('Breakout',['Pullback'])==='Breakout'&&legacyStrategyName('Breakout',['breakout'])==='Breakout (checklist)'&&legacyStrategyName('Breakout',['Breakout','Breakout (checklist)'])==='Breakout (checklist 2)'&&legacyStrategyName('x'.repeat(70),[]).length===60&&legacyStrategyName('',[])==='Checklist');
check('převod: id verze 1 = v1_<strategie>',legacyVersionId('str_abc')==='v1_str_abc');
const sqlFile=readFileSync(new URL('../drizzle/mariadb/0036_strategy_versions.sql',import.meta.url),'utf8');
check('migrace 0036: prázdná verze 1 má stejný tvar jako emptyContent()',sqlFile.includes("'"+JSON.stringify(emptyContent())+"'"));
check('migrace 0036: tabulky s user_id a převod obchodů ze strategie na v1',['strategy_versions','scenarios','no_trades','day_status','trade_plans','plan_files'].every(t=>new RegExp('CREATE TABLE IF NOT EXISTS '+t+'\\([\\s\\S]*?user_id VARCHAR\\(128\\) NOT NULL').test(sqlFile))&&/INSERT IGNORE INTO trade_plans[\s\S]*CONCAT\('v1_',r\.strategy_id\)[\s\S]*FROM trade_reviews/.test(sqlFile)&&sqlFile.split('--> statement-breakpoint').length>=10);
check('id podmínky',/^[a-z0-9]{8}$/.test(newItemId()));

// ---------- DB vrstva: falešná DB, izolace uživatelů a neměnnost verzí
function fakeDb(answer){
 const log=[];
 const db={log,prepare(sql){const make=p=>({bind:(...q)=>make(q),
  async run(){log.push({sql,p});const a=answer(sql,p,'run');return {success:true,meta:{changes:a?.changes??1,last_row_id:0}}},
  async first(){log.push({sql,p});return answer(sql,p,'first')??null},
  async all(){log.push({sql,p});return {results:answer(sql,p,'all')??[],success:true,meta:{}}}});return make([])}};
 return db;
}
const C1=JSON.stringify(c1);
{ // použitá verze: úprava založí v2, v1 ani plán obchodu se nemění
 const D=fakeDb((sql,p,k)=>{
  if(/SELECT id FROM strategies WHERE id=\? AND user_id=\?/.test(sql))return {id:'str_1'};
  if(/FROM strategy_versions v JOIN strategies s .*ORDER BY v.version DESC LIMIT 1/.test(sql))return {id:'v1_str_1',strategy_id:'str_1',version:1,content:C1,changelog:null,created:'2026-10-01 10:00:00',updated:'2026-10-01 10:00:00',name:'S'};
  if(/AS used/.test(sql))return {used:1};
  if(/COUNT\(\*\) AS n FROM strategy_versions/.test(sql))return {n:1};
 });
 const r=await store.saveVersion(D,'u1','str_1',c2,'Upravený trigger',IDS,NOW);
 const ins=D.log.find(l=>/^INSERT IGNORE INTO strategy_versions/.test(l.sql));
 check('DB: použitá verze → INSERT verze 2, žádný UPDATE staré verze ani plánů obchodů',r.action==='create'&&r.version===2&&ins&&ins.p[3]===2&&ins.p[2]==='u1'&&!D.log.some(l=>/^UPDATE (strategy_versions|trade_plans)/.test(l.sql)),{r,log:D.log.map(l=>l.sql.slice(0,60))});
 let err='';try{await store.saveVersion(D,'u1','str_1',c2,'',IDS,NOW)}catch(e){err=e.message}
 check('DB: použitá verze bez popisu změny = chyba, nic se nezapíše',/nová verze/.test(err));
}
{ // nepoužitá verze: přepis s pojistkou NOT EXISTS (mezitím použitá verze se nepřepíše)
 let guarded=false;
 const D=fakeDb((sql,p)=>{
  if(/SELECT id FROM strategies WHERE id=\? AND user_id=\?/.test(sql))return {id:'str_1'};
  if(/ORDER BY v.version DESC LIMIT 1/.test(sql))return {id:'v1_str_1',strategy_id:'str_1',version:1,content:C1,name:'S',created:'2026-10-01 10:00:00',updated:'2026-10-01 10:00:00'};
  if(/AS used/.test(sql))return {used:0};
  if(/^UPDATE strategy_versions/.test(sql)){guarded=/NOT EXISTS\(SELECT 1 FROM trade_plans WHERE user_id=\? AND version_id=\?\)/.test(sql);return {changes:0}}
 });
 let err='';try{await store.saveVersion(D,'u1','str_1',c2,'',IDS,NOW)}catch(e){err=e.message}
 check('DB: přepis nepoužité verze hlídá použití v tomtéž UPDATE; souběžně použitá → chyba',guarded&&/mezitím použil/.test(err),err);
}
{ // cizí strategie: nic
 const D=fakeDb(()=>null);
 check('DB: cizí strategie = null, nic se nezapíše',await store.saveVersion(D,'u1','str_cizi',c2,'x',IDS,NOW)===null&&D.log.length===1);
}
{ // izolace: každý dotaz na nové tabulky filtruje user_id a dostane id přihlášeného
 const MY=/(strategy_versions|scenarios|no_trades|day_status|trade_plans|plan_files|strategies|checklists|price_alerts|trade_reviews)\b/;
 const D=fakeDb((sql,p,k)=>{
  if(/FROM scenarios c/.test(sql)&&k==='first')return {id:'scn_'+'a'.repeat(24),instrument:'EUR/USD',bias:'long',hypothesis:'h',levels:'{}',status:'waiting',created:'2026-10-20 08:00:00',updated:'2026-10-20 08:00:00',trades:0};
  if(/COUNT/.test(sql))return {n:0,o:0};
 });
 const calls=[
  ()=>store.ensureMigrated(D,'u1',IDS,NOW),()=>store.listStrategiesFull(D,'u1',true),()=>store.listVersions(D,'u1','str_1'),()=>store.getVersion(D,'u1','v1_str_1'),
  ()=>store.listScenarios(D,'u1',{scope:'open',instrument:'EUR/USD'},NOW),()=>store.getScenario(D,'u1','scn_x'),()=>store.deleteScenario(D,'u1','scn_x'),
  ()=>store.updateScenario(D,'u1','scn_x',{status:'active',note:'n'},IDS,NOW),
  ()=>store.createScenario(D,'u1',{instrument:'EUR/USD',bias:'long',hypothesis:'h'},IDS,NOW),
  ()=>store.listNoTrades(D,'u1',NOW-864e5,NOW),()=>store.createNoTrade(D,'u1',{reason:'news',scenarioId:'scn_x'},IDS,NOW),()=>store.deleteNoTrade(D,'u1','ntr_x'),
  ()=>store.listDays(D,'u1','2026-10-01','2026-10-31'),()=>store.setDay(D,'u1','2026-10-20','pause','',NOW),()=>store.setDay(D,'u1','2026-10-20',null,'',NOW),
  ()=>store.getTradePlan(D,'u1','mt:1'),()=>store.linkTrade(D,'u1','mt:1',{scenarioId:'scn_x'},NOW),()=>store.unlinkTrade(D,'u1','mt:1'),()=>store.planEvals(D,'u1'),
  ()=>store.scenariosForAlerts(D,'u1',['al_1']),()=>store.ownPlanFile(D,'u1','plf_x'),()=>store.deletePlanFile(D,'u1','plf_x'),()=>store.countPlanFiles(D,'u1'),
  ()=>store.setStrategyOrigin(D,'u1','str_1','mentor','M'),()=>store.tradeEntry(D,'u1','man','5'),
 ];
 for(const f of calls){try{await f()}catch{}}
 const bad=D.log.filter(l=>MY.test(l.sql)&&!(/user_id\s*=\s*\?|user_id IN|WHERE user_id/.test(l.sql)&&l.p.includes('u1'))&&!/^INSERT/.test(l.sql));
 const ins=D.log.filter(l=>/^INSERT/.test(l.sql)&&MY.test(l.sql));
 check('izolace: každý SELECT/UPDATE/DELETE nad plány filtruje user_id přihlášeného',bad.length===0&&D.log.length>30,{n:D.log.length,bad:bad.map(l=>l.sql.slice(0,120))});
 check('izolace: každý INSERT zapisuje user_id přihlášeného',ins.length>0&&ins.every(l=>l.p.includes('u1')||/s\.user_id=\?/.test(l.sql)),ins.map(l=>l.sql.slice(0,80)));
 check('izolace: žádný dotaz nepoužije jiného uživatele',!D.log.some(l=>l.p.includes('u2')));
}
{ // vynechaný obchod ze scénáře uzavře otevřený scénář jako vynechaný
 const D=fakeDb((sql,p,k)=>{
  if(/FROM scenarios c/.test(sql))return {id:'scn_x',instrument:'EUR/USD',bias:'short',hypothesis:'h',levels:'{}',status:'active',valid_until:null,created:'2026-10-20 08:00:00',updated:'2026-10-20 08:00:00',trades:0};
  if(/COUNT/.test(sql))return {n:0};
 });
 await store.createNoTrade(D,'u1',{reason:'condition',scenarioId:'scn_x'},IDS,NOW);
 const ins=D.log.find(l=>/^INSERT INTO no_trades/.test(l.sql)),up=D.log.find(l=>/^UPDATE scenarios SET status='skipped'/.test(l.sql));
 check('DB: vynechání ze scénáře převezme trh a směr a scénář uzavře',ins&&ins.p[3]==='EUR/USD'&&ins.p[4]==='short'&&up&&up.p.includes('u1'),ins?.p);
}
{ // propojení obchodu se scénářem: snímek scénáře se zkopíruje, scénář = vstoupeno, strategie do vyhodnocení jen když chybí
 const SNAP=JSON.stringify(snap);
 const D=fakeDb((sql,p,k)=>{
  if(/FROM scenarios c/.test(sql))return {id:'scn_x',instrument:'EUR/USD',bias:'long',hypothesis:'h',levels:'{}',status:'waiting',strategy_id:'str_1',version_id:'v1_str_1',version:1,snapshot:SNAP,created:'2026-10-20 08:00:00',updated:'2026-10-20 08:00:00',trades:0};
  if(/FROM trade_plans p/.test(sql))return {trade_id:'mt:1',scenario_id:'scn_x',strategy_id:'str_1',version_id:'v1_str_1',snapshot:SNAP,version:1,name:'S',updated:'2026-10-20 10:00:00'};
 });
 const pl=await store.linkTrade(D,'u1','mt:1',{scenarioId:'scn_x'},NOW);
 const tp=D.log.find(l=>/^INSERT INTO trade_plans/.test(l.sql)),rv=D.log.find(l=>/^INSERT INTO trade_reviews/.test(l.sql));
 check('DB: obchod drží verzi a snímek scénáře',tp&&tp.p[4]==='v1_str_1'&&JSON.parse(tp.p[6]).eval.verdict==='blocked'&&pl.version===1,tp?.p);
 check('DB: scénář → vstoupeno, strategie do vyhodnocení přes IFNULL',D.log.some(l=>/^UPDATE scenarios SET status='entered'/.test(l.sql))&&rv&&/IFNULL\(strategy_id/.test(rv.sql));
}
{ // převod checklistu: nejdřív „zabrat“ (migrate_pending=1 → 0), pak strategie + verze 1
 const D=fakeDb((sql,p,k)=>{
  if(/FROM checklists WHERE user_id=\? AND migrate_pending=1/.test(sql))return [{id:'c1',name:'Breakout',items:j([{id:'abcd1234',text:'Trend'}]),markets:j(['EUR/USD'])}];
  if(/SELECT name FROM strategies/.test(sql))return [{name:'Breakout'}];
 });
 const n=await store.ensureMigrated(D,'u1',IDS,NOW);
 const claim=D.log.findIndex(l=>/^UPDATE checklists SET migrate_pending=0/.test(l.sql)),ins=D.log.findIndex(l=>/^INSERT INTO strategies/.test(l.sql)),v1=D.log.find(l=>/^INSERT IGNORE INTO strategy_versions\(id,strategy_id,user_id,version,content/.test(l.sql)&&l.p.length===7);
 check('DB: převod checklistu – zabrání před vložením, název s příponou, v1 s podmínkou',n===1&&claim>=0&&ins>claim&&D.log[ins].p[2]==='Breakout (checklist)'&&v1&&JSON.parse(v1.p[3]).blocks.setup.conditions[0].id==='abcd1234',D.log.map(l=>l.sql.slice(0,50)));
}

if(fails.length){console.log(`\n${fails.length} kontrol selhalo`);process.exit(1)}
console.log('\nVše v pořádku.');
