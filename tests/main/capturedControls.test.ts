import {test,expect} from 'bun:test'
import {controlStyleFor,styleToInlineCss} from '../../src/core/capture-compiler/structuredNodeStyle'
import type {StructuredNode} from '../../src/shared/types/structuredDesign'
test('captured controls reset application defaults and preserve source sizing and placeholder paint',()=>{
 const node={appearance:{radius:[8,8,8,8],backgroundColor:'#f3faf8',opacity:1,border:{width:1,style:'solid',color:'#aaccc0'}},source:{control:{type:'text',placeholderColor:'#51786b',placeholderOpacity:.65}},layout:{mode:'free',padding:{top:8,right:12,bottom:8,left:12}}} as StructuredNode
 const style=controlStyleFor(node)
 expect(style.all).toBe('initial');expect(style.boxSizing).toBe('border-box');expect(style.minHeight).toBe(0)
 expect(style.backgroundColor).toBe('#f3faf8');expect(style.border).toBe('1px solid #aaccc0');expect(style.padding).toBe('8px 12px 8px 12px')
 expect(style.height).toBe('100%');expect(style['--frameui-placeholder-color']).toBe('#51786b')
 expect(styleToInlineCss(style)).toContain('--frameui-placeholder-opacity:0.65')
})
