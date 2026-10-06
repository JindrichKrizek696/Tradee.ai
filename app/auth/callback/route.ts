import {authEnv,recordLogin} from '@/lib/server';
import {readCookie,serializeCookie,redirectTo,decodeJwtPayload,checkIdClaims,signSession,OAUTH_COOKIE,SESSION_COOKIE,SESSION_DAYS} from '@/lib/auth';
export async function GET(req:Request){
 const url=new URL(req.url),clear=serializeCookie(OAUTH_COOKIE,'',0);
 try{
  const c=authEnv();
  const [state,verifier]=(readCookie(req.headers.get('cookie'),OAUTH_COOKIE)||'').split('.');
  const code=url.searchParams.get('code');
  if(!state||!verifier||!code||url.searchParams.get('state')!==state)throw new Error('OAuth: nesedí state nebo chybí code ('+(url.searchParams.get('error')||'-')+')');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:c.publicUrl+'/auth/callback',grant_type:'authorization_code',code_verifier:verifier})});
  const j=await r.json().catch(()=>({})) as {id_token?:string;error?:string};
  if(!r.ok||!j.id_token)throw new Error('OAuth token: '+(j.error||r.status));
  const cl=checkIdClaims(decodeJwtPayload(j.id_token),c.clientId,Date.now()/1000);
  if(!cl.ok)throw new Error('OAuth claims: '+cl.reason);
  const user={sub:'g:'+cl.sub,email:cl.email,name:cl.name};
  if(!await recordLogin(user))return redirectTo('/?stav=cekas',[clear]);
  const token=await signSession({...user,exp:Math.floor(Date.now()/1000)+SESSION_DAYS*86400},c.sessionSecret);
  return redirectTo('/',[clear,serializeCookie(SESSION_COOKIE,token,SESSION_DAYS*86400)]);
 }catch(e){console.error(e);return redirectTo('/?stav=chyba',[clear])}
}
