import type { VisualDocument, VisualObject, VisualPage } from '@shared/types/visualDesign'
import type { StructuredNode } from '@shared/types/structuredDesign'
import { object, applyVisualLayout, cloneObject, visit } from '@core/visual/model'
import { visualObjectSchema } from '@core/visual/schema'
import { makeStructuredFrame } from '@core/capture-compiler/document'
import { visitStructuredNodes,layoutStructured } from '@core/capture-compiler/edit'
import type { Token } from '@shared/types/model/projectModel'

export function artboardSummary(page: VisualPage) {
  const names:string[]=[];const components=new Set<string>();const fonts=new Set<string>()
  visit(page.objects,n=>{names.push(n.name);if(n.source?.component)components.add(n.source.component);if(n.kind==='Text')fonts.add(n.fontFamily)})
  if(page.structured)visitStructuredNodes(page.structured.children,n=>{names.push(n.name);if(n.source.component)components.add(n.source.component);if(n.typography)fonts.add(n.typography.fontFamily)})
  return {id:page.id,name:page.name,width:page.width,height:page.height,route:page.route,layers:names.slice(0,60),components:[...components],fonts:[...fonts]}
}
export function inspectPage(page:VisualPage) {
  return { ...artboardSummary(page), nodes:page.structured?.children ?? page.objects }
}
function findVisual(page:VisualPage,id:string) { let found:VisualObject|undefined;visit(page.objects,n=>{if(n.id===id)found=n});return found }
function findStructured(page:VisualPage,id:string) { let found:StructuredNode|undefined;if(page.structured)visitStructuredNodes(page.structured.children,n=>{if(n.id===id)found=n});return found }
export function inspectSelection(page:VisualPage,ids:string[]) {
  return ids.map(id=>{const node=findStructured(page,id)??findVisual(page,id);return node?{node,parent:page.structured?findStructured(page,(node as StructuredNode).parentId??''):undefined}:null}).filter(Boolean)
}
function copyStructured(node:StructuredNode,parentId:string|null=null):StructuredNode { const result=structuredClone(node);result.id=crypto.randomUUID();result.parentId=parentId;result.children=node.children.map(n=>copyStructured(n,result.id));return result }
export function duplicateArtboard(page:VisualPage,name:string):VisualPage {
  const copy=structuredClone(page);copy.id=crypto.randomUUID();copy.name=name;copy.edited=true;copy.objects=page.objects.map(cloneObject);delete copy.thumbnail
  if(copy.structured){copy.structured.id=copy.id;copy.structured.name=name;copy.structured.children=page.structured!.children.map(n=>copyStructured(n))}
  copy.canvasX=(page.canvasX??0)+page.width+80;return copy
}
export function createArtboard(doc:VisualDocument,name:string,width:number,height:number,templateId?:string):VisualPage {
  const template=templateId?doc.pages.find(p=>p.id===templateId):undefined
  if(templateId&&!template)throw new Error('Template artboard not found.')
  const page=template?duplicateArtboard(template,name):{id:crypto.randomUUID(),name,folder:'Claude',pinned:false,state:'Default',width,height,objects:[],edited:true} satisfies VisualPage
  page.width=width;page.height=height
  if(page.structured){page.structured.width=width;page.structured.height=height}
  if(!template)page.structured=makeStructuredFrame({tag:'body',rect:{x:0,y:0,width,height},styles:{},children:[]},{name,route:'',width,height,durationMs:0})
  if(page.structured){page.structured.captureMetadata.engine='design';delete page.structured.captureMetadata.visualMatch}
  doc.pages.push(page);return page
}

function markEdited(page:VisualPage){page.edited=true;if(page.structured){page.structured.captureMetadata.engine='design';delete page.structured.captureMetadata.visualMatch}}
export function canvasLayout(page:VisualPage,id:string):VisualObject['layout'] {
 const v=findVisual(page,id);if(v)return {...v.layout}
 const n=findStructured(page,id);return {...object('Frame').layout,direction:n?.layout.mode==='stack'?(n.layout.direction==='horizontal'?'row':'column'):'none',gap:n?.layout.gap??0,padding:n?.layout.padding?.top??0}
}
export function createCanvasNode(page:VisualPage,kind:VisualObject['kind'],values:Partial<VisualObject>,parentId?:string):string {
  const node=visualObjectSchema.parse(object(kind,values))
  if(page.structured){
    const n:StructuredNode={id:node.id,name:node.name,type:kind==='Text'?'Text':kind==='Image'?'Image':kind==='Vector'?'SVG':'Container',parentId:parentId??null,children:[],bounds:{x:node.x,y:node.y,width:node.width,height:node.height},layout:{mode:'free'},appearance:{backgroundColor:kind==='Text'||kind==='Vector'||/^(linear|radial|conic)-gradient\(/.test(node.fill)?undefined:node.fill,backgroundImage:kind!=='Text'&&/^(linear|radial|conic)-gradient\(/.test(node.fill)?node.fill:undefined,radius:node.radius,boxShadow:node.shadow,border:node.strokeWidth?{width:node.strokeWidth,color:node.stroke,style:'solid'}:undefined,opacity:node.opacity,rotation:node.rotation,clip:false},source:{tag:kind==='Text'?'span':kind==='Image'?'img':kind==='Vector'?'svg':'div',imageSrc:node.src},constraints:{position:'absolute'},visibility:true,locked:false}
    if(kind==='Input'||kind==='Checkbox'||kind==='Radio'||kind==='Toggle'){n.source.tag='input';n.source.control={type:kind==='Input'?'text':kind==='Radio'?'radio':'checkbox',value:node.text??''}}
    if(kind==='Text'||kind==='Input')n.typography={text:node.text??'',fontFamily:node.fontFamily,fontSize:node.fontSize,fontWeight:node.fontWeight,lineHeight:node.lineHeight,letterSpacing:node.letterSpacing,textAlign:node.textAlign,color:kind==='Input'?'#111827':node.fill}
    if(kind==='Vector'){
      if(!node.path||!/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\s-]+$/.test(node.path))throw new Error('A valid SVG path is required.')
      n.source.svgGeometry={viewBox:node.viewBox??`0 0 ${node.width} ${node.height}`}
      n.children=[{...structuredClone(n),id:crypto.randomUUID(),type:'Shape',parentId:n.id,children:[],source:{tag:'path',svgGeometry:{d:node.path}},appearance:{...n.appearance,fill:node.fill}}]
    }
    const parent=parentId?findStructured(page,parentId):undefined
    if(parentId&&!parent)throw new Error('Parent element not found.')
    ;(parent?.children??page.structured.children).push(n)
    if(parent)layoutStructured(parent)
  }else{
    const parent=parentId?findVisual(page,parentId):undefined
    if(parentId&&!parent)throw new Error('Parent element not found.')
    ;(parent?.children??page.objects).push(node)
    if(parent)applyVisualLayout(parent)
  }
  markEdited(page);return node.id
}
export function changeCanvasNode(page:VisualPage,id:string,patch:Partial<VisualObject>) {
  const visual=findVisual(page,id)
  if(visual){if(visual.locked)throw new Error('Unlock this element before changing it.');Object.assign(visual,visualObjectSchema.parse({...visual,...patch,id:visual.id,children:visual.children}));applyVisualLayout(visual);page.edited=true;return}
  const n=findStructured(page,id)
  if(!n)throw new Error('Element not found in this artboard.')
  if(n.locked)throw new Error('Unlock this element before changing it.')
  for(const k of ['x','y','width','height'] as const)if(patch[k]!==undefined)n.bounds[k]=patch[k]!
  if(patch.name!==undefined)n.name=patch.name
  if(patch.text!==undefined&&n.source.control){const field=n.source.control.placeholder!==undefined?'placeholder':'value';n.source.control={...n.source.control,[field]:patch.text}}
  if(patch.fill!==undefined&&n.tokenBindings){for(const property of (n.typography&&!n.source.control?['color']:['backgroundColor']) as ('color'|'backgroundColor')[])if(n.tokenBindings[property]?.value.toLowerCase()!==patch.fill.toLowerCase())delete n.tokenBindings[property]}
  if(n.typography?.textRuns)for(const run of n.typography.textRuns)for(const key of ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing'] as const)if(patch[key]!==undefined)delete run[key]
  if(n.typography&&['text','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','width','height'].some(key=>patch[key as keyof typeof patch]!==undefined))delete n.typography.captureLines
  if(patch.text!==undefined&&n.typography&&patch.text!==n.typography.text)delete n.typography.textRuns
  if(patch.fill!==undefined){if(n.typography&&!n.source.control){if(/^(linear|radial|conic)-gradient\(/.test(patch.fill)){n.typography.gradient={image:patch.fill};n.typography.color='transparent'}else{n.typography.gradient=null;n.typography.color=patch.fill}if(n.typography.textRuns)n.typography.textRuns=n.typography.textRuns.map(run=>{const copy={...run};delete copy.color;delete copy.gradient;return copy})}else if(/^(linear|radial|conic)-gradient\(/.test(patch.fill)){n.appearance.backgroundImage=patch.fill}else{n.appearance.backgroundColor=patch.fill;delete n.appearance.backgroundImage}}
  if(patch.stroke!==undefined||patch.strokeWidth!==undefined)n.appearance.border={width:patch.strokeWidth??n.appearance.border?.width??1,color:patch.stroke??n.appearance.border?.color??'#000',style:'solid'}
  if(patch.radius)n.appearance.radius=patch.radius
  if(patch.shadow!==undefined)n.appearance.boxShadow=patch.shadow
  if(patch.opacity!==undefined)n.appearance.opacity=patch.opacity
  if(n.typography&&patch.fontSize!==undefined&&patch.lineHeight===undefined)patch.lineHeight=Math.round(patch.fontSize*(n.typography.lineHeight/n.typography.fontSize||1.4))
  if(n.typography)for(const k of ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','text'] as const)if(patch[k]!==undefined)Object.assign(n.typography,{[k]:patch[k]})
  if(patch.layout){n.layout={...n.layout,mode:patch.layout.direction==='none'?'free':'stack',direction:patch.layout.direction==='row'?'horizontal':'vertical',gap:patch.layout.gap,padding:{top:patch.layout.padding,right:patch.layout.padding,bottom:patch.layout.padding,left:patch.layout.padding}};layoutStructured(n)}
  if((patch.width!==undefined||patch.height!==undefined)&&n.parentId){const parent=findStructured(page,n.parentId);if(parent)layoutStructured(parent)}
  markEdited(page)
}
export function deleteCanvasNode(page:VisualPage,id:string) {
  const remove=<T extends {id:string;children:T[]}>(ns:T[]):T[]=>ns.filter(n=>n.id!==id).map(n=>({...n,children:remove(n.children)}))
  page.objects=remove(page.objects);if(page.structured)page.structured.children=remove(page.structured.children);markEdited(page)
}
export function bindToken(page:VisualPage,id:string,property:string,token:Pick<Token,'id'|'value'>) {
  const visual=findVisual(page,id);if(visual)visual.bindings={...visual.bindings,[property]:token.id}
  const structured=findStructured(page,id);if(structured)structured.tokenBindings={...structured.tokenBindings,[property==='fill'?(structured.typography?'color':'backgroundColor'):property]:{token:token.id,value:token.value}}
}
export function cloneComponent(doc:VisualDocument,page:VisualPage,componentId:string,componentName:string,file:string,x:number,y:number,parentId?:string):string {
  let v:VisualObject|undefined,s:StructuredNode|undefined
  for(const p of doc.pages){visit(p.objects,n=>{if(n.componentId===componentId||n.source?.file===file&&n.source?.component===componentName)v=n});if(p.structured)visitStructuredNodes(p.structured.children,n=>{if(n.componentBinding?.componentId===componentId||n.source.file===file&&n.source.component===componentName)s=n})}
  if(page.structured&&s){const n=copyStructured(s,parentId??null);n.bounds.x=x;n.bounds.y=y;n.componentBinding={componentId,confidence:1};const parent=parentId?findStructured(page,parentId):undefined;if(parentId&&!parent)throw new Error('Parent element not found.');(parent?.children??page.structured.children).push(n);return n.id}
  if(!page.structured&&v){const n=cloneObject(v);n.x=x;n.y=y;n.componentId=componentId;n.source={...n.source,file,component:componentName};const parent=parentId?findVisual(page,parentId):undefined;if(parentId&&!parent)throw new Error('Parent element not found.');(parent?.children??page.objects).push(n);return n.id}
  throw new Error('This component has no compatible captured instance. Capture a screen using it first; do not invent its rendered appearance.')
}

/** Place a captured screen as an artboard, preserving its native editable tree. */
export function addScreenToDocument(doc:VisualDocument,source:VisualPage):VisualPage {
  const page=duplicateArtboard(source,source.name)
  page.folder='Designs'
  page.canvasX=doc.pages.length?Math.max(...doc.pages.map(p=>(p.canvasX??0)+p.width))+100:0
  page.canvasY=0
  const empty=doc.pages.length===1&&!doc.pages[0].objects.length&&!doc.pages[0].structured?.children.length
  if(empty){page.canvasX=0;doc.pages=[page]}
  else doc.pages.push(page)
  return page
}

/** Reuse an actual captured subtree, preserving its component and token bindings. */
export function cloneElement(source:VisualPage,target:VisualPage,id:string,x?:number,y?:number,parentId?:string) {
  const node=findStructured(source,id)
  if(!node||!target.structured)throw new Error('Choose a native captured element and a native destination screen.')
  const parent=parentId?findStructured(target,parentId):undefined
  if(parentId&&!parent)throw new Error('Parent element not found.')
  const copy=copyStructured(node,parentId??null)
  copy.bounds.x=x??node.bounds.x;copy.bounds.y=y??node.bounds.y
  ;(parent?.children??target.structured.children).push(copy)
  target.fonts=[...(target.fonts??[]),...(source.fonts??source.structured?.fonts??[]).filter(f=>!target.fonts?.some(old=>old.family===f.family&&old.weight===f.weight&&old.style===f.style))]
  target.structured.fonts=target.fonts
  if(parent)layoutStructured(parent)
  markEdited(target)
  return copy
}
