import {identity,db,failed,sameOrigin} from '@/lib/server';
import {nowSql} from '@/lib/mt/store';
import {testAllowed} from '@/lib/notify/prefs';
const H={headers:{'Cache-Control':'private, no-store'}};
const ms=(s:unknown)=>s?Date.parse(String(s).replace(' ','T')+'Z'):null;
type Row={requested:string;done:string|null;sent:number|null};
const state=(r:Row|null)=>r?{requested:ms(r.requested),done:ms(r.done),sent:r.sent===null?null:Number(r.sent)}:null;
// Testovací push na vlastní zařízení: aplikace jen zapíše žádost, odešle ji cron scripts/alerts-check.mjs (do minuty). Nejvýš 1 za minutu.
export async function GET(req:Request){try{const u=await identity(req);
 return Response.json({test:state(await db().prepare('SELECT requested,done,sent FROM notify_tests WHERE user_id=?').bind(u.id).first<Row>())},H)}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req),d=db();
 const subs=await d.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id=?').bind(u.id).first<{c:number}>();
 if(!Number(subs?.c))throw Error('Push nemáš zapnutý na žádném zařízení – nejdřív ho zapni.');
 const prev=await d.prepare('SELECT requested FROM notify_tests WHERE user_id=?').bind(u.id).first<{requested:string}>(),now=Date.now();
 if(!testAllowed(ms(prev?.requested),now))throw Error('Test můžeš poslat jednou za minutu.');
 await d.prepare('INSERT INTO notify_tests(user_id,requested,done,sent) VALUES(?,?,NULL,NULL) ON DUPLICATE KEY UPDATE requested=VALUES(requested),done=NULL,sent=NULL').bind(u.id,nowSql()).run();
 return Response.json({ok:true,test:{requested:Math.floor(now/1000)*1000,done:null,sent:null}},H)}catch(e){return failed(e)}}
