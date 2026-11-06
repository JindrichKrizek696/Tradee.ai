'use client';
// Laboratoř · odznak rodiny simulovaného účtu, jméno (velké) + id varianty (malé) a legenda rodin (lib/lab/sim-labels.ts).
import {SIM_FAMILIES,type SimLabel,type SimFamily} from '@/lib/lab/sim-labels';
import './sim-badge.css';
export function FamBadge({l,sm}:{l:Pick<SimLabel,'cls'|'familyLabel'>;sm?:boolean}){return <span className={'lb-fam '+l.cls+(sm?' sm':'')}>{l.familyLabel}</span>}
// jméno velké, pod ním id varianty malé, odznak rodiny, u R… verze, zdroj a směr
export function SimName({l,extra}:{l:SimLabel;extra?:React.ReactNode}){
 return <span className="lb-sim"><span className="lb-sim-name">{l.title}{l.version!==null?<small className="lb-sim-id"> v{l.version}</small>:null}</span>
  <span className="lb-sim-meta"><span className="lb-sim-id">{l.id}</span><FamBadge l={l} sm/>{l.family==='rule'&&<span className="lb-sim-src">zdroj: {l.source??'bez zdroje'}</span>}{l.direction&&<span>{l.direction}</span>}{extra}</span></span>;
}
export function FamLegend({only}:{only?:SimFamily[]}){
 return <div className="lb-legend" aria-label="Legenda rodin simulací">{SIM_FAMILIES.filter(f=>!only||only.includes(f.id)).map(f=><span key={f.id} title={f.hint}><span className={'lb-fam '+f.cls}>{f.label}</span> <small>{f.range}</small></span>)}</div>;
}
