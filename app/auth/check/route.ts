import {currentUser} from '@/lib/server';
// Jen pro nginx auth_request: 204 = pustit, 401 = landing/přesměrování, 503 = DB nedostupná (nesmí vypadat jako odhlášení).
export async function GET(req:Request){
 try{return new Response(null,{status:await currentUser(req)?204:401,headers:{'Cache-Control':'no-store'}})}
 catch(e){console.error(e);return new Response(null,{status:503})}
}
