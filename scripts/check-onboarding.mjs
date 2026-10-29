// Kontrola průvodce: node --experimental-strip-types scripts/check-onboarding.mjs
// Validace odpovědí (riziko bez výchozí hodnoty), náhled odpovědi → nastavení (vlaječky, navigace, panely, pole deníku, strategie, profil),
// použití a vrácení (obnoví předchozí stav), DB vrstva nad podvrženou DB (jen vlastní řádky) a napojení v UI/API.
import {readFileSync} from 'node:fs';
import {emptyAnswers,validateAnswers,buildPreview,planApply,planRevert,parseSnapshot,normalizePrefs,defaultPrefs,dashHideCss,shouldPrompt,DASH_PANELS,JOURNAL_FIELDS,WATCH_FLAG} from '../lib/onboarding/core.ts';
import {getState,apply,revert,saveDraft,skip,setPrefs,getPrefs} from '../lib/onboarding/store.ts';
import {defaultNav,normalizeNav} from '../lib/nav.ts';
import {validateContent,BLOCK_IDS} from '../lib/strategy/core.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const j=x=>JSON.stringify(x);
const IDS=['EUR/USD','GBP/USD','USD/JPY','^NDX','^GSPC','GC=F','CL=F','AAPL','NVDA','BTC-USD','ETH-USD','USD/CZK','USD','EUR'];
const cur0=()=>({nav:defaultNav(),flags:{},prefs:defaultPrefs()});
const A=(o)=>{const v=validateAnswers({...emptyAnswers(),...o});if(typeof v==='string')throw Error(v);return v};

// ---------- riziko bez výchozí hodnoty
check('prázdné odpovědi: riziko null',emptyAnswers().riskPct===null);
check('validace: riziko neposlané → null',validateAnswers({markets:[]}).riskPct===null);
check('validace: riziko prázdný text → null',validateAnswers({riskPct:''}).riskPct===null);
check('validace: riziko null → null',validateAnswers({riskPct:null}).riskPct===null);
check('validace: riziko „0,5“ → 0,5',validateAnswers({riskPct:'0,5'}).riskPct===0.5);
check('validace: riziko 0 a 150 odmítnuto',typeof validateAnswers({riskPct:0})==='string'&&typeof validateAnswers({riskPct:150})==='string');
check('náhled: bez rizika profil bez rizika',buildPreview(A({account:'challenge'}),cur0(),IDS).profile.maxRiskPct===null);
check('náhled: bez rizika poznámka „žádné výchozí“',buildPreview(A({}),cur0(),IDS).notes.some(n=>/žádné výchozí/.test(n)));
check('náhled: zadané riziko se jen převezme',buildPreview(A({account:'personal',riskPct:'0,75'}),cur0(),IDS).profile.maxRiskPct===0.75);
check('zdroj: žádné výchozí riziko v kódu průvodce',!/riskPct\s*:\s*(0\.\d|1)\b/.test(readFileSync(new URL('../lib/onboarding/core.ts',import.meta.url),'utf8')));

// ---------- validace
check('validace: neznámý trh',typeof validateAnswers({markets:['forex']})==='string');
check('validace: neznámý styl',typeof validateAnswers({style:'hodl'})==='string');
check('validace: neznámá zóna',typeof validateAnswers({tz:'Mars/Olympus'})==='string');
check('validace: časové rámce v pořadí a bez duplicit',j(validateAnswers({timeframes:['H4','M15','H4']}).timeframes)==='["M15","H4"]');
check('validace: „nic dalšího“ s nástrojem se zahodí',j(validateAnswers({tools:['none','mt5']}).tools)==='["mt5"]');
check('validace: broker do 60 znaků',typeof validateAnswers({broker:'x'.repeat(61)})==='string'&&validateAnswers({broker:'  IC   Markets '}).broker==='IC Markets');
check('validace: __proto__ / pole odmítnuto',typeof validateAnswers([])==='string'&&typeof validateAnswers(null)==='string');

// ---------- náhled: vlaječky
const p1=buildPreview(A({markets:['fx','index'],style:'day',time:'h2to4',timeframes:['M15','H1'],account:'challenge',tools:['mt5']}),cur0(),IDS);
check('vlaječky: zástupci FX a indexů',j(p1.watch.map(w=>w.instrument))===j(['EUR/USD','GBP/USD','USD/JPY','^NDX','^GSPC']),p1.watch);
check('vlaječky: „Vyhlížím konkrétní pozici“',p1.watch.every(w=>w.to===WATCH_FLAG&&w.from==='none'));
const pf=buildPreview(A({markets:['fx']}),{...cur0(),flags:{'EUR/USD':'green','GBP/USD':'none'}},IDS);
check('vlaječky: existující vlaječka se nepřepíše',!pf.watch.some(w=>w.instrument==='EUR/USD')&&pf.watch.some(w=>w.instrument==='GBP/USD'),pf.watch);
check('vlaječky: jen existující trhy',buildPreview(A({markets:['stock']}),cur0(),['AAPL']).watch.length===1);
// navigace
check('navigace: day trading → kalendář a deník dopředu',j(p1.nav.order.slice(0,3))===j(['dashboard','calendar','journal'])&&p1.navChanged);
const p2=buildPreview(A({markets:['crypto'],style:'swing',time:'lt1'}),cur0(),IDS);
check('navigace: swing → analýza a reporty dopředu',p2.nav.order[1]==='analyzer');
check('navigace: jen krypto → Reporty schované',p2.nav.hidden.includes('reports'));
check('navigace: FX → Reporty zůstanou',!p1.nav.hidden.includes('reports'));
check('navigace: málo času → sloučit Deník a Journaling',p2.nav.merge===true&&p1.nav.merge===false);
check('navigace: Dashboard nikdy neschovaný',!p2.nav.hidden.includes('dashboard'));
check('navigace: bez stylu a času beze změny',buildPreview(A({markets:['fx']}),cur0(),IDS).navChanged===false);
// panely a pole
check('panely: bez FX → Síla měn schovaná',p2.prefs.dash.off.includes('currencies')&&!p1.prefs.dash.off.includes('currencies'));
check('panely: swing → Seance schovaná',p2.prefs.dash.off.includes('session')&&!p1.prefs.dash.off.includes('session'));
check('panely: málo času → Co se dnes hýbe schované',p2.prefs.dash.off.includes('movers'));
const p3=buildPreview(A({style:'scalp',tools:['tradingview']}),cur0(),IDS);
check('panely: bez MT/T212 → otevřené pozice a riziko schované',p3.prefs.dash.off.includes('positions')&&p3.prefs.dash.off.includes('risk')&&!p1.prefs.dash.off.includes('positions'));
check('pole deníku: scalping bez synchronizace → změny SL/TP sbalené',j(p3.prefs.journal.off)==='["changes"]'&&p1.prefs.journal.off.length===0);
check('panely: id jen ze seznamu',p3.prefs.dash.off.every(id=>DASH_PANELS.some(p=>p[0]===id)));
// strategie a profil
const c=p1.strategy.content;
check('strategie: bloky prázdné',BLOCK_IDS.every(b=>c.blocks[b].text===''&&c.blocks[b].conditions.length===0));
check('strategie: rozsah z odpovědí',j(c.scope.timeframes)==='["M15","H1"]'&&c.scope.style==='day'&&c.scope.markets.length===5);
check('strategie: obsah projde validací verze',typeof validateContent(c,IDS)!=='string',validateContent(c,IDS));
check('strategie: název podle stylu',p1.strategy.name==='Moje strategie – Day trading');
check('profil: návrh challenge se zónou',p1.profile?.kind==='challenge'&&p1.profile.tz==='Europe/Prague');
check('profil: bez typu účtu žádný návrh',buildPreview(A({}),cur0(),IDS).profile===null);
// náhled nic nemění
const cur=cur0(),snap=j(cur);buildPreview(A({markets:['fx'],style:'day',time:'lt1'}),cur,IDS);
check('náhled: aktuální stav se nemění',j(cur)===snap);

// ---------- použití a vrácení
const before={nav:normalizeNav({order:['dashboard','journal','analyzer','reports','calendar','journaling'],hidden:['calendar'],merge:false}),flags:{'EUR/USD':'red'},prefs:normalizePrefs({dash:{off:['stats']}})};
const pv=buildPreview(A({markets:['fx','crypto'],style:'swing',time:'lt1',tools:['tradingview']}),before,IDS);
const {writes,previous}=planApply(pv,before);
check('použití: zapíše navigaci, vlaječky a panely',writes.nav!==null&&writes.flags.length===4&&writes.prefs.dash.off.includes('movers'),writes);
check('použití: předchozí stav jen dotčených vlaječek',j(previous.flags)===j({'GBP/USD':'none','USD/JPY':'none','BTC-USD':'none','ETH-USD':'none'}),previous.flags);
const after={nav:writes.nav,flags:{...before.flags,...Object.fromEntries(writes.flags.map(f=>[f.instrument,f.flag]))},prefs:writes.prefs};
const rv=planRevert(previous,after);
check('vrácení: navigace jako před průvodcem',j(rv.nav)===j(before.nav));
check('vrácení: panely a pole jako před průvodcem',j(rv.prefs)===j(before.prefs));
check('vrácení: vlaječky zpět na původní',rv.flags.length===4&&rv.flags.every(f=>f.flag==='none'));
const touched={...after,flags:{...after.flags,'BTC-USD':'green'}};
check('vrácení: vlaječku změněnou uživatelem po průvodci nechá',!planRevert(previous,touched).flags.some(f=>f.instrument==='BTC-USD'));
check('snímek: JSON tam a zpět',j(parseSnapshot(JSON.stringify(previous)))===j(previous));
check('snímek: vadný JSON → null, cizí vlaječka se zahodí',parseSnapshot('{x')===null&&j(parseSnapshot(JSON.stringify({nav:{},flags:{a:'evil'},prefs:{}})).flags)==='{}');
check('prefs: neznámé id se zahodí',j(normalizePrefs({dash:{off:['x','stats']},journal:{off:['checkin','y']}}))===j({dash:{off:['stats']},journal:{off:['checkin']}}));
check('CSS skrytí panelů pro každý panel',DASH_PANELS.every(([id,,sel])=>dashHideCss().includes(`[data-off~="${id}"]>${sel}`)));
check('výzva: jen dokud nepoužito / nepřeskočeno',shouldPrompt(null)&&shouldPrompt('new')&&shouldPrompt('draft')&&!shouldPrompt('applied')&&!shouldPrompt('skipped')&&!shouldPrompt('reverted')&&!shouldPrompt('unavailable'));
check('pole deníku: 5 polí včetně check-inu',JOURNAL_FIELDS.length===5&&JOURNAL_FIELDS.some(f=>f[0]==='checkin'));

// ---------- DB vrstva nad podvrženou DB
function fakeDb(){
 const t={onb:new Map(),members:new Map([['u1',{nav:JSON.stringify(before.nav)}],['u2',{nav:null}]]),flags:[{user_id:'u1',instrument:'EUR/USD',flag:'red'},{user_id:'u2',instrument:'GBP/USD',flag:'green'}]},log=[];
 const db={t,log,prepare(sql){const make=q=>({bind:(...a)=>make(a),
  async first(){log.push([sql,q]);if(/FROM onboarding_answers/.test(sql))return t.onb.get(q[0])||null;if(/FROM members/.test(sql))return t.members.get(q[0])||null;return null},
  async all(){log.push([sql,q]);if(/FROM watch_flags/.test(sql))return {results:t.flags.filter(f=>f.user_id===q[0])};return {results:[]}},
  async run(){log.push([sql,q]);
   if(/^INSERT INTO onboarding_answers/.test(sql)){const cols=sql.match(/\(user_id,([^)]*)\)/)[1].split(',');const row={...(t.onb.get(q[0])||{status:'new'})};cols.forEach((c,i)=>{if(c!=='created'&&c!=='updated')row[c]=q[i+1]});t.onb.set(q[0],row)}
   if(/^UPDATE members SET nav/.test(sql))t.members.set(q[1],{nav:q[0]});
   if(/^INSERT INTO watch_flags/.test(sql)){const f=t.flags.find(x=>x.user_id===q[1]&&x.instrument===q[2]);if(f)f.flag=q[3];else t.flags.push({user_id:q[1],instrument:q[2],flag:q[3]})}
   return {meta:{changes:1}}}});return make([])}};
 return db;
}
const D=fakeDb();
check('DB: bez řádku stav „new“',(await getState(D,'u1')).status==='new');
await saveDraft(D,'u1',A({markets:['fx']}));
check('DB: rozpracované → draft',(await getState(D,'u1')).status==='draft');
const ans=A({markets:['fx','crypto'],style:'swing',time:'lt1',tools:['tradingview']});
await apply(D,'u1',ans,IDS);
const s1=await getState(D,'u1');
check('DB: použito → applied, jde vrátit',s1.status==='applied'&&s1.canRevert,s1);
check('DB: navigace zapsaná za přihlášeného',JSON.parse(D.t.members.get('u1').nav).merge===true&&D.t.members.get('u2').nav===null);
check('DB: vlaječky jen u1, EUR/USD (red) nepřepsána',D.t.flags.filter(f=>f.user_id==='u1'&&f.flag===WATCH_FLAG).length===4&&D.t.flags.find(f=>f.user_id==='u1'&&f.instrument==='EUR/USD').flag==='red'&&D.t.flags.find(f=>f.user_id==='u2').flag==='green');
check('DB: panely uložené',(await getPrefs(D,'u1')).dash.off.includes('movers'));
check('DB: vrácení proběhne',await revert(D,'u1'));
check('DB: po vrácení navigace jako dřív',j(JSON.parse(D.t.members.get('u1').nav))===j(before.nav));
check('DB: po vrácení vlaječky zpět',D.t.flags.filter(f=>f.user_id==='u1'&&f.flag===WATCH_FLAG).length===0);
check('DB: po vrácení panely výchozí',(await getPrefs(D,'u1')).dash.off.length===0);
check('DB: druhé vrácení nic nedělá',!(await revert(D,'u1'))&&(await getState(D,'u1')).status==='reverted');
await skip(D,'u2');check('DB: přeskočit → skipped',(await getState(D,'u2')).status==='skipped');
await setPrefs(D,'u2',{dash:{off:['stats','nesmysl']}});check('DB: panely z Nastavení normalizované',j((await getPrefs(D,'u2')).dash.off)==='["stats"]');
check('DB: každý dotaz s user_id přihlášeného',D.log.every(([s,q])=>/WHERE (user_id|id)=\?|^INSERT INTO (onboarding_answers|watch_flags)/.test(s)&&(q.includes('u1')||q.includes('u2'))),D.log.filter(([s,q])=>!(q.includes('u1')||q.includes('u2'))));
const missing={prepare(){const m={bind:()=>m,first:async()=>{throw Error("Table 'tradee.onboarding_answers' doesn't exist")}};return m}};
check('DB: chybí tabulka → výchozí panely',j(await getPrefs(missing,'u1'))===j(defaultPrefs()));

// ---------- napojení (statická kontrola)
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const api=src('app/api/onboarding/route.ts');
check('API: identity, sameOrigin u změn',/GET[\s\S]*identity\(req\)/.test(api)&&/PUT[\s\S]*sameOrigin\(req\)/.test(api)&&/PATCH[\s\S]*sameOrigin\(req\)/.test(api)&&/POST[\s\S]*sameOrigin\(req\)/.test(api));
check('API: strategie jen na výslovné potvrzení a bez přepsání existující',/createStrategy===true/.test(api)&&/SELECT id FROM strategies WHERE user_id=\? AND name=\?/.test(api));
check('API: bez migrace „unavailable“',/status:'unavailable'/.test(api));
check('migrace 0043: onboarding_answers s answers/status/prefs/previous',/CREATE TABLE IF NOT EXISTS onboarding_answers/.test(src('drizzle/mariadb/0043_onboarding.sql'))&&/previous TEXT/.test(src('drizzle/mariadb/0043_onboarding.sql')));
check('Nastavení: průvodce jde otevřít znovu + panely',/href="\/pruvodce"/.test(src('app/settings-page.tsx'))&&/<Guide\/><Panels\/>/.test(src('app/settings-page.tsx')));
check('Dashboard: výzva k průvodci a skrytí panelů',/<OnboardingGate/.test(src('app/dashboard.tsx'))&&/data-off=\{dashPrefs\.dash\.off/.test(src('app/dashboard.tsx')));
check('Účty: návrh profilu z průvodce (?navrh=1)',/navrh/.test(src('app/risk/accounts-page.tsx'))&&/maxRiskPct:a\.riskPct/.test(src('app/risk/accounts-page.tsx')));
check('Stránka průvodce: použít, přeskočit, vrátit',/action:'apply'/.test(src('app/onboarding/onboarding-page.tsx'))&&/action:'skip'/.test(src('app/onboarding/onboarding-page.tsx'))&&/action:'revert'/.test(src('app/onboarding/onboarding-page.tsx')));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
