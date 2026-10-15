// Laboratoř · Simulace: týdenní souhrn všech variant A–D i S… ze sweepu (čistá funkce; odesílá scripts/lab-paper-weekly.mjs jen vlastníkovi).
// Týden = posledních 7 dní před now. P&L týdne = equity teď (vč. otevřených) − equity na začátku týdne (poslední snímek ≤ začátek,
// jinak start účtu, když začal až během týdne). Nejlepší / nejhorší = uzavřené během týdne podle R.
import {PAPER_VARIANTS,fmtCzk,fmtPx,signed,type PaperTrade,type PaperEquityPoint,type VariantId,type PaperStats} from './paper.ts';

export type WeeklyVariantIn={id:VariantId;name?:string;started:number|null;startEquity:number;stats:PaperStats;equity:PaperEquityPoint[];
 trades:PaperTrade[];open:(PaperTrade&{mark?:{price:number;r:number;pnlCzk:number}|null})[]};
export type WeeklyVariantOut={id:VariantId;name:string;started:number|null;weekStartEquity:number;equity:number;weekPnl:number;weekPct:number;totalPnl:number;totalPct:number;
 opened:PaperTrade[];closed:PaperTrade[];best:PaperTrade|null;worst:PaperTrade|null;open:WeeklyVariantIn['open']};
export type WeeklySummary={from:number;to:number;variants:WeeklyVariantOut[];pushTitle:string;pushBody:string;subject:string;text:string;html:string;md:string};

const WEEK=7*86400000;
const round=(v:number,d:number)=>{const f=10**d;return Math.round(v*f)/f};
const cz=(v:number,d=0)=>v.toLocaleString('cs-CZ',{maximumFractionDigits:d,minimumFractionDigits:0});
const pct=(v:number)=>signed(v,2)+' %';
const day=(t:number)=>new Date(t).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric'});
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const rTxt=(t:PaperTrade)=>t.r===null?'–':signed(t.r,2)+' R';

export function weeklyVariant(v:WeeklyVariantIn,now:number):WeeklyVariantOut{
 const from=now-WEEK,name=v.name??(PAPER_VARIANTS as Record<string,{name:string}|undefined>)[v.id]?.name??v.id;
 const before=v.equity.filter(p=>p.t<=from).sort((a,b)=>a.t-b.t);
 const weekStartEquity=before.length?before[before.length-1].equity:v.startEquity;
 const eq=v.stats.equity,weekPnl=round(eq-weekStartEquity,2),totalPnl=round(eq-v.startEquity,2);
 const opened=v.trades.filter(t=>t.opened>from&&t.opened<=now).sort((a,b)=>a.opened-b.opened);
 const closed=v.trades.filter(t=>t.closed!==null&&t.closed>from&&t.closed<=now).sort((a,b)=>(a.closed??0)-(b.closed??0));
 const byR=[...closed].sort((a,b)=>(b.r??0)-(a.r??0)||a.id.localeCompare(b.id));
 return {id:v.id,name,started:v.started,weekStartEquity,equity:eq,weekPnl,weekPct:weekStartEquity?round(weekPnl/weekStartEquity*100,2):0,totalPnl,totalPct:round(totalPnl/v.startEquity*100,2),
  opened,closed,best:byR[0]??null,worst:byR.length>1?byR[byR.length-1]:null,open:v.open};
}

export function weeklySummary(input:WeeklyVariantIn[],now:number):WeeklySummary{
 const from=now-WEEK,vs=input.map(v=>weeklyVariant(v,now));
 const range=`${day(from)}–${day(now)}`;
 const short=(v:WeeklyVariantOut)=>v.started===null?`${v.id} –`:`${v.id} ${fmtCzk(v.weekPnl)} (${pct(v.weekPct)})`;
 const pushTitle='Tradee · Simulace za týden';
 const pushBody=vs.map(short).join(' · ').slice(0,180);
 const subject=`Simulace ${range}: `+vs.filter(v=>v.started!==null).map(v=>`${v.id} ${pct(v.weekPct)}`).join(', ');
 const md:string[]=[`### Týdenní souhrn simulace ${range}`,''];
 const text:string[]=[`Týdenní souhrn simulace ${range}`,''];
 const html:string[]=[`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1b2a5a;max-width:640px"><h2 style="font-size:18px;margin:0 0 12px">Simulace 100 000 Kč · týden ${esc(range)}</h2>`,
  '<table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 16px"><tr style="text-align:left;color:#555"><th style="padding:4px 6px">Varianta</th><th style="padding:4px 6px">Týden</th><th style="padding:4px 6px">Od startu</th><th style="padding:4px 6px">Equity</th><th style="padding:4px 6px">Obchody (otevř./zavř.)</th></tr>'];
 const color=(v:number)=>v>0?'#15803d':v<0?'#b91c1c':'#1b2a5a';
 for(const v of vs){
  const head=`${v.id} – ${v.name}`;
  if(v.started===null){md.push(`- **${head}**: ještě neběží.`);text.push(`${head}: ještě neběží.`);html.push(`<tr><td style="padding:4px 6px"><b>${esc(head)}</b></td><td colspan="4" style="padding:4px 6px;color:#777">ještě neběží</td></tr>`);continue}
  const line=`týden ${fmtCzk(v.weekPnl)} (${pct(v.weekPct)}), od startu ${fmtCzk(v.totalPnl)} (${pct(v.totalPct)}), equity ${cz(round(v.equity,0))} Kč; otevřeno ${v.opened.length}, uzavřeno ${v.closed.length}${v.closed.length?' ('+v.closed.map(t=>`${t.instrument} ${rTxt(t)}`).join(', ')+')':''}, teď otevřených ${v.open.length}`;
  md.push(`- **${head}**: ${line}.`);text.push(`${head}: ${line}.`);
  html.push(`<tr style="border-top:1px solid #e5e7eb"><td style="padding:4px 6px"><b>${esc(head)}</b></td><td style="padding:4px 6px;color:${color(v.weekPnl)}">${esc(fmtCzk(v.weekPnl))}<br><small>${esc(pct(v.weekPct))}</small></td><td style="padding:4px 6px;color:${color(v.totalPnl)}">${esc(fmtCzk(v.totalPnl))}<br><small>${esc(pct(v.totalPct))}</small></td><td style="padding:4px 6px">${esc(cz(round(v.equity,0)))} Kč</td><td style="padding:4px 6px">${v.opened.length} / ${v.closed.length}</td></tr>`);
 }
 html.push('</table>');
 for(const v of vs){
  if(v.started===null)continue;
  const sec:string[]=[];
  md.push('',`#### ${v.id} – ${v.name}`);text.push('',`== ${v.id} – ${v.name}`);
  if(v.closed.length){
   const rows=v.closed.map(t=>`${t.instrument} ${t.direction}: ${rTxt(t)}, ${t.pnlCzk===null?'–':fmtCzk(t.pnlCzk)} (${t.exitReason??'?'})`);
   md.push('Uzavřené za týden: '+rows.join('; ')+'.');text.push('Uzavřené za týden: '+rows.join('; ')+'.');
   sec.push(`<p style="margin:4px 0"><b>Uzavřené:</b> ${esc(rows.join('; '))}</p>`);
  }
  if(v.opened.length){const rows=v.opened.map(t=>`${t.instrument} ${t.direction} (${day(t.opened)}, jistota ${t.confidence} %)`);md.push('Otevřené za týden: '+rows.join('; ')+'.');text.push('Otevřené za týden: '+rows.join('; ')+'.');sec.push(`<p style="margin:4px 0"><b>Nově otevřené:</b> ${esc(rows.join('; '))}</p>`)}
  for(const [label,t] of [['Nejlepší',v.best],['Nejhorší',v.worst]] as [string,PaperTrade|null][]){
   if(!t)continue;
   const h=`${label}: ${t.instrument} ${t.direction} ${rTxt(t)} / ${t.pnlCzk===null?'–':fmtCzk(t.pnlCzk)}`;
   md.push(`${h}. Proč: ${t.why.replace(/\n/g,' ')}`);text.push(h,'Proč: '+t.why.replace(/\n/g,' '));
   sec.push(`<p style="margin:8px 0 2px"><b>${esc(h)}</b></p><p style="margin:0;white-space:pre-wrap;color:#444;font-size:13px">${esc(t.why)}</p>`);
  }
  if(v.open.length){
   const rows=v.open.map(t=>`${t.instrument} ${t.direction} od ${fmtPx(t.entry)}${t.mark?` → ${signed(t.mark.r,2)} R / ${fmtCzk(t.mark.pnlCzk)}`:''}`);
   md.push('Otevřené pozice: '+rows.join('; ')+'.');text.push('Otevřené pozice: '+rows.join('; ')+'.');sec.push(`<p style="margin:4px 0"><b>Otevřené pozice:</b> ${esc(rows.join('; '))}</p>`);
  }else{md.push('Otevřené pozice: žádné.');text.push('Otevřené pozice: žádné.')}
  if(!v.closed.length&&!v.opened.length){md.push('Za týden žádný nový ani uzavřený obchod.');text.push('Za týden žádný nový ani uzavřený obchod.')}
  html.push(`<h3 style="font-size:15px;margin:16px 0 4px">${esc(v.id+' – '+v.name)}</h3>`+(sec.join('')||'<p style="margin:4px 0;color:#777">Za týden žádný obchod, žádné otevřené pozice.</p>'));
 }
 html.push('<p style="font-size:12px;color:#777;margin-top:16px">Virtuální účty (paper trading), P&amp;L = R × riziko. Podrobnosti v Tradee → Laboratoř → Simulace.</p></div>');
 return {from,to:now,variants:vs,pushTitle,pushBody,subject,text:text.join('\n'),html:html.join(''),md:md.join('\n')};
}
