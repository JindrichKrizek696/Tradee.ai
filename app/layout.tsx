import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Northstar · by Jindra',description:'Síla měn, COT pozice, sezonalita a transparentní skórování.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="cs" ><body>{children}</body></html>}
