// DB vrstva Poznámek (Db je parametr, každý dotaz filtruje user_id). Tabulky z drizzle/mariadb/0023_notebook.sql.
import type {Db} from '../mysql.ts';
import {nowSql} from '../mt/store.ts';
import {LIMITS,MISSING_TABLES,excerpt,isMissingTable,nameTaken,type Folder,type Note,type NoteMeta,type NotePatch} from './core.ts';
const uid=(p:string)=>p+'_'+crypto.randomUUID().replace(/-/g,'').slice(0,24);
// pro failed(): chybějící tabulky → srozumitelná hláška místo obecné chyby databáze
export const notebookError=(e:unknown)=>isMissingTable(e)?new Error(MISSING_TABLES):e;
type NoteRow={id:string;folder_id:string;title:string;instrument:string|null;created:string;updated:string};
const meta=(r:NoteRow)=>({id:r.id,folderId:r.folder_id,title:r.title,instrument:r.instrument||null,created:r.created,updated:r.updated});
export async function listFolders(d:Db,userId:string):Promise<Folder[]>{
 return (await d.prepare('SELECT id,name FROM notebook_folders WHERE user_id=? ORDER BY position,created,id').bind(userId).all<Folder>()).results.map(r=>({id:r.id,name:r.name}));
}
// seznam bez celého textu (jen náhled), nejnovější nahoře
export async function listNotes(d:Db,userId:string):Promise<NoteMeta[]>{
 return (await d.prepare('SELECT id,folder_id,title,LEFT(body,400) AS head,instrument,created,updated FROM notebook_notes WHERE user_id=? ORDER BY created DESC,id DESC').bind(userId).all<NoteRow&{head:string}>()).results.map(r=>({...meta(r),excerpt:excerpt(r.head||'')}));
}
export async function createFolder(d:Db,userId:string,name:string):Promise<Folder>{
 const all=await listFolders(d,userId);
 if(all.length>=LIMITS.folders)throw new Error(`Nejvýš ${LIMITS.folders} složek.`);
 if(nameTaken(all,name))throw new Error('Složka s tímto názvem už existuje.');
 const id=uid('nf'),now=nowSql(),s=await d.prepare('SELECT COALESCE(MAX(position),-1)+1 AS s FROM notebook_folders WHERE user_id=?').bind(userId).first<{s:number}>();
 await d.prepare('INSERT INTO notebook_folders(id,user_id,name,position,created,updated) VALUES(?,?,?,?,?,?)').bind(id,userId,name,Number(s?.s||0),now,now).run();
 return {id,name};
}
// false = cizí/neexistující složka
export async function renameFolder(d:Db,userId:string,id:string,name:string):Promise<boolean>{
 const all=await listFolders(d,userId);
 if(!all.some(f=>f.id===id))return false;
 if(nameTaken(all,name,id))throw new Error('Složka s tímto názvem už existuje.');
 await d.prepare('UPDATE notebook_folders SET name=?,updated=? WHERE id=? AND user_id=?').bind(name,nowSql(),id,userId).run();
 return true;
}
export async function reorderFolders(d:Db,userId:string,ids:string[]){
 for(let i=0;i<ids.length;i++)await d.prepare('UPDATE notebook_folders SET position=? WHERE id=? AND user_id=?').bind(i,ids[i],userId).run();
}
// smaže složku i se všemi papíry v ní
export async function deleteFolder(d:Db,userId:string,id:string):Promise<boolean>{
 if(!await d.prepare('SELECT id FROM notebook_folders WHERE id=? AND user_id=?').bind(id,userId).first())return false;
 await d.prepare('DELETE FROM notebook_notes WHERE user_id=? AND folder_id=?').bind(userId,id).run();
 await d.prepare('DELETE FROM notebook_folders WHERE id=? AND user_id=?').bind(id,userId).run();
 return true;
}
const ownFolder=async(d:Db,userId:string,id:string)=>!!await d.prepare('SELECT id FROM notebook_folders WHERE id=? AND user_id=?').bind(id,userId).first();
// null = složka není uživatelova; limit hází chybu
export async function createNote(d:Db,userId:string,p:NotePatch&{folderId:string}):Promise<Note|null>{
 if(!await ownFolder(d,userId,p.folderId))return null;
 const n=await d.prepare('SELECT COUNT(*) AS n FROM notebook_notes WHERE user_id=?').bind(userId).first<{n:number}>();
 if(Number(n?.n||0)>=LIMITS.notes)throw new Error(`Nejvýš ${LIMITS.notes} papírů. Smaž nějaké staré.`);
 const id=uid('nt'),now=nowSql(),note:Note={id,folderId:p.folderId,title:p.title||'',body:p.body||'',instrument:p.instrument||null,created:now,updated:now};
 await d.prepare('INSERT INTO notebook_notes(id,user_id,folder_id,title,body,instrument,created,updated) VALUES(?,?,?,?,?,?,?,?)').bind(id,userId,note.folderId,note.title,note.body,note.instrument,now,now).run();
 return note;
}
export async function getNote(d:Db,userId:string,id:string):Promise<Note|null>{
 const r=await d.prepare('SELECT id,folder_id,title,body,instrument,created,updated FROM notebook_notes WHERE id=? AND user_id=?').bind(id,userId).first<NoteRow&{body:string}>();
 return r?{...meta(r),body:r.body}:null;
}
// jen poslaná pole; null = papír (nebo cílová složka) není uživatelův; vrací čas úpravy a nový náhled
export async function updateNote(d:Db,userId:string,id:string,p:NotePatch):Promise<{updated:string;excerpt?:string}|null>{
 if(p.folderId!==undefined&&!await ownFolder(d,userId,p.folderId))return null;
 const set:string[]=[],vals:unknown[]=[];
 if(p.folderId!==undefined){set.push('folder_id=?');vals.push(p.folderId)}
 if(p.title!==undefined){set.push('title=?');vals.push(p.title)}
 if(p.body!==undefined){set.push('body=?');vals.push(p.body)}
 if(p.instrument!==undefined){set.push('instrument=?');vals.push(p.instrument)}
 const now=nowSql();
 const r=await d.prepare(`UPDATE notebook_notes SET ${set.join(',')}${set.length?',':''}updated=? WHERE id=? AND user_id=?`).bind(...vals,now,id,userId).run();
 if(r.meta.changes<1&&!await d.prepare('SELECT id FROM notebook_notes WHERE id=? AND user_id=?').bind(id,userId).first())return null;
 return {updated:now,...(p.body!==undefined?{excerpt:excerpt(p.body)}:{})};
}
export async function deleteNote(d:Db,userId:string,id:string):Promise<boolean>{
 return (await d.prepare('DELETE FROM notebook_notes WHERE id=? AND user_id=?').bind(id,userId).run()).meta.changes>0;
}
