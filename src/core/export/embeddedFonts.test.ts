import {test,expect} from 'bun:test'
import fs from 'node:fs'
import {embeddedFontResolver} from './embeddedFonts'
import {buildXdDocument} from './xdDocument'
import {object} from '../visual/model'
const data='data:font/woff2;base64,'+fs.readFileSync(new URL('../../../tests/fixtures/fonts/PublicSans-latin-variable.woff2',import.meta.url)).toString('base64')
const fonts=[{family:'Public Sans',weight:'400',style:'normal',data}]
test('embedded variable fonts retain CSS family and each named weight rather than the default Thin face',()=>{
 const resolve=embeddedFontResolver(fonts)
 for(const [weight,style] of [[300,'Light'],[400,'Regular'],[500,'Medium'],[600,'SemiBold'],[700,'Bold'],[800,'ExtraBold']] as const){
  expect(resolve('Public Sans, Arial',String(weight),'normal')).toEqual({family:'Public Sans',style,postscript:'PublicSansRoman-'+style})
 }
 expect(resolve('Arial','400','normal')).toBeUndefined()
})
test('native XD uses source font metadata even when browser fallback measurement reports Helvetica',()=>{
 const doc={version:1 as const,id:'public-sans',name:'Source typography',updatedAt:'now',components:[],variables:[],pages:[{id:'page',name:'Page',width:1440,height:1024,folder:'',state:'',pinned:false,fonts,objects:[object('Text',{id:'label',text:'Audit',fontFamily:'Public Sans, Arial',fontWeight:'500',textRuns:[{start:0,end:2,fontWeight:'800'}]})]}]}
 const result=buildXdDocument({jobId:'fonts',document:doc,scope:'all',includePrototype:false},()=>{},[],[{stack:'Public Sans, Arial',weight:'500',style:'Regular',family:'Helvetica Neue',postscript:'HelveticaNeue'}])
 const scene=JSON.parse(result.entries.find(e=>e.path.startsWith('artwork/artboard-')&&e.path.endsWith('.agc'))!.data.toString())
 const node=scene.children[0].artboard.children[0]
 expect(node.style.font).toMatchObject({family:'Public Sans',style:'Medium',postscriptName:'PublicSansRoman-Medium'})
 expect(node.meta.ux.rangedStyles[0]).toMatchObject({fontFamily:'Public Sans',fontStyle:'ExtraBold',postscriptName:'PublicSansRoman-ExtraBold'})
})
