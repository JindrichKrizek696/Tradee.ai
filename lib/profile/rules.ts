// Profil uživatele: povolené hodnoty, kontrola vstupu a pomocné funkce (čisté, testuje scripts/check-profile.mjs).
export const STYLES={scalp:'Scalping',intraday:'Intraday',swing:'Swing',position:'Poziční'} as const;
export const MARKETS={fx:'Forex',index:'Indexy',commodities:'Komodity',crypto:'Krypto',stock:'Akcie'} as const;
export type Style=keyof typeof STYLES;
export type Market=keyof typeof MARKETS;
// barva kolečka s iniciálami, když uživatel nemá fotku (první = výchozí modrá z loga)
export const AVATAR_COLORS=['#245bff','#7a5cff','#0ea5e9','#0d9488','#16a34a','#d97706','#dc2626','#db2777'];
export const LIMITS={name:60,greet:40,bio:300};
export const AVATAR_PX=256,AVATAR_MAX_BYTES=512*1024;
export const FIRST_YEAR=1970;
export type Profile={displayName:string|null;greet:string|null;color:string|null;bio:string|null;styles:Style[];markets:Market[];since:number|null};
export const emptyProfile=():Profile=>({displayName:null,greet:null,color:null,bio:null,styles:[],markets:[],since:null});

// jeden řádek: bez řídicích znaků, mezery sloučené; prázdný → null
const line=(s:string)=>s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g,' ').replace(/\s+/g,' ').trim()||null;
// víc řádků (O mně): zachová konce řádků, nejvýš jeden prázdný řádek za sebou
const text=(s:string)=>s.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u2028\u2029]/g,' ').split('\n').map(l=>l.replace(/\s+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim()||null;
const keys=<K extends string>(v:unknown,allowed:Record<K,string>,what:string):K[]=>{
 if(!Array.isArray(v)||v.some(x=>typeof x!=='string'||!Object.hasOwn(allowed,x)))throw Error(`Neplatný výběr: ${what}.`);
 return (Object.keys(allowed) as K[]).filter(k=>v.includes(k));
};

/** Zkontroluje a vyčistí změny profilu z požadavku. Vrací jen pole, která v požadavku byla. */
export function parseProfile(b:unknown,year=new Date().getFullYear()):{ok:true;value:Partial<Profile>}|{ok:false;error:string}{
 try{
  if(!b||typeof b!=='object'||Array.isArray(b))throw Error('Neplatná data profilu.');
  const o=b as Record<string,unknown>,v:Partial<Profile>={};
  const str=(k:string)=>{const x=o[k];if(x!==null&&typeof x!=='string')throw Error('Neplatná data profilu.');return x as string|null};
  if(o.displayName!==undefined){const n=str('displayName');v.displayName=n===null?null:line(n);if(v.displayName&&[...v.displayName].length>LIMITS.name)throw Error(`Jméno může mít nejvýš ${LIMITS.name} znaků.`);if(v.displayName&&!/\p{L}/u.test(v.displayName))throw Error('Jméno musí obsahovat aspoň jedno písmeno.')}
  if(o.greet!==undefined){const n=str('greet');v.greet=n===null?null:line(n);if(v.greet&&[...v.greet].length>LIMITS.greet)throw Error(`Oslovení může mít nejvýš ${LIMITS.greet} znaků.`)}
  if(o.bio!==undefined){const n=str('bio');v.bio=n===null?null:text(n);if(v.bio&&[...v.bio].length>LIMITS.bio)throw Error(`Text o sobě může mít nejvýš ${LIMITS.bio} znaků.`)}
  if(o.color!==undefined){if(o.color!==null&&!AVATAR_COLORS.includes(o.color as string))throw Error('Neznámá barva avataru.');v.color=o.color as string|null}
  if(o.styles!==undefined)v.styles=keys(o.styles,STYLES,'styl obchodování');
  if(o.markets!==undefined)v.markets=keys(o.markets,MARKETS,'trhy');
  if(o.since!==undefined){if(o.since!==null&&(!Number.isInteger(o.since)||(o.since as number)<FIRST_YEAR||(o.since as number)>year))throw Error(`Rok musí být mezi ${FIRST_YEAR} a ${year}.`);v.since=o.since as number|null}
  if(!Object.keys(v).length)throw Error('Není co uložit.');
  return {ok:true,value:v};
 }catch(e){return {ok:false,error:(e as Error).message}}
}

// seznam klíčů v DB je text oddělený čárkou; neznámé hodnoty (např. po přejmenování) se zahodí
export const joinList=(a:string[])=>a.length?a.join(','):null;
export const splitList=<K extends string>(s:string|null|undefined,allowed:Record<K,string>):K[]=>(s||'').split(',').filter((k):k is K=>Object.hasOwn(allowed,k));

/** Typ obrázku podle prvních bajtů (ne podle přípony nebo hlavičky od klienta). */
export function sniffImage(b:Uint8Array):'image/png'|'image/jpeg'|'image/webp'|null{
 if(b.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((x,i)=>b[i]===x))return 'image/png';
 if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if(b.length>=12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
 return null;
}
// klíč v úložišti ↔ adresa pro <img>; v adrese je jen UUID, takže nová fotka = nová adresa (dlouhá cache je bezpečná)
export const AVATAR_PREFIX='avatars/';
export const avatarUrl=(key:string|null|undefined)=>key?.startsWith(AVATAR_PREFIX)?'/api/profile/avatar/'+key.slice(AVATAR_PREFIX.length):null;
export const isAvatarId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

/** Iniciály do kolečka avataru: první písmena prvních dvou slov. */
export function initials(name:string){const w=name.trim().split(/\s+/).filter(Boolean);return ((w[0]?.[0]||'?')+(w[1]?.[0]||'')).toUpperCase()}
