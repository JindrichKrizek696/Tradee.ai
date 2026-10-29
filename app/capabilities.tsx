'use client';
// Proč funkce u trhu nejde: CapabilityNotice (jedna funkce na místě, kde chybí), CapabilitiesPanel (přehled v detailu trhu)
// a ProviderNotice (změna poskytovatele dat). Logika v lib/capabilities.ts (registr instrumentů + identita trhu).
import {CircleCheck,CircleSlash,CircleDashed,Info} from 'lucide-react';
import {resolveCapabilities,capabilityFor,activeChanges,REASON_LABELS,type Feature,type Capability,type ProviderChange} from '@/lib/capabilities';
import changes from '@/data/provider-changes.json';
import './capabilities.css';
const ICON={ok:CircleCheck,partial:CircleDashed,off:CircleSlash};
const STATUS={ok:'dostupné',partial:'omezeně',off:'nedostupné'};
/** Na místě vypnuté funkce: „COT report – nedostupné u USD/CZK: Bez COT. Koruna nemá…“. Dostupná funkce nic nevykreslí. */
export function CapabilityNotice({market,name,feature,now,className}:{market:string;name?:string;feature:Feature;now?:number;className?:string}){
 const c=capabilityFor(market,feature,{now});if(c.status==='ok')return null;
 const Icon=ICON[c.status];
 return <section className={'cap-note '+c.status+(className?' '+className:'')} role="note" aria-label={`${c.label} u ${name||market}: ${STATUS[c.status]}`}>
  <Icon size={18} aria-hidden="true"/><div><b>{c.label} {c.status==='partial'?'jen omezeně':'tu není'}{name||market?` · ${name||market}`:''}</b>{c.reason&&<span className="cap-reason">{REASON_LABELS[c.reason]}</span>}<p>{c.text}</p></div>
 </section>;
}
function Row({c}:{c:Capability}){const Icon=ICON[c.status];
 return <li className={'cap-row '+c.status}><Icon size={16} aria-hidden="true"/><span className="cap-name">{c.label}</span><span className="sr-only">: {STATUS[c.status]}.</span>{c.reason&&<span className="cap-reason">{REASON_LABELS[c.reason]}</span>}<span className="cap-text">{c.text}</span></li>}
/** Přehled „Co Tradee u trhu umí“ – rozbalovací, ať nezabírá místo. */
export function CapabilitiesPanel({market,name,now}:{market:string;name?:string;now?:number}){
 const list=resolveCapabilities(market,{now}),off=list.filter(c=>c.status!=='ok').length;
 return <details className="s-card cap-panel"><summary><Info size={15} aria-hidden="true"/> Co Tradee u {name||market} umí <small>{off?`${list.length-off} z ${list.length} funkcí plně · u ${off} vysvětlení proč ne`:'všechny funkce dostupné'}</small></summary>
  <ul>{list.map(c=><Row key={c.feature} c={c}/>)}</ul>
 </details>;
}
/** Oznámení o změně poskytovatele dat (data/provider-changes.json); bez aktivní změny nic. */
export function ProviderNotice({market,now}:{market:string;now:number}){
 const list=activeChanges(market,changes as ProviderChange[],now);if(!list.length)return null;
 return <>{list.map(c=><p key={c.id} className="cap-provider" role="status"><Info size={15} aria-hidden="true"/><span><b>Změna zdroje dat: {c.from} → {c.to}</b> (od {new Date(c.since+'T12:00:00Z').toLocaleDateString('cs-CZ')}). {c.text}</span></p>)}</>;
}
