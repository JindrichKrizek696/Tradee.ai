import ViewJournal from './view-journal';
export const metadata={title:'Deník uživatele · Administrace · Tradee'};
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ViewJournal id={decodeURIComponent(id)}/>}
