'use client';
import type {JournalTrade} from '@/lib/journal/types';
export type TradeDetailProps={id:string;trade?:JournalTrade;currency:string;allTags:string[];prev:string|null;next:string|null;onOpen:(id:string)=>void;onClose:()=>void;onChanged:()=>void};
export function TradeDetail({id,onClose}:TradeDetailProps){return <div><button type="button" className="j-back" onClick={onClose}>← Deník</button><p className="j-muted">Detail obchodu {id}</p></div>}
