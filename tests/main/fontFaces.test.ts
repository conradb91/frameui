import {test,expect} from 'bun:test'
import {unicodeRangeKey} from '../../src/main/ipc/handlers/capture/fontFaces'
test('Google Fonts padded ranges match Chromium FontFace Unicode ranges',()=>{
 expect(unicodeRangeKey('U+0000-00FF, U+0131, U+0152-0153')).toBe(unicodeRangeKey('U+0-FF,U+131,U+152-153'))
 expect(unicodeRangeKey('U+4??')).toBe(unicodeRangeKey('U+0400-04FF'))
 expect(unicodeRangeKey('U+0100-01FF,U+0000-00FF')).toBe(unicodeRangeKey('U+0000-01FF'))
 expect(unicodeRangeKey()).not.toBe(unicodeRangeKey('U+0-FF'))
})
