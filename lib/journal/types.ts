// Typy deníku obchodů (MT pozice + ruční zápisy).
import type {PositionRow,ChangeRow} from '../mt/build.ts';
import type {Bar} from '../mt/protocol.ts';
export type JournalTrade={id:string;source:'mt'|'manual';accountId:string;account:string;symbol:string;instrument:string|null;side:'buy'|'sell'|null;openTs:number|null;closeTs:number;date:string;volume:number|null;net:number|null;accountCurrency:string|null;pnl:number;converted:boolean;r:number|null;rr:number|null;riskPct:number|null;mfeR:number|null;maeR:number|null;holdMs:number|null;tags:string[];hasNote:boolean;files:number;checklist:number|null;note?:string};
export type JournalAccount={id:string;name:string;platform:string;currency:string};
export type JournalList={currency:string;accounts:JournalAccount[];trades:JournalTrade[]};
export type MtJournalRow={id:string;account_id:string;symbol:string;side:string;open_ts:number;close_ts:number;volume_max:number;net:number;r_result:number|null;rr_planned:number|null;risk_pct:number|null;risk_money:number|null;mfe_money:number|null;mae_money:number|null;tags:string;tags_manual:string;has_note:number;files:number;acc_currency:string;acc_name:string;acc_login:string};
export type ManualJournalRow={id:string;date:string;instrument:string;pnl:number;note:string;created:string};
export type JournalPosition=PositionRow&{tags_manual:string;note:string|null;acc_currency:string;acc_name:string;platform:string};
export type JournalChange=ChangeRow;
export type JournalFile={id:string;name:string;size:number;type:string};
export type JournalDetail={position:JournalPosition;changes:JournalChange[];bars:{tf:string;data:Bar[]}|null;files:JournalFile[]};
