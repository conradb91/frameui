import {expect,test} from 'bun:test'
import {attachCssSvgMaskIcons} from '../../src/main/ipc/handlers/cdp/cssSvgMaskIcons'
import type {CapturedElement} from '../../src/shared/types/runtimeCapture'
const node=(tag:string):CapturedElement=>({tag,rect:{x:10,y:20,width:14,height:14},styles:{},children:[]})
test('missing pseudo mask icons become source SVG geometry without duplicate pseudo paint',()=>{
 const root=node('span');root.attributes={captureSelector:'#icon'}
 const old=node('frameui-visual');old.attributes={'data-frameui-pseudo':'before'};root.children=[old]
 const svg=node('svg');svg.children=[node('path')]
 attachCssSvgMaskIcons(root,[{selector:'#icon',pseudo:'before',node:svg}])
 expect(root.children).toEqual([svg]);expect(svg.rect).toEqual({x:10,y:20,width:14,height:14})
})
test('ordinary SVG masks keep the owner opacity and replace its painted mask once',()=>{
 const root=node('span');root.attributes={captureSelector:'#icon'};root.styles={maskImage:'url(data:image/svg+xml,mask)',backgroundColor:'#333',opacity:'.5'}
 const svg=node('svg');attachCssSvgMaskIcons(root,[{selector:'#icon',node:svg}])
 expect(root.styles).toMatchObject({maskImage:'none',backgroundColor:'transparent',opacity:'.5'})
 expect(root.children).toEqual([svg])
})
