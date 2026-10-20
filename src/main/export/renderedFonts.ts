import {randomUUID} from 'node:crypto'
import type {WebContents} from 'electron'
import type {Protocol} from 'devtools-protocol'
import type {VisualObject,VisualPage} from '../../shared/types/visualDesign'
import type {StructuredFrame} from '../../shared/types/structuredDesign'
import type {TextStyleRun} from '../../shared/types/richText'
import {xdFontKey,type XdRenderedFontFace} from '../../core/export/xdFonts'
import {withDebugger} from '../ipc/handlers/cdp/withDebugger'
import {raceAbort} from '../ipc/handlers/capture/raceAbort'

type Probe={stack:string;weight:string;style:string;text:string;size:number}
/** Ask the same Chromium renderer that paints FrameUI which faces it actually uses. */
export async function renderedExportFonts(contents:WebContents,document:{pages:{objects:VisualObject[];structured?:StructuredFrame;fonts?:VisualPage['fonts']}[]},jobSignal:AbortSignal):Promise<XdRenderedFontFace[]> {
 const signal=AbortSignal.any([jobSignal,AbortSignal.timeout(15000)]),id='frameui-font-probe-'+randomUUID(),probes=new Map<string,Probe>(),inkSamples=new Map<string,Probe>()
 function add(stack:string,weight:string,style:string,text:string,size=16){for(const line of text.split('\n')){const sampleKey=JSON.stringify([stack,weight,style,size,line]);if(line&&line.length<=1000&&inkSamples.size<4000)inkSamples.set(sampleKey,{stack,weight,style,size,text:line})}const key=JSON.stringify([stack,weight,style,size]);if(!probes.has(key)&&probes.size<256)probes.set(key,{stack,weight,style,text:text.replace(/\s+/g,' ').slice(0,200)||'Aa Mm 0123456789',size})}
 function runs(stack:string,weight:string,style:string,text:string,size:number,items?:TextStyleRun[]){add(stack,weight,style,text,size);for(const run of items??[])add(run.fontFamily??stack,run.fontWeight??weight,run.fontStyle??style,text.slice(run.start,run.end),run.fontSize??size)}
 for(const page of document.pages){
  const structured=(nodes:NonNullable<typeof page.structured>['children']):void=>{for(const node of nodes){const t=node.typography;if(t){runs(t.fontFamily,t.fontWeight,t.fontStyle??'normal',t.text,t.fontSize,t.textRuns);for(const line of t.captureLines??[])add(t.fontFamily,t.fontWeight,t.fontStyle??'normal',line.text,t.fontSize)}structured(node.children)}}
  if(page.structured)structured(page.structured.children)
  const legacy=(nodes:typeof page.objects):void=>{for(const node of nodes){if(node.kind==='Text')runs(node.fontFamily,node.fontWeight,'normal',node.text??'',node.fontSize,node.textRuns);legacy(node.children)}}
  legacy(page.structured?page.objects.filter(node=>node.designOnly):page.objects)
 }
 if(!probes.size)return []
 const values=[...probes.values()],fonts=[...new Map(document.pages.flatMap(page=>page.structured?.fonts??page.fonts??[]).map(font=>[JSON.stringify([font.family,font.weight,font.style,font.data]),font])).values()]
 const execute=(script:string)=>raceAbort(contents.executeJavaScript(script),signal)
 try{
  signal.throwIfAborted()
  const baselines=await execute(`(async()=>{const root=document.createElement('div');root.id=${JSON.stringify(id)};root.setAttribute('aria-hidden','true');root.style.cssText='position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;contain:layout style;z-index:-1';const style=document.createElement('style');style.textContent=${JSON.stringify(fonts.map(font=>`@font-face{font-family:${JSON.stringify(font.family)};font-weight:${font.weight};font-style:${font.style};src:url(${JSON.stringify(font.data)});${font.unicodeRange?'unicode-range:'+font.unicodeRange+';':''}}`).join('\n'))};root.appendChild(style);for(const [index,p] of ${JSON.stringify(values)}.entries()){const span=document.createElement('span');span.id=root.id+'-'+index;span.style.cssText='all:initial;display:block;white-space:pre;padding:0;border:0;margin:0';span.style.fontFamily=p.stack;span.style.fontWeight=p.weight;span.style.fontStyle=/italic|oblique/i.test(p.style)?'italic':'normal';span.style.fontSize=p.size+'px';span.style.lineHeight=(p.size*2)+'px';span.textContent=p.text;const marker=document.createElement('i');marker.style.cssText='all:initial;display:inline-block;width:0;height:0;padding:0;border:0;margin:0;vertical-align:baseline';span.appendChild(marker);root.appendChild(span)}document.body.appendChild(root);await document.fonts.ready;return Array.from(root.querySelectorAll('span')).map(span=>span.lastElementChild.getBoundingClientRect().top-span.getBoundingClientRect().top-parseFloat(getComputedStyle(span).lineHeight)/2)})()`) as number[]
  const sourceBaselines=baselines.slice()
  return await withDebugger(contents,'1.3',async send=>{
   await send('DOM.enable');await send('CSS.enable')
   const tree=await send<Protocol.DOM.GetDocumentResponse>('DOM.getDocument',{depth:0}),result:XdRenderedFontFace[]=[]
   for(let index=0;index<values.length;index++){
    signal.throwIfAborted()
    const {nodeId}=await send<Protocol.DOM.QuerySelectorResponse>('DOM.querySelector',{nodeId:tree.root.nodeId,selector:'#'+id+'-'+index})
    if(!nodeId)continue
    const {fonts:used}=await send<Protocol.CSS.GetPlatformFontsForNodeResponse>('CSS.getPlatformFontsForNode',{nodeId})
    let face=used.filter(font=>font.glyphCount>0).sort((a,b)=>b.glyphCount-a.glyphCount)[0]
    let substitutedFrom:string|undefined
    // Private macOS UI instances cannot be reopened by name in Adobe XD.
    if(face?.postScriptName.startsWith('.')){
     substitutedFrom=face.familyName
     baselines[index]=await execute(`(async()=>{const span=document.getElementById(${JSON.stringify(id+'-')}+${index});span.style.fontFamily='"Helvetica Neue", Arial, sans-serif';await document.fonts.ready;return span.lastElementChild.getBoundingClientRect().top-span.getBoundingClientRect().top-parseFloat(getComputedStyle(span).lineHeight)/2})()`) as number
     const updated=await send<Protocol.CSS.GetPlatformFontsForNodeResponse>('CSS.getPlatformFontsForNode',{nodeId})
     face=updated.fonts.filter(font=>font.glyphCount>0).sort((a,b)=>b.glyphCount-a.glyphCount)[0]
    }
    if(face?.postScriptName)result.push({stack:values[index].stack,weight:values[index].weight,style:values[index].style,family:face.familyName,postscript:face.postScriptName,substitutedFrom,sourceBaselineBySize:{[String(values[index].size)]:sourceBaselines[index]},baselineBySize:{[String(values[index].size)]:baselines[index]}})
   }
   const merged=new Map<string,XdRenderedFontFace>();for(const face of result){const key=JSON.stringify([face.stack,face.weight,face.style]),previous=merged.get(key);merged.set(key,{...face,sourceBaselineBySize:{...previous?.sourceBaselineBySize,...face.sourceBaselineBySize},baselineBySize:{...previous?.baselineBySize,...face.baselineBySize}})}
   const resolved=[...merged.values()],samples=[...inkSamples.values()].flatMap(sample=>{const face=resolved.find(f=>xdFontKey(f.stack,f.weight,f.style)===xdFontKey(sample.stack,sample.weight,sample.style));return face?[{...sample,target:face.family,key:xdFontKey(sample.stack,sample.weight,sample.style)}]:[]})
   const ink=await execute(`(()=>{const ctx=document.createElement('canvas').getContext('2d');return ${JSON.stringify(samples)}.map(s=>{const prefix=(/italic|oblique/i.test(s.style)?'italic':'normal')+' '+s.weight+' '+s.size+'px ';ctx.font=prefix+s.stack;const source=ctx.measureText(s.text);ctx.font=prefix+JSON.stringify(s.target);const target=ctx.measureText(s.text);return {face:s.key,textKey:JSON.stringify([s.size,s.text]),value:{sourceWidth:source.width,targetWidth:target.width,sourceLeft:source.actualBoundingBoxLeft,targetLeft:target.actualBoundingBoxLeft,sourceAscent:source.actualBoundingBoxAscent,targetAscent:target.actualBoundingBoxAscent}}})})()`) as {face:string;textKey:string;value:NonNullable<XdRenderedFontFace['inkByText']>[string]}[]
   for(const item of ink){const face=resolved.find(f=>xdFontKey(f.stack,f.weight,f.style)===item.face);if(face)(face.inkByText??={})[item.textKey]=item.value}
   return resolved
  },signal)
 } catch(error){jobSignal.throwIfAborted();console.warn('[xd-fonts] Browser face resolution unavailable:',error instanceof Error?error.message:'Unknown failure');return []}
 finally{if(!contents.isDestroyed())await raceAbort(contents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.remove()`),AbortSignal.timeout(500)).catch(()=>{})}
}
