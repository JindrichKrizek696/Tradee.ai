import {runtime,identity,db,failed} from '@/lib/server';
import {isAvatarId,AVATAR_PREFIX} from '@/lib/profile/rules';
import {avatarInUse} from '@/lib/profile/store';
// profilovou fotku vidí přihlášení členové; jen aktuální fotky (stará po výměně vrátí 404). Adresa se s každou fotkou mění → dlouhá cache.
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){try{await identity(req);const {id}=await params;
 const key=AVATAR_PREFIX+id;if(!isAvatarId(id)||!await avatarInUse(db(),key))return new Response('Fotka nenalezena.',{status:404});
 const o=await runtime().BUCKET.get(key);if(!o)return new Response('Fotka nenalezena.',{status:404});
 return new Response(o.body,{headers:{'Content-Type':o.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}})}catch(e){return failed(e)}}
