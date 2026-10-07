// Měna souhrnu uživatele a kurzy ECB z DB (kalendář obchodů i deník).
import type {Db} from './mysql.ts';
import {makeRates,isCurrency,CENT,type FxRow,type Rates} from './fx.ts';
export async function userCurrency(d:Db,userId:string):Promise<string>{
 const m=await d.prepare('SELECT currency FROM members WHERE id=?').bind(userId).first<{currency:string|null}>();
 return isCurrency(m?.currency)?m!.currency as string:'USD';
}
// centové měny (USC…) se počítají z kurzu základní měny – ta musí být mezi načtenými
export async function loadRates(d:Db,currency:string,accCurrencies:string[]):Promise<Rates>{
 const curs=[...new Set([currency,...accCurrencies,...accCurrencies.map(c=>CENT[c]).filter(Boolean)])].filter(c=>c&&c!=='EUR');
 return makeRates(curs.length?(await d.prepare(`SELECT date,currency,per_eur FROM fx_rates WHERE currency IN (${curs.map(()=>'?').join(',')})`).bind(...curs).all<FxRow>()).results:[]);
}
