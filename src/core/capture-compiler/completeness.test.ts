import {test,expect} from 'bun:test'
import {captureCompletenessWarnings} from './completeness'
import {makeStructuredFrame} from './document'
import type {CapturedElement} from '../../shared/types/runtimeCapture'
const text=(value:string):CapturedElement=>({tag:'frameui-text',textPreview:value,rect:{x:0,y:0,width:100,height:20},styles:{},children:[]})
const fixture=():CapturedElement=>({tag:'body',rect:{x:0,y:0,width:1440,height:1000},styles:{},children:[text('Crew details'),{tag:'input',attributes:{type:'radio'},rect:{x:0,y:40,width:20,height:20},styles:{},children:[]},{tag:'span',rect:{x:0,y:0,width:1,height:1},styles:{clip:'rect(0,0,0,0)'},children:[text('Hidden accessibility label')]}]})
const frame=(root:CapturedElement)=>makeStructuredFrame(root,{name:'Capture',route:'/',width:1440,height:1000,durationMs:0})
test('capture checks preserve visible text and controls without flagging clipped accessibility content',()=>{
 const root=fixture();expect(captureCompletenessWarnings(root,frame(root))).toEqual([])
})
test('capture checks report lost visible text and radio controls instead of silently passing',()=>{
 const root=fixture(),f=frame(root);f.children=[]
 expect(captureCompletenessWarnings(root,f)).toHaveLength(2)
 expect(captureCompletenessWarnings(root,f).join(' ')).toContain('1 form controls')
})
test('single private-use icon glyphs also participate in capture completeness checks',()=>{
 const root=fixture();root.children=[text('\ue001')];const f=frame(root);f.children=[]
 expect(captureCompletenessWarnings(root,f)[0]).toContain('1 visible text fragments')
})
test('a truncated artboard height is reported even when all text and controls exist',()=>{
 const root=fixture(),f=frame(root);f.height=1
 expect(captureCompletenessWarnings(root,f).join(' ')).toContain('extends beyond the artboard height')
})
test('missing SVG icon geometry is included in capture diagnostics',()=>{
 const root=fixture();root.children=[{tag:'svg',rect:{x:0,y:0,width:24,height:24},styles:{},children:[{tag:'path',rect:{x:0,y:0,width:24,height:24},attributes:{d:'M0 0L24 24'},styles:{},children:[]}]}];const f=frame(root);f.children=[]
 expect(captureCompletenessWarnings(root,f)[0]).toContain('1 SVG shapes')
})
