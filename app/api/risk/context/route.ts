// Vše pro kalkulačku pozice a karty rizika: instrumenty (výchozí + DB), profily účtů se stavem, účty k propojení, kurzy pro přepočet měn.
import {identity,db,failed} from '@/lib/server';
import {viewAs} from '@/lib/admin/http';
import {listInstruments,listProfiles,linkableAccounts,profileStatus,fxContext} from '@/lib/risk/store';
import {CURRENCIES} from '@/lib/fx';
export async function GET(req:Request){try{const u=await identity(req),v=await viewAs(req,u);if(v instanceof Response)return v;const d=db();
 const [instruments,profiles,accounts,fx]=await Promise.all([listInstruments(d),listProfiles(d,v.userId),linkableAccounts(d,v.userId),fxContext(d)]);
 const withStatus=[];for(const p of profiles)withStatus.push({...p,status:p.archived?null:await profileStatus(d,v.userId,p,accounts).catch(e=>{console.error('risk status',p.id,e);return null})});
 return Response.json({instruments,profiles:withStatus,accounts,quotes:fx.quotes,ecb:fx.ecb,currencies:CURRENCIES},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return failed(e)}}
