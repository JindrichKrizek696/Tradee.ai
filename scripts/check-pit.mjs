// Kontrola skóre k datu (Etapa 2A): node --experimental-strip-types scripts/check-pit.mjs
// neměnnost snímků, vyhledání nejbližšího ≤ t, označení rekonstrukce, rozdíly mezi snímky, vysvětlení (vstupy → hodnota
// podle prahů přehledu), směr karty páru vs karty měny, jednotné texty metodiky.
import fs from 'node:fs';
import {buildSnapshot,captureAll,asDaily,fromHistory,fromHistoryEntry,nearestAtOrBefore,diffSnapshots,explainPart,recompute,mapValue,ruleText,fingerprint,directionText,stance,mixedSignals,currencyGroups,changePoints,methodChanges,pragueDay,RECONSTRUCTED_NOTE} from '../lib/score/pit.ts';
import {insertSnapshots,insertSql,encodeParts,decodeParts,toRow,fromRow,sqlTime,fromSqlTime,PIT_TABLE} from '../lib/score/pit-store.ts';
import {scoresAt,scoreHistory,parseT} from '../lib/score/pit-api.ts';
import {pairBreakdown,THRESHOLDS} from '../lib/fundamentals/breakdown.ts';
import {scoreV3,WEIGHTS,MIN_COVERAGE} from '../lib/score/v3.ts';
import {METHOD,groupWeight} from '../lib/score/method-text.ts';
import {instruments} from '../lib/markets.ts';
import {pairs} from '../lib/score-engine.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)?.slice(0,400)));if(!ok)fails.push(name)};
const root=new URL('../',import.meta.url),read=n=>JSON.parse(fs.readFileSync(new URL('data/'+n,root))),src=p=>fs.readFileSync(new URL(p,root),'utf8');
const data={...read('fundamentals.json'),ffMacro:read('ff-macro.json'),tePmi:read('te-pmi.json'),retailOfficial:read('retail-official.json')},core=read('score-market.json'),extra=read('expanded-market.json'),market={...core,prices:{...core.prices,...extra.prices},legacy:extra.legacy};
const now=Date.parse(data.checkedAt)+3600000;

// ---------- 1. neměnnost ----------
const s1=buildSnapshot('EUR/USD',data,market,now);
let threw=false;try{s1.parts[0].value=99}catch{threw=true}
check('snímek je zmrazený (změna složky vyhodí chybu)',threw&&s1.parts[0].value!==99,s1.parts[0].value);
threw=false;try{s1.parts[0].inputs.push({})}catch{threw=true}
check('zmrazené i vstupy složek',threw);
check('zápis jen INSERT IGNORE, bez UPDATE',/^INSERT IGNORE INTO score_snapshots_v2\(/.test(insertSql(2))&&!/UPDATE|REPLACE/i.test(insertSql(2)),insertSql(1));
const storeSrc=['lib/score/pit-store.ts','lib/score/pit-api.ts','scripts/capture-score-history.mjs','scripts/pit-backfill.mjs','lib/lab/store.ts'].map(src).join('\n');
check('žádný kód nemění ani nemaže score_snapshots_v2',!/(UPDATE|DELETE FROM|REPLACE INTO|TRUNCATE)\s+(\$\{PIT_TABLE\}|score_snapshots_v2)/i.test(storeSrc)&&!/ON DUPLICATE KEY UPDATE/i.test(src('lib/score/pit-store.ts')));
const mig=src('drizzle/mariadb/0039_score_pit.sql');
check('migrace 0039: klíč (trh, druh, čas) + unikátní denní klíč',/PRIMARY KEY\(market,kind,at\)/.test(mig)&&/UNIQUE KEY \w+\(daily_key\)/.test(mig)&&/DATETIME\(3\)/.test(mig),null);
// falešná DB se stejnými klíči jako tabulka (INSERT IGNORE: existující klíč se přeskočí)
function fakeDb(){const rows=new Map(),daily=new Set();return {rows,prepare(sql){return {bind(...v){return {async run(){let n=0;if(!sql.startsWith('INSERT IGNORE INTO '+PIT_TABLE))throw Error('nečekaný SQL');for(let i=0;i<v.length;i+=14){const r=v.slice(i,i+14),k=r[0]+'|'+r[2]+'|'+r[1];if(rows.has(k)||(r[4]&&daily.has(r[4])))continue;rows.set(k,r);if(r[4])daily.add(r[4]);n++}return {success:true,meta:{changes:n}}}}}}}}}
const db=fakeDb(),ids=instruments.map(i=>i.id),cap=captureAll(ids,data,market,now);
const n1=await insertSnapshots(db,[...cap,...cap.map(asDaily)]);
check('první uložení: capture + denní pro každý trh',n1===2*ids.length,n1);
const before=JSON.stringify([...db.rows.values()]);
const altered=fromHistoryEntry('EUR/USD',cap[0].at,{score:99,coverage:100,method:'score-v3',parts:{}});
const n2=await insertSnapshots(db,[...cap,{...altered,kind:'capture'}]);
check('stejný čas znovu (i s jiným obsahem) → nic se nepřepíše',n2===0&&JSON.stringify([...db.rows.values()])===before,n2);
const later=captureAll(['EUR/USD'],data,market,now+3600000);
const n3=await insertSnapshots(db,[...later,...later.map(asDaily)]);
check('další snímek téhož dne: nový capture, denní zůstává první',n3===(pragueDay(now)===pragueDay(now+3600000)?1:2),n3);
const row=await toRow(cap[0]),back=await fromRow({market:row[0],at:row[1],kind:row[2],method:row[5],version:row[6],score:row[7],coverage:row[8],reconstructed:row[9],source:row[10],note:row[11],fingerprint:row[12],parts:row[13]});
check('uložení a načtení řádku = stejný snímek (gzip+base64)',JSON.stringify(back)===JSON.stringify(cap[0])&&String(row[13]).startsWith('gz:'),String(row[13]).slice(0,20));
check('dekódování i starého prostého JSON',(await decodeParts(JSON.stringify(cap[0].parts))).length===cap[0].parts.length&&(await decodeParts(await encodeParts([]))).length===0);
check('čas DB ↔ ISO (UTC, ms)',fromSqlTime(sqlTime('2026-11-06T14:00:00.123Z'))==='2026-11-06T14:00:00.123Z'&&sqlTime('2026-11-06T14:00:00.123Z')==='2026-11-06 14:00:00.123');
const gz=(await Promise.all(cap.map(s=>encodeParts(s.parts)))).reduce((a,x)=>a+x.length,0);check('kompaktní: gzip+base64 snímku všech trhů < 40 % JSON',gz<JSON.stringify(cap.map(s=>s.parts)).length*.4,gz);

// ---------- 2. nejbližší ≤ t ----------
const list=['2026-10-01T10:00:00Z','2026-10-01T11:00:00Z','2026-10-02T09:00:00Z'].map(at=>({at}));
check('nearest ≤ t: přesná shoda',nearestAtOrBefore(list,Date.parse('2026-10-01T11:00:00Z'))?.at==='2026-10-01T11:00:00Z');
check('nearest ≤ t: mezi snímky bere starší',nearestAtOrBefore(list,Date.parse('2026-10-02T08:59:59Z'))?.at==='2026-10-01T11:00:00Z');
check('nearest ≤ t: před prvním → null',nearestAtOrBefore(list,Date.parse('2026-09-30T00:00:00Z'))===null);
check('nearest ≤ t: po posledním → poslední',nearestAtOrBefore(list,Date.parse('2027-01-01T00:00:00Z'))?.at==='2026-10-02T09:00:00Z');
check('nearest ≤ t: nikdy budoucí snímek',[...Array(50)].every((_,i)=>{const t=Date.parse('2026-10-01T09:30:00Z')+i*3600000,s=nearestAtOrBefore(list,t);return !s||Date.parse(s.at)<=t}));
const hist=read('score-history.json'),hAt=hist.snapshots[5].at;
const at1=await scoresAt(null,hist,Date.parse(hAt)+1000,['EUR/USD','USD']);
check('API bez DB: stav k datu ze zálohy historie',at1.source==='history'&&at1.snapshots['EUR/USD']?.at===new Date(hAt).toISOString()&&at1.snapshots['EUR/USD'].reconstructed,at1.snapshots['EUR/USD']?.at);
check('API: čas v budoucnu se ořízne na teď',parseT(String(Date.now()+86400000))<=Date.now()&&parseT(null)<=Date.now());
let bad=false;try{parseT('nesmysl')}catch{bad=true}check('API: neplatný čas → chyba',bad);
const at0=await scoresAt(null,hist,Date.parse('2020-01-01'),['EUR/USD']);
check('API: před začátkem historie → žádný snímek',!at0.snapshots['EUR/USD']);
const hh=await scoreHistory(null,hist,'EUR/USD','1R',Date.parse(hist.snapshots.at(-1).at)+1);
check('historie pro graf: jen body změny, seřazené',hh.snapshots.length>1&&hh.snapshots.every((s,i,a)=>!i||a[i-1].at<s.at)&&hh.snapshots.every((s,i,a)=>!i||i===a.length-1||fingerprint(s)!==fingerprint(a[i-1])),hh.snapshots.length);

// ---------- 3. rekonstrukce ----------
const rec=fromHistory(hist);
check('backfill: všechny záznamy označené jako rekonstrukce',rec.length>0&&rec.every(s=>s.reconstructed&&s.kind==='backfill'&&s.note.startsWith(RECONSTRUCTED_NOTE)&&s.source==='score-history'),rec[0]);
check('backfill: bez vstupních čísel (nic se nedomýšlí)',rec.every(s=>s.parts.every(p=>p.inputs.length===0&&p.x===null&&p.rule===null)));
const v22=rec.find(s=>s.method==='score-v2.2');
check('backfill v2.2: příspěvky zachované, hodnota −2…+2 neznámá',v22&&v22.parts.every(p=>p.value===null&&p.scale==='points')&&v22.parts.some(p=>p.contribution!==null),v22?.parts[0]);
const v3h=fromHistoryEntry('EUR/USD','2026-10-20T10:00:00Z',{score:-12.5,coverage:80,method:'score-v3',parts:{cot:{value:5,label:'COT',weight:15,score:1,status:'ok',asOf:'2026-10-13',reason:'Signál +0,3'},trend:{value:null,label:'Trend',weight:15,score:-2,status:'stale',reason:'zastaralé: …'}}});
check('backfill v3: hodnota a stav složky ze záznamu',v3h.parts[0].value===1&&v3h.parts[0].contribution===5&&v3h.parts[1].value===null&&v3h.parts[1].status==='stale'&&v3h.reconstructed,v3h.parts);
check('backfill: pořadí podle času',rec.every((s,i,a)=>!i||a[i-1].at<=s.at));

// ---------- 4. rozdíly ----------
const mod=structuredClone(data);mod.observations.EUR.inflation={...mod.observations.EUR.inflation,value:'5,4 % meziročně'};
const sA=buildSnapshot('EUR/USD',data,market,now),sB=buildSnapshot('EUR/USD',mod,market,now+3600000),d1=diffSnapshots(sA,sB),inf=d1.find(c=>c.id==='inflation');
check('diff: změněná inflace s důvodem (vstup a → b)',inf&&inf.from===0&&inf.to===2&&/EUR inflace y\/y \+3,8 → \+5,4/.test(inf.text)&&inf.text.startsWith('Inflace 0 → +2'),d1.map(c=>c.text));
check('diff: ostatní hodnoty beze změny se nehlásí jako změna hodnoty',d1.filter(c=>c.from!==c.to).length===1,d1.map(c=>c.text));
check('diff: přepočet příspěvků se hlásí jako přepočet / beze změny vstupů',d1.filter(c=>c.id!=='inflation').every(c=>c.from===c.to),d1);
const mkPart=(p,over)=>({...structuredClone(p),...over});
const cotA=sA.parts.find(p=>p.id==='cot'),fake=(snap,parts)=>({...structuredClone(snap),parts});
const nA=fake(sA,sA.parts.map(p=>p.id==='cot'?mkPart(p,{value:1,status:'ok',inputs:[{...cotA.inputs[0]||{side:'EUR',label:'COT EUR · signál fondů',unit:''},value:.4,period:'2026-10-27',publishedAt:'2026-10-30'}]}):p));
const nB=fake(sA,sA.parts.map(p=>p.id==='cot'?mkPart(p,{value:2,status:'ok',inputs:[{...cotA.inputs[0]||{side:'EUR',label:'COT EUR · signál fondů',unit:''},value:.8,period:'2026-11-03',publishedAt:'2026-11-06'}]}):p));
const cotD=diffSnapshots(nA,nB).find(c=>c.id==='cot');
check('diff: „COT +1 → +2 (nová data … 6. 11.)“',cotD?.text==='COT +1 → +2 (nová data EUR 6. 11.)',cotD?.text);
check('diff: složka zastarala',diffSnapshots(nB,fake(nB,nB.parts.map(p=>p.id==='cot'?mkPart(p,{value:null,status:'stale',ageMs:9*86400000}):p))).find(c=>c.id==='cot')?.why==='data zastarala (stáří 9 d)');
check('diff: změna metodiky se hlásí samostatně',diffSnapshots({...sA,method:'score-v2.2',version:'score-v2.2'},sA)[0]?.text==='Změna metodiky score-v2.2 → score-v3');
check('diff: shodné snímky → žádná změna',diffSnapshots(sA,buildSnapshot('EUR/USD',data,market,now)).length===0&&fingerprint(sA)===fingerprint(buildSnapshot('EUR/USD',data,market,now+1)));
check('graf: body změny a značka metodiky',changePoints([sA,{...sA,at:'x'},sB]).length===2&&changePoints([sA,{...sA,at:'x'}]).length===2&&methodChanges([{...sA,method:'score-v2.2'},sA]).length===1);

// ---------- 5. vysvětlení = prahy přehledu ----------
let mism=[],compared=0;
for(const pair of [...pairs,'CAD/USD','JPY/EUR']){
 const s=buildSnapshot(pair,data,market,now),b=pairBreakdown(pair,data,market,now);
 for(const p of s.parts){const row=b.rows.find(r=>r.id===p.id);
  if(p.x!==null&&mapValue(p.id,p.x)!==row.score)mism.push(`${pair} ${p.id} x=${p.x} → ${mapValue(p.id,p.x)} vs přehled ${row.score}`);
  if(p.status==='ok'){compared++;const r=recompute(p,pair);if(r!==p.value)mism.push(`${pair} ${p.id} ze vstupů ${r} vs ${p.value}`)}}
}
check(`vysvětlení: vstupy → hodnota = přehled (${compared} složek, 30 párů)`,!mism.length&&compared>100,mism.slice(0,6));
const e=explainPart(sA.parts.find(p=>p.id==='inflation'),sA);
check('vysvětlení inflace: vstupy s obdobím, zdrojem, odkazem; pravidlo s prahy; váha; příspěvek',e.inputs.length===2&&e.inputs.every(i=>i.meta.some(m=>m.startsWith('období'))&&i.url)&&e.rule.includes('±1 od 0,5 p. b., ±2 od 1,5 p. b.')&&e.weight==='10 %'&&/váha 10 \/ \d+ % dostupných vah/.test(e.contribution),e);
check('pravidla z THRESHOLDS (stejná čísla jako přehled)',Object.entries(THRESHOLDS).every(([id,[t1,t2]])=>mapValue(id,t1)===1&&mapValue(id,-t2)===-2&&mapValue(id,t1*.99)===0&&ruleText(id,t1).includes('→ +1')));
check('pravidlo retail pozic kontrariánsky',mapValue('retailPositions',80)===-2&&mapValue('retailPositions',62)===-1&&mapValue('retailPositions',50)===0&&mapValue('retailPositions',35)===1&&mapValue('retailPositions',20)===2);
const rq=sA.parts.find(p=>p.id==='retailSales');
check('vysvětlení: transformace q/q ÷ 3 je u vstupu uvedená, když se použila',buildSnapshot('NZD/USD',data,market,now).parts.find(p=>p.id==='retailSales').inputs.filter(i=>i.side==='NZD').every(i=>i.value===null||!i.transform||/÷ 3/.test(i.transform))&&rq.inputs.length===2);
const idx=buildSnapshot('USD',data,market,now),infI=idx.parts.find(p=>p.id==='inflation');
check('index: složka = průměr 7 párů ze vstupů',infI.inputs.filter(i=>/^USD\//.test(i.label)).length===7&&(infI.status!=='ok'||Math.abs(infI.inputs.filter(i=>/^USD\//.test(i.label)).reduce((s,i)=>s+i.value,0)/7-infI.value)<1e-3),infI.inputs.map(i=>i.label));
check('technický model: snímek se signály a vstupy trendu',(t=>t.method.startsWith('technical')&&t.parts.find(p=>p.id==='trend').inputs.length===3)(buildSnapshot('^GSPC',data,market,now)));

// ---------- 6. karta měny vs karta páru ----------
check('směr páru: „Kladné = podpora USD vůči CAD“',directionText('USD/CAD')==='Kladné = podpora USD vůči CAD'&&directionText('USD')==='Kladné = podpora USD vůči ostatním 7 měnám (průměr párů)');
const uc=buildSnapshot('USD/CAD',data,market,now),cu=buildSnapshot('CAD/USD',data,market,now);
check('obrácený pár = opačná znaménka všech složek a skóre',uc.parts.every(p=>{const q=cu.parts.find(x=>x.id===p.id);return p.value===null?q.value===null:q.value===-p.value||(p.value===0&&q.value===0)})&&(uc.score===null||cu.score===-uc.score),uc.parts.map(p=>[p.id,p.value,cu.parts.find(x=>x.id===p.id).value]));
const pInf=uc.parts.find(p=>p.id==='inflation'),gUSD=currencyGroups('USD',buildSnapshot('USD',data,market,now)),gCAD=currencyGroups('CAD',buildSnapshot('CAD',data,market,now));
const own=(g,id)=>g.flatMap(x=>x.rows).find(r=>r.id===id).ownValue;
check('karta měny: vlastní čísla měny → znaménko složky páru',['inflation','gdp','mpmi','spmi','retailSales'].every(id=>{const a=own(gUSD,id),b=own(gCAD,id),p=uc.parts.find(x=>x.id===id);return a===null||b===null||p.x===null||Math.abs((a-b)-p.x)<1e-6&&Math.sign(mapValue(id,a-b))===Math.sign(p.value??mapValue(id,p.x))}),['inflation','gdp'].map(id=>[own(gUSD,id),own(gCAD,id),uc.parts.find(x=>x.id===id).x]));
check('karta měny: horizonty oddělené (trend D1, makro, pozice týdně, sezonalita měsíc)',gUSD.map(g=>g.id).join()==='trend,macro,positions,season'&&/D1/.test(gUSD[0].horizon)&&/týdně/.test(gUSD[2].horizon)&&/měsíc/.test(gUSD[3].horizon));
check('stance: kladná = pro BASE, záporná = pro QUOTE (u indexu proti měně)',stance({value:1,status:'ok'},'USD/CAD').text==='pro USD'&&stance({value:-2,status:'ok'},'USD/CAD').text==='pro CAD'&&stance({value:-1,status:'ok'},'USD').text==='proti USD'&&stance({value:null,status:'stale'},'USD/CAD').side==='none');
const mx=mixedSignals(uc.parts,'USD/CAD');
check('smíšené signály se neskrývají',mx.pro.length+mx.proti.length===uc.parts.filter(p=>p.status==='ok'&&p.value).length&&mx.mixed===(mx.pro.length>0&&mx.proti.length>0),mx);
check('index složka v kartě měny = hodnota snímku indexu',gUSD.flatMap(g=>g.rows).every(r=>{const p=idx.parts.find(x=>x.id===r.id);return r.index===(p.status==='ok'?p.value:null)}));
check('index skóre se shoduje s v3',idx.score===scoreV3('USD',data,market,now).score);

// ---------- 7. jednotné texty metodiky ----------
check('METHOD.summary obsahuje každou váhu',Object.entries(WEIGHTS).every(([,w])=>METHOD.summary.includes(w+' %'))&&METHOD.summary.includes('Skóre = Σ(váha × složka / 2)'));
check('METHOD: práh pozastavení z MIN_COVERAGE',METHOD.missing.includes(MIN_COVERAGE+' %')&&METHOD.paused.includes(MIN_COVERAGE+' %')&&METHOD.legend.includes(MIN_COVERAGE+' %'));
const landing=src('public/landing/index.html');
check('landing: skupiny vah = výpočet (fundament/pozice/cena)',landing.includes(`Fundament · ${groupWeight('fundament')} %`)&&landing.includes(`Pozice · ${groupWeight('pozice')} %`)&&landing.includes(`Cena · ${groupWeight('cena')} %`),[groupWeight('fundament'),groupWeight('pozice'),groupWeight('cena')]);
check('landing: váhy složek = výpočet',landing.includes(`Sazby a výhled ${WEIGHTS.rates} %, inflace ${WEIGHTS.inflation} %, zaměstnanost ${WEIGHTS.employment} %, HDP ${WEIGHTS.gdp} %, výrobní a servisní PMI po ${WEIGHTS.mpmi} %, retail sales ${WEIGHTS.retailSales} %`)&&landing.includes(`CFTC COT (${WEIGHTS.cot} %`)&&landing.includes(`kontrariánsky (${WEIGHTS.retailPositions} %)`)&&landing.includes(`pod ${MIN_COVERAGE} % dostupných vah`));
const ui=src('app/tradee.tsx')+src('app/markets/markets-view.tsx')+src('app/score-breakdown.tsx');
check('UI bere texty metodiky z jednoho místa (žádné ručně psané váhy)',!/úrokové sazby 15 %/.test(ui)&&!/pod 60 % dostupných vah/.test(ui)&&/METHOD\.summary/.test(ui)&&/METHOD\.legend/.test(ui)&&/METHOD\.breakdownFoot/.test(ui));
check('přehled: komentář prahů COT odpovídá kódu',/t1 0,25 · t2 0,75/.test(src('lib/fundamentals/breakdown.ts'))&&THRESHOLDS.cot[0]===.25);

if(fails.length){console.log(`\nFAIL: ${fails.length} kontrol`);process.exit(1)}
console.log('\nPASS: skóre k datu');
