import {identity,db,failed,sameOrigin} from '@/lib/server';
import {isPalette} from '@/lib/palettes';
import {isCurrency} from '@/lib/fx';
export async function GET(req:Request){try{const u=await identity(req);const row=await db().prepare('SELECT palette,currency FROM members WHERE id=?').bind(u.id).first<{palette:string|null;currency:string|null}>();return Response.json({palette:isPalette(row?.palette)?row!.palette:null,currency:isCurrency(row?.currency)?row!.currency:'USD'},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);const b=await req.json() as {palette?:unknown;currency?:unknown};
 if(b.palette===undefined&&b.currency===undefined)throw Error('Není co uložit.');
 if(b.palette!==undefined){if(!isPalette(b.palette))throw Error('Neznámá předvolba barev.');await db().prepare('UPDATE members SET palette=? WHERE id=?').bind(b.palette,u.id).run()}
 if(b.currency!==undefined){if(!isCurrency(b.currency))throw Error('Nepodporovaná měna.');await db().prepare('UPDATE members SET currency=? WHERE id=?').bind(b.currency,u.id).run()}
 return Response.json({ok:true})}catch(e){return failed(e)}}
