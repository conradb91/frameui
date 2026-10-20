import {expect,test} from 'bun:test'
import {emptyLegacyClip,legacyClipPath} from './legacyClip'
import {compileStructuredNodes} from './compile'
import {richTextFromCapture} from './capturedRichText'
import type {CapturedElement} from '../../shared/types/runtimeCapture'
test('zero-area CSS clips hide accessibility labels without hiding normal aria-labelled text',()=>{
 const hidden:CapturedElement={tag:'span',styles:{clip:'rect(0px, 0px, 0px, 0px)'},rect:{x:0,y:0,width:1,height:1},children:[{tag:'frameui-text',textPreview:'Compliant:',styles:{},rect:{x:0,y:0,width:70,height:18},children:[]}]}
 expect(emptyLegacyClip(hidden.styles.clip)).toBe(true)
 expect(compileStructuredNodes(hidden)).toEqual([])
 expect(richTextFromCapture(hidden).text).toBe('')
 expect(compileStructuredNodes({...hidden,styles:{},rect:{x:0,y:0,width:70,height:18}})[0].typography?.text).toBe('Compliant:')
})
test('nonempty legacy clips retain exact offsets and auto edges',()=>{
 expect(emptyLegacyClip('rect(0, 80px, 30px, 10px)')).toBe(false)
 expect(legacyClipPath('rect(0, 80px, 30px, 10px)',100,40)).toBe('inset(0px 20px 10px 10px)')
 expect(legacyClipPath('rect(auto auto auto auto)',100,40)).toBe('inset(0px 0px 0px 0px)')
 expect(legacyClipPath('auto',100,40)).toBeUndefined()
})
