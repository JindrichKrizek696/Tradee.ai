// Kontrola Poznámek (Notebook): node --experimental-strip-types scripts/check-notebook.mjs
import {LIMITS,SUGGESTED,MISSING_TABLES,cleanFolderName,nameTaken,suggestions,validateNote,cleanOrder,excerpt,noteLabel,sqlMs,sortNotes,folderCounts,isMissingTable} from '../lib/notebook/core.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const err=v=>!!v&&typeof v==='object'&&typeof v.error==='string';
const IDS=['EUR/USD','GBP/USD','^NDX','BTC-USD','GC=F'];
// složky
check('název složky: ořez a jeden řádek',cleanFolderName('  Konec \n týdne ')==='Konec týdne',cleanFolderName('  Konec \n týdne '));
check('název složky: diakritika a emoji projdou',cleanFolderName('Páry 📈')==='Páry 📈');
check('název složky: chyby',err(cleanFolderName(''))&&err(cleanFolderName('   '))&&err(cleanFolderName(null))&&err(cleanFolderName(5))&&err(cleanFolderName('x'.repeat(LIMITS.name+1)))&&!err(cleanFolderName('x'.repeat(LIMITS.name))));
check('název složky: řídicí znaky pryč',cleanFolderName('A\u0000B\u0007')==='AB',cleanFolderName('A\u0000B\u0007'));
const F=[{id:'nf_a',name:'Analýza'},{id:'nf_b',name:'Páry'}];
check('duplicitní název bez ohledu na velikost písmen',nameTaken(F,'analýza')&&nameTaken(F,'PÁRY')&&!nameTaken(F,'Analyza')&&!nameTaken(F,'Analýza','nf_a'));
check('návrhy bez už založených',JSON.stringify(suggestions(F))===JSON.stringify(['Začátek týdne','Konec týdne'])&&suggestions([]).length===SUGGESTED.length,suggestions(F));
check('návrhy podle zadání',SUGGESTED.join()==='Analýza,Začátek týdne,Konec týdne');
// papíry
const c=validateNote({folderId:'nf_a'},IDS,true);
check('nový papír: prázdný název i text',!err(c)&&c.folderId==='nf_a'&&c.title===''&&c.body===''&&!('instrument' in c),c);
check('nový papír bez složky = chyba',err(validateNote({title:'x'},IDS,true))&&err(validateNote({folderId:'a b'},IDS,true))&&err(validateNote({folderId:'x'.repeat(41)},IDS,true)));
const u=validateNote({title:'  Týden 41\n shrnutí ',body:'Řádek 1\r\nŘádek 2\r\n\r\n  odsazení\u0000'},IDS);
check('úprava: název na jeden řádek, text zachová řádky a mezery',!err(u)&&u.title==='Týden 41 shrnutí'&&u.body==='Řádek 1\nŘádek 2\n\n  odsazení'&&!('folderId' in u)&&!('instrument' in u),u);
check('úprava: jen poslaná pole',JSON.stringify(validateNote({body:'x'},IDS))==='{"body":"x"}');
check('prázdná úprava = chyba',err(validateNote({},IDS))&&err(validateNote(null,IDS))&&err(validateNote([],IDS))&&err(validateNote('x',IDS)));
check('limity názvu a textu',err(validateNote({title:'x'.repeat(LIMITS.title+1)},IDS))&&!err(validateNote({title:'x'.repeat(LIMITS.title)},IDS))&&err(validateNote({body:'x'.repeat(LIMITS.body+1)},IDS))&&!err(validateNote({body:'x'.repeat(LIMITS.body)},IDS)));
check('špatné typy',err(validateNote({title:5},IDS))&&err(validateNote({body:{}},IDS))&&err(validateNote({folderId:5},IDS)));
check('trh: známý, prázdný = bez trhu, neznámý = chyba',validateNote({instrument:'EUR/USD'},IDS).instrument==='EUR/USD'&&validateNote({instrument:''},IDS).instrument===null&&validateNote({instrument:null},IDS).instrument===null&&err(validateNote({instrument:'XXX'},IDS))&&err(validateNote({instrument:5},IDS)));
check('přesun do jiné složky',validateNote({folderId:'nf_b'},IDS).folderId==='nf_b');
// pořadí
check('pořadí: platné',JSON.stringify(cleanOrder(['b','a']))==='["b","a"]'&&Array.isArray(cleanOrder([])));
check('pořadí: chyby',err(cleanOrder('a'))&&err(cleanOrder(['a','a']))&&err(cleanOrder([1]))&&err(cleanOrder(['']))&&err(cleanOrder(Array.from({length:LIMITS.folders+1},(_,i)=>'f'+i))));
// seznam
check('náhled: jeden řádek',excerpt('  Řádek 1\n\nŘádek 2  ')==='Řádek 1 Řádek 2');
const long=excerpt('slovo '.repeat(100));
check('náhled: zkrácený s výpustkou',long.length<=LIMITS.excerpt&&long.endsWith('…'),long);
check('název do seznamu',noteLabel({title:'  '})==='Bez názvu'&&noteLabel({title:'Týden 41'})==='Týden 41');
check('čas z DB je UTC',sqlMs('2026-10-12 18:02:37')===Date.UTC(2026,9,12,18,2,37));
const N=[{id:'nt_a',folderId:'nf_a',created:'2026-10-01 10:00:00'},{id:'nt_c',folderId:'nf_b',created:'2026-10-12 08:00:00'},{id:'nt_b',folderId:'nf_a',created:'2026-10-12 08:00:00'}];
check('nejnovější nahoře, při shodě podle id',sortNotes(N).map(n=>n.id).join()==='nt_c,nt_b,nt_a'&&N[0].id==='nt_a',sortNotes(N).map(n=>n.id));
check('počty ve složkách',JSON.stringify(folderCounts(N))==='{"nf_a":2,"nf_b":1}');
// chybějící tabulky (migrace neproběhla)
check('chybějící tabulka: kód, errno i text',isMissingTable({code:'ER_NO_SUCH_TABLE'})&&isMissingTable({errno:1146})&&isMissingTable(new Error("Table 'tradee.notebook_notes' doesn't exist")));
check('jiné chyby nejsou chybějící tabulka',!isMissingTable(new Error('ECONNREFUSED'))&&!isMissingTable(null)&&!isMissingTable({code:'ER_DUP_ENTRY'})&&!isMissingTable(new Error("Table 'tradee.trades' doesn't exist")));
// stejný filtr jako failed() v lib/server.ts: hláška se nesmí schovat za obecnou chybu
check('hláška o migraci projde přes failed()',!/D1_|SQLITE|binding|R2|ER_|ECONN|mysql|MariaDB|ETIMEDOUT|Access denied/i.test(MISSING_TABLES));
if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
