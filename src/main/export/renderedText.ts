import {randomUUID} from 'node:crypto'
import type {WebContents} from 'electron'
import type {VisualDocument} from '../../shared/types/visualDesign'
import type {StructuredTypography} from '../../shared/types/structuredDesign'
import {typographyStyleFor} from '../../core/capture-compiler/structuredNodeStyle'
import {textSegments} from '../../core/visual/textRuns'
import {textRunStyle} from '../../core/capture-compiler/textPaint'
import {raceAbort} from '../ipc/handlers/capture/raceAbort'
export type ExportTextLines=Record<string,NonNullable<StructuredTypography['captureLines']>>
/** Re-measure edited/native text with the same Chromium styles used on the design canvas.
 * Existing captured lines are already positioned in FrameUI and remain authoritative.
 */
export async function renderedExportText(contents:WebContents,document:{pages:Pick<VisualDocument['pages'][number],'id'|'objects'|'structured'|'fonts'>[]},jobSignal:AbortSignal):Promise<ExportTextLines>{
 const signal=AbortSignal.any([jobSignal,AbortSignal.timeout(20000)]),id='frameui-line-probe-'+randomUUID()
 const items:{key:string;text:string;width:number;lineHeight:number;style:ReturnType<typeof typographyStyleFor>;segments:{text:string;style:ReturnType<typeof textRunStyle>}[]}[]=[]
 for(const page of document.pages){
  const add=(key:string,width:number,t:StructuredTypography)=>{if(!t.text||(t.captureLines?.length&&t.textOverflow!=='ellipsis'))return;items.push({key,text:t.text,width,lineHeight:t.lineHeight,style:typographyStyleFor(t),segments:textSegments(t.text,t.textRuns).map(s=>({text:s.text,style:textRunStyle(s)}))})}
  const structured=(nodes:NonNullable<typeof page.structured>['children'])=>{for(const n of nodes){if(n.typography)add(page.id+':'+n.id,n.bounds.width,n.typography);structured(n.children)}}
  if(page.structured)structured(page.structured.children)
  const visual=(nodes:typeof page.objects)=>{for(const n of nodes){if(n.kind==='Text')add(page.id+':'+n.id,n.width,{text:n.text??'',fontFamily:n.fontFamily,fontSize:n.fontSize,fontWeight:n.fontWeight,lineHeight:n.lineHeight,letterSpacing:n.letterSpacing,textAlign:n.textAlign,color:n.fill,textRuns:n.textRuns});visual(n.children)}}
  visual(page.structured?page.objects.filter(n=>n.designOnly):page.objects)
 }
 const fonts=[...new Map(document.pages.flatMap(p=>p.structured?.fonts??p.fonts??[]).map(f=>[JSON.stringify([f.family,f.weight,f.style,f.data]),f])).values()]
 if(!items.length)return {}
 signal.throwIfAborted()
 try{return await raceAbort(contents.executeJavaScript(`(async()=>{
 const root=document.createElement('div');root.id=${JSON.stringify(id)};root.style.cssText='all:initial;position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;contain:layout style';document.body.append(root);
 const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(fonts.map(f=>'@font-face{font-family:'+JSON.stringify(f.family)+';font-weight:'+f.weight+';font-style:'+f.style+';src:url('+JSON.stringify(f.data)+');'+(f.unicodeRange?'unicode-range:'+f.unicodeRange+';':'')+'}').join(''))};root.append(sheet);
 const result={};
 try{for(const item of ${JSON.stringify(items)}){
  if(!root.isConnected)throw Error('Export canceled');
  const host=document.createElement('div');host.style.cssText='all:initial;display:block;position:relative;box-sizing:content-box;margin:0;padding:0;border:0';Object.assign(host.style,item.style);host.style.width=item.width+'px';

  for(const segment of item.segments){const span=document.createElement('span');span.style.cssText='all:unset';Object.assign(span.style,segment.style);span.textContent=segment.text;host.append(span)}root.append(host);await document.fonts.ready;
  const box=host.getBoundingClientRect(),walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),rows=[],chars=[];let offset=0,text;
  while(text=walker.nextNode()){if(text.parentElement===sheet)continue;for(let i=0;i<text.length;i++){
   const range=document.createRange();range.setStart(text,i);range.setEnd(text,i+1);const rect=range.getBoundingClientRect(),start=offset+i;chars.push({end:start+1,right:rect.right-box.left});if(!rect.height||text.data[i]==='\\n')continue;
   let row=rows.find(r=>Math.min(r.bottom,rect.bottom)-Math.max(r.top,rect.top)>Math.min(r.bottom-r.top,rect.height)*.5);if(!row){row={top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,from:start,to:start+1};rows.push(row)}else{row.top=Math.min(row.top,rect.top);row.bottom=Math.max(row.bottom,rect.bottom);row.from=Math.min(row.from,start);row.to=Math.max(row.to,start+1);row.left=Math.min(row.left,rect.left);row.right=Math.max(row.right,rect.right)}
  }offset+=text.length}
  rows.sort((a,b)=>a.top-b.top||a.from-b.from);
  if(item.style.textOverflow==='ellipsis'&&rows.length===1&&rows[0].right-box.left>item.width){
   const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=getComputedStyle(host.firstElementChild||host).font;const dots=ctx.measureText('…').width;
   const end=chars.filter(c=>c.right<=item.width-dots).at(-1)?.end||0;
   result[item.key]=[{text:item.text.slice(0,end)+'…',start:0,x:0,y:0,width:item.width,height:item.lineHeight}];host.remove();continue;
  }
  result[item.key]=rows.map((r,i)=>({text:item.text.slice(r.from,r.to),start:r.from,x:r.left-box.left,y:Math.max(0,Math.round((r.top-box.top)/item.lineHeight)*item.lineHeight),width:r.right-r.left,height:item.lineHeight}));host.remove();
 }}finally{root.remove()}return result})()`),signal) as ExportTextLines}
 finally{if(!contents.isDestroyed())await raceAbort(contents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.remove()`),AbortSignal.timeout(500)).catch(()=>{})}
}
