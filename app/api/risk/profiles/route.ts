import {identity,db,failed,sameOrigin} from '@/lib/server';
import {createProfile} from '@/lib/risk/store';
import {parseProfileInput} from '@/lib/risk/account';
import {pragueDate} from '@/lib/mt/trades';
import {CURRENCIES} from '@/lib/fx';
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);
 const p=parseProfileInput(await req.json().catch(()=>null),pragueDate(Date.now()),CURRENCIES);if(!p.ok)throw Error(p.error);
 return Response.json({id:await createProfile(db(),u.id,p.value)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
