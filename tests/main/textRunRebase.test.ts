import {test,expect} from 'bun:test'
import {rebaseTextRuns} from '../../src/core/visual/textRuns'
test('changing training to partner retains the blue C and remainder of the next line',()=>{
 const before='Find the right training.\nCompare your options.',after='Find the right partner.\nCompare your options.'
 const start=before.indexOf('Compare'),next=after.indexOf('Compare')
 const runs=rebaseTextRuns(before,after,[{start,end:before.length,color:'#0099ff',fontWeight:700}])
 expect(runs).toEqual([{start:next,end:after.length,color:'#0099ff',fontWeight:700}])
 const edited=after.replace('Compare','compare')
 expect(rebaseTextRuns(after,edited,runs)).toEqual([{start:next,end:edited.length,color:'#0099ff',fontWeight:700}])
})
