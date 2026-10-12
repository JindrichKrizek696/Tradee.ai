import {identity,db,failed,sameOrigin} from '@/lib/server';
import {isPalette} from '@/lib/palettes';
import {isCurrency} from '@/lib/fx';
import {parseNav,normalizeNav} from '@/lib/nav';
import {parseOff,normalizeOff} from '@/lib/overview-toggle';
type Row={palette:string|null;currency:string|null;nav:string|null;score_off?:string|null};
// score_off (vypnuté složky přehledu skóre) přibude migrací 0023; do té doby se čte bez něj a výběr drží jen prohlížeč
export async function GET(req:Request){try{const u=await identity(req);const q=(cols:string)=>db().prepare(`SELECT ${cols} FROM members WHERE id=?`).bind(u.id).first<Row>();const row=await q('palette,currency,nav,score_off').catch(()=>q('palette,currency,nav'));return Response.json({palette:isPalette(row?.palette)?row!.palette:null,currency:isCurrency(row?.currency)?row!.currency:'USD',nav:parseNav(row?.nav),scoreOff:parseOff(row?.score_off)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);const b=await req.json() as {palette?:unknown;currency?:unknown;nav?:unknown;scoreOff?:unknown};
 if(b.palette===undefined&&b.currency===undefined&&b.nav===undefined&&b.scoreOff===undefined)throw Error('Není co uložit.');
 if(b.palette!==undefined){if(!isPalette(b.palette))throw Error('Neznámá předvolba barev.');await db().prepare('UPDATE members SET palette=? WHERE id=?').bind(b.palette,u.id).run()}
 if(b.currency!==undefined){if(!isCurrency(b.currency))throw Error('Nepodporovaná měna.');await db().prepare('UPDATE members SET currency=? WHERE id=?').bind(b.currency,u.id).run()}
 if(b.scoreOff!==undefined){if(!Array.isArray(b.scoreOff))throw Error('Neplatný výběr složek skóre.');await db().prepare('UPDATE members SET score_off=? WHERE id=?').bind(JSON.stringify(normalizeOff(b.scoreOff)),u.id).run()}
 if(b.nav!==undefined){if(!b.nav||typeof b.nav!=='object')throw Error('Neplatné nastavení navigace.');const nav=normalizeNav(b.nav);await db().prepare('UPDATE members SET nav=? WHERE id=?').bind(JSON.stringify(nav),u.id).run();return Response.json({ok:true,nav})}
 return Response.json({ok:true})}catch(e){return failed(e)}}
