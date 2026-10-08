'use client';
import {useEffect,useState} from 'react';
import {Journal} from '@/app/journal/journal';
import '../../../mt.css';
type Person={memberId:string;name?:string|null;email?:string|null};
export default function ViewJournal({id}:{id:string}){
 const [name,setName]=useState<string|null>(null),[denied,setDenied]=useState(false),[error,setError]=useState('');
 useEffect(()=>{(async()=>{try{const r=await fetch('/api/admin/people',{cache:'no-store'});if(r.status===403){setDenied(true);return}const j=await r.json() as {people?:Person[]};if(!r.ok)throw Error();const p=(j.people||[]).find(x=>x.memberId===id);setName(p?.name||p?.email||id)}catch{setError('Uživatele se nepodařilo načíst. Zkus obnovit stránku.')}})()},[id]);
 return <div className="mt-page"><header className="mt-top"><a className="mt-back" href="/admin">← Administrace</a></header>
  {denied?<main className="mt-main"><p>Sem nemáš přístup.</p></main>:error?<main className="mt-main"><p role="alert">{error}</p></main>:name===null?<main className="mt-main"><p>Načítám…</p></main>:<main className="mt-main wide"><Journal viewAs={{id,name}}/></main>}
 </div>;
}
