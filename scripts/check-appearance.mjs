// Kontrola vzhledu grafu (Nastavení grafu): node --experimental-strip-types scripts/check-appearance.mjs
import {APPEARANCE_DEFAULT,readAppearance,sameAppearance,resolveCandles,setPartColor,sourcePair,legendPair,canvasLine,toHex,toCss,splitColor,withOpacity,isLight,barEnd,closeIn,fmtCountdown} from '../lib/chart/appearance.ts';
import {normalizePrefs,parsePrefs,emptyPrefs} from '../lib/chart/drawings.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const ctx={dark:false,bull:'#16a34a',bear:'#dc2626'},dark={dark:true,bull:'#22c55e',bear:'#ef4444'};

// barvy
check('hex: #rgb, velká písmena, plné krytí bez ff',toHex('#ABC')==='#aabbcc'&&toHex(' #16A34A ')==='#16a34a'&&toHex('#16a34aff')==='#16a34a'&&toHex('#16a34a80')==='#16a34a80');
check('hex: rgb() a rgba()',toHex('rgb(22, 163, 74)')==='#16a34a'&&toHex('rgba(22,163,74,0.5)')==='#16a34a80'&&toHex('rgb(22 163 74 / 50%)')==='#16a34a80');
check('hex: nesmysl → null',toHex('red')===null&&toHex('#12345')===null&&toHex('rgb(300,0,0)')===null&&toHex('color-mix(in srgb,red,blue)')===null);
check('krytí: rozdělení a složení',splitColor('#16a34a80').hex==='#16a34a'&&Math.abs(splitColor('#16a34a80').a-128/255)<1e-9&&withOpacity('#16a34a',1)==='#16a34a'&&withOpacity('#16a34a',.5)==='#16a34a80'&&withOpacity('#16a34a',0)==='#16a34a00');
check('css: plná hex, průhledná rgba',toCss('#16a34a')==='#16a34a'&&toCss('#16a34a80')==='rgba(22,163,74,0.502)');
check('jas: bílá/žlutá světlé, černá/modrá tmavé',isLight('#ffffff')&&isLight('#fde047')&&!isLight('#000000')&&!isLight('#245bff'));

// načtení
check('výchozí: nic → výchozí vzhled',sameAppearance(readAppearance(null),APPEARANCE_DEFAULT)&&sameAppearance(readAppearance('x'),APPEARANCE_DEFAULT)&&sameAppearance(readAppearance([]),APPEARANCE_DEFAULT));
const a=readAppearance({src:'blue-yellow',body:{on:false,up:'#FFFFFF',down:'nope'},wick:{on:'ano'},grid:'h',gridStyle:'dotted',gridColor:'#00000040',bg:'#101010',line:'#245BFF',crosshair:'magnet',lastLine:false,countdown:true,junk:1});
check('načtení: platné hodnoty projdou, neplatné = výchozí',a.src==='blue-yellow'&&a.body.on===false&&a.body.up==='#ffffff'&&a.body.down==='#dc2626'&&a.wick.on===true&&a.grid==='h'&&a.gridStyle==='dotted'&&a.gridColor==='#00000040'&&a.bg==='#101010'&&a.line==='#245bff'&&a.crosshair==='magnet'&&a.lastLine===false&&a.lastLabel===true&&a.countdown===true&&!('junk' in a),a);
check('načtení: neznámá předvolba / mřížka / kříž → výchozí',readAppearance({src:'rainbow',grid:'diag',crosshair:'laser',gridStyle:'wavy'}).src==='app'&&readAppearance({grid:'diag'}).grid==='both'&&readAppearance({crosshair:'laser'}).crosshair==='normal'&&readAppearance({gridStyle:'wavy'}).gridStyle==='solid');
check('načtení: barva podle motivu = null',readAppearance({bg:'',line:null,gridColor:'transparent'}).bg===null&&readAppearance({line:null}).line===null&&readAppearance({gridColor:'transparent'}).gridColor===null);

// barvy svíček
const app=resolveCandles(APPEARANCE_DEFAULT,ctx);
check('svíčky: podle signálu = barvy aplikace, obrys vypnutý',app.body.up==='#16a34a'&&app.body.down==='#dc2626'&&app.wick.on&&!app.border.on&&app.border.up==='#16a34a',app);
check('svíčky: podle signálu sleduje změnu Barev signálu',resolveCandles(APPEARANCE_DEFAULT,{dark:false,bull:'#245bff',bear:'#17191e'}).body.up==='#245bff');
const bb={...APPEARANCE_DEFAULT,src:'blue-black'};
check('svíčky: předvolba ve světlém a tmavém motivu (černá ↔ bílá)',resolveCandles(bb,ctx).body.down==='#17191e'&&resolveCandles(bb,dark).body.down==='#f4f4f5'&&resolveCandles(bb,dark).wick.up==='#3d6dff'&&sourcePair('blue-yellow',dark).down==='#eab308');
check('svíčky: zapnutí částí platí i u předvolby',!resolveCandles({...bb,body:{...bb.body,on:false}},ctx).body.on&&resolveCandles({...bb,border:{...bb.border,on:true}},ctx).border.on);
const own={...APPEARANCE_DEFAULT,src:'custom',body:{on:true,up:'#ffffff',down:'#000000'},wick:{on:true,up:'#a1a1aa',down:'#a1a1aa'}};
check('svíčky: vlastní = uložené barvy',resolveCandles(own,dark).body.up==='#ffffff'&&resolveCandles(own,dark).wick.down==='#a1a1aa');
const edited=setPartColor(bb,dark,'wick','up','#A1A1AA');
check('úprava barvy u předvolby: z předvolby vlastní, ostatní části zůstanou, jak vypadaly',edited.src==='custom'&&edited.wick.up==='#a1a1aa'&&edited.wick.down==='#f4f4f5'&&edited.body.up==='#3d6dff'&&edited.body.down==='#f4f4f5'&&edited.border.up==='#3d6dff',edited);
const e2=setPartColor(own,ctx,'body','down','#dc2626');
check('úprava vlastní barvy: změní jen tu jednu',e2.body.down==='#dc2626'&&e2.body.up==='#ffffff'&&e2.wick.up==='#a1a1aa');
check('úprava barvy u Barev signálu: převezme barvy aplikace',setPartColor(APPEARANCE_DEFAULT,{dark:false,bull:'#7c3aed',bear:'#ea580c'},'body','up','#000000').body.down==='#ea580c');

check('legenda: Barvy signálu = texty aplikace, předvolba světle textové / tmavě tmavé barvy, vlastní bez průhlednosti',legendPair(APPEARANCE_DEFAULT,ctx)===null&&legendPair({...APPEARANCE_DEFAULT,src:'yellow-black'},ctx).up==='#a16207'&&legendPair({...APPEARANCE_DEFAULT,src:'yellow-black'},dark).down==='#f4f4f5'&&legendPair({...own,body:{on:true,up:'#ffffff80',down:'#000000'}},ctx).up==='#ffffff');
check('mřížka na vlastním pozadí podle jasu',canvasLine('#ffffff')==='#00000017'&&canvasLine('#101010')==='#ffffff17');

// uložení k účtu (drawing_prefs)
const pr=normalizePrefs({appearance:{src:'custom',grid:'none',junk:1}});
check('prefs: appearance se uloží (tolerantně), jen poslaný klíč',pr.ok&&pr.prefs.appearance.grid==='none'&&pr.prefs.appearance.src==='custom'&&!('junk' in pr.prefs.appearance)&&!('presets' in pr.prefs),pr);
check('prefs: appearance musí být objekt',!normalizePrefs({appearance:'dark'}).ok&&!normalizePrefs({appearance:[]}).ok&&!normalizePrefs({appearance:null}).ok);
check('prefs: z DB tolerantně, bez vzhledu výchozí',parsePrefs({appearance:{grid:'v'}}).appearance.grid==='v'&&sameAppearance(parsePrefs({}).appearance,APPEARANCE_DEFAULT)&&sameAppearance(emptyPrefs().appearance,APPEARANCE_DEFAULT));

// odpočet
const t=Date.UTC(2026,9,21,8,0)/1000;
check('odpočet: konec svíčky H1, D1 a měsíce',barEnd(t,3600)===t+3600&&barEnd(t,86400)===t+86400&&barEnd(Date.UTC(2026,1,1)/1000,31*86400)===Date.UTC(2026,2,1)/1000&&barEnd(Date.UTC(2026,11,1)/1000,31*86400)===Date.UTC(2027,0,1)/1000);
check('odpočet: běžící svíčka, skončená (zavřený trh) null',closeIn(t,3600,t+600)===3000&&closeIn(t,3600,t+3600)===null&&closeIn(t,3600,t+90000)===null&&closeIn(t,3600,t-5)===null);
check('odpočet: formát',fmtCountdown(3000)==='50:00'&&fmtCountdown(59)==='00:59'&&fmtCountdown(3*3600+7*60+5)==='3:07:05'&&fmtCountdown(2*86400+13*3600+120)==='2d 13h'&&fmtCountdown(-4)==='00:00');

console.log(fails.length?`\n${fails.length} chyb`:'\nvše ok');
process.exit(fails.length?1:0);
