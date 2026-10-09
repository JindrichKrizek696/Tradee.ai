// Volba účtu společná pro Dashboard („Můj trading“) a Deník.
const KEY='tradee.account';
export function readAccount():string{try{return localStorage.getItem(KEY)||'all'}catch{return 'all'}}
export function writeAccount(v:string){try{localStorage.setItem(KEY,v)}catch{}}
