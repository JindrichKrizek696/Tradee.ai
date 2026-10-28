'use client';
// Odznak „zdroj dat“: odkud je cena trhu (poskytovatel, symbol, typ spot/futures/index/CFD, zpoždění). Tooltip = title + aria-label.
// Smysl: zlato v Tradee je COMEX futures GC=F, ne spot XAUUSD od brokera; Nasdaq 100 je index ^NDX, ne NQ ani US100.
import {Database} from 'lucide-react';
import {dataSource,sourceBadgeText,sourceTooltip} from '@/lib/instrument-info';
import './data-source.css';
export function DataSourceBadge({id,compact,className}:{id:string;compact?:boolean;className?:string}){
 const s=dataSource(id);if(!s)return null;
 const text=compact?'Data: '+s.short:sourceBadgeText(id),tip=sourceTooltip(id),warn=s.type==='futures'||s.type==='index';
 return <span className={'ds-badge'+(warn?' ds-warn':'')+(className?' '+className:'')} title={tip} tabIndex={0} role="note" aria-label={text+'. '+tip.replace(/\n/g,'. ')}><Database size={12} aria-hidden/><span>{text}</span></span>;
}
