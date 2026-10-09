import {identity,db,failed,sameOrigin} from '@/lib/server';
import {symbolMap,setSymbol,unmappedSymbols} from '@/lib/checklists/store';
import {instruments} from '@/lib/markets';
const ids=instruments.map(i=>i.id);
export async function GET(req:Request){try{const u=await identity(req),d=db(),map=await symbolMap(d,u.id);
 return Response.json({map,unmapped:await unmappedSymbols(d,u.id,ids,map)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function PUT(req:Request){try{sameOrigin(req);const u=await identity(req);
 const b=await req.json() as {symbol?:unknown;instrument?:unknown};
 const symbol=typeof b.symbol==='string'?b.symbol.trim():'';if(!symbol||symbol.length>32)throw Error('Neplatný symbol.');
 const ins=b.instrument;
 if(ins!==null&&ins!==''&&!(typeof ins==='string'&&ids.includes(ins)))throw Error('Neznámý trh.');
 await setSymbol(db(),u.id,symbol,ins as string|null);return Response.json({ok:true})}catch(e){return failed(e)}}
