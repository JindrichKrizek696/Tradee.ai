// Kontrola navigace: node --experimental-strip-types scripts/check-nav.mjs
import {VIEWS,normalizeNav,parseNav,defaultNav,isView} from '../lib/nav.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const j=x=>JSON.stringify(x);
check('výchozí',j(defaultNav())===j({order:[...VIEWS],hidden:[],merge:false})&&j(normalizeNav(undefined))===j(defaultNav())&&j(normalizeNav('x'))===j(defaultNav())&&j(normalizeNav(null))===j(defaultNav()));
const a=normalizeNav({order:['journal','dashboard'],hidden:['reports']});
check('chybějící se doplní ve výchozím pořadí',j(a.order)==='["journal","dashboard","analyzer","reports","calendar","journaling"]'&&j(a.hidden)==='["reports"]',a);
const b=normalizeNav({order:['calendar','calendar','nope',5,'dashboard'],hidden:['nope','journal','journal']});
check('duplicity a neznámá id pryč',j(b.order)==='["calendar","dashboard","analyzer","reports","journal","journaling"]'&&j(b.hidden)==='["journal"]',b);
check('Dashboard nejde schovat',!normalizeNav({order:[],hidden:['dashboard','calendar']}).hidden.includes('dashboard')&&normalizeNav({hidden:['dashboard']}).hidden.length===0);
check('špatné typy',j(normalizeNav({order:'x',hidden:{}}))===j(defaultNav()));
check('všechny položky vždy přítomny',normalizeNav({order:['journaling']}).order.length===VIEWS.length);
check('parseNav',j(parseNav('{"order":["reports"],"hidden":["journal"]}').hidden)==='["journal"]'&&j(parseNav('{rozbité'))===j(defaultNav())&&j(parseNav(null))===j(defaultNav())&&j(parseNav(''))===j(defaultNav()));
check('merge: výchozí vypnuto, jen pravé true zapíná',defaultNav().merge===false&&normalizeNav({merge:true}).merge===true&&normalizeNav({merge:'true'}).merge===false&&normalizeNav({merge:1}).merge===false&&normalizeNav({}).merge===false);
check('merge přežije parseNav a nemění pořadí',parseNav('{"merge":true,"hidden":["calendar"]}').merge===true&&j(parseNav('{"merge":true}').order)===j(VIEWS));
check('isView',isView('journal')&&!isView('admin')&&!isView(undefined));
if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
