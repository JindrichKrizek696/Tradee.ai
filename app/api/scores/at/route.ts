import history from '@/data/score-history.json';
import {identity,db,failed} from '@/lib/server';
import {instruments} from '@/lib/markets';
import {scoresAt,parseT} from '@/lib/score/pit-api';
const ids=new Set(instruments.map(i=>i.id));
// Stav skóre k času t: GET /api/scores/at?t=<ISO|ms>&markets=EUR/USD,USD → nejbližší uložený snímek ≤ t pro každý trh
// (+ u ≤ 3 trhů i předchozí snímek s jiným obsahem pro „co se změnilo“).
export async function GET(req:Request){try{await identity(req);const q=new URL(req.url).searchParams;
 const t=parseT(q.get('t')),raw=q.get('markets'),markets=raw?raw.split(',').map(s=>s.trim()).filter(s=>ids.has(s)).slice(0,80):null;
 let d=null;try{d=db()}catch{}
 return Response.json(await scoresAt(d,history as never,t,markets&&markets.length?markets:null),{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
