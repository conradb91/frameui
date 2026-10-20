import {create,type Font} from 'fontkit'
import type {StructuredFont} from '../../shared/types/structuredDesign'
import type {ExportFontFace} from './sketchFonts'

type Names=Record<string,string>
type NamedFont=Font & {fvar?:{axis:{axisTag:string}[];instance:{coord:number[];name:Names;postscriptNameID?:number}[]};name?:{records:{fontFeatures?:Record<string,Names>}}}
const canonical=(v:string)=>v.replace(/["']/g,'').trim().toLowerCase()
const weightOf=(v:string)=>v==='bold'?700:Number(v)||400
const name=(v:Names|undefined)=>v?.en??Object.values(v??{})[0]
export function embeddedFontResolver(fonts:StructuredFont[]){
 const parsed=new Map<string,NamedFont|null>()
 return (stack:string,weight:string,style:string):ExportFontFace|undefined=>{
  const family=(stack.match(/"[^"]*"|'[^']*'|[^,]+/g)??[])[0]?.trim().replace(/^["']|["']$/g,'')
  if(!family)return
  const wanted=weightOf(weight),italic=/italic|oblique/i.test(style)
  const candidates=fonts.filter(f=>canonical(f.family)===canonical(family)).sort((a,b)=>{
   const score=(f:StructuredFont)=>Number(/italic|oblique/i.test(f.style)!==italic)*10000+Math.abs(weightOf(f.weight)-wanted)*2+(wanted>500&&weightOf(f.weight)<wanted?1:0)
   return score(a)-score(b)
  })
  for(const source of candidates){
   if(!parsed.has(source.data))try{const match=/^data:[^,]*;base64,([\s\S]+)$/.exec(source.data);const font=match&&create(Buffer.from(match[1],'base64'));parsed.set(source.data,font&&'layout' in font?font as NamedFont:null)}catch{parsed.set(source.data,null)}
   const font=parsed.get(source.data);if(!font)continue
   const axis=font.fvar?.axis.findIndex(a=>a.axisTag==='wght')??-1
   if(axis>=0){
    const instance=[...font.fvar!.instance].sort((a,b)=>Math.abs(a.coord[axis]-wanted)-Math.abs(b.coord[axis]-wanted)||(wanted>=500?b.coord[axis]-a.coord[axis]:a.coord[axis]-b.coord[axis]))[0]
    const postscript=instance?.postscriptNameID!==undefined?name(font.name?.records.fontFeatures?.[String(instance.postscriptNameID)]):undefined
    const instanceStyle=instance&&name(instance.name)
    if(postscript&&instanceStyle)return {family,style:italic&&!/italic|oblique/i.test(instanceStyle)?(instanceStyle==='Regular'?'Italic':instanceStyle+' Italic'):instanceStyle,postscript}
   }
   if(font.postscriptName)return {family,style:font.getName('preferredSubfamily','en')??font.subfamilyName??'Regular',postscript:font.postscriptName}
  }
 }
}
