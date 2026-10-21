import {test,expect} from 'bun:test'
import {formatElapsed} from '../../src/renderer/lib/formatElapsed'
test('elapsed time switches to minutes and seconds after sixty seconds',()=>{
 expect(formatElapsed(0)).toBe('0 sec')
 expect(formatElapsed(59.9)).toBe('59 sec')
 expect(formatElapsed(60)).toBe('1 min | 0 sec')
 expect(formatElapsed(125)).toBe('2 min | 5 sec')
 expect(formatElapsed(-1)).toBe('0 sec')
})
