// Předvolby barev signálu (bullish/bearish). Barva značky (#245bff) se nemění.
export type Palette={id:string;label:string;bull:string;bear:string;bullText:string;bearText:string};
export const palettes:Palette[]=[
 {id:'green-red',label:'Zelená / červená',bull:'#16a34a',bear:'#dc2626',bullText:'#15803d',bearText:'#b91c1c'},
 {id:'blue-black',label:'Modrá / černá',bull:'#245bff',bear:'#17191e',bullText:'#1d4ed8',bearText:'#17191e'},
 {id:'blue-yellow',label:'Modrá / žlutá',bull:'#2563eb',bear:'#eab308',bullText:'#1d4ed8',bearText:'#a16207'},
 {id:'purple-orange',label:'Fialová / oranžová',bull:'#7c3aed',bear:'#ea580c',bullText:'#6d28d9',bearText:'#c2410c'},
 {id:'neon-pink',label:'Křiklavě zelená / růžová',bull:'#00d664',bear:'#ec4899',bullText:'#15803d',bearText:'#be185d'},
];
export const DEFAULT_PALETTE='green-red';
export const isPalette=(id:unknown):id is string=>typeof id==='string'&&palettes.some(p=>p.id===id);
export const getPalette=(id:unknown)=>palettes.find(p=>p.id===id)??palettes[0];
