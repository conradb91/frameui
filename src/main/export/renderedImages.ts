import type {WebContents} from 'electron'
import type {StructuredFrame,StructuredNode} from '../../shared/types/structuredDesign'
import {xdImageColorFilter,type XdRenderedImageEffect} from '../../core/export/xdImages'
import {xdImageSource,splitXdCssLayers} from '../../core/export/xdBackgrounds'
import {raceAbort} from '../ipc/handlers/capture/raceAbort'

/** Bake only image colour adjustments, retaining editable image geometry and original source. */
export async function renderedExportImages(contents:WebContents,document:{pages:{structured?:StructuredFrame}[]},jobSignal:AbortSignal):Promise<XdRenderedImageEffect[]> {
 const signal=AbortSignal.any([jobSignal,AbortSignal.timeout(20000)]),items=new Map<string,{source:string;filter:string}>()
 function walk(n:StructuredNode){const a=n.appearance,filter=a.filter;if(!n.children.length&&!n.typography&&filter&&xdImageColorFilter.test(filter)){const layers=splitXdCssLayers(a.backgroundImage??'');const source=layers.length===1?xdImageSource(layers[0]):undefined;if(source?.startsWith('data:image/'))items.set(JSON.stringify([source,filter]),{source,filter})}n.children.forEach(walk)}
 for(const page of document.pages)page.structured?.children.forEach(walk)
 const result:XdRenderedImageEffect[]=[]
 for(const item of items.values()){
  signal.throwIfAborted()
  const data=await raceAbort(contents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify(item.source)};await image.decode();if(image.naturalWidth*image.naturalHeight>40000000)throw Error('Effect image exceeds render limit');const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.filter=${JSON.stringify(item.filter)};ctx.drawImage(image,0,0);return canvas.toDataURL('image/png')})()`),signal) as string
  result.push({...item,data})
 }
 return result
}
