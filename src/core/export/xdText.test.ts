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

test('inline mixed weights retain one browser line and its original space',()=>{
 const t=xdPositionedText({...base,characters:'Your crew compliance',fontSize:16,lineHeight:24,runs:[{start:10,end:20,fontWeight:'700'}],captureLines:[{text:'Your crew',start:0,x:12,y:8,width:74,height:24},{text:'compliance',start:10,x:90,y:8,width:90,height:24}]})
 expect(t.characters).toBe('Your crew compliance')
 expect(t.lines).toEqual([{x:12,y:8,height:24,from:0,to:20}])
 expect(t.runs).toEqual([{start:10,end:20,fontWeight:'700'}])
})
test('inline fragments never merge across a hard newline or deliberate layout gap',()=>{
 const hard=xdPositionedText({...base,characters:'First\nSecond',captureLines:[{text:'First',start:0,x:0,y:0,width:70,height:24},{text:'Second',start:6,x:75,y:0,width:90,height:24}]})
 expect(hard.lines).toHaveLength(2)
 const spaced=xdPositionedText({...base,characters:'First Second',fontSize:16,captureLines:[{text:'First',start:0,x:0,y:0,width:70,height:24},{text:'Second',start:6,x:300,y:0,width:90,height:24}]})
 expect(spaced.lines).toHaveLength(2)
})

test('measured CSS ellipsis exports the visible editable prefix without accepting stale text',()=>{
 const captureLines=[{text:'Seafarer record…',start:0,x:0,y:0,width:140,height:14.3}]
 const t=xdPositionedText({...base,characters:'Seafarer record and discharge book validity',textOverflow:'ellipsis',captureLines})
 expect(t.characters).toBe('Seafarer record…')
 expect(t.lines).toHaveLength(1)
 expect(xdPositionedText({...base,characters:'New subtitle',textOverflow:'ellipsis',captureLines}).characters).toBe('New subtitle')
})
