// Kontrola auth helperů: node --experimental-strip-types scripts/check-auth.mjs
import {signSession,verifySession,pkceChallenge,pkcePair,checkIdClaims,decodeJwtPayload,normalizeEmail,readCookie,serializeCookie,b64url,googleAuthUrl,redirectTo} from '../lib/auth.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const now=1_800_000_000;
const s={sub:'g:123',email:'a@b.cz',name:'Áda',exp:now+60};

const t=await signSession(s,'tajne');
check('session: platná projde',JSON.stringify(await verifySession(t,'tajne',now))===JSON.stringify(s),await verifySession(t,'tajne',now));
check('session: prošlá neprojde',await verifySession(t,'tajne',now+61)===null);
check('session: jiný secret neprojde',await verifySession(t,'jine',now)===null);
const [p,sig]=t.split('.');
const forged=b64url(new TextEncoder().encode(JSON.stringify({...s,email:'admin@x.cz'})))+'.'+sig;
check('session: změněný payload neprojde',await verifySession(forged,'tajne',now)===null);
check('session: změněný podpis neprojde',await verifySession(p+'.'+sig.slice(0,-2)+'AA','tajne',now)===null);
check('session: nesmysl/prázdná neprojde',await verifySession('xyz','tajne',now)===null&&await verifySession(null,'tajne',now)===null&&await verifySession('a.b.c','tajne',now)===null);

check('pkce: vektor RFC 7636',await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')==='E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
const pair=await pkcePair();
check('pkce: pár sedí a verifier má 43+ znaků',pair.verifier.length>=43&&await pkceChallenge(pair.verifier)===pair.challenge,pair);

const claims={iss:'https://accounts.google.com',aud:'cid',sub:'999',email:'Ja@Gmail.com',email_verified:true,name:'Já',exp:now+100};
const okc=checkIdClaims(claims,'cid',now);
check('claims: platné → lowercase e-mail',okc.ok&&okc.email==='ja@gmail.com'&&okc.sub==='999'&&okc.name==='Já',okc);
check('claims: jiný aud',!checkIdClaims({...claims,aud:'jiny'},'cid',now).ok);
check('claims: cizí iss',!checkIdClaims({...claims,iss:'https://evil.com'},'cid',now).ok);
check('claims: neověřený e-mail',!checkIdClaims({...claims,email_verified:false},'cid',now).ok);
check('claims: prošlý token',!checkIdClaims({...claims,exp:now-1},'cid',now).ok);
check('claims: null',!checkIdClaims(null,'cid',now).ok);
const noName=checkIdClaims({...claims,name:undefined},'cid',now);
check('claims: bez jména → část e-mailu',noName.ok&&noName.name==='ja',noName);

const jwt='x.'+b64url(new TextEncoder().encode(JSON.stringify({sub:'1',name:'Žluťoučký'})))+'.y';
check('jwt: dekóduje UTF-8 payload',decodeJwtPayload(jwt)?.name==='Žluťoučký',decodeJwtPayload(jwt));
check('jwt: rozbitý → null',decodeJwtPayload('nic')===null&&decodeJwtPayload('a.###.c')===null);

check('email: normalizace',normalizeEmail('  Pepa@Seznam.CZ ')==='pepa@seznam.cz');
check('email: nevalidní',[ '', 'bez-zavinace', 'a@b', 'a b@c.cz', null, 42, 'x'.repeat(250)+'@a.cz'].every(v=>normalizeEmail(v)===null));

check('cookie: čtení',readCookie('a=1; tradee_session=abc.def; b=2','tradee_session')==='abc.def'&&readCookie(null,'x')===null&&readCookie('a=1','x')===null);
const sc=serializeCookie('tradee_session','v',60);
check('cookie: atributy',sc==='tradee_session=v; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60',sc);

const u=new URL(googleAuthUrl({clientId:'cid',redirectUri:'https://tradee.eu/auth/callback',state:'st',challenge:'ch'}));
check('google url',u.origin+u.pathname==='https://accounts.google.com/o/oauth2/v2/auth'&&u.searchParams.get('scope')==='openid email profile'&&u.searchParams.get('code_challenge_method')==='S256'&&u.searchParams.get('response_type')==='code'&&u.searchParams.get('state')==='st'&&u.searchParams.get('prompt')==='select_account',u.toString());

const r=redirectTo('/?stav=cekas',['a=1','b=2']);
check('redirect: 302 + dvě cookies',r.status===302&&r.headers.get('location')==='/?stav=cekas'&&r.headers.getSetCookie().length===2&&r.headers.get('cache-control')==='no-store',[r.status,r.headers.getSetCookie()]);

if(fails.length){console.log(`\n${fails.length} selhalo`);process.exit(1)}console.log('\nvše ok');
