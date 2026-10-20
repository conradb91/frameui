import { expect, test } from 'bun:test'
import { resolveXdCssFont, xdFontKey } from './xdFonts'
test('CSS preference chooses first installed family, then closest weight instead of inventing a face', () => {
  const faces = [
    { family: 'Arial', style: 'Regular', postscript: 'ArialMT' },
    { family: 'Arial', style: 'Bold', postscript: 'Arial-BoldMT' },
    { family: 'Other', style: 'SemiBold', postscript: 'Other-SemiBold' },
  ]
  expect(resolveXdCssFont(faces, '"Public Sans", Arial, Other', '650', 'normal')).toEqual(faces[1])
  expect(resolveXdCssFont(faces, '"Public Sans", Other, Arial', '650', 'normal')).toEqual(faces[2])
  expect(resolveXdCssFont(faces, 'Public Sans, Arial', '750', 'normal')).toEqual(faces[1])
  expect(xdFontKey('"Public Sans", Inter', '650', 'Regular')).toBe(
    xdFontKey('Public Sans,Inter', '650', 'normal'),
  )
})
