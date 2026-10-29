'use client';
// Kalkulačka velikosti pozice (lib/risk/size.ts): stránka /kalkulacka, okno v Deníku a později formulář scénáře.
// Exportovaná komponenta – vstupy jdou předvyplnit (trh z grafu, vstup, stop, cíl) a onResult vrací výsledek volajícímu.
import {useEffect,useMemo,useState} from 'react';
import {Info,TriangleAlert} from 'lucide-react';
import {positionSize,RISK_MODE_LABELS,type RiskMode,type SizeResult,type RateFn} from '@/lib/risk/size';
import {defaultInstrumentFor,KIND_LABELS as INST_KIND,type Instrument,type Spec} from '@/lib/risk/instruments';
import {KIND_LABELS} from '@/lib/risk/account';
import {useRisk,activeProfiles,rateOf,specOf,useProfilePref,writeProfilePref,defaultRiskPct} from './risk-context';
import {RiskStatus} from './account-risk';
import '../mt.css';
import './risk.css';
export type CalcInitial={market?:string;instrument?:string;entry?:number;stop?:number;target?:number};
/** Pevný účet a instrument (replay): bez výběru profilu a instrumentu, zůstatek / zbývající limity a kurz dodá volající. */
export type CalcFixed={name:string;currency:string;balance:number;remainingDD:number|null;remainingDaily:number|null;maxRiskPct:number|null;spec:Spec;rate:RateFn};
export type CalcCtx={profileId:string;instrumentId:string;entry:number;stop:number;target:number|null};
const num=(s:string)=>{const n=Number(s.replace(/\s/g,'').replace(',','.'));return s.trim()&&Number.isFinite(n)?n:NaN};
const f=(n:number,max=2)=>n.toLocaleString('cs-CZ',{maximumFractionDigits:max});
const str=(n:number|undefined)=>n===undefined||!Number.isFinite(n)?'':String(n);
export function PositionCalculator({initial,onResult,title=true,fixed}:{initial?:CalcInitial;onResult?:(r:SizeResult|null,ctx:CalcCtx)=>void;title?:boolean;fixed?:CalcFixed}){
 const {data,error}=useRisk(!fixed),profiles=activeProfiles(data),pref=useProfilePref();
 const profile=fixed?null:profiles.find(p=>p.id===pref)||null;
 const [inst,setInst]=useState(fixed?.spec.id||initial?.instrument||''),[entry,setEntry]=useState(str(initial?.entry)),[stop,setStop]=useState(str(initial?.stop)),[target,setTarget]=useState(str(initial?.target));
 const [mode,setMode]=useState<RiskMode>('pct'),[rawValue,setValue]=useState<string|null>(null),[bal,setBal]=useState(''),[ccy,setCcy]=useState('USD');
 // výchozí instrument podle trhu, jakmile jsou data
 useEffect(()=>{if(!inst&&data){const d=initial?.market?defaultInstrumentFor(data.instruments,initial.market):null;setInst(d?.id||'EURUSD')}},[data,inst,initial?.market]);
 const value=rawValue??(mode==='fixed'?'':String(fixed?fixed.maxRiskPct??1:defaultRiskPct(profile)));
 const spec=useMemo(()=>fixed?fixed.spec:inst?specOf(data,profile?.id||null,inst):null,[fixed,data,profile,inst]);
 const accCcy=fixed?.currency||profile?.currency||ccy,balance=fixed?fixed.balance:profile?profile.status?.balance??profile.balance??profile.startBalance:num(bal);
 const result=useMemo(()=>spec?positionSize({spec,entry:num(entry),stop:num(stop),target:Number.isFinite(num(target))?num(target):null,accountCcy:accCcy,balance:Number.isFinite(balance)?balance:null,mode,value:num(value),remainingDD:fixed?fixed.remainingDD:profile?.status?.drawdown?.remaining??null,remainingDaily:fixed?fixed.remainingDaily:profile?.status?.daily?.remaining??null,rate:fixed?fixed.rate:rateOf(data)}):null,[spec,entry,stop,target,accCcy,balance,mode,value,profile,data,fixed]);
 useEffect(()=>{onResult?.(result,{profileId:profile?.id||'',instrumentId:inst,entry:num(entry),stop:num(stop),target:Number.isFinite(num(target))?num(target):null})},[result,profile,inst,onResult,entry,stop,target]);
 const groups=useMemo(()=>{const g=new Map<string,Instrument[]>();for(const i of data?.instruments||[]){const k=INST_KIND[i.kind];(g.get(k)||g.set(k,[]).get(k)!).push(i)}return [...g]},[data]);
 const unitWord=(u:string)=>u==='lot'?'loty':u==='kontrakt'?'kontrakty':'kusy';
 if(!data&&!fixed)return <div className="pc">{error?<p className="mt-alert" role="alert">{error}</p>:<p className="rk-muted">Načítám účty a instrumenty…</p>}</div>;
 return <div className="pc">
  {title&&<h2 className="pc-title">Kalkulačka pozice</h2>}
  {fixed?<p className="pc-spec">Účet <b>{fixed.name}</b> · zůstatek {f(fixed.balance)} {fixed.currency}{fixed.remainingDaily!==null?` · zbývá denní ztráta ${f(fixed.remainingDaily)}`:''}{fixed.remainingDD!==null?` · zbývá drawdown ${f(fixed.remainingDD)}`:''} · {fixed.spec.id}</p>:<div className="pc-grid">
   <label className="pc-field"><span>Účet</span><select value={profile?.id||''} onChange={e=>{writeProfilePref(e.target.value);setValue(null)}}>
    <option value="">Bez profilu (zadám zůstatek)</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {KIND_LABELS[p.kind]} · {p.currency}</option>)}</select></label>
   {!profile&&data&&<><label className="pc-field"><span>Zůstatek</span><input inputMode="decimal" value={bal} onChange={e=>setBal(e.target.value)} placeholder="10 000"/></label>
    <label className="pc-field pc-narrow"><span>Měna</span><select value={ccy} onChange={e=>setCcy(e.target.value)}>{(data?.currencies||[]).map(c=><option key={c}>{c}</option>)}</select></label></>}
   <label className="pc-field"><span>Instrument</span><select value={inst} onChange={e=>setInst(e.target.value)}>{groups.map(([k,list])=><optgroup key={k} label={k}>{list.map(i=><option key={i.id} value={i.id}>{i.name===i.id?i.id:`${i.id} – ${i.name}`}</option>)}</optgroup>)}</select></label>
  </div>}
  {profile&&<RiskStatus profile={profile} compact/>}
  <div className="pc-grid">
   <label className="pc-field"><span>Vstup</span><input inputMode="decimal" value={entry} onChange={e=>setEntry(e.target.value)}/></label>
   <label className="pc-field"><span>Stop loss</span><input inputMode="decimal" value={stop} onChange={e=>setStop(e.target.value)}/></label>
   <label className="pc-field"><span>Cíl <small>(volitelné)</small></span><input inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)}/></label>
  </div>
  <div className="pc-grid">
   <div className="pc-field pc-wide"><span>Riziko</span><div className="mt-chips" role="radiogroup" aria-label="Způsob rizika">{(Object.keys(RISK_MODE_LABELS) as RiskMode[]).map(m=><button key={m} type="button" role="radio" aria-checked={mode===m} className={mode===m?'active':''} onClick={()=>{setMode(m);setValue(null)}}>{RISK_MODE_LABELS[m]}</button>)}</div></div>
   <label className="pc-field pc-narrow"><span>{mode==='fixed'?accCcy:'%'}</span><input inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} aria-label="Hodnota rizika"/></label>
  </div>
  {spec&&<p className="pc-spec">Tick {f(spec.tickSize,6)} = {f(spec.tickValue,6)} {spec.quote} za {spec.unit==='lot'?'lot':spec.unit==='kontrakt'?'kontrakt':'kus'} · krok {f(spec.lotStep,4)}, minimum {f(spec.minLot,4)}{spec.commission||spec.spread?` · náklady: komise ${f(spec.commission)} ${spec.quote}, spread ${f(spec.spread,6)}`:''}{spec.overridden.length?' · upraveno pro účet':''}{profile&&<> · <a href={'/ucty#'+profile.id}>upravit pro broker</a></>}</p>}
  {spec?.proxy&&<p className="pc-note"><Info size={14}/> Cena v Tradee je z {spec.dataSymbol} (jiný instrument než {spec.id}) – vstup a stop zadej podle platformy brokera.</p>}
  {result&&(result.ok?<div className="pc-out" aria-live="polite">
   <div className="pc-big"><b>{f(result.units,4)}</b> {unitWord(result.unit)}<span>riziko {f(result.moneyAtRisk)} {accCcy} vč. nákladů</span></div>
   <dl className="pc-dl">
    <div><dt>Rozpočet rizika</dt><dd>{f(result.budget)} {accCcy}</dd></div>
    <div><dt>Ztráta do SL / {result.unit==='lot'?'lot':result.unit==='kontrakt'?'kontrakt':'kus'}</dt><dd>{f(result.lossPerUnit)} {accCcy}</dd></div>
    <div><dt>Náklady / {result.unit==='lot'?'lot':result.unit==='kontrakt'?'kontrakt':'kus'}</dt><dd>{f(result.costPerUnit)} {accCcy}</dd></div>
    <div><dt>Stop</dt><dd>{f(result.stopTicks,2)} ticků</dd></div>
    <div><dt>Hodnota ticku</dt><dd>{f(result.tickValueAcc,4)} {accCcy}</dd></div>
    {result.pipValueAcc!==null&&<div><dt>Hodnota pipu</dt><dd>{f(result.pipValueAcc)} {accCcy}</dd></div>}
    <div><dt>R:R</dt><dd>{result.rr===null?'–':f(result.rr)}</dd></div>
    {result.reward!==null&&<div><dt>Zisk v cíli</dt><dd>{f(result.reward)} {accCcy}</dd></div>}
    {result.rate!==1&&<div><dt>Kurz {spec?.quote} → {accCcy}</dt><dd>{f(result.rate,6)}</dd></div>}
   </dl>
   {result.warnings.map(w=><p key={w} className="pc-warn"><TriangleAlert size={14}/> {w}</p>)}
  </div>:<p className={'pc-err'+(result.code==='input'?' soft':'')} role="status">{result.reason}</p>)}
 </div>;
}
