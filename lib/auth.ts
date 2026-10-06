// Čisté pomocné funkce pro přihlášení přes Google (bez DB a bez cloudflare:workers, aby šly testovat v Node).
export const SESSION_COOKIE='tradee_session',OAUTH_COOKIE='tradee_oauth',SESSION_DAYS=30;
export type Session={sub:string;email:string;name:string;exp:number};
const enc=new TextEncoder(),dec=new TextDecoder();
const ISSUERS=['accounts.google.com','https://accounts.google.com'];

export function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
export function fromB64url(s:string){const b=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0))}
export const randomToken=(bytes=32)=>b64url(crypto.getRandomValues(new Uint8Array(bytes)));

const hmacKey=(secret:string)=>crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
export async function signSession(s:Session,secret:string){const body=b64url(enc.encode(JSON.stringify(s)));const sig=new Uint8Array(await crypto.subtle.sign('HMAC',await hmacKey(secret),enc.encode(body)));return body+'.'+b64url(sig)}
export async function verifySession(token:string|null|undefined,secret:string,nowSec=Date.now()/1000):Promise<Session|null>{
 const parts=(token||'').split('.');if(parts.length!==2||!parts[0]||!parts[1])return null;
 try{
  if(!await crypto.subtle.verify('HMAC',await hmacKey(secret),fromB64url(parts[1]),enc.encode(parts[0])))return null;
  const s=JSON.parse(dec.decode(fromB64url(parts[0]))) as Session;
  return typeof s.sub==='string'&&typeof s.email==='string'&&typeof s.name==='string'&&typeof s.exp==='number'&&s.exp>nowSec?s:null;
 }catch{return null}
}

export async function pkceChallenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}
export async function pkcePair(){const verifier=randomToken(32);return {verifier,challenge:await pkceChallenge(verifier)}}

export function decodeJwtPayload(jwt:string):Record<string,unknown>|null{const p=jwt.split('.');if(p.length!==3)return null;try{const v=JSON.parse(dec.decode(fromB64url(p[1])));return v&&typeof v==='object'?v:null}catch{return null}}

// Token přišel přímo z token endpointu Googlu přes TLS → podpis netřeba ověřovat (OIDC Core 3.1.3.7), jen claims.
export function checkIdClaims(c:Record<string,unknown>|null,clientId:string,nowSec:number):{ok:true;sub:string;email:string;name:string}|{ok:false;reason:string}{
 if(!c)return {ok:false,reason:'chybí claims'};
 if(!ISSUERS.includes(String(c.iss)))return {ok:false,reason:'iss'};
 if(c.aud!==clientId)return {ok:false,reason:'aud'};
 if(typeof c.exp!=='number'||c.exp<=nowSec)return {ok:false,reason:'exp'};
 if(c.email_verified!==true&&c.email_verified!=='true')return {ok:false,reason:'email_verified'};
 const email=normalizeEmail(c.email);if(!email||typeof c.sub!=='string'||!c.sub)return {ok:false,reason:'email/sub'};
 const name=typeof c.name==='string'&&c.name.trim()?c.name.trim().slice(0,200):email.split('@')[0];
 return {ok:true,sub:c.sub,email,name};
}

export function normalizeEmail(v:unknown){if(typeof v!=='string')return null;const e=v.trim().toLowerCase();return e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null}

export function readCookie(header:string|null,name:string){for(const part of (header||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return part.slice(i+1).trim()}return null}
export const serializeCookie=(name:string,value:string,maxAgeSec:number)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
export function redirectTo(location:string,cookies:string[]=[],status=302){const h=new Headers({Location:location,'Cache-Control':'no-store'});for(const c of cookies)h.append('Set-Cookie',c);return new Response(null,{status,headers:h})}

export function googleAuthUrl(p:{clientId:string;redirectUri:string;state:string;challenge:string}){
 return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:p.clientId,redirect_uri:p.redirectUri,response_type:'code',scope:'openid email profile',state:p.state,code_challenge:p.challenge,code_challenge_method:'S256',prompt:'select_account'});
}
