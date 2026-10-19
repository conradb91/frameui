import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import type { ProjectIndex } from '@shared/types/projectIndex'
import type { VisualPage } from '@shared/types/visualDesign'
import { readSource } from './repoAccess'
/** Font bytes stay local. Claude receives descriptors, never chooses filesystem URLs. */
export function resolveProjectFonts(root:string,index:ProjectIndex):NonNullable<VisualPage['fonts']> {
 const fonts:NonNullable<VisualPage['fonts']>=[],canonical=fs.realpathSync(root)
 let total=0
 for(const file of Object.keys(index.files??{}).filter(f=>/\.css$/i.test(f)).slice(0,100)){
  try{postcss.parse(readSource(root,file)).walkAtRules('font-face',rule=>{
   if(fonts.length>=40||total>12_000_000)return
   const values:Record<string,string>={};rule.walkDecls(d=>{values[d.prop]=d.value})
   const family=(values['font-family']??'').replace(/^['"]|['"]$/g,'');if(!family)return
   const urls=[...(values.src??'').matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)].map(m=>m[1].split('?')[0].split('#')[0])
   for(const url of urls){
    if(/^(?:data:|https?:|\/\/)/i.test(url))continue
    const candidates=url.startsWith('/')?[path.join(root,'public',url),path.join(root,url)]:[path.resolve(root,path.dirname(file),url)]
    const source=candidates.find(f=>fs.existsSync(f));if(!source)continue
    const real=fs.realpathSync(source),relative=path.relative(canonical,real)
    if(relative.startsWith('..')||path.isAbsolute(relative)||!fs.statSync(real).isFile()||fs.statSync(real).size>2_000_000)continue
    const ext=path.extname(real).slice(1).toLowerCase();if(!['woff','woff2','ttf','otf'].includes(ext))continue
    const weight=values['font-weight']??'400',style=values['font-style']??'normal';if(fonts.some(f=>f.family===family&&f.weight===weight&&f.style===style&&f.unicodeRange===values['unicode-range']))break
    const bytes=fs.readFileSync(real);total+=bytes.length;fonts.push({family,weight,style,stretch:values['font-stretch'],unicodeRange:values['unicode-range'],data:`data:font/${ext};base64,${bytes.toString('base64')}`});break
   }
  })}catch{/* Unresolved font rules stay unresolved; never substitute remote bytes. */}
 }
 return fonts
}
