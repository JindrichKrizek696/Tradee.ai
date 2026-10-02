import {identity,db,failed,sameOrigin} from '@/lib/server';
import {isPalette} from '@/lib/palettes';
export async function GET(req:Request){try{const u=await identity(req);const row=await db().prepare('SELECT palette FROM members WHERE id=?').bind(u.id).first<{palette:string|null}>();return Response.json({palette:isPalette(row?.palette)?row!.palette:null},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
export async function POST(req:Request){try{sameOrigin(req);const u=await identity(req);const {palette}=await req.json() as {palette:unknown};if(!isPalette(palette))throw Error('Neznámá předvolba barev.');await db().prepare('UPDATE members SET palette=? WHERE id=?').bind(palette,u.id).run();return Response.json({ok:true})}catch(e){return failed(e)}}
