import history from '@/data/score-history.json';
import {identity,db,failed} from '@/lib/server';
import {instruments} from '@/lib/markets';
import {scoreHistory,parseT} from '@/lib/score/pit-api';
import {WINDOWS,type WindowKey} from '@/lib/score/pit';
const ids=new Set(instruments.map(i=>i.id));
// Historie skóre trhu pro graf: GET /api/scores/history?market=EUR/USD&window=1D|1W|1M|3M|1R[&to=…] → jen body změny (snímky s plnými složkami)
export async function GET(req:Request){try{await identity(req);const q=new URL(req.url).searchParams,m=q.get('market')||'',w=(q.get('window')||'1M') as WindowKey;
 if(!ids.has(m))throw Error('Neznámý trh.');if(!(w in WINDOWS))throw Error('Neznámé okno.');
 let d=null;try{d=db()}catch{}
 return Response.json(await scoreHistory(d,history as never,m,w,parseT(q.get('to'))),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
