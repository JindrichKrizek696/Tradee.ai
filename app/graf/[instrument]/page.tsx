import ChartPage from '../../chart-page';
export const metadata={title:'Graf trhu · Tradee'};
// ?tf=H1 = časový rámec z aplikace (tlačítko „Nové okno“ u grafu)
export default async function Page({params,searchParams}:{params:Promise<{instrument:string}>;searchParams?:Promise<{tf?:string|string[]}>}){const {instrument}=await params,tf=(await searchParams)?.tf;return <ChartPage slug={instrument} tf={typeof tf==='string'?tf:undefined}/>}
