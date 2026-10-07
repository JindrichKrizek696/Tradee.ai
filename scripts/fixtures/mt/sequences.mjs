// Testovací sekvence událostí MT pro lib/mt/build.ts. Čas T0 = 2026-10-07 08:00:00 UTC.
export const T0=Date.UTC(2026,9,7,8,0,0);
const base={order:'',commission:0,swap:0,fee:0,profit:0,magic:0,comment:'',reason:'client',dealType:'trade',sl:0,tp:0,digits:5,point:0.00001,tickSize:0.00001,tickValue:1,spread:0,priceRequested:0,balance:0};
export const deal=(id,ts,p)=>({...base,id:'d:'+id,type:'deal',ts,deal:String(id),symbol:'EURUSD',...p});
export const mod=(pos,ts,p)=>({id:`m:${pos}:${ts}`,type:'position_modify',ts,position:String(pos),symbol:'EURUSD',slOld:0,slNew:0,tpOld:0,tpNew:0,price:0,...p});
export const state=(pos,ts,p)=>({id:`p:${pos}:${ts}`,type:'position_state',ts,position:String(pos),symbol:'EURUSD',side:'buy',volume:1,priceOpen:1.1,priceCurrent:1.1,sl:0,tp:0,profit:0,swap:0,mfePrice:1.1,maePrice:1.1,mfeMoney:0,maeMoney:0,spread:0,openTs:T0,...p});

// 1) buy 1 lot s SL/TP, zavřen TP
export const buyTp=[
 deal(1,T0,{position:'100',side:'buy',entry:'in',volume:1,price:1.1,sl:1.095,tp:1.11,comment:'#breakout #London',spread:8,priceRequested:1.09998,balance:10000,commission:-3.5}),
 deal(2,T0+3_600_000,{position:'100',side:'sell',entry:'out',volume:1,price:1.11,profit:1000,commission:-3.5,reason:'tp'}),
];
// 2) sell zasažený SL
export const sellSl=[
 deal(3,T0,{position:'200',side:'sell',entry:'in',volume:0.5,price:1.2,sl:1.205,tp:1.19,balance:10000}),
 deal(4,T0+600_000,{position:'200',side:'buy',entry:'out',volume:0.5,price:1.205,profit:-250,reason:'sl'}),
];
// 3) SL posunut 3× (trailing), pak zavřen SL v zisku
export const trailing=[
 deal(5,T0,{position:'300',side:'buy',entry:'in',volume:1,price:1.1,sl:1.095,tp:0,balance:10000}),
 mod(300,T0+60_000,{slOld:1.095,slNew:1.098}),
 mod(300,T0+120_000,{slOld:1.098,slNew:1.1}),
 mod(300,T0+180_000,{slOld:1.1,slNew:1.102,tpOld:0,tpNew:1.12}),
 deal(6,T0+240_000,{position:'300',side:'sell',entry:'out',volume:1,price:1.102,profit:200,reason:'sl'}),
];
// 4) částečné uzavření ve dvou krocích
export const partial=[
 deal(7,T0,{position:'400',side:'buy',entry:'in',volume:2,price:1.1,sl:1.09,tp:1.12,balance:10000}),
 deal(8,T0+60_000,{position:'400',side:'sell',entry:'out',volume:1,price:1.105,profit:500}),
 deal(9,T0+120_000,{position:'400',side:'sell',entry:'out',volume:1,price:1.11,profit:1000,reason:'tp'}),
];
// 5) přidání do pozice (vážený vstup)
export const scaleIn=[
 deal(10,T0,{position:'500',side:'buy',entry:'in',volume:1,price:1.1,balance:10000}),
 deal(11,T0+60_000,{position:'500',side:'buy',entry:'in',volume:1,price:1.2}),
 deal(12,T0+120_000,{position:'500',side:'sell',entry:'out',volume:2,price:1.2,profit:1000}),
];
// 6) otočení inout: buy 1 → sell 2 (zbyde short 1) → zavřen
export const reversal=[
 deal(13,T0,{position:'600',side:'buy',entry:'in',volume:1,price:1.1}),
 deal(14,T0+60_000,{position:'600',side:'sell',entry:'inout',volume:2,price:1.105,profit:500}),
 deal(15,T0+120_000,{position:'600',side:'buy',entry:'out',volume:1,price:1.1,profit:500}),
];
// 7) MT4 řetězec: in ticket 700 (1 lot), dílčí out 0.4, zbytek se ve dorovnání pošle jako in se stejným ts (0.6) a out
export const mt4Chain=[
 deal('700:in',T0,{position:'700',side:'buy',entry:'in',volume:0.4,price:1.1,sl:1.095}),
 deal('701:in',T0,{position:'700',side:'buy',entry:'in',volume:0.6,price:1.1,sl:1.095}),
 deal('700:out',T0+60_000,{position:'700',side:'sell',entry:'out',volume:0.4,price:1.105,profit:200}),
 deal('701:out',T0+120_000,{position:'700',side:'sell',entry:'out',volume:0.6,price:1.11,profit:600}),
];
// 8) bez SL, MFE/MAE ze stavů s mezerou > 10 min
export const states=[
 deal(16,T0,{position:'800',side:'buy',entry:'in',volume:1,price:1.1}),
 state(800,T0+120_000,{mfeMoney:30,mfePrice:1.1003,maeMoney:-5,maePrice:1.09995}),
 state(800,T0+240_000,{mfeMoney:50,mfePrice:1.1005,maeMoney:-20,maePrice:1.0998}),
 state(800,T0+1_200_000,{mfeMoney:40,mfePrice:1.1004,maeMoney:-25,maePrice:1.09975}),
 deal(17,T0+1_300_000,{position:'800',side:'sell',entry:'out',volume:1,price:1.1002,profit:20}),
];
// 9) MT4: SL nastaven až 3 s po vstupu
export const lateSl=[
 deal(18,T0,{position:'900',side:'buy',entry:'in',volume:1,price:1.1,balance:5000}),
 mod(900,T0+3000,{slOld:0,slNew:1.099}),
 deal(19,T0+60_000,{position:'900',side:'sell',entry:'out',volume:1,price:1.102,profit:200}),
];
