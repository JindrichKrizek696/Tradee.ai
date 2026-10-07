// Klíče EA TradeeSync: v DB jen SHA-256 otisk, plaintext uživatel uvidí jednou.
export const KEY_RE=/^tk_[A-Za-z0-9_-]{43}$/;
export const isKeyFormat=(k:string)=>KEY_RE.test(k);
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
export async function hashKey(key:string){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));return Array.from(h,b=>b.toString(16).padStart(2,'0')).join('')}
export async function generateKey(){const key='tk_'+b64url(crypto.getRandomValues(new Uint8Array(32)));return {key,hash:await hashKey(key),prefix:key.slice(0,9)}}
