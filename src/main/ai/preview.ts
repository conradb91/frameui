import { raceAbort } from '../ipc/handlers/capture/raceAbort'
import { sourceTarget } from '@core/repo-design/targets'
import { compileRepositoryPage, designIRMarkup } from '@core/repo-design/compiler'
import { captureDomSnapshot } from '../ipc/handlers/cdp/domSnapshot'
import { makeStructuredFrame } from '@core/capture-compiler/document'
import postcss from 'postcss'
import electron from 'electron'
import { randomUUID } from 'node:crypto'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { VisualPage } from '@shared/types/visualDesign'
import { renderStructuredFrameToHtml } from '@core/capture-compiler/renderStructuredFrameToHtml'

export interface TextMeasurement {id:string;parentId:string;height:number;width:number;requiredWidth:number;requiredHeight:number;naturalWidth:number;overflow:boolean}
export async function renderArtboard(page:VisualPage,signal:AbortSignal):Promise<string> {return (await inspectArtboardRender(page,signal)).image}
export async function inspectArtboardRender(page:VisualPage,signal:AbortSignal):Promise<{image:string;text:TextMeasurement[];warnings:string[]}> {
  signal=AbortSignal.any([signal,AbortSignal.timeout(20000)])
  if(!page.structured)throw new Error('Render comparison requires a structured artboard. Capture this screen with the current capture engine first.')
  const width=Math.ceil(Math.min(page.width,2560)),height=Math.ceil(Math.min(page.height,4096))
  const session=electron.session.fromPartition('ai-preview-'+randomUUID(),{cache:false})
  const url='frameui-design://preview/index.html'
  session.protocol.handle('frameui-design',()=>new Response(renderStructuredFrameToHtml(page.structured!),{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"}}))
  session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.url!==url&&!details.url.startsWith('data:')}))
  session.setPermissionRequestHandler((_wc,_p,callback)=>callback(false))
  const win=new electron.BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{session,sandbox:true,contextIsolation:true,backgroundThrottling:false,nodeIntegration:false,webviewTag:false}})
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  const abort=()=>{if(!win.isDestroyed())win.destroy()};signal.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,20000)
  try { return await raceAbort((async()=>{signal.throwIfAborted();await win.loadURL(url);await win.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{})))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    const inspection=await win.webContents.executeJavaScript(`(()=>{
      const entries=[...document.querySelectorAll('[data-frameui-text]')].filter(el=>el.textContent.trim()&&el.getBoundingClientRect().width>0).map(el=>{const box=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const rects=[...range.getClientRects()],bottom=Math.max(box.top,...rects.map(r=>r.bottom)),right=Math.max(box.left,...rects.map(r=>r.right)),height=Math.ceil(bottom-box.top);const clone=el.cloneNode(true);Object.assign(clone.style,{width:'max-content',height:'auto',whiteSpace:'pre',visibility:'hidden',left:'0',top:'0'});document.body.appendChild(clone);const naturalWidth=Math.ceil(clone.getBoundingClientRect().width);clone.remove();return {naturalWidth,id:el.dataset.frameuiText,parentId:el.dataset.frameuiParent,height:box.height,width:box.width,requiredWidth:Math.ceil(right-box.left),requiredHeight:Math.max(height,Math.ceil(parseFloat(getComputedStyle(el).lineHeight))),overflow:bottom>box.bottom+2||right>box.right+2,box:{x:box.x,y:box.y,right:box.right,bottom:box.bottom}}});
      const warnings=entries.filter(e=>e.overflow).map(e=>'Text '+e.id+' exceeds its box; '+(e.requiredWidth>e.width+2?'required width '+e.requiredWidth+'px, allocated '+e.width+'px.':'required height '+e.requiredHeight+'px, allocated '+e.height+'px.'));
      for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){const a=entries[i],b=entries[j];if(a.parentId===b.parentId&&Math.min(a.box.right,b.box.right)-Math.max(a.box.x,b.box.x)>2&&Math.min(a.box.bottom,b.box.bottom)-Math.max(a.box.y,b.box.y)>2)warnings.push('Text boxes overlap: '+a.id+' and '+b.id+'.')}
      return {text:entries.map(({box,...entry})=>entry),warnings:warnings.slice(0,60)};
    })()`);
    return {image:(await win.webContents.capturePage()).resize({width,height}).toDataURL(),...inspection}})(),signal) }
  finally {clearTimeout(timeout);signal.removeEventListener('abort',abort);abort()}
}
export function compareImages(reference:string,render:string) {
  const a=electron.nativeImage.createFromDataURL(reference),b=electron.nativeImage.createFromDataURL(render)
  if(a.isEmpty()||b.isEmpty())throw new Error('Images could not be decoded.')
  const size=b.getSize(),originalSize=a.getSize()
  const first=PNG.sync.read(a.resize(size).toPNG()),second=PNG.sync.read(b.toPNG()),diff=new PNG(size)
  const pixels=pixelmatch(first.data,second.data,diff.data,size.width,size.height,{threshold:0.15})
  return {matchPercent:Math.round((1-pixels/(size.width*size.height))*10000)/100,description:`Pixel comparison at ${size.width} × ${size.height}. Reference ${originalSize.width} × ${originalSize.height}${originalSize.width!==size.width||originalSize.height!==size.height?' was resized; this is not a geometry-accurate score':''}. Pixel differences cannot independently identify font or layout causes.`,diff:'data:image/png;base64,'+PNG.sync.write(diff).toString('base64')}
}

/** Reuses FrameUI's source compiler; no project JavaScript executes here. */
export async function renderRepositoryComponent(root:string,model:import('@shared/types/model/projectModel').ProjectModel,componentId:string,width:number,signal:AbortSignal,props:Record<string,string>={}) {
  signal=AbortSignal.any([signal,AbortSignal.timeout(20000)])
  const target=sourceTarget(model,'component:'+componentId)
  if(!target)throw new Error('Component is no longer indexed.')
  const ir=compileRepositoryPage(root,target,model,'Populated',props)
  if(ir.status==='unsupported')throw new Error('This component needs runtime context. Capture a screen using it first.')
  const session=electron.session.fromPartition('ai-component-'+randomUUID(),{cache:false}),url='frameui-design://preview/index.html'
  session.protocol.handle('frameui-design',()=>new Response(designIRMarkup(ir),{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"}}))
  session.webRequest.onBeforeRequest((d,callback)=>callback({cancel:d.url!==url&&!d.url.startsWith('data:')}))
  session.setPermissionRequestHandler((_wc,_p,callback)=>callback(false))
  const win=new electron.BrowserWindow({show:false,width:Math.ceil(width),height:800,useContentSize:true,webPreferences:{session,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}})
  const abort=()=>{if(!win.isDestroyed())win.destroy()};signal.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,20000)
  try{return await raceAbort((async()=>{
    signal.throwIfAborted();await win.loadURL(url);await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)')
    const tree=await captureDomSnapshot(win.webContents,{width,height:800})
    const frame=makeStructuredFrame(tree,{name:target.name,route:'',width,height:800,durationMs:0,file:target.source.filePath})
    // The capture's viewport/body wrappers are not part of the component.
    const roots:import('@shared/types/structuredDesign').StructuredNode[]=[]
    const componentName=target.name.replace(/([a-z])([A-Z])/g,'$1 $2')
    const locate=(nodes:typeof frame.children)=>{for(const n of nodes){if(n.source.component===componentName){roots.push(n);continue}locate(n.children)}};locate(frame.children)
    if(roots.length===1){const component=roots[0];component.parentId=null;component.bounds.x=0;component.bounds.y=0;frame.children=[component];frame.width=component.bounds.width;frame.height=component.bounds.height}
    const fonts:NonNullable<VisualPage['fonts']>=[]
    postcss.parse(ir.styles).walkAtRules('font-face',rule=>{const values:Record<string,string>={};rule.walkDecls(d=>{values[d.prop]=d.value});const data=/url\(["']?(data:font\/[^"')\s]+)["']?\)/.exec(values.src??'')?.[1];if(data)fonts.push({family:(values['font-family']??'').replace(/^['"]|['"]$/g,''),weight:values['font-weight']??'400',style:values['font-style']??'normal',data})})
    return {frame,fonts,warnings:ir.warnings}
  })(),signal)}finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);abort()}
}
