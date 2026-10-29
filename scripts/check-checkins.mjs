// Kontrola check-inů a dne bez obchodu: node --experimental-strip-types scripts/check-checkins.mjs
// Validace (před seancí / před vstupem / po obchodu), statistika stav vs. proces bez hodnotících slov, SOUKROMÍ (každý dotaz jen
// za přihlášeného, žádný pohled správce), „Den bez obchodu“ v Poznámkách a napojení v UI.
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {validateCheckin,checkinStats,stateOf,rowToCheckin,PRIVACY,VERDICTS} from '../lib/checkins/core.ts';
import {listCheckins,createCheckin,deleteCheckin,statsFor} from '../lib/checkins/store.ts';
import {dayEntryTitle,dayEntryBody,DAY_FOLDER} from '../lib/notebook/core.ts';
import {createDayEntry,listNotes} from '../lib/notebook/store.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const j=x=>JSON.stringify(x);
const NOW=Date.parse('2026-10-29T08:00:00Z');
const v=o=>validateCheckin(o,NOW);

// ---------- validace
const s=v({kind:'session',energy:4,focus:3,mood:null,note:'  klidné ráno '});
check('před seancí: platný, den = Praha, poznámka oříznutá',s.kind==='session'&&s.day==='2026-10-29'&&s.note==='klidné ráno'&&s.fomo===null,s);
check('před seancí: aspoň jedna hodnota',typeof v({kind:'session'})==='string');
check('stupnice 1–5 celá čísla',typeof v({kind:'session',energy:6})==='string'&&typeof v({kind:'session',energy:2.5})==='string'&&typeof v({kind:'session',energy:'3'})==='string');
const e=v({kind:'entry',fomo:true,plan:false,scenarioId:'scn_abc'});
check('před vstupem: dvě odpovědi ano/ne',e.fomo===true&&e.plan===false&&e.energy===null&&e.scenarioId==='scn_abc',e);
check('před vstupem: aspoň jedna odpověď, jen boolean',typeof v({kind:'entry'})==='string'&&typeof v({kind:'entry',fomo:'ano'})==='string');
const a=v({kind:'after',verdict:'revenge',tradeId:'mt:123'});
check('po obchodu: zařazení + obchod',a.verdict==='revenge'&&a.tradeId==='mt:123',a);
check('po obchodu: bez obchodu nebo zařazení odmítnuto',typeof v({kind:'after',verdict:'fomo'})==='string'&&typeof v({kind:'after',tradeId:'mt:1'})==='string'&&typeof v({kind:'after',verdict:'blbost',tradeId:'mt:1'})==='string');
check('zařazení: podle plánu, legitimní ztráta, chyba v exekuci, FOMO, revenge, jiné',j(Object.keys(VERDICTS))==='["plan","legit","execution","fomo","revenge","other"]');
check('neznámý druh / budoucí den / dlouhá poznámka odmítnuto',typeof v({kind:'mood'})==='string'&&typeof v({kind:'session',energy:3,day:'2026-11-05'})==='string'&&typeof v({kind:'session',energy:3,note:'x'.repeat(501)})==='string');
check('zpětný den povolen',v({kind:'session',energy:3,day:'2026-10-20'}).day==='2026-10-20');
check('nepatřičná pole se zahodí (session bez fomo)',v({kind:'session',energy:3,fomo:true}).fomo===null);
check('stav = průměr vyplněných',stateOf({energy:4,focus:2,mood:null})===3&&stateOf({energy:null,focus:null,mood:null})===null);
check('řádek z DB → záznam',j(rowToCheckin({id:'chk_1',kind:'entry',day:'2026-10-29',ts:'5',energy:null,focus:null,mood:null,fomo:1,plan:0,verdict:null,trade_id:null,scenario_id:'s',note:''}))===j({id:'chk_1',kind:'entry',day:'2026-10-29',ts:5,energy:null,focus:null,mood:null,fomo:true,plan:false,verdict:null,tradeId:null,scenarioId:'s',note:''}));

// ---------- statistika
const C=(kind,day,o={})=>({id:'c'+Math.random(),kind,day,ts:Date.parse(day+'T07:00:00Z'),energy:null,focus:null,mood:null,fomo:null,plan:null,verdict:null,tradeId:null,scenarioId:null,note:'',...o});
const list=[C('session','2026-10-01',{energy:1,focus:2,mood:2}),C('session','2026-10-02',{energy:2,focus:2,mood:2}),C('session','2026-10-03',{energy:5,focus:4,mood:5}),C('session','2026-10-04',{energy:4,focus:4,mood:4}),
 C('after','2026-10-01',{verdict:'fomo',tradeId:'t1'}),C('after','2026-10-03',{verdict:'plan',tradeId:'t5'}),C('entry','2026-10-03',{plan:true,fomo:false,tradeId:'t5'}),C('entry','2026-10-01',{plan:false,fomo:true,tradeId:'t1'})];
const trades=[{id:'t1',day:'2026-10-01',process:40},{id:'t2',day:'2026-10-01',process:60},{id:'t3',day:'2026-10-02',process:50},{id:'t4',day:'2026-10-03',process:90},{id:'t5',day:'2026-10-03',process:100},{id:'t6',day:'2026-10-04',process:80},{id:'t7',day:'2026-10-09',process:10},{id:'t8',day:null,process:70}];
const st=checkinStats(list,trades);
check('statistika: koše nižší / vyšší stav',st.buckets[0].trades===3&&st.buckets[0].avgProcess===50&&st.buckets[2].trades===3&&st.buckets[2].avgProcess===90,st.buckets);
check('statistika: obchody bez check-inu dne se nepočítají',st.pairs===6);
check('statistika: korelace kladná',st.correlation!==null&&st.correlation>0.5,st.correlation);
check('statistika: zařazení s průměrným procesem',st.verdicts.find(x=>x.verdict==='fomo').avgProcess===40&&st.verdicts.find(x=>x.verdict==='plan').count===1);
check('statistika: před vstupem podle plánu vs. mimo',st.entry.processPlanYes===100&&st.entry.processPlanNo===40&&st.entry.fomoYes===1);
check('statistika: shrnutí jako souvislost, ne příčina',st.summary.some(t=>/souvislost, ne příčina/.test(t)));
const words=[...st.summary,...checkinStats([],[]).summary,PRIVACY].join(' ');
check('bez hodnotících slov (špatný, selhal, musíš, chyba tvoje…)',!/špatn|selhal|musíš|nesmíš|tvoje chyba|ostud|slab(ý|á) trader|nedisciplin/i.test(words),words);
check('málo dat → vlídná věta',/málo dat/.test(checkinStats([],[]).summary[0]));
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
check('UI statistiky bez hodnotících slov',!/špatn|selhal|musíš|nesmíš|ostud/i.test(src('app/checkins/checkins.tsx')));

// ---------- soukromí: podvržená DB, každý dotaz za přihlášeného
function fakeDb(rows=[]){
 const log=[];
 const db={log,rows,prepare(sql){const make=q=>({bind:(...x)=>make(x),
  async first(){log.push([sql,q]);if(/COUNT\(\*\)/.test(sql))return {n:rows.filter(r=>r.user_id===q[0]).length};return null},
  async all(){log.push([sql,q]);if(/FROM checkins/.test(sql))return {results:rows.filter(r=>r.user_id===q[0]&&(!/trade_id=\?/.test(sql)||r.trade_id===q[q.length-1]))};return {results:[]}},
  async run(){log.push([sql,q]);if(/^INSERT INTO checkins/.test(sql))rows.push({id:q[0],kind:q[1],day:q[2],ts:q[3],energy:q[4],focus:q[5],mood:q[6],fomo:q[7],plan:q[8],verdict:q[9],trade_id:q[10],scenario_id:q[11],note:q[12],user_id:q[13]});
   if(/^DELETE FROM checkins WHERE user_id=\? AND kind='after' AND trade_id=\?/.test(sql)){for(let i=rows.length-1;i>=0;i--)if(rows[i].user_id===q[0]&&rows[i].kind==='after'&&rows[i].trade_id===q[1])rows.splice(i,1)}
   if(/^DELETE FROM checkins WHERE id=\? AND user_id=\?/.test(sql)){const i=rows.findIndex(r=>r.id===q[0]&&r.user_id===q[1]);if(i>=0){rows.splice(i,1);return {meta:{changes:1}}}return {meta:{changes:0}}}
   return {meta:{changes:1}}}});return make([])}};
 return db;
}
const D=fakeDb();
const mine=await createCheckin(D,'u1',v({kind:'session',energy:3}));await createCheckin(D,'u2',v({kind:'session',energy:5,note:'cizí'}));
await createCheckin(D,'u1',v({kind:'after',verdict:'legit',tradeId:'mt:9'}));await createCheckin(D,'u1',v({kind:'after',verdict:'plan',tradeId:'mt:9'}));
const l1=await listCheckins(D,'u1');
check('soukromí: seznam jen vlastní check-iny',l1.length>0&&l1.every(c=>c.note!=='cizí'),l1);
check('po obchodu: jedno zařazení na obchod (nové nahradí staré)',D.rows.filter(r=>r.user_id==='u1'&&r.kind==='after').length===1&&D.rows.find(r=>r.kind==='after').verdict==='plan');
check('soukromí: cizí check-in nejde smazat',!(await deleteCheckin(D,'u2',mine.id))&&await deleteCheckin(D,'u1',mine.id));
await statsFor(D,'u1');
const leak=D.log.filter(([s,q])=>!/user_id=\?/.test(s)&&!/^INSERT INTO checkins/.test(s)||!q.includes('u1')&&!q.includes('u2'));
check('soukromí: KAŽDÝ dotaz má user_id=? s přihlášeným',!leak.length,leak);
check('soukromí: statistika obchodů MT přes účet uživatele',D.log.some(([s,q])=>/JOIN mt_accounts a ON a\.id=p\.account_id WHERE a\.user_id=\?/.test(s)&&q[0]==='u1'));
const route=src('app/api/checkins/route.ts');
check('API: jen identity(req), žádný pohled správce (viewAs / ?as=)',/identity\(req\)/.test(route)&&!/viewAs|adminUser|searchParams\.get\('as'\)/.test(route));
check('API: změny se sameOrigin',/POST[\s\S]*sameOrigin\(req\)/.test(route)&&/DELETE[\s\S]*sameOrigin\(req\)/.test(route));
const files=[];const walk=d=>{for(const f of readdirSync(d)){const p=join(d,f);if(statSync(p).isDirectory())walk(p);else files.push(p)}};walk(new URL('../app/api/admin',import.meta.url).pathname);walk(new URL('../lib/admin',import.meta.url).pathname);
check('správa: žádný admin endpoint nečte check-iny',files.every(f=>!/checkins/.test(readFileSync(f,'utf8'))));
check('UI: záznam obchodu bez check-inu v pohledu správce / jen ke čtení',/!readOnly&&!\/\[\?&\]as=\/\.test\(query\)&&!hide\('checkin'\)/.test(src('app/journal/trade-record.tsx')));
check('UI: statistika v Deníku jen pro sebe',/\{!viewAs&&<CheckinStats\/>\}/.test(src('app/journal/journal.tsx')));
check('UI: poznámka o soukromí u formulářů',(src('app/checkins/checkins.tsx').match(/<Private\/>/g)||[]).length>=3&&/nikdy nesdílí/.test(PRIVACY));
check('UI: před seancí na Scénářích, před vstupem u scénáře',/<SessionCheckin\/>/.test(src('app/strategy/scenarios-page.tsx'))&&/<EntryCheck scenarioId=/.test(src('app/strategy/scenarios-page.tsx')));
check('migrace 0043: checkins s indexem user_id',/CREATE TABLE IF NOT EXISTS checkins/.test(src('drizzle/mariadb/0043_onboarding.sql'))&&/INDEX checkins_user_day\(user_id,day\)/.test(src('drizzle/mariadb/0043_onboarding.sql')));

// ---------- Den bez obchodu
check('den bez obchodu: název s datem',dayEntryTitle('2026-10-29')==='Den bez obchodu · 29. 10. 2026');
const body=dayEntryBody('Vynechávám','zprávy NFP');
check('den bez obchodu: šablona se stavem dne a poznámkou',/^Stav dne: Vynechávám\nPoznámka: zprávy NFP/.test(body)&&/Na co se zaměřit zítra/.test(body));
check('den bez obchodu: bez stavu „nevyplněn“, bez prázdné poznámky',/^Stav dne: nevyplněn\n\nCo jsem/.test(dayEntryBody(null,'')));
function nbDb({hasCols=true}={}){
 const t={folders:[],notes:[]},log=[];
 const db={t,log,prepare(sql){const make=q=>({bind:(...x)=>make(x),
  async first(){log.push([sql,q]);if(!hasCols&&/kind|day/.test(sql)&&/notebook_notes/.test(sql)&&/SELECT/.test(sql))throw Error("Unknown column 'kind' in 'where clause'");
   if(/FROM notebook_notes WHERE user_id=\? AND kind='noday' AND day=\?/.test(sql))return t.notes.find(n=>n.user_id===q[0]&&n.kind==='noday'&&n.day===q[1])||null;
   if(/SELECT id,folder_id,title,body,instrument,created,updated FROM notebook_notes WHERE id=\? AND user_id=\?/.test(sql)){const n=t.notes.find(n=>n.id===q[0]&&n.user_id===q[1]);return n?{...n}:null}
   if(/COUNT\(\*\) AS n FROM notebook_notes/.test(sql))return {n:t.notes.filter(n=>n.user_id===q[0]).length};
   if(/MAX\(position\)/.test(sql))return {s:0};return null},
  async all(){log.push([sql,q]);if(/FROM notebook_folders/.test(sql))return {results:t.folders.filter(f=>f.user_id===q[0])};if(/FROM notebook_notes/.test(sql)){if(!hasCols&&/,kind,day/.test(sql))throw Error("Unknown column 'kind' in 'field list'");return {results:t.notes.filter(n=>n.user_id===q[0]).map(n=>({...n,head:n.body}))}}return {results:[]}},
  async run(){log.push([sql,q]);if(/^INSERT INTO notebook_folders/.test(sql))t.folders.push({id:q[0],user_id:q[1],name:q[2]});
   if(/^INSERT INTO notebook_notes/.test(sql)){if(!hasCols&&/kind/.test(sql))throw Error("Unknown column 'kind' in 'field list'");t.notes.push({id:q[0],user_id:q[1],folder_id:q[2],title:q[3],body:q[4],instrument:q[5],created:q[6],updated:q[7],kind:/'noday'/.test(sql)?'noday':'note',day:q[8]??null})}
   return {meta:{changes:1}}}});return make([])}};
 return db;
}
const N=nbDb();
const r1=await createDayEntry(N,'u1','2026-10-29',dayEntryTitle('2026-10-29'),body);
check('den bez obchodu: založí složku „Deník dne“ a papír',r1.created&&N.t.folders.length===1&&N.t.folders[0].name===DAY_FOLDER&&N.t.notes[0].kind==='noday'&&N.t.notes[0].day==='2026-10-29');
const r2=await createDayEntry(N,'u1','2026-10-29','x','y');
check('den bez obchodu: jeden papír na den (vrátí existující)',!r2.created&&r2.note.id===r1.note.id&&N.t.notes.length===1);
await createDayEntry(N,'u2','2026-10-29','t','b');
check('den bez obchodu: jiný uživatel má vlastní složku',N.t.folders.length===2&&N.t.notes.filter(n=>n.user_id==='u2').length===1);
const ln=await listNotes(N,'u1');
check('seznam papírů: druh „Den bez obchodu“ a den',ln.length===1&&ln[0].kind==='noday'&&ln[0].day==='2026-10-29');
check('den bez obchodu: každý dotaz za přihlášeného',N.log.every(([s,q])=>q.includes('u1')||q.includes('u2')));
const M=nbDb({hasCols:false});
const r3=await createDayEntry(M,'u1','2026-10-28','t','b'),l3=await listNotes(M,'u1');
check('bez migrace: papír se založí jako obyčejný, seznam funguje',r3.created&&l3.length===1&&!l3[0].kind);
const de=src('app/api/journaling/day-entry/route.ts');
check('API dne: stav dne (etapa 1A) + papír, sameOrigin',/setDay\(d,u\.id,day,status,note\)/.test(de)&&/createDayEntry/.test(de)&&/sameOrigin\(req\)/.test(de));
check('Poznámky: tlačítko „Den bez obchodu“ a štítek',/<DayEntry onDone=\{openDay\}\/>/.test(src('app/journaling/notebook.tsx'))&&/nb-daytag/.test(src('app/journaling/notebook.tsx')));
check('migrace 0043: notebook_notes kind a day',/ADD COLUMN IF NOT EXISTS kind/.test(src('drizzle/mariadb/0043_onboarding.sql'))&&/ADD COLUMN IF NOT EXISTS day DATE/.test(src('drizzle/mariadb/0043_onboarding.sql')));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
