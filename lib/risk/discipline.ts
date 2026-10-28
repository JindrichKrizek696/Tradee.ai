// Disciplína × profil účtu: max. riziko na obchod a denní ztráta berou limity a zůstatek z profilu (i pro T212 a ruční účty bez zůstatku z EA).
// Čisté funkce – testy scripts/check-risk.mjs a scripts/check-discipline.mjs.
import type {RuleSettings} from '../discipline/rules.ts';
import type {Rules} from './account.ts';
const r2=(n:number)=>Math.round(n*100)/100;
/** riziko v % zůstatku: z EA, jinak z rizika v penězích a zůstatku profilu; jinak null */
export function riskPctOf(riskPct:number|null,riskMoney:number|null,balance:number|null):number|null{
 if(riskPct!==null&&Number.isFinite(riskPct))return riskPct;
 return riskMoney!==null&&riskMoney>0&&balance!==null&&balance>0?r2(riskMoney/balance*100):null;
}
/** denní limit ztráty profilu v % zůstatku na začátku dne (pro pravidlo max_daily_loss); null = profil limit nemá */
export function dailyLossPct(rules:Rules,start:number,balanceStart:number|null):number|null{
 const d=rules.dailyLoss;if(d.type==='none'||!(d.value>0)||!balanceStart||balanceStart<=0)return null;
 const amount=d.type==='amount'?d.value:(d.base==='initial'?start:balanceStart)*d.value/100;
 return Math.round(amount/balanceStart*100*1000)/1000;
}
/** Pravidla uživatele zpřísněná profilem: platí přísnější z obou hodnot; vypnuté pravidlo zůstává vypnuté. */
export function withProfile(s:RuleSettings,rules:Rules|null,start:number,balanceStart:number|null):RuleSettings{
 if(!rules)return s;
 const out={...s};
 if(s.max_risk.on&&rules.maxRiskPct!==null)out.max_risk={on:true,value:s.max_risk.value===null?rules.maxRiskPct:Math.min(s.max_risk.value,rules.maxRiskPct)};
 const dl=dailyLossPct(rules,start,balanceStart);
 if(s.max_daily_loss.on&&dl!==null)out.max_daily_loss={on:true,value:s.max_daily_loss.value===null?dl:Math.min(s.max_daily_loss.value,dl)};
 return out;
}
/** Deník: obchodům bez rizika v % (T212 import) ho dopočítá ze zůstatku profilu před obchodem (start + uzavřené obchody od data startu). */
export function fillRiskPct<T extends {account_id:string;open_ts:number;close_ts:number;net:number;risk_pct:number|null;risk_money:number|null}>(rows:T[],profiles:{linkId:string;start:number;startTs:number}[]):T[]{
 const by=new Map(profiles.map(p=>[p.linkId,p]));if(!by.size)return rows;
 const bal=new Map<string,{b:number;closes:{ts:number;net:number}[];i:number}>();
 for(const p of profiles)bal.set(p.linkId,{b:p.start,closes:rows.filter(r=>r.account_id===p.linkId&&Number(r.close_ts)>=p.startTs).map(r=>({ts:Number(r.close_ts),net:Number(r.net)})).sort((a,b)=>a.ts-b.ts),i:0});
 return [...rows].sort((a,b)=>Number(a.open_ts)-Number(b.open_ts)).map(r=>{
  const p=by.get(r.account_id),st=bal.get(r.account_id);
  if(!p||!st||r.risk_pct!==null&&r.risk_pct!==undefined||Number(r.open_ts)<p.startTs)return r;
  while(st.i<st.closes.length&&st.closes[st.i].ts<=Number(r.open_ts)){st.b+=st.closes[st.i].net;st.i++}
  const v=riskPctOf(null,r.risk_money===null?null:Number(r.risk_money),st.b);
  return v===null?r:{...r,risk_pct:v};
 });
}
