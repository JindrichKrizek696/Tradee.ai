// Nápady s více vstupy: jeden nápad (idea) = několik vstupů / pozic na stejném trhu a ve stejném směru (přikupování, dva vstupy z různých zón, částečné výstupy).
// Čisté funkce – testy scripts/check-journal-ideas.mjs.
const EPS=1e-9,r2=(n:number)=>Math.round(n*100)/100,r6=(n:number)=>Math.round(n*1e6)/1e6;
export const IDEA_WINDOW_MIN=240,IDEA_WINDOW_LIMITS={min:5,max:7*24*60};
export type Side='buy'|'sell';
export const LEG_STATUSES={open:'Otevřená',closed:'Uzavřená',pending:'Čeká (limit)',cancelled:'Zrušená'} as const;
export type LegStatus=keyof typeof LEG_STATUSES;
/** Vážený průměr vstupu z plnění: Σ cena × objem / Σ objem (ne prostý průměr cen). */
export function weightedEntry(fills:{price:number;qty:number}[]):number|null{
 const q=fills.reduce((a,f)=>a+(f.qty>0?f.qty:0),0);if(q<=EPS)return null;
 return r6(fills.reduce((a,f)=>a+(f.qty>0?f.price*f.qty:0),0)/q);
}
/** Riziko nápadu do společného stopu: Σ |vstup − stop| × objem × hodnota bodu. Stop na špatné straně některého vstupu = null (riziko nejde určit). */
export function ideaRisk(fills:{price:number;qty:number}[],stop:number|null,side:Side,pointValue=1):number|null{
 if(stop===null||!fills.length)return null;
 let s=0;for(const f of fills){if(!(f.qty>0))continue;const d=side==='buy'?f.price-stop:stop-f.price;if(d<=0)return null;s+=d*f.qty*pointValue}
 return r6(s);
}
// ---- seskupení pozic do nápadů
export type GroupInput={tradeId:string;accountId:string;symbol:string;side:Side;openTs:number;scenarioId?:string|null;manualIdea?:string|null};
/**
 * Přiřadí pozice k nápadům (id nápadu pro každý obchod):
 * 1) ruční přiřazení (manualIdea) má přednost;
 * 2) pozice propojené se stejným scénářem a směrem = jeden nápad („sc:<scénář>:<směr>“);
 * 3) ostatní: stejný účet + symbol + směr a otevření do `windowMs` od prvního vstupu nápadu (výchozí 4 h) → připojí se k poslednímu takovému nápadu, jinak nový „auto:<první obchod>“.
 */
export function groupIdeas(list:GroupInput[],windowMs=IDEA_WINDOW_MIN*60000):Record<string,string>{
 const out:Record<string,string>={};
 const groups:{key:string;accountId:string;symbol:string;side:Side;first:number;manual:boolean}[]=[];
 const sorted=[...list].sort((a,b)=>a.openTs-b.openTs||a.tradeId.localeCompare(b.tradeId));
 for(const t of sorted){
  if(t.manualIdea){out[t.tradeId]=t.manualIdea;continue}
  if(t.scenarioId){
   const key='sc:'+t.scenarioId+':'+t.side;out[t.tradeId]=key;
   if(!groups.some(g=>g.key===key))groups.push({key,accountId:t.accountId,symbol:t.symbol,side:t.side,first:t.openTs,manual:false});
   continue;
  }
  const g=[...groups].reverse().find(g=>!g.manual&&g.accountId===t.accountId&&g.symbol===t.symbol&&g.side===t.side&&t.openTs-g.first<=windowMs&&t.openTs>=g.first);
  if(g){out[t.tradeId]=g.key;continue}
  const key='auto:'+t.tradeId;groups.push({key,accountId:t.accountId,symbol:t.symbol,side:t.side,first:t.openTs,manual:false});out[t.tradeId]=key;
 }
 return out;
}
export const parseWindow=(v:unknown):number|string=>{const n=Number(v);if(!Number.isFinite(n)||!Number.isInteger(n))return 'Okno musí být celé číslo minut.';if(n<IDEA_WINDOW_LIMITS.min||n>IDEA_WINDOW_LIMITS.max)return `Okno musí být ${IDEA_WINDOW_LIMITS.min} až ${IDEA_WINDOW_LIMITS.max} minut.`;return n};
// ---- limit rizika nápadu a rezervace čekajících vstupů
export type CapLeg={status:LegStatus;riskPct:number|null};
export type CapState={cap:number|null;filled:number;pending:number;total:number;remaining:number|null;over:boolean};
/** Plánované riziko nápadu: vyplněné vstupy (otevřené i uzavřené) + rezervace čekajících limitních vstupů; zrušené se nepočítají. */
export function capState(capPct:number|null,legs:CapLeg[]):CapState{
 const sum=(s:LegStatus[])=>r6(legs.filter(l=>s.includes(l.status)).reduce((a,l)=>a+(l.riskPct&&l.riskPct>0?l.riskPct:0),0));
 const filled=sum(['open','closed']),pending=sum(['pending']),total=r6(filled+pending);
 return {cap:capPct,filled,pending,total,remaining:capPct===null?null:r6(capPct-total),over:capPct!==null&&total>capPct+EPS};
}
/** Přidání dalšího vstupu: překročil by limit nápadu (otevřené + čekající + nový)? → blocked a text pro uživatele. */
export function checkAddLeg(capPct:number|null,legs:CapLeg[],addPct:number):{ok:boolean;state:CapState;message:string|null}{
 const st=capState(capPct,legs);
 if(capPct===null||!(addPct>0))return {ok:true,state:st,message:null};
 if(st.total+addPct>capPct+EPS)return {ok:false,state:st,message:`Vstup ${fmt(addPct)} % by překročil limit nápadu ${fmt(capPct)} % (už využito ${fmt(st.filled)} %${st.pending?` + čeká ${fmt(st.pending)} %`:''}, zbývá ${fmt(Math.max(0,capPct-st.total))} %).`};
 return {ok:true,state:st,message:null};
}
const fmt=(n:number)=>String(Math.round(n*100)/100).replace('.',',');
// ---- souhrn nápadu
export type IdeaLeg={id:string;tradeId:string|null;status:LegStatus;openTs:number|null;closeTs:number|null;price:number|null;qty:number|null;stop:number|null;riskPct:number|null;riskMoney:number|null;net:number|null;note?:string};
export type IdeaSummary={legs:number;filled:number;avgEntry:number|null;qty:number;stop:number|null;plannedRisk:number|null;net:number;r:number|null;cap:CapState;status:'planned'|'open'|'closed';firstTs:number|null;lastTs:number|null};
/** Souhrn: vážený vstup, společný stop (stop nápadu, jinak stop prvního vstupu), plánované riziko = součet rizik vstupů při otevření, R = čistý výsledek ÷ plánované riziko. */
export function ideaSummary(legs:IdeaLeg[],o:{capPct:number|null;stop:number|null}={capPct:null,stop:null}):IdeaSummary{
 const fills=legs.filter(l=>l.status==='open'||l.status==='closed'),firstStop=[...fills].sort((a,b)=>(a.openTs??0)-(b.openTs??0)).find(l=>l.stop!==null)?.stop??null;
 const risks=fills.map(l=>l.riskMoney??0),plannedRisk=fills.length&&fills.every(l=>l.riskMoney!==null&&l.riskMoney>0)?r2(risks.reduce((a,r)=>a+r,0)):null;
 const net=r2(fills.reduce((a,l)=>a+(l.net??0),0)),closed=fills.length>0&&fills.every(l=>l.status==='closed');
 const ts=fills.flatMap(l=>[l.openTs,l.closeTs]).filter((x):x is number=>x!==null);
 return {legs:legs.length,filled:fills.length,avgEntry:weightedEntry(fills.filter(l=>l.price!==null&&l.qty!==null).map(l=>({price:l.price as number,qty:l.qty as number}))),qty:r6(fills.reduce((a,l)=>a+(l.qty??0),0)),stop:o.stop??firstStop,plannedRisk,net,r:closed&&plannedRisk?r2(net/plannedRisk):null,cap:capState(o.capPct,legs),status:!fills.length?'planned':closed?'closed':'open',firstTs:ts.length?Math.min(...ts):null,lastTs:ts.length?Math.max(...ts):null};
}
export const isIdeaKey=(v:unknown):v is string=>typeof v==='string'&&/^(idea_[a-z0-9]{24}|auto:[\w:.#-]{1,96}|sc:[\w-]{1,40}:(buy|sell))$/.test(v);
