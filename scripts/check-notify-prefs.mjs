// Kontrola voleb upozornění: node --experimental-strip-types scripts/check-notify-prefs.mjs
// Výchozí hodnoty (alerty vše, disciplína podle notify_settings, laboratoř vše), sloučení s řádky, validace změny z API,
// Laboratoř jen pro vlastníka, brány odesílání (alerty, disciplína), výchozí kanály formuláře, okénko v aplikaci, limit testu, popis zařízení,
// DB pomocníci nad podvrženou DB (izolace uživatelů, chybějící tabulka = výchozí) a přednost notify_prefs v getNotify.
import {readFileSync} from 'node:fs';
import {CATEGORIES,defaultPrefs,mergePrefs,parsePatch,applyPatch,publicPrefs,visibleCategories,gateAlert,defaultAlertChannels,toastsToShow,testAllowed,deviceLabel,uaShort,getPrefs,setPrefs,prefRowsFor,channelsFor} from '../lib/notify/prefs.ts';
import {getNotify} from '../lib/discipline/store.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const throws=(f,re)=>{try{f();return false}catch(e){return re?re.test(e.message):true}};
const j=x=>JSON.stringify(x);
const ALL={push:true,mail:true,inapp:true};

// ---------- výchozí
const d0=defaultPrefs();
check('kategorie: alerts, discipline, lab',j(CATEGORIES)==='["alerts","discipline","lab"]');
check('výchozí: alerty push+mail+v aplikaci',j(d0.alerts)===j(ALL),d0.alerts);
check('výchozí: disciplína bez notify_settings = dosavadní (mail, okno, bez push)',j(d0.discipline)===j({push:false,mail:true,inapp:true}),d0.discipline);
check('výchozí: laboratoř vše zapnuto (nic potichu nepřestane)',j(d0.lab)===j(ALL),d0.lab);
check('výchozí: disciplína z notify_settings (popup→v aplikaci)',j(defaultPrefs({popup:false,mail:false,push:true}).discipline)===j({push:true,mail:false,inapp:false}));

// ---------- sloučení
const m=mergePrefs([{category:'alerts',push:0,mail:1,inapp:0},{category:'nesmysl',push:1,mail:1,inapp:1},{category:'lab',push:'0',mail:'1',inapp:'1'}],{popup:true,mail:true,push:true});
check('sloučení: řádek alertů přepíše výchozí',j(m.alerts)===j({push:false,mail:true,inapp:false}),m.alerts);
check('sloučení: neznámá kategorie se ignoruje',!('nesmysl' in m));
check('sloučení: disciplína bez řádku = notify_settings',j(m.discipline)===j(ALL),m.discipline);
check('sloučení: hodnoty jako řetězce z DB',m.lab.push===false&&m.lab.mail===true);
check('sloučení: prázdné / null řádky = výchozí',j(mergePrefs(null))===j(defaultPrefs())&&j(mergePrefs([]))===j(defaultPrefs()));
const ap=applyPatch(d0,{alerts:{mail:false}});
check('změna: jen dotčený kanál, originál nezměněn',ap.alerts.mail===false&&ap.alerts.push===true&&d0.alerts.mail===true);

// ---------- vlastník / ostatní
check('ne-vlastník nevidí Laboratoř',j(visibleCategories(false))==='["alerts","discipline"]');
check('vlastník vidí i Laboratoř',j(visibleCategories(true))==='["alerts","discipline","lab"]');
check('publicPrefs bez lab pro ne-vlastníka',!('lab' in publicPrefs(d0,false))&&'lab' in publicPrefs(d0,true));

// ---------- validace změny (PUT /api/notify/prefs)
check('validace: platná změna',j(parsePatch({alerts:{push:false,inapp:true}},false))===j({alerts:{push:false,inapp:true}}));
check('validace: lab jen vlastník',throws(()=>parsePatch({lab:{mail:false}},false),/kategorie/)&&j(parsePatch({lab:{mail:false}},true))===j({lab:{mail:false}}));
check('validace: neznámá kategorie',throws(()=>parsePatch({spam:{push:true}},true),/kategorie/));
check('validace: neznámý kanál',throws(()=>parsePatch({alerts:{sms:true}},true),/kanál/));
check('validace: ne-boolean',throws(()=>parsePatch({alerts:{push:1}},true),/ano \/ ne/)&&throws(()=>parsePatch({alerts:{push:'true'}},true)));
check('validace: špatné typy těla',throws(()=>parsePatch(null,true))&&throws(()=>parsePatch([],true))&&throws(()=>parsePatch('x',true))&&throws(()=>parsePatch({alerts:[]},true))&&throws(()=>parsePatch({alerts:null},true)));
check('validace: prázdná změna',throws(()=>parsePatch({},true),/Není co/)&&throws(()=>parsePatch({alerts:{}},true),/Není co/));
check('validace: __proto__ neprojde',throws(()=>parsePatch(JSON.parse('{"__proto__":{"push":true}}'),true)));

// ---------- brány odesílání
check('alert: push+mail a vše zapnuto → oba',j(gateAlert(['push','mail'],ALL))===j({push:true,mail:true}));
check('alert: vypnutý push u alertů → jen mail',j(gateAlert(['push','mail'],{...ALL,push:false}))===j({push:false,mail:true}));
check('alert: vypnutý mail u alertů → jen push',j(gateAlert(['push','mail'],{...ALL,mail:false}))===j({push:true,mail:false}));
check('alert: kanál nevybraný v alertu nejde ani se zapnutou volbou',j(gateAlert(['mail'],ALL))===j({push:false,mail:true}));
check('alert: vše vypnuto → nic (zůstane jen schránka)',j(gateAlert(['push','mail'],{push:false,mail:false,inapp:true}))===j({push:false,mail:false}));
// výchozí kanály formuláře
check('formulář: vše zapnuto + zařízení → push+mail',j(defaultAlertChannels(ALL,true))==='["push","mail"]');
check('formulář: bez zařízení → mail',j(defaultAlertChannels(ALL,false))==='["mail"]');
check('formulář: mail vypnutý → push',j(defaultAlertChannels({...ALL,mail:false},true))==='["push"]');
check('formulář: vše vypnuto → aspoň jeden kanál',defaultAlertChannels({push:false,mail:false,inapp:true},false).length===1);
check('formulář: bez načtených voleb = jako dřív',j(defaultAlertChannels(null,true))==='["push","mail"]'&&j(defaultAlertChannels(undefined,false))==='["mail"]');

// ---------- okénko v aplikaci
const E=(id,read=false)=>({id,read});
const t0=toastsToShow([E(5),E(4)],null,true);
check('okénko: první načtení nic neukáže, jen si zapamatuje',t0.show.length===0&&t0.last===5,t0);
const t1=toastsToShow([E(7),E(6),E(5)],5,true);
check('okénko: nové události od nejstarší',j(t1.show.map(e=>e.id))==='[6,7]'&&t1.last===7,t1);
check('okénko: přečtené se neukazují',toastsToShow([E(8,true)],7,true).show.length===0);
const t2=toastsToShow([E(9)],8,false);
check('okénko: „V aplikaci“ vypnuto → nic, ale posune se (po zapnutí nezaplaví)',t2.show.length===0&&t2.last===9,t2);
check('okénko: nejvýš 3 najednou',toastsToShow([E(20),E(19),E(18),E(17),E(16)],10,true).show.length===3);
check('okénko: prázdný seznam drží poslední',toastsToShow([],12,true).last===12);

// ---------- test push, zařízení
const NOW=Date.parse('2026-10-28T10:00:00Z');
check('test: první povolen',testAllowed(null,NOW));
check('test: do minuty ne',!testAllowed(NOW-30000,NOW)&&!testAllowed(NOW-59999,NOW));
check('test: po minutě ano',testAllowed(NOW-60000,NOW));
check('zařízení: Chrome · macOS',deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')==='Chrome · macOS');
check('zařízení: Safari · iOS',deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')==='Safari · iOS');
check('zařízení: Edge · Windows',deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')==='Edge · Windows');
check('zařízení: Firefox · Android',deviceLabel('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0')==='Firefox · Android');
check('zařízení: bez UA podle push služby',deviceLabel(null,'https://web.push.apple.com/abc')==='Safari / Apple'&&deviceLabel('','https://fcm.googleapis.com/fcm/send/x')==='Chrome / Android'&&deviceLabel(undefined,null)==='Neznámé zařízení');
check('UA: zkrácení a jen ASCII',uaShort('a'.repeat(500)).length===200&&uaShort('x\u0000yé')==='xy'&&uaShort(null)===null);

// ---------- DB pomocníci nad podvrženou DB
function fakeDb({prefs=[],settings=null,missing=false}={}){
 const log=[];
 const db={log,prepare(sql){const make=q=>({bind:(...a)=>make(a),
  async first(){log.push([sql,q]);if(/FROM notify_settings/.test(sql))return settings;if(/FROM notify_prefs/.test(sql)){if(missing)throw Error("Table 'tradee.notify_prefs' doesn't exist");return prefs.find(r=>r.user_id===q[0]&&(!/category=/.test(sql)||r.category==='discipline'))||null}return null},
  async all(){log.push([sql,q]);if(/FROM notify_prefs/.test(sql)){if(missing)throw Error("Table 'tradee.notify_prefs' doesn't exist");
   if(/category=\?/.test(sql))return {results:prefs.filter(r=>r.category===q[0]&&q.slice(1).includes(r.user_id))};return {results:prefs.filter(r=>r.user_id===q[0])}}return {results:[]}},
  async run(){log.push([sql,q]);return {meta:{changes:1}}}});return make([])}};
 return db;
}
const rows=[{user_id:'u1',category:'alerts',push:0,mail:1,inapp:1},{user_id:'u2',category:'alerts',push:1,mail:0,inapp:0},{user_id:'u1',category:'discipline',push:1,mail:0,inapp:0}];
let D=fakeDb({prefs:rows,settings:{popup:1,mail:1,push:0}});
const g1=await getPrefs(D,'u1');
check('DB: getPrefs jen vlastní řádky',g1.alerts.push===false&&g1.alerts.mail===true&&g1.discipline.push===true&&D.log.every(([s,q])=>!/notify_/.test(s)||q.includes('u1')),g1);
const map=await prefRowsFor(D,'alerts',['u1','u2','u1','u3']);
check('DB: prefRowsFor pro více uživatelů (u3 bez řádku)',map.size===2&&map.get('u1').push===false&&map.get('u2').mail===false&&!map.has('u3'));
check('DB: channelsFor bez řádku = výchozí (lab zapnuto)',j(await channelsFor(D,'u3','lab'))===j(ALL));
D=fakeDb({missing:true,settings:{popup:0,mail:1,push:1}});
check('DB: chybí tabulka → výchozí, nic nespadne',j(await channelsFor(D,'u1','alerts'))===j(ALL)&&(await prefRowsFor(D,'alerts',['u1'])).size===0);
check('DB: chybí tabulka → disciplína z notify_settings',j((await getPrefs(D,'u1')).discipline)===j({push:true,mail:true,inapp:false}));
D=fakeDb({prefs:rows,settings:null});
const saved=await setPrefs(D,'u1',{alerts:{mail:false}}),ins=D.log.filter(([s])=>/^INSERT INTO notify_prefs/.test(s));
check('DB: setPrefs zapíše jen změněnou kategorii za přihlášeného',ins.length===1&&ins[0][1][0]==='u1'&&ins[0][1][1]==='alerts'&&ins[0][1][2]===0&&ins[0][1][3]===0&&saved.alerts.mail===false,ins);
// getNotify (okno ke zdůvodnění, violations/pending): řádek disciplíny má přednost
D=fakeDb({prefs:rows,settings:{popup:1,mail:1,push:0,snooze_until:null}});
const n1=await getNotify(D,'u1');
check('getNotify: notify_prefs (discipline) má přednost',n1.popup===false&&n1.mail===false&&n1.push===true,n1);
D=fakeDb({missing:true,settings:{popup:1,mail:0,push:0,snooze_until:null}});
const n2=await getNotify(D,'u1');
check('getNotify: bez tabulky jako dřív',n2.popup===true&&n2.mail===false&&n2.push===false,n2);

// ---------- odesílací skripty a API (statická kontrola)
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const ac=src('scripts/alerts-check.mjs');
check('alerts-check: brána gateAlert u push i mailu',/gateAlert/.test(ac)&&/g\.push&&pushOn/.test(ac)&&/g\.mail&&mailOn/.test(ac)&&!/a\.channels\.includes\('push'\)&&pushOn/.test(ac));
check('alerts-check: testovací push z fronty notify_tests',/notify_tests/.test(ac)&&/done IS NULL/.test(ac));
const nm=src('scripts/notify.mjs');
check('notify.mjs: volba disciplíny má přednost',/prefRowsFor\(d,'discipline'/.test(nm)&&/pref\?pref\.push/.test(nm)&&/pref\?pref\.mail/.test(nm));
for(const f of ['scripts/lab-paper.mjs','scripts/lab-paper-weekly.mjs','scripts/lab-analyst-save.mjs'])check(`${f}: respektuje volbu Laboratoř`,/channelsFor\(d,[^,]+,'lab'\)/.test(src(f))&&/lab\.mail/.test(src(f)));
check('lab-paper(-weekly): i push',/lab\.push/.test(src('scripts/lab-paper.mjs'))&&/lab\.push/.test(src('scripts/lab-paper-weekly.mjs')));
const pr=src('app/api/notify/prefs/route.ts'),tr=src('app/api/notify/test/route.ts');
check('API prefs: identity, PUT se sameOrigin a parsePatch s owner',/identity\(req\)/.test(pr)&&/PUT[\s\S]*sameOrigin\(req\)[\s\S]*parsePatch\([^)]*u\.owner\)/.test(pr));
check('API test: sameOrigin, limit 1/min, jen vlastní odběry',/POST[\s\S]*sameOrigin\(req\)/.test(tr)&&/testAllowed/.test(tr)&&/WHERE user_id=\?/.test(tr));
const pu=src('app/api/push/route.ts');
check('API push: odebrání zařízení jen vlastního',/DELETE FROM push_subscriptions WHERE id=\? AND user_id=\?/.test(pu));
const sp=src('app/settings-page.tsx');
check('Nastavení: Upozornění úplně nahoře, kotva #upozorneni',/<main[\s\S]*<h1>[\s\S]*<Alerts\/><Navigation\/>/.test(sp)&&/id="upozorneni"/.test(sp));
check('Alerty: karta kanálů a okénko',/AlertNotifyCard/.test(src('app/alerts/alerts-page.tsx'))&&/AlertToasts/.test(src('app/shell.tsx')));
const mig=src('drizzle/mariadb/0034_notify_prefs.sql');
check('migrace 0034: notify_prefs s PK (user_id, category)',/CREATE TABLE IF NOT EXISTS notify_prefs/.test(mig)&&/PRIMARY KEY\(user_id, category\)/.test(mig)&&/inapp TINYINT/.test(mig));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
