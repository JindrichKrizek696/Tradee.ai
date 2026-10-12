// Laboratoř – jen vlastník. Ostatním (i adminům) stránka vrací 404 už na serveru; data chrání /api/laborator/* (také 404).
import {headers} from 'next/headers';
import {notFound} from 'next/navigation';
import {currentUser} from '@/lib/server';
import {labAllowed} from '@/lib/lab/access';
import LabPage from './lab-page';
export const dynamic='force-dynamic';
export const metadata={title:'Tradee',robots:{index:false,follow:false}};
export default async function Page(){
 const h=await headers(),u=await currentUser(new Request('https://tradee.eu/laborator',{headers:{cookie:h.get('cookie')||''}})).catch(()=>null);
 if(!labAllowed(u))notFound();
 return <LabPage/>;
}
