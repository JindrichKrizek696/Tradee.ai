import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import {themeScript} from './theme';
import {installScript,THEME_COLOR} from './pwa/constants';
import {PwaClient} from './pwa/pwa-ui';
export const metadata: Metadata = {title:'Tradee',applicationName:'Tradee',description:'Síla měn, COT pozice, sezonalita a transparentní skórování.',robots:{index:false,follow:false},icons:{icon:[{url:'/favicon.ico',sizes:'48x48'},{url:'/favicon.svg',type:'image/svg+xml'},{url:'/landing/icons/icon-32.png',type:'image/png',sizes:'32x32'}],apple:[{url:'/apple-touch-icon.png',sizes:'180x180'}]},manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'Tradee',statusBarStyle:'default'},formatDetection:{telephone:false},other:{'apple-mobile-web-app-capable':'yes'}};
// viewport-fit=cover: obsah až do výřezu, okraje řeší env(safe-area-inset-*) v app/pwa/pwa.css; theme-color podle systému, PwaClient ho pak srovná s přepínačem motivu
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',themeColor:[{media:'(prefers-color-scheme: light)',color:THEME_COLOR.light},{media:'(prefers-color-scheme: dark)',color:THEME_COLOR.dark}]};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="cs" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/><script dangerouslySetInnerHTML={{__html:installScript}}/></head><body>{children}<PwaClient/></body></html>}
