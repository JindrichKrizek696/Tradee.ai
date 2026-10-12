// Kontrola vypínání složek v přehledu skóre: node --experimental-strip-types scripts/check-overview-toggle.mjs
import fs from 'node:fs';
import {applyOff,normalizeOff,parseOff,toggleOff} from '../lib/overview-toggle.ts';
import {scoreV3,WEIGHTS} from '../lib/score/v3.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const j=x=>JSON.stringify(x);
const near=(a,b,eps=0.051)=>a!==null&&b!==null&&Math.abs(a-b)<eps;

// --- ukládání výběru ---
check('normalizeOff: jen id, bez duplicit, seřazené',j(normalizeOff(['trend','cot','cot',5,null,'', 'a b','<x>']))==='["cot","trend"]',normalizeOff(['trend','cot','cot',5]));
check('normalizeOff: špatný typ → []',j(normalizeOff('cot'))==='[]'&&j(normalizeOff(null))==='[]'&&j(normalizeOff({cot:true}))==='[]');
check('normalizeOff: nejvýš 32 položek',normalizeOff(Array.from({length:50},(_,i)=>'x'+i)).length===32);
check('parseOff: prázdné / rozbité = nenastaveno (null), „[]“ = nic vypnuto',parseOff(null)===null&&parseOff('')===null&&parseOff('{rozbité')===null&&j(parseOff('[]'))==='[]'&&j(parseOff('["gdp","cot"]'))==='["cot","gdp"]');
check('toggleOff přepíná tam i zpět',j(toggleOff([],'cot'))==='["cot"]'&&j(toggleOff(['cot','gdp'],'cot'))==='["gdp"]'&&j(toggleOff(toggleOff(['trend'],'gdp'),'gdp'))==='["trend"]');

// --- přepočet na fixtuře: skóre = Σ(w·v/2)/Σw·100, příspěvek = w·v/2/coverage·100 ---
const mk=parts=>{const ok=parts.filter(p=>p.value!==null),cov=ok.reduce((s,p)=>s+p.weight,0);return {coverage:cov,score:Math.round(10*ok.reduce((s,p)=>s+p.weight*p.value/2,0)/cov*100)/10,parts:parts.map(p=>({...p,contribution:p.value===null?null:Math.round(100*p.weight*p.value/2/cov*100)/100}))}};
const R=mk([{id:'rates',weight:15,value:2},{id:'cot',weight:15,value:-1},{id:'trend',weight:15,value:1},{id:'gdp',weight:8,value:null},{id:'mpmi',weight:6,value:-2},{id:'seasonality',weight:5,value:0}]);
const none=applyOff(R,[]);
check('nic vypnuto → beze změny (skóre, příspěvky, pokrytí)',none.score===R.score&&!none.cut&&none.coverage===R.coverage&&j(none.parts.map(p=>p.contribution))===j(R.parts.map(p=>p.contribution))&&none.parts.every(p=>!p.off),none);
check('nic vypnuto → body = prostý součet dostupných',none.points===0&&none.counted===5,none);
check('vypnutá chybějící složka nic nemění',applyOff(R,['gdp']).score===R.score&&!applyOff(R,['gdp']).cut&&applyOff(R,['gdp']).offCount===1);
const a=applyOff(R,['cot']),expect=Math.round(10*(15*2/2+15*1/2+6*-2/2+5*0/2)/(15+15+6+5)*100)/10;
check('vypnutá složka: body bez ní',a.points===1&&a.counted===4,a);
check('vypnutá složka: celkem = přímý výpočet ze zapnutých vah',near(a.score,expect)&&a.cut&&a.coverage===41,[a.score,expect]);
check('vypnutá složka: bez příspěvku, označená off; ostatní příspěvky dají součet = skóre',a.parts.find(p=>p.id==='cot').contribution===null&&a.parts.find(p=>p.id==='cot').off&&near(a.parts.reduce((s,p)=>s+(p.contribution??0),0),a.score,0.06),a.parts);
check('vypnutá složka: hodnota zůstává vidět',a.parts.find(p=>p.id==='cot').value===-1);
check('vše dostupné vypnuto → bez skóre a 0 bodů',(x=>x.score===null&&x.points===0&&x.counted===0&&x.coverage===0)(applyOff(R,['rates','cot','trend','mpmi','seasonality'])));
check('pozastavené skóre zůstane pozastavené',applyOff({...R,score:null},['cot']).score===null&&applyOff({...R,score:null},[]).score===null);
check('neznámé id nic nevypne',applyOff(R,['nope']).score===R.score&&applyOff(R,['nope']).offCount===0);

// --- reálná data (všechny páry): vypnutí = přímý výpočet Σ(w·v/2)/Σw zapnutých složek, bez změny modelu ---
const read=n=>JSON.parse(fs.readFileSync(new URL('../data/'+n,import.meta.url)));
const D={...read('fundamentals.json'),ffMacro:read('ff-macro.json'),tePmi:read('te-pmi.json'),retailOfficial:read('retail-official.json')},core=read('score-market.json'),ex=read('expanded-market.json'),M={...core,prices:{...core.prices,...ex.prices}};
const cc=Object.keys(D.currencies),T=Date.parse(D.checkedAt)+3600000,bad=[];let n=0;
for(const a of cc)for(const q of ['',...cc]){if(a===q)continue;const id=q?a+'/'+q:a,r=scoreV3(id,D,M,T);
 if(applyOff(r,[]).score!==r.score)bad.push(id+' beze změny');
 // hlídá, že přepočet v přehledu pořád odpovídá vzorci modelu (změní-li se model, musí se změnit i applyOff)
 const all=r.parts.filter(p=>p.value!==null),aw=all.reduce((s,p)=>s+p.weight,0);
 if(r.score!==null&&!near(all.reduce((s,p)=>s+p.weight*p.value/2,0)/aw*100,r.score,0.06))bad.push(id+' vzorec modelu se liší');
 for(const off of [['cot'],['trend','seasonality'],['rates','inflation','employment']]){n++;const x=applyOff(r,off),on=r.parts.filter(p=>p.value!==null&&!off.includes(p.id)),w=on.reduce((s,p)=>s+WEIGHTS[p.id],0);
  const direct=r.score===null||!w?null:on.reduce((s,p)=>s+WEIGHTS[p.id]*p.value/2,0)/w*100;
  if(direct===null?x.score!==null&&x.cut:!near(x.score,direct,0.06))bad.push(`${id} ${off} ${x.score} ≠ ${direct}`);}}
check(`reálná data: ${n} přepočtů párů a indexů = přímý výpočet ze zapnutých vah`,bad.length===0,bad.slice(0,10));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
