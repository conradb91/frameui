import type {FrameUiExportNode} from '../../shared/types/frameuiExport'
type Text=NonNullable<FrameUiExportNode['text']>
/** Preserve the browser's visible lines as editable positioned XD paragraphs.
 * Area frames invite a second layout with different font metrics and clip words/lines.
 */
export function xdPositionedText(t:Text){
 const original=t.characters
 let cursor=0
 const ellipsis=t.textOverflow==='ellipsis'&&t.captureLines?.length===1&&t.captureLines[0].text.endsWith('…')&&original.startsWith(t.captureLines[0].text.slice(0,-1))
 const captured=t.captureLines?.length&&(ellipsis||t.captureLines.map(l=>l.text).join('').replace(/\s/g,'')===original.replace(/\s/g,''))?t.captureLines:undefined
 const fragments=captured?.length?captured.map(l=>{const found=l.start??original.indexOf(l.text,cursor);const start=Math.max(0,found);cursor=start+l.text.length;return {...l,start}}):original.split('\n').map((text,index)=>{const start=cursor;cursor+=text.length+1;return {text,start,x:0,y:index*t.lineHeight,height:t.lineHeight}})
 // Inline spans can have different weights but occupy the same browser line.
 // Keep their original spaces/ranges in one editable XD line; only real wraps
 // introduce a paragraph break. Deliberately separated fragments stay positioned.
 const sourceLines:typeof fragments=[]
 for(const fragment of fragments){
  const previous=sourceLines.at(-1),end=previous?previous.start+previous.text.length:0
  const gap=previous?original.slice(end,fragment.start):''
  const advanceGap=previous?fragment.x-(previous.x+('width' in previous?Number(previous.width):0)):Infinity
  const sameRow=previous&&Math.abs(previous.y-fragment.y)<=1&&Math.abs(previous.height-fragment.height)<=1
  if(previous&&sameRow&&fragment.start>=end&&/^[ \t]*$/.test(gap)&&advanceGap>=-1&&advanceGap<=t.fontSize){
   const right=Math.max(previous.x+('width' in previous?Number(previous.width):0),fragment.x+('width' in fragment?Number(fragment.width):0))
   previous.text=original.slice(previous.start,fragment.start+fragment.text.length)
   Object.assign(previous,{width:right-previous.x,height:Math.max(previous.height,fragment.height)})
  }else sourceLines.push({...fragment})
 }
 const mapping:number[]=[],lines:{x:number;y:number;height:number;from:number;to:number}[]=[]
 let characters=''
 for(const [index,l] of sourceLines.entries()){
  if(index){characters+='\n';mapping.push(Math.max(0,l.start-1))}
  const from=characters.length
  characters+=l.text
  for(let i=0;i<l.text.length;i++)mapping.push(l.start+i)
  lines.push({x:l.x,y:l.y,height:l.height,from,to:characters.length})
 }
 const runs=(t.runs??[]).flatMap(run=>{
  const result:NonNullable<Text['runs']>=[]
  let start=-1
  for(let i=0;i<=mapping.length;i++){
   const covered=i<mapping.length&&mapping[i]>=run.start&&mapping[i]<run.end
   if(covered&&start<0)start=i
   if(!covered&&start>=0){result.push({...run,start,end:i});start=-1}
  }
  return result
 })
 return {characters,lines,runs}
}
