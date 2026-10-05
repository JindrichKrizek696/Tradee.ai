'use client';
import {useState,useRef,useEffect,useId,type ReactNode} from 'react';
import {History} from 'lucide-react';
import {HoverCard,HoverCardTrigger,HoverCardContent} from '@/components/ui/hover-card';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table';
export type AuditRow={at:string;previous:string;value:string;why:string;source?:string};
let pinned:string|null=null;
const observers=new Map<string,(open:boolean)=>void>();
export function Audit({title,rows,children}:{title:string;rows:AuditRow[];children:ReactNode}){const [open,setOpen]=useState(false),id=useId(),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const activate=()=>{if(timer.current)clearTimeout(timer.current);for(const [key,set] of observers)set(key===id);setOpen(true)};
 const show=()=>{if(pinned&&pinned!==id)return;activate()};
 const hide=()=>{if(pinned===id)return;timer.current=setTimeout(()=>setOpen(false),220)};
 const close=()=>{if(pinned===id)pinned=null;if(timer.current)clearTimeout(timer.current);setOpen(false)};
 const pin=()=>{pinned=id;activate()};
 useEffect(()=>{observers.set(id,setOpen);const outside=(e:PointerEvent)=>{if(pinned===id&&e.target instanceof Element&&!e.target.closest(`[data-audit-owner="${id}"]`))close()};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')close()};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{observers.delete(id);if(pinned===id)pinned=null;if(timer.current)clearTimeout(timer.current);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[id]);
 return <HoverCard open={open} onOpenChange={v=>{if(v)show();else if(pinned!==id)setOpen(false)}} openDelay={180} closeDelay={200}><div data-audit-owner={id} className="n-audit" onKeyDown={e=>{if(e.key==='Escape')setOpen(false)}}>{children}<HoverCardTrigger asChild><button type="button" className="n-audit-button" aria-label={'Historie změn · '+title} aria-expanded={open} onClick={pin} onFocus={show} onMouseEnter={show} onMouseLeave={hide}><History size={14}/> Historie změn</button></HoverCardTrigger></div><HoverCardContent data-audit-owner={id} className="n-audit-popover" side="top" align="start" collisionPadding={14} onMouseEnter={show} onMouseLeave={hide}><div className="n-audit-heading"><b>{title} · historie</b><button aria-label="Zavřít historii" onClick={close}>×</button></div>{rows.length?<Table><TableHeader><TableRow><TableHead>Datum / období</TableHead><TableHead>Předtím</TableHead><TableHead>Nová hodnota</TableHead><TableHead>Co se změnilo</TableHead></TableRow></TableHeader><TableBody>{rows.slice(-12).reverse().map((r,i)=><TableRow key={i}><TableCell>{r.at}</TableCell><TableCell>{r.previous}</TableCell><TableCell>{r.value}</TableCell><TableCell>{r.why}{r.source&&<a href={r.source} target="_blank" rel="noreferrer">Zdroj ↗</a>}</TableCell></TableRow>)}</TableBody></Table>:<p>Ověřená historie zatím není dostupná. První záznam vznikne při ověření podkladu.</p>}<small>Jen doložené hodnoty. První pozorování není zpětně domyšlená změna.</small></HoverCardContent></HoverCard>}
