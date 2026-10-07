import {db} from '@/lib/server';
import {accountState} from '@/lib/mt/store';
import {authKey,mtJson} from '@/lib/mt/http';
export async function GET(req:Request){
 try{
  const a=await authKey(req);if(a instanceof Response)return a;
  const u=new URL(req.url),login=u.searchParams.get('login')||'',server=u.searchParams.get('server')||'';
  if(!/^\d{1,32}$/.test(login)||!server||server.length>64)return mtJson({error:'Chybí login nebo server.'},400);
  return mtJson(await accountState(db(),a.userId,login,server));
 }catch(e){console.error('mt state',e);return mtJson({error:'Stav účtu teď nejde zjistit.'},503)}
}
