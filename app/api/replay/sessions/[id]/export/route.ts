// Replay: export seance – JSON (nastavení, záznam událostí, obchody, výsledky) nebo CSV obchodů.
import {identity,db,failed} from '@/lib/server';
import {getSession,loadEvents,loadTrades,sessionBars,compute} from '@/lib/replay/store';
import {tradesCsv} from '@/lib/replay/results';
import type {Trade} from '@/lib/replay/engine';
type Ctx={params:Promise<{id:string}>};
export async function GET(req:Request,{params}:Ctx){try{const u=await identity(req),{id}=await params;if(!/^rp_[a-z0-9]{1,30}$/.test(id))return Response.json({error:'Seance nenalezena.'},{status:404});
 const d=db(),s=await getSession(d,u.id,id);if(!s)return Response.json({error:'Seance nenalezena.'},{status:404});
 const events=await loadEvents(d,u.id,id);
 // aktivní seance: přepočet do hodin (nic se neukládá); ukončená: uložené obchody
 let trades:Trade[]=(await loadTrades(d,u.id,id)) as unknown as Trade[],summary=s.results?.summary??null;
 if(s.status==='active'){const c=compute(s,await sessionBars(d,s,false),events);trades=c.res.trades;summary=c.summary}
 const name=('tradee-replay-'+s.name).replace(/[^\w.-]+/g,'-').slice(0,60);
 if(new URL(req.url).searchParams.get('format')==='csv')return new Response('﻿'+tradesCsv(trades),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}.csv"`,'Cache-Control':'private, no-store'}});
 const {config,...rest}=s;
 return new Response(JSON.stringify({session:{...rest,config:{exec:config.exec,specs:config.specs,account:config.account,strategy:config.strategy,notes:config.notes}},events,trades,summary},null,1),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${name}.json"`,'Cache-Control':'private, no-store'}});
}catch(e){return failed(e)}}
