import mysql,{type RowDataPacket,type ResultSetHeader} from 'mysql2/promise';
export type DbConfig={host:string;port?:number;user:string;password:string;database:string};
/** Převod několika SQLite obratů z původních dotazů na MariaDB. Ostatní SQL je společné. */
export function translate(sql:string){
 let s=sql.replace(/^\s*INSERT OR IGNORE/i,'INSERT IGNORE');
 const m=s.match(/\sON CONFLICT\((\w+)\) DO UPDATE SET (.+)$/i);
 if(m&&m.index!==undefined)s=s.slice(0,m.index)+' ON DUPLICATE KEY UPDATE '+m[2].replace(/excluded\.(\w+)/gi,'VALUES($1)');
 if(/^\s*SELECT \* FROM \(SELECT/i.test(s))s=s.replace(/\)\s+ORDER BY/i,') AS sub ORDER BY');
 return s;
}
/** Malý adaptér se stejným rozhraním jako D1 (prepare → bind → run/first/all), aby API routy zůstaly beze změny. */
export function createDb(cfg:DbConfig){
 const connect=()=>mysql.createConnection({host:cfg.host,port:cfg.port||3306,user:cfg.user,password:cfg.password,database:cfg.database,disableEval:true,dateStrings:true,decimalNumbers:true,charset:'utf8mb4'});
 async function exec<T>(sql:string,params:unknown[]):Promise<T>{const c=await connect();try{const [res]=await c.execute(translate(sql),params.map(p=>p===undefined?null:p) as (string|number|null)[]);return res as T}finally{await c.end()}}
 return {
  prepare(sql:string){
   const make=(params:unknown[])=>({
    bind:(...p:unknown[])=>make(p),
    async run(){const r=await exec<ResultSetHeader>(sql,params);return {success:true as const,meta:{changes:r.affectedRows,last_row_id:r.insertId}}},
    async first<T=Record<string,unknown>>(){const rows=await exec<RowDataPacket[]>(sql,params);return (rows[0] as T|undefined)??null},
    async all<T=Record<string,unknown>>(){const rows=await exec<RowDataPacket[]>(sql,params);return {results:rows as T[],success:true as const,meta:{}}},
   });
   return make([]);
  },
 };
}
export type Db=ReturnType<typeof createDb>;
