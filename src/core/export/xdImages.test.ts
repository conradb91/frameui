import { expect, test } from 'bun:test'
import { xdObjectImageBounds } from './xdImages'
test('image object-fit crop preserves intrinsic ratio and CSS object-position', () => {
  expect(xdObjectImageBounds(100, 100, 200, 100, 'cover', '75% 50%')).toEqual({ x: -75, y: 0, width: 200, height: 100 })
  expect(xdObjectImageBounds(100, 100, 200, 100, 'contain')).toEqual({ x: 0, y: 25, width: 100, height: 50 })
  expect(xdObjectImageBounds(100, 100, 200, 100, 'fill')).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  expect(xdObjectImageBounds(100, 100, 20, 10, 'scale-down', 'bottom right')).toEqual({ x: 80, y: 90, width: 20, height: 10 })
})
