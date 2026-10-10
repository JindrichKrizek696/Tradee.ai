'use client';
// Editor pravidel strategie: skládačka vstupních podmínek, směr, výstup (SL / TP / časový limit) a náklady.
import {Plus,X,ArrowUp,ArrowDown,Database} from 'lucide-react';
import {CONDITION_LABELS,DATA_CONDITIONS,DEFAULT_CONDITIONS,DEFAULT_SPREADS,SPREAD_LABELS,SPREAD_UNIT,instrumentSpec,type Condition,type ConditionType,type StrategyRules,type SpreadGroup,type SlType,type TpType} from '@/lib/backtest/rules';
import {SESSIONS,WEEKDAYS} from '@/lib/journal/analytics';
import {fmtNum} from '@/lib/journal/format';
import {NumInput} from './shared';
const MAX_CONDITIONS=20;
const GROUPS:[string,ConditionType[]][]=[['Cena a indikátory',['ma','ma_cross','breakout','ma_distance','rsi','change','atr']],['Čas',['session','weekday','hour']],['Data Tradee',['score','strength','cot','no_news']]];
const HELP:Record<ConditionType,string>={
 score:'Skóre trhu z Tradee (−100 až +100). Historie skóre je zatím krátká – mimo ni podmínka neplatí.',
 strength:'Síla základní měny minus síla kotované. Jen pro FX páry.',
 cot:'Netto pozice spekulantů z COT reportu, platí od dne zveřejnění. Jen pro FX.',
 ma:'Zavírací cena nad / pod klouzavým průměrem.',
 ma_cross:'Rychlá MA překříží pomalou právě na této svíčce.',
 breakout:'Close nad maximem / pod minimem předchozích N svíček (bez aktuální).',
 ma_distance:'(close − MA) / ATR(14) se znaménkem: + nad MA, − pod MA. Např. „< 1“ = nejvýš 1 ATR nad MA.',
 rsi:'RSI s Wilderovým vyhlazením; překřížení = přechod přes hodnotu na této svíčce.',
 change:'Změna zavírací ceny za posledních N svíček v %.',
 atr:'Volatilita: ATR(14) vůči k × průměru ATR(14) za N svíček.',
 session:'Seance podle pražského času vstupu.',
 weekday:'Den v týdnu podle pražského data vstupu.',
 hour:'Pražská hodina vstupu, od včetně, do vyjma. Od > do = přes půlnoc.',
 no_news:'Žádná zpráva se signálem ≥ s v měnách trhu ±N minut kolem vstupu. Kalendář má krátkou historii – dřív podmínka neplatí.'};
const SL_TYPES:[SlType,string][]=[['atr','× ATR(14)'],['pips','bodů'],['pct','% ceny']];
const TP_TYPES:[TpType,string][]=[['r','násobek R'],['pips','bodů'],['pct','% ceny'],['signal','když podmínky přestanou platit'],['none','žádný']];
const UNIT={pips:'pip',points:'bod',pct:'%'} as const;
function Sel<T extends string|number>({label,value,options,onChange}:{label:string;value:T;options:[T,string][];onChange:(v:T)=>void}){
 return <label className="bt-f"><span>{label}</span><select value={String(value)} onChange={e=>{const o=options.find(x=>String(x[0])===e.target.value);if(o)onChange(o[0])}}>{options.map(([v,l])=><option key={String(v)} value={String(v)}>{l}</option>)}</select></label>;
}
function Num({label,value,onChange,min,max,suffix}:{label:string;value:number;onChange:(v:number)=>void;min?:number;max?:number;suffix?:string}){
 return <label className="bt-f"><span>{label}</span><span className="bt-unit"><NumInput label={label} value={value} min={min} max={max} onChange={v=>{if(v!==null)onChange(v)}}/>{suffix&&<em>{suffix}</em>}</span></label>;
}
function Chips<T extends string|number>({label,options,value,onChange}:{label:string;options:[T,string][];value:T[];onChange:(v:T[])=>void}){
 return <div className="bt-f wide" role="group" aria-label={label}><span>{label}</span><div className="jg-chips">{options.map(([v,l])=>{const on=value.includes(v);return <button key={String(v)} type="button" className={on?'on':''} aria-pressed={on} onClick={()=>onChange(on?value.filter(x=>x!==v):options.map(o=>o[0]).filter(x=>x===v||value.includes(x)))}>{l}</button>})}</div></div>;
}
const KIND:['sma'|'ema',string][]=[['sma','SMA'],['ema','EMA']],CMP:['>'|'<',string][]=[['>','větší než'],['<','menší než']];
// parametry jedné podmínky podle typu
function Params({c,set}:{c:Condition;set:(c:Condition)=>void}){
 switch(c.type){
  case 'score':return <><Sel label="Skóre" value={c.op} options={[['>','je nad'],['<','je pod'],['rising','roste'],['falling','klesá']]} onChange={op=>set({...c,op})}/>{c.op==='rising'||c.op==='falling'?<Num label="Za dní" value={c.days} min={1} max={365} onChange={days=>set({...c,days})}/>:<Num label="Hodnota" value={c.value} min={-100} max={100} onChange={value=>set({...c,value})}/>}</>;
  case 'strength':return <><Sel label="Rozdíl síly" value={c.op} options={CMP} onChange={op=>set({...c,op})}/><Num label="Hodnota" value={c.value} min={-1000} max={1000} onChange={value=>set({...c,value})}/></>;
  case 'cot':return <><Sel label="Spekulanti" value={c.op} options={[['long','netto long'],['short','netto short'],['>','týdenní změna nad'],['<','týdenní změna pod']]} onChange={op=>set({...c,op})}/>{(c.op==='>'||c.op==='<')&&<Num label="Kontraktů" value={c.value} onChange={value=>set({...c,value})}/>}</>;
  case 'ma':return <><Sel label="Cena" value={c.op} options={[['above','nad'],['below','pod']]} onChange={op=>set({...c,op})}/><Sel label="Průměr" value={c.kind} options={KIND} onChange={kind=>set({...c,kind})}/><Num label="Perioda" value={c.period} min={1} max={1000} onChange={period=>set({...c,period})}/></>;
  case 'ma_cross':return <><Sel label="Průměr" value={c.kind} options={KIND} onChange={kind=>set({...c,kind})}/><Num label="Rychlá" value={c.fast} min={1} max={1000} onChange={fast=>set({...c,fast})}/><Num label="Pomalá" value={c.slow} min={2} max={1000} onChange={slow=>set({...c,slow})}/><Sel label="Směr" value={c.dir} options={[['up','zespodu nahoru'],['down','shora dolů']]} onChange={dir=>set({...c,dir})}/></>;
  case 'breakout':return <><Sel label="Close" value={c.dir} options={[['up','nad maximem'],['down','pod minimem']]} onChange={dir=>set({...c,dir})}/><Num label="Svíček" value={c.period} min={1} max={1000} onChange={period=>set({...c,period})}/></>;
  case 'ma_distance':return <><Sel label="Průměr" value={c.kind} options={KIND} onChange={kind=>set({...c,kind})}/><Num label="Perioda" value={c.period} min={1} max={1000} onChange={period=>set({...c,period})}/><Sel label="Vzdálenost" value={c.op} options={CMP} onChange={op=>set({...c,op})}/><Num label="ATR" value={c.value} min={-100} max={100} suffix="× ATR" onChange={value=>set({...c,value})}/></>;
  case 'rsi':return <><Num label="Perioda" value={c.period} min={2} max={200} onChange={period=>set({...c,period})}/><Sel label="RSI" value={c.op} options={[['>','je nad'],['<','je pod'],['cross_up','překříží nahoru'],['cross_down','překříží dolů']]} onChange={op=>set({...c,op})}/><Num label="Hodnota" value={c.value} min={0} max={100} onChange={value=>set({...c,value})}/></>;
  case 'change':return <><Num label="Za svíček" value={c.bars} min={1} max={1000} onChange={bars=>set({...c,bars})}/><Sel label="Změna" value={c.op} options={CMP} onChange={op=>set({...c,op})}/><Num label="Hodnota" value={c.value} min={-100} max={1000} suffix="%" onChange={value=>set({...c,value})}/></>;
  case 'atr':return <><Sel label="ATR(14)" value={c.op} options={[['above','nad'],['below','pod']]} onChange={op=>set({...c,op})}/><Num label="Násobek k" value={c.k} min={0.1} max={10} suffix="×" onChange={k=>set({...c,k})}/><Num label="Průměr za svíček" value={c.period} min={2} max={1000} onChange={period=>set({...c,period})}/></>;
  case 'session':return <Chips label="Seance" options={SESSIONS.map(s=>[s.key,s.label] as [typeof s.key,string])} value={c.sessions} onChange={sessions=>set({...c,sessions})}/>;
  case 'weekday':return <Chips label="Dny" options={WEEKDAYS.map((d,i)=>[i,d] as [number,string])} value={c.days} onChange={days=>set({...c,days})}/>;
  case 'hour':return <><Num label="Od hodiny" value={c.from} min={0} max={23} onChange={from=>set({...c,from:Math.round(from)})}/><Num label="Do hodiny" value={c.to} min={0} max={24} onChange={to=>set({...c,to:Math.round(to)})}/></>;
  case 'no_news':return <><Num label="± minut" value={c.minutes} min={0} max={1440} onChange={minutes=>set({...c,minutes:Math.round(minutes)})}/><Sel label="Signál zprávy" value={c.minSignal} options={[[1,'≥ 1'],[2,'≥ 2'],[3,'3 (vysoký)']]} onChange={minSignal=>set({...c,minSignal})}/></>;
 }
}
export function RuleEditor({rules,onChange,markets,issues}:{rules:StrategyRules;onChange:(r:StrategyRules)=>void;markets:string[];issues:string[]}){
 const setEntry=(entry:Condition[])=>onChange({...rules,entry}),ex=rules.exit;
 const add=(t:ConditionType)=>setEntry([...rules.entry,structuredClone(DEFAULT_CONDITIONS[t]) as Condition]);
 const move=(i:number,d:number)=>{const j=i+d,a=[...rules.entry];if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];setEntry(a)};
 const groups=[...new Set(markets.map(m=>instrumentSpec(m).group))] as SpreadGroup[],tpNum=ex.tp.type==='r'||ex.tp.type==='pips'||ex.tp.type==='pct';
 const fx=markets.length>0&&markets.every(m=>/^[A-Z]{3}\/[A-Z]{3}$/.test(m));
 return <div className="bt-rules">
  <section className="bt-sec"><h3>Vstup <small>všechny podmínky musí platit zároveň · vyhodnocení na zavření svíčky, vstup na otevření další</small></h3>
   {!rules.entry.length&&<p className="j-muted">Zatím žádná podmínka. Přidej první níže.</p>}
   <ol className="bt-conds">{rules.entry.map((c,i)=><li key={i} className="bt-cond">
    <div className="bt-chead"><b>{CONDITION_LABELS[c.type]}</b>{DATA_CONDITIONS.includes(c.type)&&<span className="bt-badge" title="Používá historická data Tradee, která nemusí pokrýt celé období"><Database size={11}/> data Tradee</span>}
     {(c.type==='strength'||c.type==='cot')&&markets.length>0&&!fx&&<span className="bt-badge warn">jen FX páry</span>}
     <span className="bt-cact"><button type="button" className="bt-icon" aria-label="Posunout nahoru" disabled={i===0} onClick={()=>move(i,-1)}><ArrowUp size={14}/></button><button type="button" className="bt-icon" aria-label="Posunout dolů" disabled={i===rules.entry.length-1} onClick={()=>move(i,1)}><ArrowDown size={14}/></button><button type="button" className="bt-icon" aria-label={'Odebrat podmínku '+CONDITION_LABELS[c.type]} onClick={()=>setEntry(rules.entry.filter((_,k)=>k!==i))}><X size={14}/></button></span></div>
    <div className="bt-params"><Params c={c} set={n=>setEntry(rules.entry.map((x,k)=>k===i?n:x))}/></div>
    <p className="bt-help">{HELP[c.type]}</p>
   </li>)}</ol>
   <label className="bt-add"><Plus size={14}/><select value="" disabled={rules.entry.length>=MAX_CONDITIONS} aria-label="Přidat podmínku" onChange={e=>{if(e.target.value)add(e.target.value as ConditionType)}}>
    <option value="">{rules.entry.length>=MAX_CONDITIONS?`Nejvýš ${MAX_CONDITIONS} podmínek`:'Přidat podmínku…'}</option>
    {GROUPS.map(([g,ts])=><optgroup key={g} label={g}>{ts.map(t=><option key={t} value={t}>{CONDITION_LABELS[t]}</option>)}</optgroup>)}
   </select></label>
  </section>
  <section className="bt-sec"><h3>Směr</h3>
   <div className="jg-seg" role="radiogroup" aria-label="Směr obchodu">{([['long','Long'],['short','Short'],['score','Podle skóre']] as const).map(([k,l])=><button key={k} type="button" role="radio" aria-checked={rules.direction===k} className={rules.direction===k?'on':''} onClick={()=>onChange({...rules,direction:k})}>{l}</button>)}</div>
   {rules.direction==='score'&&<p className="bt-help">Kladné skóre Tradee = long, záporné = short. Bez skóre se neobchoduje (historie skóre je krátká).</p>}
  </section>
  <section className="bt-sec"><h3>Výstup</h3>
   <div className="bt-params">
    <Num label="Stop loss" value={ex.sl.value} min={0.0001} onChange={value=>onChange({...rules,exit:{...ex,sl:{...ex.sl,value}}})}/>
    <Sel label="SL v" value={ex.sl.type} options={SL_TYPES} onChange={type=>onChange({...rules,exit:{...ex,sl:{type,value:type===ex.sl.type?ex.sl.value:type==='atr'?1.5:type==='pct'?1:20}}})}/>
    <Sel label="Take profit" value={ex.tp.type} options={TP_TYPES} onChange={type=>onChange({...rules,exit:{...ex,tp:{type,value:type==='r'?2:type==='pct'?2:type==='pips'?40:0}}})}/>
    {tpNum&&<Num label={ex.tp.type==='r'?'TP (R)':'TP hodnota'} value={ex.tp.value} min={0} suffix={ex.tp.type==='r'?'R':ex.tp.type==='pct'?'%':'bodů'} onChange={value=>onChange({...rules,exit:{...ex,tp:{...ex.tp,value}}})}/>}
    <label className="bt-f"><span>Časový limit</span><span className="bt-unit"><NumInput label="Časový limit ve svíčkách" value={ex.maxBars} min={1} max={100000} allowEmpty wide placeholder="bez limitu" onChange={v=>onChange({...rules,exit:{...ex,maxBars:v===null?null:Math.round(v)}})}/><em>svíček</em></span></label>
   </div>
   <p className="bt-help">SL i TP se počítají od otevření vstupní svíčky. Když svíčka zasáhne SL i TP, počítá se SL; gap přes úroveň = výstup na open. R = násobek vzdálenosti SL.</p>
  </section>
  <section className="bt-sec"><h3>Náklady</h3>
   <div className="bt-params">
    <Num label="Komise" value={rules.costs.commissionPct} min={0} max={1000} suffix="% rizika" onChange={commissionPct=>onChange({...rules,costs:{...rules.costs,commissionPct}})}/>
    {groups.map(g=><label key={g} className="bt-f"><span>Spread · {SPREAD_LABELS[g]}</span><span className="bt-unit"><NumInput label={'Spread '+SPREAD_LABELS[g]} value={rules.costs.spread[g]??null} min={0} allowEmpty wide placeholder={'výchozí '+fmtNum(DEFAULT_SPREADS[g],2)} onChange={v=>{const spread={...rules.costs.spread};if(v===null)delete spread[g];else spread[g]=v;onChange({...rules,costs:{...rules.costs,spread}})}}/><em>{UNIT[SPREAD_UNIT[g]]}</em></span></label>)}
   </div>
   <p className="bt-help">Komise v % rizika na obchod (5 % = −0,05 R). Spread se odečte v ceně – polovina na vstupu, polovina na výstupu. Prázdné pole = výchozí spread pro typ trhu{groups.length?'':' (vyber trhy v nastavení běhu)'}. Swap se nepočítá.</p>
  </section>
  {issues.length>0&&<ul className="bt-issues" role="alert">{issues.map((x,i)=><li key={i}>{x}</li>)}</ul>}
 </div>;
}
