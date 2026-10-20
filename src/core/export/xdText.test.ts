import {test,expect} from 'bun:test'
import {xdPositionedText} from './xdText'
import type {FrameUiExportNode} from '../../shared/types/frameuiExport'
const base={characters:'Find training.\nCompare options.',fontFamily:'Arial',fontStyle:'normal',fontWeight:'700',fontSize:54,lineHeight:61,letterSpacing:-2,alignment:'left',color:'#123456'} as NonNullable<FrameUiExportNode['text']>
test('hard and captured soft lines remain separate positioned editable paragraphs with range styles',()=>{
 const t=xdPositionedText({...base,characters:'Find training. Compare options.',captureLines:[{text:'Find training.',start:0,x:0,y:0,width:300,height:61},{text:'Compare options.',start:15,x:0,y:61,width:350,height:61}],runs:[{start:15,end:31,color:'#0595ff',fontWeight:'800'}]})
 expect(t.characters).toBe('Find training.\nCompare options.')
 expect(t.lines.map(l=>[l.from,l.to,l.y])).toEqual([[0,14,0],[15,31,61]])
 expect(t.runs).toEqual([{start:15,end:31,color:'#0595ff',fontWeight:'800'}])
})
test('fallback explicit line breaks retain all text without a fixed-height area box',()=>{
 const t=xdPositionedText(base)
 expect(t.characters).toBe(base.characters)
 expect(t.lines).toHaveLength(2)
 expect(t.lines[1]).toMatchObject({from:15,to:31,y:61})
})

test('stale captured lines cannot replace edited design text',()=>{
 const t=xdPositionedText({...base,characters:'Updated title',captureLines:[{text:'Old title',start:0,x:0,y:0,width:100,height:30}]})
 expect(t.characters).toBe('Updated title')
})
