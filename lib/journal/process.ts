// Hodnocení procesu, ne výsledku: otázky se zodpoví dřív, než se ve vyhodnocení ukáže P&L. Čisté funkce – testy scripts/check-journal-ideas.mjs.
export const PROCESS_QUESTIONS=[
 {id:'plan',text:'Vstup odpovídal plánu nebo scénáři?'},
 {id:'trigger',text:'Počkal jsem na trigger strategie?'},
 {id:'size',text:'Velikost pozice byla podle pravidel?'},
 {id:'manage',text:'SL a TP jsem spravoval podle plánu?'},
 {id:'state',text:'Byl jsem v dobrém stavu (klid, soustředění)?'},
] as const;
export const PROCESS_ANSWERS={yes:'Ano',partly:'Částečně',no:'Ne'} as const;
export type ProcessAnswer=keyof typeof PROCESS_ANSWERS;
export type Process={answers:Record<string,ProcessAnswer>;rating:number|null;doneAt:number|null};
export const emptyProcess=():Process=>({answers:{},rating:null,doneAt:null});
/** Proces je ohodnocený, když jsou zodpovězené všechny otázky – teprve pak se ukáže výsledek. */
export const processComplete=(answers:Record<string,unknown>)=>PROCESS_QUESTIONS.every(q=>typeof answers[q.id]==='string'&&answers[q.id] as string in PROCESS_ANSWERS);
/** Skóre procesu 0–100: ano = 1, částečně = 0,5, ne = 0 (null, dokud není vše zodpovězeno). */
export function processScore(answers:Record<string,unknown>):number|null{
 if(!processComplete(answers))return null;
 const v:number[]=PROCESS_QUESTIONS.map(q=>answers[q.id]==='yes'?1:answers[q.id]==='partly'?0.5:0);
 return Math.round(v.reduce((a,b)=>a+b,0)/v.length*100);
}
export function parseProcess(raw:unknown):{answers:Record<string,ProcessAnswer>;rating:number|null}|string{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return 'Neplatné hodnocení procesu.';
 const o=raw as {answers?:unknown;rating?:unknown},a=o.answers&&typeof o.answers==='object'&&!Array.isArray(o.answers)?o.answers as Record<string,unknown>:{};
 const answers:Record<string,ProcessAnswer>={};
 for(const q of PROCESS_QUESTIONS){const v=a[q.id];if(v===undefined||v===null||v==='')continue;if(typeof v!=='string'||!(v in PROCESS_ANSWERS))return 'Neplatná odpověď.';answers[q.id]=v as ProcessAnswer}
 let rating:number|null=null;
 if(o.rating!==undefined&&o.rating!==null){if(typeof o.rating!=='number'||!Number.isInteger(o.rating)||o.rating<1||o.rating>5)return 'Hodnocení procesu musí být 1 až 5.';rating=o.rating}
 return {answers,rating};
}
