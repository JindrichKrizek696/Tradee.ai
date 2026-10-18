// Kontrola pravidel profilu: node --experimental-strip-types scripts/check-profile.mjs
import {parseProfile,sniffImage,splitList,joinList,avatarUrl,isAvatarId,initials,STYLES,AVATAR_COLORS} from '../lib/profile/rules.ts';
const fails=[];
const check=(name,ok,got)=>{console.log((ok?'ok   ':'FAIL ')+name+(ok?'':' → '+JSON.stringify(got)));if(!ok)fails.push(name)};
const ok=(b)=>{const r=parseProfile(b,2026);return r.ok?r.value:null};
const err=(b)=>{const r=parseProfile(b,2026);return r.ok?null:r.error};

check('jméno: ořízne a sloučí mezery',ok({displayName:'  Jakub   Pazdera '})?.displayName==='Jakub Pazdera',ok({displayName:'  Jakub   Pazdera '}));
check('jméno: prázdné → null (zpět na Google)',ok({displayName:'   '})?.displayName===null);
check('jméno: null → null',ok({displayName:null})?.displayName===null);
check('jméno: řídicí znaky pryč',ok({displayName:'Ja\u0000kub\n'})?.displayName==='Ja kub',ok({displayName:'Ja\u0000kub\n'}));
check('jméno: bez písmene neprojde',!!err({displayName:'1234'}));
check('jméno: limit 60 znaků (počítá znaky, ne bajty)',ok({displayName:'Ř'.repeat(60)})?.displayName?.length===60&&!!err({displayName:'a'.repeat(61)}));
check('jméno: číslo místo textu neprojde',!!err({displayName:42}));
check('oslovení: limit 40',!!err({greet:'x'.repeat(41)})&&ok({greet:'Kubo'})?.greet==='Kubo');
check('o mně: zachová řádky, max 1 prázdný',ok({bio:'a\r\n\r\n\r\n\r\nb  c\n'})?.bio==='a\n\nb c',ok({bio:'a\r\n\r\n\r\n\r\nb  c\n'}));
check('o mně: limit 300',!!err({bio:'x'.repeat(301)}));
check('barva: jen z nabídky',ok({color:AVATAR_COLORS[2]})?.color===AVATAR_COLORS[2]&&!!err({color:'#123456'})&&ok({color:null})?.color===null);
check('styly: pořadí podle nabídky, bez duplicit',JSON.stringify(ok({styles:['swing','scalp','swing']})?.styles)==='["scalp","swing"]',ok({styles:['swing','scalp','swing']}));
check('styly: neznámý klíč neprojde',!!err({styles:['hodl']})&&!!err({styles:'swing'}));
check('trhy: prázdné pole projde',JSON.stringify(ok({markets:[]})?.markets)==='[]');
check('rok: rozsah 1970–letos',ok({since:2019})?.since===2019&&!!err({since:1969})&&!!err({since:2027})&&!!err({since:2019.5})&&!!err({since:'2019'})&&ok({since:null})?.since===null);
check('jen poslaná pole',JSON.stringify(Object.keys(ok({greet:'Kubo'})||{}))==='["greet"]');
check('prázdný požadavek neprojde',!!err({})&&!!err(null)&&!!err([])&&!!err('x'));
check('seznam: tam a zpět',JSON.stringify(splitList(joinList(['scalp','swing']),STYLES))==='["scalp","swing"]'&&joinList([])===null);
check('seznam: neznámé hodnoty z DB zahodí',JSON.stringify(splitList('swing,xx,,scalp',STYLES))==='["swing","scalp"]'&&splitList(null,STYLES).length===0);

const bytes=(...a)=>new Uint8Array(a);
check('obrázek: PNG',sniffImage(bytes(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0))==='image/png');
check('obrázek: JPEG',sniffImage(bytes(0xff,0xd8,0xff,0xe0))==='image/jpeg');
const webp=new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
check('obrázek: WebP',sniffImage(webp)==='image/webp');
check('obrázek: HTML/SVG/GIF neprojde',sniffImage(new TextEncoder().encode('<svg onload=alert(1)>'))===null&&sniffImage(new TextEncoder().encode('GIF89a'))===null&&sniffImage(bytes())===null);

const id='0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
check('avatar: adresa z klíče',avatarUrl('avatars/'+id)==='/api/profile/avatar/'+id&&avatarUrl(null)===null&&avatarUrl('journal/x')===null);
check('avatar: id jen UUID',isAvatarId(id)&&!isAvatarId('../journal/x')&&!isAvatarId(id.toUpperCase()));
check('iniciály',initials('Jakub Pazdera')==='JP'&&initials('  ondřej ')==='O'&&initials('')==='?');

if(fails.length){console.log(`\n${fails.length} FAIL`);process.exit(1)}console.log('\nCHECK OK');
