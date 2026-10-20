import type {CapturedElement} from '../../shared/types/runtimeCapture'
import type {StructuredFrame} from '../../shared/types/structuredDesign'
import {emptyLegacyClip} from './legacyClip'

/** Cheap structural checks on every capture; diagnostics do not replace visual comparison. */
export function captureCompletenessWarnings(root:CapturedElement,frame:StructuredFrame):string[]{
 const expected=new Map<string,number>(),controls=new Map<string,number>()
 const svgTags=new Set(['path','rect','circle','ellipse','line','polygon','polyline','use']);let expectedSvg=0,capturedSvg=0
 const svg=(n:CapturedElement)=>{if(n.styles.display==='none'||n.styles.visibility==='hidden'||n.styles.opacity==='0')return;if(svgTags.has(n.tag))expectedSvg++;n.children.forEach(svg)}
 const normalize=(text:string)=>text.replace(/[\s\u00ad\u200b]/g,'')
 const controlType=(n:CapturedElement)=>{const type=n.attributes?.type||'text';return n.tag==='input'?(['email','password','number','range','checkbox','radio','date','time','hidden','file','color','button','submit','reset','image'].includes(type)?type:'text'):n.tag}
 const source=(n:CapturedElement)=>{
  const s=n.styles
  if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0'||emptyLegacyClip(s.clip))return
  if(['input','select','textarea'].includes(n.tag)){
   const type=controlType(n)
   if(!['hidden','file','color','button','submit','reset','image'].includes(type))controls.set(type,(controls.get(type)??0)+1)
   return
  }
  if(n.tag==='svg'){svg(n);return} // SVG labels remain vector content, not plain typography.
  if(n.tag==='frameui-text'){
   const text=normalize(n.textPreview??'')
   if(text.length>=2||/[\uE000-\uF8FF]/.test(text))expected.set(text,(expected.get(text)??0)+1)
  }
  n.children.forEach(source)
 }
 source(root)
 let actual='',outside=false;const capturedControls=new Map<string,number>()
 const captured=(nodes:StructuredFrame['children'],parentY=0,clipBottom=Infinity)=>{for(const n of nodes){
  const y=parentY+n.bounds.y,bottom=Math.min(y+n.bounds.height,clipBottom)
  if((n.typography||n.source.control||n.source.imageSrc)&&bottom>frame.height+4)outside=true
  if(svgTags.has(n.source.tag))capturedSvg++
  if(n.typography)actual+=normalize(n.typography.text)
  const type=n.source.control?.type
  if(type)capturedControls.set(type,(capturedControls.get(type)??0)+1)
  const clipped=n.appearance.clipY??n.appearance.clip
  captured(n.children,y,clipped?Math.min(clipBottom,y+n.bounds.height):clipBottom)
 }}
 captured(frame.children)
 let missingText=0,missingControls=0
 for(const [text,count] of expected){let found=0,index=0;while((index=actual.indexOf(text,index))>=0){found++;index+=text.length}missingText+=Math.max(0,count-found)}
 for(const [type,count] of controls)missingControls+=Math.max(0,count-(capturedControls.get(type)??0))
 const warnings:string[]=[]
 if(outside)warnings.push('Capture review: visible content extends beyond the artboard height. Recapture this screen to avoid a clipped export.')
 if(capturedSvg<expectedSvg)warnings.push(`Capture review: ${expectedSvg-capturedSvg} SVG shapes could not be matched to editable vectors. Compare icons and illustrations before handoff.`)
 if(missingText)warnings.push(`Capture review: ${missingText} visible text fragments could not be matched to editable layers. Compare this screen with its HTML before handoff.`)
 if(missingControls)warnings.push(`Capture review: ${missingControls} form controls could not be matched to editable controls. Recapture this screen before handoff.`)
 return warnings
}
