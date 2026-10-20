import {create,type Font} from 'fontkit'
import svgpath from 'svgpath'
import type {StructuredFont} from '../../shared/types/structuredDesign'
import type {FrameUiExportNode} from '../../shared/types/frameuiExport'

export function isIconFontText(value:string):boolean {
 const chars=[...value].filter(c=>! /\s/u.test(c))
 return chars.length>0&&chars.every(c=>{const p=c.codePointAt(0)!;return p>=0xe000&&p<=0xf8ff||p>=0xf0000&&p<=0xffffd||p>=0x100000&&p<=0x10fffd})
}
/** Only private-use icon text is outlined. Normal text stays editable as text.
 * Read the captured font, never guess an icon from its name or a system fallback.
 */
export type IconFontCache=Map<string,Font|null>
export function iconFontResolver(fonts:StructuredFont[],cache:IconFontCache=new Map()) {
 return (t:NonNullable<FrameUiExportNode['text']>,baseline?:(height:number)=>number):string|undefined=>{
  if(!isIconFontText(t.characters))return
  const families=(t.fontFamily.match(/"[^"]*"|'[^']*'|[^,]+/g)??[]).map(f=>f.replace(/["']/g,'').trim().toLowerCase())
  const candidates=fonts.filter(f=>families.includes(f.family.toLowerCase())).sort((a,b)=>families.indexOf(a.family.toLowerCase())-families.indexOf(b.family.toLowerCase())||Math.abs((Number(a.weight)||400)-(Number(t.fontWeight)||400))-Math.abs((Number(b.weight)||400)-(Number(t.fontWeight)||400)))
  for(const source of candidates){
   if(!cache.has(source.data)){
    try{const data=/^data:[^,]*;base64,([\s\S]+)$/.exec(source.data);const parsed=data&&create(Buffer.from(data[1],'base64'));cache.set(source.data,parsed&&'layout' in parsed?parsed:null)}catch{cache.set(source.data,null)}
   }
   const font=cache.get(source.data)
   if(!font||[...t.characters].some(c=>! /\s/u.test(c)&&!font.hasGlyphForCodePoint(c.codePointAt(0)!)))continue
   const scale=t.fontSize/font.unitsPerEm
   const lines=t.captureLines?.length?t.captureLines:t.characters.split('\n').map((text,i)=>({text,x:0,y:i*t.lineHeight,height:t.lineHeight}))
   const paths:string[]=[]
   for(const line of lines){
    const run=font.layout(line.text);let x=line.x
    const base=line.y+(baseline?.(line.height)??(line.height-(font.ascent-font.descent)*scale)/2+font.ascent*scale)
    for(const [i,glyph] of run.glyphs.entries()){
     const pos=run.positions[i],path=glyph.path.toSVG()
     if(path)paths.push(svgpath(path).matrix([scale,0,0,-scale,x+pos.xOffset*scale,base-pos.yOffset*scale]).round(5).toString())
     x+=pos.xAdvance*scale+t.letterSpacing
    }
   }
   if(paths.length)return paths.join(' ')
  }
 }
}
