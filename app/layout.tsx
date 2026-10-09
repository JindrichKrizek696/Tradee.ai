import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import {themeScript} from './theme';
export const metadata: Metadata = {title:'Tradee',description:'Síla měn, COT pozice, sezonalita a transparentní skórování.',robots:{index:false,follow:false},icons:{icon:[{url:'/favicon.ico',sizes:'48x48'},{url:'/landing/icons/icon-32.png',type:'image/png',sizes:'32x32'}],apple:'/apple-touch-icon.png'},manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'Tradee',statusBarStyle:'default'}};
export const viewport: Viewport = {themeColor:'#245bff'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="cs" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body>{children}</body></html>}
