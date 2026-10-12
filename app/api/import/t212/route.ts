import {identity,db,failed,sameOrigin} from '@/lib/server';
import {parseT212,MAX_T212_BYTES} from '@/lib/import/t212';
import {previewT212,importT212} from '@/lib/import/t212-store';
import {highNews} from '@/lib/discipline/news';
import calendarAuto from '@/data/calendar.json';
import fundamentals from '@/data/fundamentals.json';
import type {AutoEvent,CuratedEvent} from '@/lib/calendar';
import {instruments} from '@/lib/markets';
const ids=instruments.map(i=>i.id);
const TOO_BIG='Soubor může mít nejvýš 5 MB.';
// CSV jako multipart (pole „file“) nebo přímo v těle (text/csv); ?dry=1 = jen náhled bez uložení
async function readCsv(req:Request):Promise<string>{
 if(Number(req.headers.get('content-length')||0)>MAX_T212_BYTES+64*1024)throw Error(TOO_BIG);
 let text:string;
 if((req.headers.get('content-type')||'').includes('multipart/form-data')){
  const f=(await req.formData()).get('file');
  if(!f||typeof f==='string')throw Error('Vyber CSV soubor z Trading 212.');
  if(f.size>MAX_T212_BYTES)throw Error(TOO_BIG);
  text=await f.text();
 }else text=await req.text();
 if(text.length>MAX_T212_BYTES)throw Error(TOO_BIG);
 if(!text.trim())throw Error('Soubor je prázdný.');
 return text;
}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),d=db();
 const parsed=parseT212(await readCsv(req));
 if(!parsed.trades.length)throw Error('V souboru nejsou žádné uzavřené pozice.');
 const dry=new URL(req.url).searchParams.get('dry')==='1';
 if(dry)return Response.json({preview:await previewT212(d,u.id,parsed,ids)},{headers:{'Cache-Control':'no-store'}});
 const r=await importT212(d,u.id,parsed,()=>highNews(calendarAuto.events as AutoEvent[],fundamentals.events as CuratedEvent[],fundamentals.sources));
 return Response.json({ok:true,...r},{headers:{'Cache-Control':'no-store'}})}catch(e){return failed(e)}}
