// Kontrola PWA: node scripts/check-pwa.mjs
// Manifest (pole, ikony a jejich skutečné rozměry z hlavičky PNG), offline stránka, service worker (statická analýza
// + spuštění ve vm s podvrženým `self`: /api a /auth se nikdy neobslouží ani neuloží, navigace se neukládá) a registrační modul.
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const pub=p=>'public'+p.split('?')[0];
const png=p=>{const b=readFileSync(pub(p));return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?{w:b.readUInt32BE(16),h:b.readUInt32BE(20)}:null};

// --- manifest
const m=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
check('manifest: id, jména, popis, jazyk',m.id==='/'&&m.name&&m.short_name==='Tradee'&&m.description&&m.lang==='cs',m);
check('manifest: start_url /?source=pwa, scope /',m.start_url==='/?source=pwa'&&m.scope==='/',[m.start_url,m.scope]);
check('manifest: display standalone + display_override',m.display==='standalone'&&JSON.stringify(m.display_override)==='["window-controls-overlay","standalone"]',[m.display,m.display_override]);
check('manifest: orientation any, barvy světlého motivu',m.orientation==='any'&&m.theme_color==='#ebf0f9'&&m.background_color==='#ebf0f9',m.theme_color);
check('manifest: categories',JSON.stringify(m.categories)==='["finance","productivity"]',m.categories);
for(const i of m.icons){const d=png(i.src),[w,h]=i.sizes.split('x').map(Number);check(`ikona ${i.src} (${i.purpose}) ${i.sizes}`,existsSync(pub(i.src))&&d&&d.w===w&&d.h===h,d)}
const has=(purpose,size)=>m.icons.some(i=>i.purpose===purpose&&i.sizes===size);
check('ikony any 192+512, maskable 192+512, monochrome 96',has('any','192x192')&&has('any','512x512')&&has('maskable','192x192')&&has('maskable','512x512')&&has('monochrome','96x96'),m.icons.map(i=>i.purpose+i.sizes));
const sc=Object.fromEntries((m.shortcuts||[]).map(s=>[s.name,s.url]));
check('zkratky: Analýza trhů, Graf, Deník, Alerty → /alerty',sc['Analýza trhů']?.includes('#analyzer')&&sc['Graf']?.startsWith('/graf/')&&sc['Deník']?.includes('#journal')&&sc['Alerty']?.startsWith('/alerty'),sc);
for(const s of m.shortcuts)for(const i of s.icons||[])check('ikona zkratky '+s.name,existsSync(pub(i.src)),i.src);
for(const s of m.screenshots){const d=png(s.src),[w,h]=s.sizes.split('x').map(Number);check(`screenshot ${s.form_factor} ${s.sizes}`,d&&d.w===w&&d.h===h&&(s.form_factor==='narrow'?h>w:w>h)&&!!s.label,d)}
check('screenshoty narrow i wide',['narrow','wide'].every(f=>m.screenshots.some(s=>s.form_factor===f)));
const b=png('/pwa/badge-96.png'),badge=readFileSync('public/pwa/badge-96.png');
check('odznak: 96 px s alfa kanálem (typ barvy 4 nebo 6)',b&&b.w===96&&[4,6].includes(badge[25]),badge[25]);
const at=png('/apple-touch-icon.png');check('apple-touch-icon 180×180',at&&at.w===180&&at.h===180,at);

// --- offline stránka
const off=existsSync('public/offline.html')?readFileSync('public/offline.html','utf8'):'';
check('offline.html existuje, česky, bez externích zdrojů',off.includes('lang="cs"')&&off.includes('Jsi offline')&&!/(src|href)="https?:/.test(off),off.length);

// --- hlavičky (Workers static assets)
const hd=readFileSync('public/_headers','utf8');
check('_headers: sw.js no-cache, manifest typ',/\/sw\.js\n\s+Cache-Control: no-cache/.test(hd)&&/application\/manifest\+json/.test(hd)&&/\/_next\/static\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/.test(hd),hd);

// --- service worker: statická analýza
const sw=readFileSync('public/sw.js','utf8');
check('sw: vyloučení /api a /auth',/const NEVER=\/\^\\\/\(api\|auth\)/.test(sw)&&/if\(NEVER\.test\(url\.pathname\)\)return;/.test(sw));
check('sw: NEVER se testuje před navigací i cache',sw.indexOf('NEVER.test(')<sw.indexOf("req.mode==='navigate'")&&sw.indexOf('NEVER.test(')<sw.indexOf('respondWith(swr(e))'),'');
const navFn=sw.slice(sw.indexOf('async function navigate'),sw.indexOf("self.addEventListener('fetch'"));
check('sw: navigace se neukládá (žádné put v navigate)',navFn.length>0&&!navFn.includes('.put('),navFn);
check('sw: skipWaiting jen na zprávu',/SKIP_WAITING'\)self\.skipWaiting\(\)/.test(sw)&&(sw.match(/skipWaiting\(\)/g)||[]).length===1);
check('sw: verzované cache',/const VERSION='[^']+'/.test(sw)&&/'tradee-shell-'\+VERSION/.test(sw));
check('sw: push s actions a requireInteraction',sw.includes('opts.actions=')&&sw.includes('opts.requireInteraction=true')&&sw.includes("addEventListener('notificationclick'"));

// --- service worker: běh ve vm
const L={},puts=[],shown=[],opened=[];
const mkCache=()=>({put:async(r)=>{puts.push(typeof r==='string'?r:r.url)},match:async()=>undefined,keys:async()=>[],delete:async()=>true});
const ctx={self:null,URL,Response:class{constructor(b,o){this.body=b;Object.assign(this,o||{})}static error(){return {error:true}}},Notification:{maxActions:2},
 caches:{open:async()=>mkCache(),match:async()=>undefined,keys:async()=>[],delete:async()=>true},
 fetch:async(u)=>({ok:true,type:'basic',redirected:false,headers:{get:()=>null},clone(){return this},blob:async()=>'',url:String(u)}),console};
ctx.self={location:{origin:'https://tradee.eu'},addEventListener:(t,f)=>{L[t]=f},registration:{showNotification:async(t,o)=>{shown.push([t,o])},navigationPreload:null},
 clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async u=>{opened.push(u)}},skipWaiting:()=>{}};
vm.runInNewContext(sw,ctx);
const fetchEv=(url,mode='no-cors',method='GET')=>{const e={request:{url,mode,method},responded:false,waits:[],respondWith(p){this.responded=true;this.p=p},waitUntil(p){this.waits.push(p)},preloadResponse:Promise.resolve(undefined)};L.fetch(e);return e};
for(const u of ['/api/notify','/api/alerts?x=1','/auth/check','/auth/logout','/api'])for(const mode of ['no-cors','cors','navigate']){const e=fetchEv('https://tradee.eu'+u,mode);check(`sw: ${u} (${mode}) jde mimo SW`,!e.responded)}
check('sw: POST jde mimo SW',!fetchEv('https://tradee.eu/journal','navigate','POST').responded);
check('sw: cizí doména jde mimo SW',!fetchEv('https://cdn.example.com/a.js').responded);
check('sw: JSON v /assets se neukládá',!fetchEv('https://tradee.eu/assets/data-abc.json').responded);
const nav=fetchEv('https://tradee.eu/nastaveni','navigate');await nav.p;
check('sw: navigace obsloužena sítí bez uložení',nav.responded&&puts.length===0,puts);
const st=fetchEv('https://tradee.eu/_next/static/chunks/app-abc.js');await st.p;await Promise.all(st.waits);
check('sw: /_next/static stale-while-revalidate',st.responded&&puts.some(u=>u.includes('/_next/static/')),puts);
check('sw: nic z /api ani /auth v cache',!puts.some(u=>/\/(api|auth)(\/|$)/.test(new URL(u,'https://tradee.eu').pathname)),puts);
const pe={data:{json:()=>({title:'EUR/USD nad 1.10',body:'Cena protnula alert',url:'/alerty#7',tag:'alert-7',requireInteraction:true,actions:[{action:'open',title:'Otevřít',url:'/graf/EUR-USD'},{action:'mute',title:'Ztlumit'},{action:'x',title:'Navíc'}]})},waitUntil(p){this.p=p}};
L.push(pe);await pe.p;
const [t,o]=shown[0]||[];
check('sw push: titulek, tag, requireInteraction, max. 2 akce',t==='EUR/USD nad 1.10'&&o.tag==='alert-7'&&o.requireInteraction===true&&o.actions.length===2&&o.data.url==='https://tradee.eu/alerty#7'&&o.data.actions.open==='https://tradee.eu/graf/EUR-USD',o);
const pe2={data:{json:()=>({url:'https://evil.com/x'})},waitUntil(p){this.p=p}};L.push(pe2);await pe2.p;
check('sw push: výchozí titulek, cizí url → /',shown[1][0]==='Tradee'&&shown[1][1].data.url==='https://tradee.eu/',shown[1]);
const click=(action)=>{const e={action,notification:{data:o.data,close(){}},waitUntil(p){this.p=p}};L.notificationclick(e);return e.p};
await click('open');await click('');await click('mute');
check('sw klik: akce s url, tělo → url, akce bez url jen zavře',JSON.stringify(opened)===JSON.stringify(['https://tradee.eu/graf/EUR-USD','https://tradee.eu/alerty#7']),opened);

// --- registrační modul a zapojení
const reg=readFileSync('app/pwa/register.ts','utf8');
check('registrace: hlídá prohlížeč, podporu SW, secure context a vypnutí',reg.includes("typeof window==='undefined'")&&reg.includes("'serviceWorker' in navigator")&&reg.includes('isSecureContext')&&reg.includes("tradee.sw")&&reg.includes(".catch("),'');
const lay=readFileSync('app/layout.tsx','utf8');
check('layout: PwaClient, manifest, viewport-fit cover, theme-color light+dark',lay.includes('<PwaClient/>')&&lay.includes("manifest:'/manifest.webmanifest'")&&lay.includes("viewportFit:'cover'")&&/prefers-color-scheme: dark/.test(lay),'');
check('notify-settings používá registerSW a iOS poznámku',readFileSync('app/notify-settings.tsx','utf8').includes('registerSW()')&&readFileSync('app/notify-settings.tsx','utf8').includes('<IosPushNote/>'));
const {isIos}=await import('../app/pwa/install.ts').catch(()=>({}));
if(isIos)check('isIos: iPhone, iPad (MacIntel+touch), ne Mac',isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')&&isIos('Mozilla/5.0 (Macintosh)','MacIntel',5)&&!isIos('Mozilla/5.0 (Macintosh)','MacIntel',0));

if(fails.length){console.log('\nSelhalo: '+fails.length);process.exit(1)}console.log('\nVše ok');
