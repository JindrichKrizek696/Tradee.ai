// Zprávy z kalendáře (auto + ověřené) pro no-trade okna; načtené jednou za běh workeru.
import calendarAuto from '../../data/calendar.json';
import fundamentals from '../../data/fundamentals.json';
import type {AutoEvent,CuratedEvent} from '../calendar.ts';
import {impactNews,type ImpactEvent} from './news-window.ts';
let cache:ImpactEvent[]|null=null;
export const allImpactNews=()=>cache??=impactNews(calendarAuto.events as AutoEvent[],fundamentals.events as CuratedEvent[],fundamentals.sources as Record<string,{url?:string}>);
