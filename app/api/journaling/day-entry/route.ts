import {identity,db,failed,sameOrigin} from '@/lib/server';
import {setDay} from '@/lib/strategy/store';
import {isDay,isDayStatus,DAY_STATUSES} from '@/lib/strategy/scenario';
import {createDayEntry,notebookError} from '@/lib/notebook/store';
import {dayEntryTitle,dayEntryBody} from '@/lib/notebook/core';
import {pragueDay} from '@/lib/checkins/core';
const headers={'Cache-Control':'private, no-store'};
// „Den bez obchodu“: POST {day?, status (waiting/skipping/pause | null), note} → stav dne (etapa 1A) + papír v Poznámkách (jeden na den)
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),b=await req.json().catch(()=>null) as {day?:unknown;status?:unknown;note?:unknown}|null;
 const today=pragueDay(Date.now()),day=b?.day===undefined||b?.day===null?today:b.day;
 if(!isDay(day)||day>today)throw Error('Neplatný den.');
 const status=b?.status===null||b?.status===undefined?null:b.status;if(status!==null&&!isDayStatus(status))throw Error('Neznámý stav dne.');
 const note=typeof b?.note==='string'?b.note.trim():'';if(note.length>500)throw Error('Poznámka může mít nejvýš 500 znaků.');
 const d=db();if(status)await setDay(d,u.id,day,status,note);
 const r=await createDayEntry(d,u.id,day,dayEntryTitle(day),dayEntryBody(status?DAY_STATUSES[status]:null,note));
 return Response.json({...r,day,status},{headers})}catch(e){return failed(notebookError(e))}}
