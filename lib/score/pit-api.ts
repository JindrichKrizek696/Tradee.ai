// Serverová část „Stav k datu“: čtení z score_snapshots_v2, před migrací 0039 záloha z data/score-history.json (rekonstrukce).
import type {Db} from '../mysql.ts';
import {fromHistory,nearestAtOrBefore,fingerprint,changePoints,WINDOWS,dailyWindow,type PitSnapshot,type WindowKey} from './pit.ts';
import {snapshotsAt,lastChangeBefore,snapshotRange,isMissingPitTable} from './pit-store.ts';
type Hist=Parameters<typeof fromHistory>[0];
/** Čas z dotazu: ISO nebo ms; chybí → teď. Budoucnost se ořízne na teď. */
export function parseT(v:string|null,now=Date.now()){if(!v)return now;const n=/^\d+$/.test(v)?Number(v):Date.parse(v);if(!Number.isFinite(n))throw Error('Neplatný čas.');return Math.min(n,now)}
export async function scoresAt(d:Db|null,hist:Hist,t:number,markets:string[]|null){
 let source:'db'|'history'='db',snaps:Record<string,PitSnapshot>={},previous:Record<string,PitSnapshot|null>={};
 try{
  if(!d)throw Object.assign(Error('bez DB'),{code:'ER_NO_SUCH_TABLE'});
  snaps=await snapshotsAt(d,t,markets);
  if(markets&&markets.length<=3)for(const m of markets)previous[m]=snaps[m]?await lastChangeBefore(d,snaps[m]):null;
  if(!Object.keys(snaps).length)throw Object.assign(Error('prázdné'),{code:'EMPTY'});
 }catch(e){
  if(!isMissingPitTable(e)&&(e as {code?:string}).code!=='EMPTY')throw e;
  source='history';snaps={};previous={};
  const all=fromHistory(hist,markets),by=new Map<string,PitSnapshot[]>();
  for(const s of all)(by.get(s.market)??by.set(s.market,[]).get(s.market)!).push(s);
  for(const [m,list] of by){const s=nearestAtOrBefore(list,t);if(!s)continue;snaps[m]=s;
   if(markets&&markets.length<=3){const f=fingerprint(s),before=list.filter(x=>x.at<s.at&&fingerprint(x)!==f);previous[m]=before.at(-1)??null}}
 }
 return {t:new Date(t).toISOString(),source,snapshots:snaps,previous};
}
export async function scoreHistory(d:Db|null,hist:Hist,market:string,w:WindowKey,to:number){
 const from=to-WINDOWS[w],daily=dailyWindow(w);
 try{if(!d)throw Object.assign(Error('bez DB'),{code:'ER_NO_SUCH_TABLE'});
  const list=await snapshotRange(d,market,from,to,daily);
  // před prvním bodem okna: poslední známý stav (graf začíná skutečnou hodnotou, ne prázdnem)
  const head=(await snapshotsAt(d,from,[market]))[market];
  return {source:'db' as const,daily,snapshots:head&&(!list.length||head.at<list[0].at)?[head,...list]:list};
 }catch(e){if(!isMissingPitTable(e))throw e}
 const all=fromHistory(hist,[market]),head=nearestAtOrBefore(all,from),inside=all.filter(s=>Date.parse(s.at)>from&&Date.parse(s.at)<=to);
 return {source:'history' as const,daily:false,snapshots:changePoints(head?[head,...inside]:inside)};
}
