import {authEnv} from '@/lib/server';
import {pkcePair,randomToken,googleAuthUrl,serializeCookie,redirectTo,OAUTH_COOKIE} from '@/lib/auth';
export async function GET(){
 try{const c=authEnv();const state=randomToken(16);const {verifier,challenge}=await pkcePair();
  return redirectTo(googleAuthUrl({clientId:c.clientId,redirectUri:c.publicUrl+'/auth/callback',state,challenge}),[serializeCookie(OAUTH_COOKIE,state+'.'+verifier,600)])}
 catch(e){console.error(e);return redirectTo('/?stav=chyba')}
}
