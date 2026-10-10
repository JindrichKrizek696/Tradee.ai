import ChartPage from '../../chart-page';
export const metadata={title:'Graf trhu · Tradee'};
export default async function Page({params}:{params:Promise<{instrument:string}>}){const {instrument}=await params;return <ChartPage slug={instrument}/>}
