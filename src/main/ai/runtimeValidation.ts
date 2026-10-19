import { raceAbort } from '../ipc/handlers/capture/raceAbort'
import electron from 'electron'
import { runtimeAllowed } from '../security/runtimePolicy'
import { safeRoute } from '@core/visual/model'
import type { VisualPage } from '@shared/types/visualDesign'
import { enableCaptureMotion } from '../ipc/handlers/cdp/captureMotion'
import { scrollToSettle } from '../ipc/handlers/capture/scrollToSettle'
import { renderArtboard, compareImages } from './preview'
export async function validateRuntime(projectId:string,url:string,page:VisualPage,signal:AbortSignal) {
 signal=AbortSignal.any([signal,AbortSignal.timeout(60000)])
 const allowed=(value:string)=>runtimeAllowed(electron.app.getPath('userData'),projectId,value)&&safeRoute(value,new URL(url).origin)
 if(!allowed(url))throw new Error('Connect and verify this Runtime URL before comparing it.')
 const width=Math.ceil(Math.min(page.width,2560)),height=Math.ceil(Math.min(page.height,4096))
 const win=new electron.BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{partition:`persist:project-${projectId}`,sandbox:true,contextIsolation:true,backgroundThrottling:false,nodeIntegration:false,webSecurity:true,webviewTag:false}})
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}))
 const navigation=(event:Electron.Event,destination:string)=>{if(!allowed(destination))event.preventDefault()}
 win.webContents.on('will-navigate',navigation);win.webContents.on('will-redirect',navigation)
 const abort=()=>{if(!win.isDestroyed())win.destroy()};const timeout=setTimeout(abort,60000);signal.addEventListener('abort',abort,{once:true})
 try{return await raceAbort((async()=>{
  signal.throwIfAborted();await win.loadURL('about:blank');await enableCaptureMotion(win.webContents);await win.loadURL(url)
  if(new URL(win.webContents.getURL()).pathname!==new URL(url).pathname)throw new Error('Runtime redirected to another page. Sign in through Capture and retry the requested route.')
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)')
  await scrollToSettle(win,signal)
  await win.webContents.insertCSS('*,*::before,*::after{animation-play-state:paused!important;transition:none!important}')
  signal.throwIfAborted();if(!allowed(win.webContents.getURL()))throw new Error('Runtime left the approved project origin.')
  const image=(await win.webContents.capturePage()).resize({width,height}).toDataURL(),render=await renderArtboard(page,signal)
  const comparison=compareImages(image,render)
  return {image,matchPercent:comparison.matchPercent,description:comparison.description+' Compared the approved artboard with the live runtime viewport; offscreen content is excluded.'}
 })(),signal)}finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);abort()}
}
