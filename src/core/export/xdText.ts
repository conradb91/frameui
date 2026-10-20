import type {FrameUiExportNode} from '../../shared/types/frameuiExport'
type Text=NonNullable<FrameUiExportNode['text']>
/** Preserve the browser's visible lines as editable positioned XD paragraphs.
 * Area frames invite a second layout with different font metrics and clip words/lines.
 */
export function xdPositionedText(t:Text){
 const original=t.characters
 let cursor=0
 const captured=t.captureLines?.length&&t.captureLines.map(l=>l.text).join('').replace(/\s/g,'')===original.replace(/\s/g,'')?t.captureLines:undefined
 const sourceLines=captured?.length?captured.map(l=>{const found=l.start??original.indexOf(l.text,cursor);const start=Math.max(0,found);cursor=start+l.text.length;return {...l,start}}):original.split('\n').map((text,index)=>{const start=cursor;cursor+=text.length+1;return {text,start,x:0,y:index*t.lineHeight,height:t.lineHeight}})
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
