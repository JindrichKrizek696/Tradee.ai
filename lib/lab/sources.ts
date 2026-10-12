// Laboratoř · zdroje COT a skóre pro studii i tester (lab_cot, jinak záloha z JSON; skóre z score_snapshots + score-history.json).
import type {Db} from '../mysql.ts';
import {loadCot,cotFromMarketJson,loadScoreSnaps} from './store.ts';
import {isMissingLabTable} from './core.ts';
import type {CotSource,ScoreSnap} from './study.ts';
import history from '../../data/score-history.json';
import scoreMarket from '../../data/score-market.json';
import expanded from '../../data/expanded-market.json';
type Hist={snapshots:{at:string;scores:Record<string,{score:number|null;method?:string}|undefined>}[]};
export async function cotSource(d:Db):Promise<{cot:CotSource;note:string}>{
 try{const c=await loadCot(d);if(Object.keys(c).length)return {cot:c,note:'COT: historie z lab_cot (CFTC od 2006).'}}
 catch(e){if(!isMissingLabTable(e))throw e}
 return {cot:cotFromMarketJson(scoreMarket as never,(expanded as unknown as {legacy?:never}).legacy),note:'COT: jen posledních ~56 týdnů z JSON – pro celou historii spusť scripts/lab-cot-history.mjs.'};
}
export const scoreSnaps=(d:Db,markets:string[]):Promise<ScoreSnap[]>=>loadScoreSnaps(d,markets,history as unknown as Hist);
