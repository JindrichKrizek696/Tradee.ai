// Konstanty PWA bez 'use client' – importuje je i serverový kořenový layout.
export const THEME_COLOR={light:'#ebf0f9',dark:'#000000'} as const;
// Vkládá se do <head>: beforeinstallprompt umí přijít dřív, než se načte React – událost se uschová na window (viz install.ts).
export const installScript=`addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__tradeeBip=e;dispatchEvent(new Event('tradee:install'))});addEventListener('appinstalled',function(){window.__tradeeBip=null;dispatchEvent(new Event('tradee:install'))})`;
