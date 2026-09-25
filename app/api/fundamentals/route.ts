import report from '@/data/fundamentals.json';
import expanded from '@/data/expanded-market.json';
import history from '@/data/score-history.json';
import scoreMarket from '@/data/score-market.json';
import {identity,failed} from '@/lib/server';
export async function GET(req:Request){try{await identity(req);return Response.json({...report,history,scoreMarket:{...scoreMarket,prices:{...scoreMarket.prices,...expanded.prices},legacy:expanded.legacy,refresh:{attemptedAt:expanded.refresh.attemptedAt,issues:[...scoreMarket.refresh.issues,...expanded.refresh.issues]}}},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
