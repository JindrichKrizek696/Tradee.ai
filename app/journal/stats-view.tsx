'use client';
import type {JournalTrade} from '@/lib/journal/types';
export function StatsView({trades}:{trades:JournalTrade[];currency:string}){return <p className="j-muted">{trades.length} obchodů</p>}
