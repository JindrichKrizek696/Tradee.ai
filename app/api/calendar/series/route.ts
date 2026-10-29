import {identity,db,failed} from '@/lib/server';
import {histSeries,revisionsFor} from '@/lib/calendar-hist-store';
const headers={'Cache-Control':'private, no-store'};
// Historie jednoho ukazatele: GET ?currency=USD&title=CPI m/m → všechna uložená vydání řady (měna + titul ForexFactory) a jejich změny.
export async function GET(req:Request){try{await identity(req);const q=new URL(req.url).searchParams,currency=(q.get('currency')||'').toUpperCase(),title=q.get('title')||'';
 if(!/^[A-Z]{3}$/.test(currency)||!title||title.length>160)throw Error('Neznámý ukazatel.');
 try{const d=db(),events=await histSeries(d,currency,title,240);return Response.json({available:true,events,changes:await revisionsFor(d,events.map(e=>e.id))},{headers})}
 catch(e){if(e instanceof Error&&/ER_NO_SUCH_TABLE|doesn't exist/i.test(e.message))return Response.json({available:false,events:[],changes:[]},{headers});throw e}
}catch(e){return failed(e)}}
