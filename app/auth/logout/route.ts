import {sameOrigin,failed} from '@/lib/server';
import {serializeCookie,redirectTo,SESSION_COOKIE} from '@/lib/auth';
export async function POST(req:Request){try{sameOrigin(req);return redirectTo('/',[serializeCookie(SESSION_COOKIE,'',0)],303)}catch(e){return failed(e)}}
