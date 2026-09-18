import { test, expect } from 'bun:test'
import { object } from './model'
import { mergeCapturedPage } from './refresh'
import type { VisualPage } from '../../shared/types/visualDesign'
const page = (): VisualPage => ({
  id: 'page',
  name: 'Dashboard',
  folder: 'Application',
  pinned: false,
  state: 'Desktop',
  width: 1440,
  height: 1000,
  objects: [
    object('Button', {
      id: 'button',
      name: 'Save Button',
      width: 120,
      fill: '#123456',
    }),
  ],
})
test('refresh merges app colour while retaining designer width', () => {
  const base = page(),
    local = {
      ...structuredClone(base),
      importedObjects: structuredClone(base.objects),
      edited: true,
    },
    remote = structuredClone(base)
  local.objects[0].width = 144
  remote.objects[0].id = 'new-id'
  remote.objects[0].fill = '#abcdef'
  const result = mergeCapturedPage(local, remote)
  expect(result.objects[0].width).toBe(144)
  expect(result.objects[0].fill).toBe('#abcdef')
  expect(result.objects[0].id).toBe('button')
  expect(result.conflicts).toEqual([])
})
test('conflicting property changes retain design and expose app choice', () => {
  const base = page(),
    local = {
      ...structuredClone(base),
      importedObjects: structuredClone(base.objects),
      edited: true,
    },
    remote = structuredClone(base)
  local.objects[0].width = 144
  remote.objects[0].width = 160
  const result = mergeCapturedPage(local, remote)
  expect(result.objects[0].width).toBe(144)
  expect(result.conflicts?.[0].property).toBe('width')
  expect(result.conflicts?.[0].incoming).toBe(160)
})
test('new design-only objects survive refresh', () => {
  const base = page(),
    local = {
      ...structuredClone(base),
      importedObjects: structuredClone(base.objects),
      edited: true,
    },
    remote = structuredClone(base)
  local.objects.push(object('Text', { text: 'Designer note' }))
  const result = mergeCapturedPage(local, remote)
  expect(result.objects).toHaveLength(2)
  expect(result.objects[1].text).toBe('Designer note')
})
