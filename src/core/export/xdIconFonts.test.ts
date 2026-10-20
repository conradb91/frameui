import {expect,test} from 'bun:test'
import {isIconFontText,iconFontResolver} from './xdIconFonts'
test('private-use icons are detected by glyph content rather than font family names',()=>{
 expect(isIconFontText('\uec30')).toBe(true)
 expect(isIconFontText(String.fromCodePoint(0xf0001))).toBe(true)
 expect(isIconFontText(' \uf485 ')).toBe(true)
 expect(isIconFontText('Keep ordinary text editable')).toBe(false)
 expect(isIconFontText('Label \uec30')).toBe(false)
 expect(isIconFontText('')).toBe(false)
})
test('invalid or missing embedded fonts do not invent replacement icon geometry',()=>{
 const t={characters:'\uec30',fontFamily:'Company Symbols',fontSize:20,fontWeight:'400',lineHeight:24,letterSpacing:0,fontStyle:'normal',alignment:'left'} as const
 expect(iconFontResolver([])(t)).toBeUndefined()
 expect(iconFontResolver([{family:'Company Symbols',weight:'400',style:'normal',data:'data:font/woff2;base64,AAAA'}])(t)).toBeUndefined()
})
