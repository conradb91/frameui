import {captureDomSnapshot} from '../../../src/main/ipc/handlers/cdp/domSnapshot'
import {captureResources} from '../../../src/main/ipc/handlers/captureResources'
import {makeStructuredFrame} from '../../../src/core/capture-compiler/document'
import {renderedExportFonts} from '../../../src/main/export/renderedFonts'
import {renderedExportText} from '../../../src/main/export/renderedText'
import {renderedExportImages} from '../../../src/main/export/renderedImages'
import {inspectScript} from '../../../src/main/artifacts/prototypePageScripts'
declare const chrome:any
export function tabTransport(tabId:number){
 const send=(method:string,params:object={})=>chrome.debugger.sendCommand({tabId},method,params)
 const execute=async(expression:string)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result?.value}
 let attached=false
 const adapter:any={isDestroyed:()=>false,executeJavaScript:execute,debugger:{isAttached:()=>attached,attach:()=>{attached=true},detach:()=>{attached=false},sendCommand:send},session:{fetch:async(address:string)=>{
  const {frameTree}=await send('Page.getFrameTree'),{resource}=await send('Network.loadNetworkResource',{frameId:frameTree.frame.id,url:address,options:{disableCache:false,includeCredentials:true}})
  if(!resource.success||!resource.stream)throw Error('Resource unavailable')
  const parts:Uint8Array[]=[]
  try{while(true){const item=await send('IO.read',{handle:resource.stream});parts.push(item.base64Encoded?Uint8Array.from(atob(item.data),c=>c.charCodeAt(0)):new TextEncoder().encode(item.data));if(item.eof)break}}finally{await send('IO.close',{handle:resource.stream})}
  const size=parts.reduce((n,p)=>n+p.length,0),bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length}
  return new Response(bytes,{status:resource.httpStatusCode??200,headers:resource.headers??{}})
 }},capturePage:async(rect?:object)=>{const result=await send('Page.captureScreenshot',{format:'png',fromSurface:true,...(rect?{clip:{...rect,scale:1},captureBeyondViewport:true}:{})});return {isEmpty:()=>!result.data,toDataURL:()=>`data:image/png;base64,${result.data}`}}}
 return {send,execute,adapter}
}
export async function captureTab(tabId:number,progress:(stage:string)=>void){
 const {send,execute,adapter}=tabTransport(tabId),signal=AbortSignal.timeout(120000),started=Date.now(),notes:string[]=[]
 const position=await execute('({x:scrollX,y:scrollY})')
 try{
  progress('Reading the current page');await execute(`(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]);if(!document.body)throw Error('This page is not ready to capture.')})()`)
  await execute('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const info=await execute(inspectScript),metadata=await execute('({url:location.href,title:document.title,width:innerWidth,height:innerHeight})')
  const root=await captureDomSnapshot(adapter,{width:metadata.width,height:metadata.height},signal)
  progress('Embedding images and fonts');const fonts=await captureResources(adapter,root,metadata.url,signal,new Map(),notes)
  const frame=makeStructuredFrame(root,{name:info.title||metadata.title||'Captured screen',route:new URL(metadata.url).pathname,width:metadata.width,height:metadata.height,durationMs:Date.now()-started});frame.fonts=fonts
  const id=crypto.randomUUID(),page:any={id,name:frame.name,route:'/__chrome_capture_'+id,folder:'Chrome captures',pinned:false,state:metadata.width<600?'Mobile':'Desktop',width:frame.width,height:frame.height,objects:[],structured:frame,fonts,capturedAt:new Date().toISOString(),artifactSource:{path:new URL(metadata.url).pathname+new URL(metadata.url).search+new URL(metadata.url).hash,steps:[]}}
  progress('Preserving text and image effects');const document={pages:[page]}
  const renderedFonts=await renderedExportFonts(adapter,document,signal),renderedLines=await renderedExportText(adapter,document,signal),renderedImages=await renderedExportImages(adapter,document,signal)
  const lines=(nodes:any[])=>nodes.forEach(n=>{if(n.typography&&renderedLines[id+':'+n.id])n.typography.captureLines=renderedLines[id+':'+n.id];lines(n.children)});lines(frame.children)
  progress('Creating the screen preview')
  try{const {cssContentSize}=await send('Page.getLayoutMetrics');const image=await send('Page.captureScreenshot',{format:'jpeg',quality:75,fromSurface:true,captureBeyondViewport:true,clip:{x:0,y:0,width:Math.min(metadata.width,cssContentSize.width),height:Math.max(1,Math.min(frame.height,30000)),scale:Math.min(1,480/metadata.width)}});page.thumbnail=page.fullPageScreenshot='data:image/jpeg;base64,'+image.data}catch{notes.push('The preview could not be generated. Editable layers were retained.')}
  notes.push(...(info.frameWarnings??[]));page.captureWarnings=[...new Set(notes)]
  return {page,info:{title:info.title,signature:info.signature,visual:info.visual,overlay:info.overlay,overlaySelector:info.overlaySelector,expanded:info.expanded,url:metadata.url},notes,renderedFonts,renderedImages,renderedLines}
 }finally{await execute(`window.scrollTo(${Number(position.x)||0},${Number(position.y)||0})`).catch(()=>{})}
}
