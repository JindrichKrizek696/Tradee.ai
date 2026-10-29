// Kontrola slovníku pojmů: node --experimental-strip-types scripts/check-glossary.mjs
// Povinné pojmy existují, každý má definici a příklad, id jsou unikátní, každé <Term id> v app/ odkazuje na existující pojem,
// složky skóre v3 a bloky strategie mají pojem, hledání bez diakritiky, slovník je v globálním hledání a v klíčových místech UI.
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {GLOSSARY,GLOSSARY_IDS,REQUIRED_IDS,SCORE_TERMS,BLOCK_TERMS,GROUPS,getTerm,filterTerms} from '../lib/glossary.ts';
import {BLOCK_IDS} from '../lib/strategy/core.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const root=new URL('..',import.meta.url).pathname;
const src=f=>readFileSync(join(root,f),'utf8');

// ---------- obsah
const missing=REQUIRED_IDS.filter(id=>!getTerm(id));
check(`povinné pojmy (${REQUIRED_IDS.length}) jsou ve slovníku`,!missing.length,missing);
check('id jsou unikátní',new Set(GLOSSARY_IDS).size===GLOSSARY_IDS.length,GLOSSARY_IDS.filter((x,i)=>GLOSSARY_IDS.indexOf(x)!==i));
check('id jen malá písmena, číslice a pomlčky',GLOSSARY_IDS.every(id=>/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)),GLOSSARY_IDS.filter(id=>!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)));
const bad=GLOSSARY.filter(t=>!t.term||t.def.length<20||!/[.!?)]$/.test(t.def)||t.example.length<10||!(t.group in GROUPS));
check('každý pojem: název, definice (věta) a příklad, známá skupina',!bad.length,bad.map(t=>t.id));
check('definice je jedna věta (bez dalších vět)',GLOSSARY.every(t=>!/[.!?] [A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(t.def.replace(/\b(p|b|tzv|např|min|max|resp)\. /g,''))),GLOSSARY.filter(t=>/[.!?] [A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(t.def)).map(t=>t.id));
const see=GLOSSARY.flatMap(t=>(t.see||[]).filter(s=>!getTerm(s)).map(s=>t.id+'→'+s));
check('odkazy „Souvisí“ vedou na existující pojmy',!see.length,see);
check('žádné jméno mentora ani kurzu',!GLOSSARY.some(t=>/mentor|kurz\b|kurzu|akademi/i.test(t.def+t.example)));

// ---------- mapy na pojmy
const weights=src('lib/score/v3.ts').match(/export const WEIGHTS=\{([^}]*)\}/)[1].split(',').map(x=>x.split(':')[0].trim()).filter(Boolean);
check('složky skóre v3 mají pojem',weights.every(w=>SCORE_TERMS[w]&&getTerm(SCORE_TERMS[w])),weights.filter(w=>!SCORE_TERMS[w]||!getTerm(SCORE_TERMS[w])));
check('bloky strategie → existující pojmy',Object.entries(BLOCK_TERMS).every(([b,id])=>BLOCK_IDS.includes(b)&&getTerm(id)));

// ---------- každé <Term id> v app/ existuje
const files=[];const walk=d=>{for(const f of readdirSync(d)){const p=join(d,f);if(statSync(p).isDirectory())walk(p);else if(/\.tsx$/.test(f))files.push(p)}};walk(join(root,'app'));
const used=new Map();let dynamic=0;
for(const f of files){const s=readFileSync(f,'utf8');
 for(const m of s.matchAll(/<Term id="([^"]+)"/g))used.set(m[1],(used.get(m[1])||[]).concat(f.slice(root.length)));
 for(const m of s.matchAll(/<Term id=\{([^}]*)\}/g)){dynamic++;for(const q of m[1].matchAll(/'([a-z0-9-]+)'/g))if(!/^(TFF|Disaggregated)$/.test(q[1]))used.set(q[1],(used.get(q[1])||[]).concat(f.slice(root.length)))}}
const unknown=[...used.keys()].filter(id=>!getTerm(id));
check(`každé <Term id> existuje (${used.size} pojmů, ${dynamic} dynamických)`,!unknown.length,unknown.map(id=>id+' v '+used.get(id).join(', ')));
check('dynamická id jen z map slovníku nebo literálů',files.every(f=>{const s=readFileSync(f,'utf8');return [...s.matchAll(/<Term id=\{([^}]*)\}/g)].every(m=>/SCORE_TERMS|BLOCK_TERMS|'[a-z0-9-]+'/.test(m[1]))}));
// klíčová místa
const places={'app/score-breakdown.tsx':/<Term id=\{SCORE_TERMS\[p\.id\]\}/,'app/cot-detail.tsx':/<Term id="cot-index"/,'app/risk/position-calculator.tsx':/<Term id="pip"/,'app/journal/metrics-view.tsx':/<Term id="r"/,'app/strategy/strategies-page.tsx':/<Term id=\{BLOCK_TERMS\[b\]\}/,'app/journal/trade-record.tsx':/<Term id="be-ucetni"/};
for(const [f,re] of Object.entries(places))check(`pojmy v UI: ${f}`,re.test(src(f)));

// ---------- hledání
const ids=q=>filterTerms(q).map(t=>t.id);
check('hledání: „drawdown“ najde statický i trailing',ids('drawdown').includes('drawdown-staticky')&&ids('drawdown').includes('drawdown-trailing'));
check('hledání bez diakritiky: „sezonalita“, „staticky“',ids('sezonalita')[0]==='sezonalita'&&ids('staticky').includes('drawdown-staticky'));
check('hledání aliasu: „fair value gap“ → FVG',ids('fair value gap')[0]==='fvg');
check('hledání: shoda v názvu před shodou v textu',ids('pip')[0]==='pip');
check('hledání: prázdný dotaz = vše',filterTerms('').length===GLOSSARY.length);
const se=src('app/search.tsx');
check('globální hledání: skupina Slovník pojmů a odkaz na /slovnik#id',/term:'Slovník pojmů'/.test(se)&&/for\(const t of GLOSSARY\)/.test(se)&&/'\/slovnik#'\+t\.id/.test(se));
check('stránka /slovnik s kotvami',/id=\{t\.id\}/.test(src('app/slovnik/glossary-page.tsx'))&&/GlossaryPage/.test(src('app/slovnik/page.tsx')));
const tm=src('app/term.tsx');
check('<Term>: klepnutí (mobil), fokus, Esc, aria-expanded',/onClick=/.test(tm)&&/onFocus=/.test(tm)&&/Escape/.test(tm)&&/aria-expanded/.test(tm)&&/role="tooltip"/.test(tm));

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
