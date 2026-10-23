import {test,expect} from 'bun:test'
import {chromium} from 'playwright-core'
import {collectExportTextProbes,renderedExportText} from '../../src/main/export/renderedText'
const text=(id:string,value:string,extra={})=>({id,children:[],bounds:{width:180},source:{},typography:{text:value,fontFamily:'Arial',fontSize:14,fontWeight:'400',lineHeight:18,letterSpacing:0,textAlign:'left',color:'#111',...extra}})
const page=(id:string,children:any[])=>({id,objects:[],structured:{children,fonts:[]}})
test('export measurements reuse identical flow text and retain distinct geometry and styles',()=>{
 const document:any={pages:[page('one',[text('a','Repeated'),text('b','Captured',{captureLines:[{text:'Captured'}]}),{...text('c','Input'),source:{control:{type:'text'}}},text('d','Clipped',{textOverflow:'ellipsis',captureLines:[{text:'Clipped'}]})]),page('two',[text('a','Repeated'),text('b','Repeated',{fontWeight:'700'}),{...text('c','Repeated'),bounds:{width:220}}])]}
 const {items,aliases}=collectExportTextProbes(document)
 expect(items).toHaveLength(4)
 expect([...aliases.values()].some(keys=>keys.includes('one:a')&&keys.includes('two:a'))).toBe(true)
 expect(items.some(item=>item.text==='Captured'||item.text==='Input')).toBe(false)
 expect(items.some(item=>item.text==='Clipped')).toBe(true)
})
test('large text exports measure in batches, populate every flow occurrence and clean up probes',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{const view=await browser.newPage();await view.setContent('<main>Editor stays unchanged</main>');const document:any={pages:[page('unique',Array.from({length:260},(_,i)=>text('n'+i,'Item '+i))),...Array.from({length:200},(_,i)=>page('copy'+i,[text('n','Item 0')]))]},progress:number[]=[]
 const lines=await renderedExportText({executeJavaScript:(script:string)=>view.evaluate(script),isDestroyed:()=>false} as any,document,new AbortController().signal,done=>progress.push(done))
 expect(progress).toEqual([128,256,260]);expect(Object.keys(lines)).toHaveLength(460)
 expect(lines['unique:n259'][0].text).toBe('Item 259');expect(lines['copy199:n'][0].text).toBe('Item 0')
 expect(await view.locator('[id^="frameui-line-probe-"]').count()).toBe(0);expect(await view.locator('main').textContent()).toBe('Editor stays unchanged')
 }finally{await browser.close()}
},30000)
