// Předvolby barev signálu (bullish/bearish). Barva značky (#245bff) se nemění.
// dark = barvy v tmavém motivu (černá ↔ bílá se prohodí); text v tmavém motivu dopočítá theme.css.
export type Palette={id:string;label:string;bull:string;bear:string;bullText:string;bearText:string;dark?:{bull:string;bear:string}};
export const palettes:Palette[]=[
 {id:'green-red',label:'Zelená / červená',bull:'#16a34a',bear:'#dc2626',bullText:'#15803d',bearText:'#b91c1c'},
 {id:'blue-black',label:'Modrá / černá',bull:'#245bff',bear:'#17191e',bullText:'#1d4ed8',bearText:'#17191e',dark:{bull:'#3d6dff',bear:'#f4f4f5'}},
 {id:'blue-yellow',label:'Modrá / žlutá',bull:'#2563eb',bear:'#eab308',bullText:'#1d4ed8',bearText:'#a16207'},
 {id:'purple-orange',label:'Fialová / oranžová',bull:'#7c3aed',bear:'#ea580c',bullText:'#6d28d9',bearText:'#c2410c'},
 {id:'neon-pink',label:'Křiklavě zelená / růžová',bull:'#00d664',bear:'#ec4899',bullText:'#15803d',bearText:'#be185d'},
 {id:'green-black',label:'Zelená / černá',bull:'#16a34a',bear:'#17191e',bullText:'#15803d',bearText:'#17191e',dark:{bull:'#22c55e',bear:'#f4f4f5'}},
 {id:'white-black',label:'Bílá / černá',bull:'#17191e',bear:'#a1a1aa',bullText:'#17191e',bearText:'#71717a',dark:{bull:'#f4f4f5',bear:'#52525b'}},
 {id:'yellow-black',label:'Žlutá / černá',bull:'#eab308',bear:'#17191e',bullText:'#a16207',bearText:'#17191e',dark:{bull:'#facc15',bear:'#f4f4f5'}},
 {id:'green-purple',label:'Zelená / fialová',bull:'#16a34a',bear:'#9333ea',bullText:'#15803d',bearText:'#7e22ce',dark:{bull:'#22c55e',bear:'#a855f7'}},
 {id:'purple-white',label:'Fialová / bílá',bull:'#7c3aed',bear:'#17191e',bullText:'#6d28d9',bearText:'#17191e',dark:{bull:'#a78bfa',bear:'#f4f4f5'}},
];
export const DEFAULT_PALETTE='green-red';
export const isPalette=(id:unknown):id is string=>typeof id==='string'&&palettes.some(p=>p.id===id);
export const getPalette=(id:unknown)=>palettes.find(p=>p.id===id)??palettes[0];
