import { deflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { object } from '../visual/model'
import { buildXdDocument, validateXdEntries, validateXdArchive } from './xdDocument'
import { createStoredZip, crc32 } from '../../main/export/storedZip'
import type { VisualDocument } from '@shared/types/visualDesign'
const fixture = (): VisualDocument => ({
  version: 1,
  id: 'native-xd-test',
  name: 'Native XD',
  updatedAt: new Date().toISOString(),
  components: [],
  variables: [],
  pages: [
    {
      id: 'first',
      name: 'Login',
      folder: '',
      state: '',
      pinned: false,
      width: 390,
      height: 844,
      canvasX: -500,
      canvasY: 120,
      objects: [
        object('Group', {
          id: 'form',
          name: 'Form',
          x: 24,
          y: 100,
          width: 342,
          height: 500,
          fill: '#ffffff',
          children: [
            object('Text', {
              id: 'heading',
              name: 'Heading',
              text: 'Welcome back',
              x: 0,
              y: 16,
              width: 300,
              height: 48,
              fontFamily: 'Arial',
              fontSize: 28,
              fontWeight: '700',
              textRuns: [{ start: 0, end: 7, fontWeight: '400', color: '#ff0000' }],
            }),
            object('Rectangle', {
              id: 'button',
              name: 'Continue',
              x: 0,
              y: 80,
              width: 300,
              height: 48,
              radius: [12, 12, 12, 12],
              gradient: 'linear-gradient(90deg, #009988 0%, #0066ff 100%)',
            }),
            object('Vector', {
              id: 'icon',
              name: 'Check',
              x: 16,
              y: 100,
              width: 24,
              height: 24,
              path: 'M2 12L9 19L22 3',
              stroke: '#112233',
              strokeWidth: 2,
              fill: 'transparent',
            }),
          ],
        }),
      ],
    },
    {
      id: 'second',
      name: 'Dashboard',
      folder: '',
      state: '',
      pinned: false,
      width: 1440,
      height: 2100,
      canvasX: 80,
      canvasY: 120,
      objects: [],
    },
  ],
})
const build = (
  document = fixture(),
  scope: 'all' | 'selected' | 'current' = 'all',
  pageIds?: string[],
) =>
  buildXdDocument(
    {
      jobId: crypto.randomUUID(),
      document,
      scope,
      pageId: 'first',
      pageIds,
      includePrototype: true,
    },
    () => {},
    [
      { family: 'Arial', style: 'Bold', postscript: 'Arial-BoldMT' },
      { family: 'Arial', style: 'Regular', postscript: 'ArialMT' },
    ],
  )
const read = (built: ReturnType<typeof build>, path: string) =>
  JSON.parse(built.entries.find((e) => e.path === path)!.data.toString())
function nodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return [...(v.id && v.type ? [v] : []), ...Object.values(v).flatMap(nodes)]
  }
  return []
}
test('native XD archive contains AGC artboards, editable ranges, gradients and paths without Sketch data', () => {
  const d = fixture(),
    before = JSON.stringify(d),
    b = build(d)
  expect(JSON.stringify(d)).toBe(before)
  expect(b.entries[0].data.toString()).toBe('application/vnd.adobe.sparkler.project+dcxucf')
  expect(b.entries.some((e) => e.path === 'document.json' || e.path.startsWith('pages/'))).toBe(
    false,
  )
  const resources = read(b, 'resources/graphics/graphicContent.agc')
  expect(Object.values(resources.artboards)).toContainEqual({
    name: 'Login',
    x: -500,
    y: 120,
    width: 390,
    height: 844,
  })
  expect(Object.values(resources.artboards)).toContainEqual({
    name: 'Dashboard',
    x: 80,
    y: 120,
    width: 1440,
    height: 2100,
  })
  expect(Object.keys(resources.resources.gradients)).toHaveLength(1)
  const all = b.entries
    .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
    .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  const text = all.find((n) => n.name === 'Heading') as any
  expect(text.text.rawText).toBe('Welcome back')
  expect(text.meta.ux.rangedStyles.map((r: any) => [r.length, r.postscriptName])).toEqual([
    [7, 'ArialMT'],
    [5, 'Arial-BoldMT'],
  ])
  expect(text.style.font.postscriptName).toBe('Arial-BoldMT')
  expect((all.find((n) => n.name === 'Check') as any).shape.type).toBe('path')
  expect((all.find((n) => n.name === 'Continue') as any).shape.r).toEqual([12, 12, 12, 12])
  expect(b.report.applicationValidation).toBe('unverified')
  const zip = createStoredZip(b.entries)
  expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  expect(zip.readUInt16LE(8)).toBe(0) // mimetype is first and uncompressed
  expect(() => validateXdEntries(b.entries)).not.toThrow()
})
test('all scopes produce one native document with only requested artboards', () => {
  expect(build().report.artboards).toBe(2)
  expect(build(fixture(), 'current').report.artboards).toBe(1)
  const selected = build(fixture(), 'selected', ['second'])
  expect(selected.report.artboards).toBe(1)
  expect(
    Object.values(read(selected, 'resources/graphics/graphicContent.agc').artboards).map(
      (a: any) => a.name,
    ),
  ).toEqual(['Dashboard'])
  expect(() => build(fixture(), 'selected', [])).toThrow('Select at least one artboard')
})
test('validation rejects missing manifest and resources rather than reporting success', () => {
  const b = build()
  expect(() => validateXdEntries(b.entries.filter((e) => e.path !== 'manifest'))).toThrow()
  expect(() =>
    validateXdEntries(b.entries.filter((e) => !e.path.startsWith('artwork/artboard-'))),
  ).toThrow()
  expect(() => validateXdEntries([...b.entries, b.entries[0]])).toThrow('Duplicate')
})
test('nested groups and large designs retain native hierarchy without flattening', () => {
  const d = fixture()
  let child = object('Text', {
    id: 'deep-text',
    text: 'Still editable',
    width: 100,
    height: 20,
  })
  for (let i = 0; i < 30; i++)
    child = object('Group', {
      id: 'group-' + i,
      width: 100,
      height: 100,
      children: [child],
    })
  d.pages[0].objects = [child]
  d.pages = Array.from({ length: 40 }, (_, i) => ({
    ...structuredClone(d.pages[0]),
    id: 'page-' + i,
    canvasX: i * 600,
    objects: i === 0 ? [child] : [],
  }))
  const b = build(d)
  expect(b.report.artboards).toBe(40)
  expect(b.report.editableText).toBe(1)
  expect(b.entries.filter((e) => e.path.startsWith('artwork/artboard-'))).toHaveLength(40)
})

test('embedded image resources are deduplicated with native dimensions and validated references', () => {
  const d = fixture(),
    src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0cAAAAASUVORK5CYII='
  d.pages[0].objects = [
    object('Image', {
      id: 'image1',
      name: 'Image one',
      src,
      width: 100,
      height: 80,
    }),
    object('Image', {
      id: 'image2',
      name: 'Image two',
      src,
      width: 50,
      height: 50,
    }),
  ]
  const b = build(d)
  expect(b.entries.filter((e) => /^resources\/[0-9a-f]+$/.test(e.path))).toHaveLength(1)
  expect(b.report.images).toBe(2)
  const images = b.entries
    .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
    .flatMap((e) => nodes(JSON.parse(e.data.toString())))
    .filter((n: any) => (String(n.name).startsWith('Image one background') || String(n.name).startsWith('Image two background')) && n.style?.fill?.pattern) as any[]
  expect(images[0].style.fill.pattern).toMatchObject({ width: 1, height: 1 })
  expect(images[0].style.fill.pattern.meta.ux.uid).toBe(images[1].style.fill.pattern.meta.ux.uid)
})
test('archive checksum validation rejects corrupt output before save succeeds', () => {
  const b = build(),
    archive = createStoredZip(b.entries)
  expect(() => validateXdArchive(archive)).not.toThrow()
  const corrupt = Buffer.from(archive)
  corrupt[40] ^= 1
  expect(() => validateXdArchive(corrupt)).toThrow('checksum')
  expect(() => validateXdArchive(archive.subarray(0, archive.length - 12))).toThrow()
})
test('native click navigation connects exported artboards and excludes outside destinations', () => {
  const d = fixture()
  d.prototype = {
    version: 1,
    flows: [],
    variables: {},
    scenarios: [],
    imports: [],
    interactions: [
      {
        id: 'next',
        sourceArtboardId: 'first',
        sourceElementId: 'button',
        destinationId: 'second',
        action: 'navigate',
        trigger: 'click',
        transition: 'fade',
      },
    ],
  }
  const b = build(d),
    interactions = read(b, 'interactions/interactions.json').interactions
  expect(Object.values(interactions)).toHaveLength(1)
  expect((Object.values(interactions)[0] as any[])[0]).toMatchObject({
    triggerEvent: 'tap',
    action: 'artboard-transition',
    properties: { transition: 'dissolve' },
  })
  const current = build(d, 'current')
  expect(Object.keys(read(current, 'interactions/interactions.json').interactions)).toHaveLength(0)
})

test('native component definitions link unchanged instances using Adobe symbol and sync references', () => {
  const d = fixture()
  d.components = [
    object('Component', {
      id: 'shared-card',
      name: 'Shared card',
      width: 120,
      height: 50,
      fill: '#123456',
      children: [
        object('Text', {
          id: 'master-label',
          name: 'Shared label',
          text: 'Reusable',
          x: 8,
          y: 8,
          width: 100,
          height: 24,
          fontFamily: 'Arial',
        }),
      ],
    }),
  ]
  d.pages[0].objects = [
    object('Instance', {
      id: 'instance-one',
      name: 'Card one',
      componentId: 'shared-card',
      x: 10,
      y: 10,
      width: 120,
      height: 50,
    }),
    object('Instance', {
      id: 'instance-two',
      name: 'Card two',
      componentId: 'shared-card',
      x: 10,
      y: 80,
      width: 120,
      height: 50,
    }),
  ]
  const b = build(d),
    resources = read(b, 'resources/graphics/graphicContent.agc'),
    symbols = resources.resources.meta.ux.symbols
  expect(symbols).toHaveLength(1)
  expect(b.report.components).toBe(1)
  expect(b.report.linkedInstances).toBe(2)
  const all = b.entries
    .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
    .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  const instances = all.filter((n) => ['Card one', 'Card two'].includes(String(n.name))) as any[]
  expect(instances).toHaveLength(2)
  expect(instances[0].meta.ux.symbolId).toBe(symbols[0].meta.ux.symbolId)
  expect(instances[1].meta.ux.symbolId).toBe(symbols[0].meta.ux.symbolId)
  expect(instances[0].group.children.every((n: any) => n.type === 'syncRef')).toBe(true)
  expect(instances[0].group.children[0].guid).not.toBe(instances[1].group.children[0].guid)
  expect(() => validateXdArchive(createStoredZip(b.entries))).not.toThrow()
})
test('nested rounded overflow clips remain editable native clipPath resources', () => {
  const d = fixture()
  d.pages[0].objects = [
    object('Group', {
      id: 'outer',
      name: 'Outer clip',
      width: 200,
      height: 200,
      clip: true,
      radius: [12, 12, 12, 12],
      children: [
        object('Group', {
          id: 'inner',
          name: 'Inner clip',
          x: 10,
          y: 10,
          width: 120,
          height: 120,
          clip: true,
          children: [
            object('Rectangle', {
              id: 'overflow',
              name: 'Overflow content',
              x: -20,
              y: -20,
              width: 250,
              height: 250,
            }),
          ],
        }),
      ],
    }),
  ]
  const b = build(d),
    resources = read(b, 'resources/graphics/graphicContent.agc')
  expect(Object.values(resources.resources.clipPaths)).toHaveLength(2)
  expect(b.report.clippingMasks).toBe(2)
  expect(
    Object.values(resources.resources.clipPaths).some(
      (c: any) => c.children[0].shape.r?.[0] === 12,
    ),
  ).toBe(true)
  const groups = b.entries
    .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
    .flatMap((e) => nodes(JSON.parse(e.data.toString())))
    .filter((n) => ['Outer clip', 'Inner clip'].includes(String(n.name))) as any[]
  expect(groups.every((g) => g.style.clipPath.ref)).toBe(true)
  expect(b.report.warnings.some((w) => w.includes('Nested CSS clipping'))).toBe(false)
})
test('CSS card shadows use native background graphics without unsupported Group filters', () => {
  const d = fixture()
  d.pages[0].objects = [
    object('Group', {
      id: 'shadow-card',
      name: 'Shadow card',
      width: 200,
      height: 100,
      opacity: 0.5,
      fill: '#ffffff',
      shadow: '0px 8px 20px rgba(0, 0, 0, 0.2)',
      children: [object('Text', { id: 'shadow-label', text: 'Composite', width: 160, height: 30 })],
    }),
  ]
  const b = build(d),
    all = b.entries
      .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
      .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  const card = all.find((n) => n.name === 'Shadow card') as any
  expect(card.style.opacity).toBe(0.5)
  expect(card.style.filters).toBeUndefined()
  expect(card.group.children[0].style.filters[0]).toMatchObject({
    type: 'dropShadow',
    global: true,
    params: { dropShadows: [{ dx: 0, dy: 8, r: 20 }] },
  })
  expect(card.group.children[0].type).toBe('shape')
  expect(card.group.children[0].style.opacity).toBe(1)
  expect(b.report.nativeEffects).toBe(1)
})

test('layer blur and inner shadows use genuine native XD effect structures', () => {
  const d = fixture()
  d.pages[0].objects = [
    object('Rectangle', {
      id: 'effect-shape',
      name: 'Effects',
      width: 200,
      height: 100,
      blur: 12,
      shadow: 'inset 2px 3px 4px rgba(0, 0, 0, 0.25), 0px 8px 20px rgba(0, 0, 0, 0.2)',
    }),
  ]
  const b = build(d),
    all = b.entries
      .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
      .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  const shape = all.find((n) => n.name === 'Effects') as any
  expect(shape.style.filters.find((f: any) => f.type === 'uxdesign#blur')).toMatchObject({
    global: true,
    params: { blurAmount: 12, backgroundEffect: false, brightnessAmount: 0, fillOpacity: 1 },
  })
  expect(shape.style.filters.find((f: any) => f.type === 'uxdesign#innerShadow')).toMatchObject({
    params: { innerShadows: [{ dx: 2, dy: 3, r: 4 }] },
  })
  expect(shape.style.filters.find((f: any) => f.type === 'dropShadow')).toMatchObject({
    params: { dropShadows: [{ dx: 0, dy: 8, r: 20 }] },
  })
  expect(b.report.nativeEffects).toBe(3)
})
test('component and clipping references are validated before native output can succeed', () => {
  const d = fixture()
  d.components = [
    object('Component', {
      id: 'master-reference',
      width: 120,
      height: 50,
      children: [object('Rectangle', { id: 'master-shape', width: 120, height: 50 })],
    }),
  ]
  d.pages[0].objects = [
    object('Instance', {
      id: 'ref-instance',
      componentId: 'master-reference',
      width: 120,
      height: 50,
    }),
  ]
  const b = build(d),
    path = b.entries.find((e) => e.path.startsWith('artwork/artboard-'))!.path
  const scene = read(b, path)
  const all = nodes(scene)
  const instance = all.find((n) => n.name === d.pages[0].objects[0].name) as any
  instance.group.children[0].syncSourceGuid = 'missing-master-node'
  expect(() =>
    validateXdEntries(
      b.entries.map((e) =>
        e.path === path ? { ...e, data: Buffer.from(JSON.stringify(scene)) } : e,
      ),
    ),
  ).toThrow('component source')
})

test('CSS gradient plus embedded image paints preserve native bottom-to-top ordering and rounded crop', () => {
  const d = fixture(),
    png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0cAAAAASUVORK5CYII='
  d.pages[0].objects = []
  d.pages[0].structured = {
    id: 'background-frame',
    name: 'Background fixture',
    viewport: '390x844',
    sourceRoute: '/',
    width: 390,
    height: 844,
    captureMetadata: {
      capturedAt: '2026-10-20T00:00:00Z',
      engine: 'domSnapshot',
      structuredNodeCount: 1,
      durationMs: 1,
      visualMatch: { diffPixels: 0, totalPixels: 1, diffPercent: 0 },
    },
    children: [
      {
        id: 'hero-background',
        type: 'Container',
        name: 'Layered hero',
        parentId: null,
        children: [],
        bounds: { x: 0, y: 0, width: 300, height: 180 },
        layout: { mode: 'free' },
        appearance: {
          backgroundColor: '#f8fafc',
          backgroundImage: `linear-gradient(120deg, rgba(3, 59, 95, 0.15), rgba(18, 113, 172, 0.15)), url("${png}")`,
          backgroundSize: 'auto, cover',
          backgroundPosition: '0% 0%, 50% 57%',
          radius: [16, 16, 16, 16],
          opacity: 1,
          rotation: 0,
          clip: false,
        },
        source: { tag: 'section' },
        constraints: { position: 'static' },
        visibility: true,
        locked: false,
      },
    ],
  }
  const b = build(d),
    all = b.entries
      .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
      .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  const hero = all.find((n) => n.name === 'Layered hero') as any
  expect(hero.group.children.map((n: any) => n.style?.fill?.type ?? n.type)).toEqual([
    'solid',
    'group',
    'gradient',
  ])
  const image = hero.group.children[1].group.children[0]
  expect(image.style.fill.pattern.meta.ux.scaleBehavior).toBe('fill')
  expect(image.shape).toMatchObject({ x: 0, width: 300, height: 300 })
  expect(image.shape.y).toBeCloseTo(-68.4, 6)
  expect(b.report.images).toBe(1)
  expect(b.report.warnings.every((w) => w.length <= 240 && !w.includes('base64'))).toBe(true)
  expect(() => validateXdArchive(createStoredZip(b.entries))).not.toThrow()
})
test('unsupported individual paint produces a bounded redacted warning without dropping supported artboards', () => {
  const d = fixture()
  d.pages[0].objects.push(
    object('Rectangle', {
      id: 'unsupported-paint',
      name: 'Unsupported paint',
      gradient: 'linear-gradient(red, broken(data:image/jpeg;base64,' + 'A'.repeat(4000) + '))',
    }),
  )
  const b = build(d)
  expect(b.report.artboards).toBe(2)
  expect(b.report.warnings.every((w) => w.length <= 240 && !w.includes('base64'))).toBe(true)
  expect(b.report.warnings.some((w) => w.includes('Unsupported paint'))).toBe(true)
})
test('captured selects retain field geometry and editable selected display label with captured typography', () => {
  const d = fixture()
  d.pages[0].objects = []
  d.pages[0].structured = {
    id: 'select-frame',
    name: 'Select fixture',
    viewport: '390x844',
    sourceRoute: '/',
    width: 390,
    height: 844,
    captureMetadata: {
      capturedAt: '2026-10-20T00:00:00Z',
      engine: 'domSnapshot',
      structuredNodeCount: 1,
      durationMs: 1,
      visualMatch: { diffPixels: 0, totalPixels: 1, diffPercent: 0 },
    },
    children: [
      {
        id: 'select-field',
        type: 'Input',
        name: 'Learning format',
        parentId: null,
        children: [],
        bounds: { x: 24, y: 100, width: 300, height: 48 },
        layout: { mode: 'free', padding: { top: 2, right: 16, bottom: 18, left: 16 } },
        appearance: {
          backgroundColor: '#ffffff',
          radius: [8, 8, 8, 8],
          border: { width: 1, color: '#ccddee' },
          opacity: 1,
          rotation: 0,
          clip: false,
        },
        source: {
          tag: 'select',
          control: {
            type: 'select',
            value: 'online',
            options: [{ value: 'online', label: 'Online learning' }],
          },
        },
        typography: {
          text: 'online',
          fontFamily: 'Arial',
          fontWeight: '700',
          fontSize: 18,
          lineHeight: 24,
          letterSpacing: 0,
          textAlign: 'left',
          color: '#123456',
        },
        constraints: { position: 'static' },
        visibility: true,
        locked: false,
      },
    ],
  }
  const b = build(d),
    all = b.entries
      .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
      .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  const field = all.find((n) => n.name === 'Learning format') as any,
    label = all.find((n) => n.name === 'Selected option') as any
  expect(field.type).toBe('group')
  expect(field.group.children.some((n: any) => n.type === 'shape')).toBe(true)
  expect(label.text.rawText).toBe('Online learning')
  expect(label.transform.ty).toBe(30)
  expect(label.text.paragraphs[0].lines[0][0].y).toBe(0)
  expect(label.style.stroke).toBeUndefined()
  expect(label.style.font).toMatchObject({
    family: 'Arial',
    size: 18,
    postscriptName: 'Arial-BoldMT',
  })
  expect(label.transform).toMatchObject({ tx: 16, ty: 30 })
})

test('paint and font encoding matches independent genuine Adobe serialization2.27 projections', () => {
  const projection = JSON.parse(
    readFileSync(
      new URL('../../../tests/fixtures/xd/adobe-native-style-projection.json', import.meta.url),
      'utf8',
    ),
  )
  const d = fixture()
  d.pages[0].objects = [
    object('Rectangle', {
      id: 'canonical-white',
      name: 'Canonical white',
      width: 100,
      height: 100,
      fill: '#ffffff',
    }),
    object('Rectangle', {
      id: 'canonical-gradient',
      name: 'Canonical gradient',
      width: 100,
      height: 100,
      gradient: 'linear-gradient(180deg, rgb(236, 85, 255), rgb(100, 0, 113))',
    }),
    object('Text', {
      id: 'canonical-font',
      name: 'Canonical font',
      width: 200,
      height: 30,
      text: 'Adobe font encoding',
      fontFamily: projection.textFont.family,
      fontSize: projection.textFont.size,
      fontWeight: projection.textFont.style === 'Bold' ? '700' : '400',
    }),
  ]
  const b = build(d),
    all = b.entries
      .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
      .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  expect((all.find((n) => n.name === 'Canonical white') as any).style.fill).toEqual(
    projection.opaqueWhite,
  )
  const gradient = (all.find((n) => n.name === 'Canonical gradient') as any).style.fill
  expect(gradient.gradient.meta.ux.gradientResources).toEqual(
    projection.inlineGradient.gradient.meta.ux.gradientResources,
  )
  expect(gradient.gradient.ref).toBeUndefined()
  expect((all.find((n) => n.name === 'Canonical font') as any).style.font).toEqual(
    projection.textFont,
  )
})
test('native artboards keep exact source dimensions and add canvas origin once without synthetic page wrappers', () => {
  const d = fixture()
  d.pages[0].width = 1440
  d.pages[0].canvasX = 2600
  d.pages[0].canvasY = -900
  d.pages[0].objects = [
    object('Rectangle', {
      id: 'local-rectangle',
      name: 'Local rectangle',
      x: 24,
      y: 80,
      width: 300,
      height: 120,
      fill: '#ffffff',
    }),
  ]
  const b = build(d),
    scene = b.entries
      .filter((e) => e.path.startsWith('artwork/artboard-'))
      .map((e) => JSON.parse(e.data.toString()))
      .find((s) => s.children[0].artboard.children.some((c: any) => c.name === 'Local rectangle'))
  const root = scene.children[0],
    children = root.artboard.children
  expect(children).toHaveLength(1)
  expect(children[0].type).toBe('shape')
  expect(children[0].transform).toMatchObject({ a: 1, d: 1, tx: 2624, ty: -820 })
  const resources = read(b, 'resources/graphics/graphicContent.agc')
  expect(resources.artboards[root.id]).toMatchObject({ width: 1440, height: 844, x: 2600, y: -900 })
})
test('browser-measured fallback font faces override unavailable first-declared families', () => {
  const d = fixture()
  d.pages[0].objects = [
    object('Text', {
      id: 'rendered-font',
      name: 'Rendered fallback',
      width: 300,
      height: 40,
      text: 'Readable fallback',
      fontFamily: '"Public Sans", Inter, -apple-system, sans-serif',
      fontWeight: '650',
    }),
  ]
  const b = buildXdDocument(
    { jobId: crypto.randomUUID(), document: d, scope: 'all', includePrototype: false },
    () => {},
    [],
    [
      {
        stack: '"Public Sans", Inter, -apple-system, sans-serif',
        weight: '650',
        style: 'normal',
        family: 'Arial',
        postscript: 'Arial-BoldMT',
        fontStyle: 'Bold',
      },
    ],
  )
  const all = b.entries
    .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
    .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  expect((all.find((n) => n.name === 'Rendered fallback') as any).style.font).toMatchObject({
    family: 'Arial',
    postscriptName: 'Arial-BoldMT',
    style: 'Bold',
  })
  expect(JSON.stringify(all)).not.toContain('PublicSans-Bold')
})

test('browser-measured baselines use each captured line box and do not guess the font-size baseline', () => {
  const d = fixture()
  d.pages[0].objects = [
    object('Text', {
      id: 'measured-baseline',
      name: 'Measured baseline',
      width: 200,
      height: 40,
      fontFamily: 'Arial',
      fontSize: 20,
      lineHeight: 30,
      text: 'Aligned',
    }),
  ]
  const b = buildXdDocument(
    { jobId: crypto.randomUUID(), document: d, scope: 'all', includePrototype: false },
    () => {},
    [],
    [
      {
        stack: 'Arial',
        weight: '400',
        style: 'normal',
        family: 'Arial',
        postscript: 'ArialMT',
        fontStyle: 'Regular',
        baselineBySize: { '20': 7.5 },
        sourceBaselineBySize: { '20': 5.5 },
      },
    ],
  )
  const all = b.entries
    .filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc'))
    .flatMap((e) => nodes(JSON.parse(e.data.toString())))
  expect(
    (all.find((n) => n.name === 'Measured baseline') as any).text.paragraphs[0].lines[0][0].y,
  ).toBe(0)
  expect((all.find(n=>n.name==='Measured baseline') as any).transform.ty).toBe(140.5)
  expect(b.report.warnings.some((w) => w.includes('baselines are not browser-measured'))).toBe(
    false,
  )
})

test('inert frameui-root capture wrappers project onto native artboards while real body groups remain', () => {
  const d = fixture()
  d.pages[0].width = 1440
  d.pages[0].canvasX = 2400
  d.pages[0].canvasY = 700
  d.pages[0].objects = []
  const base: any = {
    parentId: null,
    children: [],
    bounds: { x: 0, y: 0, width: 1440, height: 844 },
    layout: { mode: 'free' },
    appearance: { radius: [0, 0, 0, 0], opacity: 1, rotation: 0, clip: false },
    source: { tag: 'body' },
    constraints: { position: 'static' },
    visibility: true,
    locked: false,
  }
  const body = {
    ...structuredClone(base),
    id: 'real-body',
    name: 'Real body',
    parentId: 'synthetic-capture',
    appearance: { ...base.appearance, backgroundColor: '#ffffff' },
  }
  const wrapper = {
    ...structuredClone(base),
    id: 'synthetic-capture',
    name: 'Synthetic capture wrapper',
    source: { tag: 'frameui-root' },
    appearance: { ...base.appearance, clip: true, backgroundColor: 'rgb(255, 255, 255)' },
    children: [body],
  }
  d.pages[0].structured = {
    id: 'captured-frame',
    name: 'Captured',
    width: 1440,
    height: 844,
    viewport: '1440x844',
    sourceRoute: '/',
    children: [wrapper],
    captureMetadata: {
      capturedAt: '2026-10-20T00:00:00Z',
      engine: 'domSnapshot',
      structuredNodeCount: 2,
      durationMs: 1,
    },
  }
  const b = build(d),
    scene = b.entries
      .filter((e) => e.path.startsWith('artwork/artboard-'))
      .map((e) => JSON.parse(e.data.toString()))
      .find((s) => s.children[0].artboard.children.some((c: any) => c.name === 'Real body'))
  expect(scene.children[0].artboard.children).toHaveLength(1)
  expect(scene.children[0].artboard.children[0].name).toBe('Real body')
  expect(scene.children[0].artboard.children[0].transform).toMatchObject({
    tx: 2400,
    ty: 700,
    a: 1,
    d: 1,
  })
  expect(JSON.stringify(scene)).not.toContain('Synthetic capture wrapper')
  wrapper.appearance.backgroundColor = '#eef5ff'
  const coloured = build(d)
    .entries.filter((e) => e.path.startsWith('artwork/artboard-'))
    .map((e) => JSON.parse(e.data.toString()))
    .find((s) => s.children[0].artboard.children.some((c: any) => c.name === 'Real body'))
  expect(coloured.children[0].style.fill.color.value).toEqual({ r: 238, g: 245, b: 255 })
  expect(JSON.stringify(coloured)).not.toContain('Synthetic capture wrapper')
  d.prototype = {
    version: 1,
    flows: [],
    variables: {},
    scenarios: [],
    imports: [],
    interactions: [
      {
        id: 'target-wrapper',
        sourceArtboardId: 'first',
        sourceElementId: 'synthetic-capture',
        trigger: 'click',
        action: 'back',
        transition: 'instant',
      },
    ],
  }
  expect(
    JSON.stringify(
      build(d)
        .entries.filter((e) => e.path.startsWith('artwork/'))
        .map((e) => e.data.toString()),
    ),
  ).toContain('Synthetic capture wrapper')
})

test('browser-rendered image-only colour effects replace editable image resources while retaining original companion data', () => {
  const png = (r: number, g: number, b: number) => {
    const chunk = (tag: string, data: Buffer) => {
      const name = Buffer.from(tag),
        size = Buffer.alloc(4),
        crc = Buffer.alloc(4)
      size.writeUInt32BE(data.length)
      crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
      return Buffer.concat([size, name, data, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(1, 0)
    ihdr.writeUInt32BE(1, 4)
    ihdr[8] = 8
    ihdr[9] = 2
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.from([0, r, g, b]))),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
  const original = png(0, 100, 200),
    processed = png(90, 90, 90),
    source = 'data:image/png;base64,' + original.toString('base64'),
    data = 'data:image/png;base64,' + processed.toString('base64')
  const d = fixture()
  d.pages[0].objects = []
  d.pages[0].structured = {
    id: 'effect-image-frame',
    name: 'Effect image fixture',
    viewport: '390x844',
    sourceRoute: '/',
    width: 390,
    height: 844,
    captureMetadata: {
      capturedAt: '2026-10-20T00:00:00Z',
      engine: 'domSnapshot',
      structuredNodeCount: 1,
      durationMs: 1,
    },
    children: [
      {
        id: 'image-only',
        type: 'Container',
        name: 'Image-only colour effect',
        parentId: null,
        children: [],
        bounds: { x: 0, y: 0, width: 300, height: 180 },
        layout: { mode: 'free' },
        appearance: {
          backgroundImage: `url("${source}")`,
          backgroundSize: 'cover',
          backgroundPosition: '50% 50%',
          filter: 'saturate(0.78)',
          radius: [0, 0, 0, 0],
          opacity: 1,
          rotation: 0,
          clip: false,
        },
        source: { tag: 'div' },
        constraints: { position: 'static' },
        visibility: true,
        locked: false,
      },
    ],
  }
  const b = buildXdDocument(
    { jobId: crypto.randomUUID(), document: d, scope: 'all', includePrototype: false },
    () => {},
    [],
    [],
    [{ source, filter: 'saturate(0.78)', data }],
  )
  expect(
    b.entries.some((e) => /^resources\/[0-9a-f]+$/.test(e.path) && e.data.equals(processed)),
  ).toBe(true)
  expect(b.entries.find((e) => e.path === 'frameui/design.json')!.data.toString()).toContain(
    original.toString('base64'),
  )
  expect(b.report.warnings.some((w) => w.includes('Unsupported CSS filter'))).toBe(false)
  expect(b.report.warnings.some((w) => w.includes('baked into an editable image resource'))).toBe(
    true,
  )
  const sourceNode = d.pages[0].structured!.children[0]
  sourceNode.children = [
    {
      ...structuredClone(sourceNode),
      id: 'nested-content',
      name: 'Real nested content',
      appearance: { ...sourceNode.appearance, backgroundImage: undefined, filter: undefined },
      children: [],
    },
  ]
  const compound = buildXdDocument(
    { jobId: crypto.randomUUID(), document: d, scope: 'all', includePrototype: false },
    () => {},
    [],
    [],
    [{ source, filter: 'saturate(0.78)', data }],
  )
  expect(compound.report.warnings.some((w) => w.includes('Unsupported CSS filter'))).toBe(true)
  expect(
    compound.entries.some((e) => /^resources\/[0-9a-f]+$/.test(e.path) && e.data.equals(original)),
  ).toBe(true)
})

test('off-canvas source artboards are packed within XD visible bounds without scaling', () => {
  const d = fixture()
  d.pages[0].canvasY = 45541
  const built = buildXdDocument({ jobId: 'bounds', document: d, scope: 'all', includePrototype: false })
  const resources = JSON.parse(built.entries.find((e) => e.path === 'resources/graphics/graphicContent.agc')!.data.toString())
  for (const b of Object.values(resources.artboards) as { x: number; y: number; width: number; height: number }[]) {
    expect(b.x).toBeGreaterThanOrEqual(-25000)
    expect(b.y).toBeGreaterThanOrEqual(-25000)
    expect(b.x + b.width).toBeLessThanOrEqual(25000)
    expect(b.y + b.height).toBeLessThanOrEqual(25000)
  }
  expect(Object.values(resources.artboards).map((b: any) => b.width)).toEqual(d.pages.map((p) => p.width))
  expect(built.report.warnings.some((w) => w.includes('Flow groups translated'))).toBe(true)
})

test('CSS positioned content paints above later zero-index pseudo gradients and native text tracking uses em units', () => {
  const d = fixture()
  d.pages[0].objects = []
  const shape = (id: string, zIndex?: number): any => ({
    id, type: 'Container', name: id, parentId: 'hero', children: [],
    bounds: { x: 0, y: 0, width: 300, height: 100 }, layout: { mode: 'free' },
    appearance: { zIndex, backgroundColor: '#fff', opacity: 1, radius: [0, 0, 0, 0], rotation: 0, clip: false },
    source: { tag: 'div' }, visibility: true, locked: false, constraints: { position: 'absolute' },
  })
  const hero = shape('hero')
  const heading = shape('hero heading', 1)
  heading.type = 'Text'
  heading.typography = { text: 'Find courses', fontFamily: 'Arial', fontWeight: '700', fontSize: 54, lineHeight: 60, letterSpacing: -2.43, color: '#16243a', textAlign: 'left' }
  hero.children = [shape('hero image'), heading, shape('hero gradient')]
  d.pages[0].structured = { id: 'hero frame', name: 'Hero', width: 390, height: 844, viewport: '390x844', sourceRoute: '/', children: [hero] } as any
  const b = build(d)
  const all = b.entries.filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc')).flatMap((e) => nodes(JSON.parse(e.data.toString()))) as any[]
  const group = all.find((n) => n.name === 'hero')
  expect(group.group.children.map((n: any) => n.name)).toEqual(['hero background 1', 'hero image', 'hero gradient', 'hero heading'])
  const text = all.find((n) => n.name === 'hero heading' && n.type === 'text')
  expect(text.meta.ux.rangedStyles[0].charSpacing).toBeCloseTo(-45)
  expect(text.style.stroke).toBeUndefined()
  expect(text.style.fill.color.value).toEqual({ r: 22, g: 36, b: 58 })
})

test('symbol viewBox maps referenced paths into SVG viewport and unchecked native radios retain rings', () => {
  const d = fixture()
  d.pages[0].objects = []
  const node = (id: string, tag: string, type: string, w: number, h: number): any => ({
    id, name: id, type, parentId: 'frame', children: [], bounds: { x: 0, y: 0, width: w, height: h }, layout: { mode: 'free' },
    appearance: { opacity: 1, radius: [0, 0, 0, 0], rotation: 0, clip: false, fill: 'none', stroke: '#345673', strokeWidth: 1.8 },
    source: { tag }, visibility: true, locked: false, constraints: { position: 'static' },
  })
  const svg = node('15px icon', 'svg', 'SVG', 15, 15)
  svg.appearance.clip = true
  svg.source.svgGeometry = { definitions: JSON.stringify([{ tag: 'symbol', attributes: { id: 'info', viewBox: '0 0 24 24' }, children: [{ tag: 'circle', attributes: { cx: '12', cy: '12', r: '9' }, children: [] }] }]) }
  const use = node('symbol use', 'use', 'Shape', 12.375, 12.375)
  use.source.svgGeometry = { href: '#info' }
  svg.children = [use]
  const radio = node('Unchecked choice', 'input', 'Input', 16, 16)
  radio.appearance = { ...radio.appearance, stroke: undefined, fill: undefined, strokeWidth: undefined }
  radio.source.control = { type: 'radio', appearance: 'auto', checked: false, value: 'choice' }
  d.pages[0].structured = { id: 'frame', name: 'Controls', width: 390, height: 844, viewport: '390x844', sourceRoute: '/', children: [svg, radio] } as any
  const b = build(d)
  const all = b.entries.filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc')).flatMap((e) => nodes(JSON.parse(e.data.toString()))) as any[]
  const circle = all.find((n) => n.name === 'symbol use / circle')
  expect(circle.shape.path).toStartWith('M1.875 7.5')
  expect(circle.style.stroke.width).toBeCloseTo(1.125)
  svg.source.svgGeometry.viewBox = '0 0 24 24'
  const outerViewBox = build(d).entries.filter((e) => e.path.startsWith('artwork/') && e.path.endsWith('.agc')).flatMap((e) => nodes(JSON.parse(e.data.toString()))) as any[]
  const nestedCircle = outerViewBox.find((n) => n.name === 'symbol use / circle')
  expect(nestedCircle.shape.path).toBe(circle.shape.path)
  expect(nestedCircle.style.stroke.width).toBeCloseTo(1.125)
  const ring = all.find((n) => n.name === 'Unchecked choice background 1')
  expect(ring.shape).toMatchObject({ type: 'ellipse', cx: 8, cy: 8, rx: 8, ry: 8 })
  expect(ring.style.stroke).toMatchObject({ type: 'solid', width: 1 })
  expect(ring.style.fill.color.value).toEqual({ r: 255, g: 255, b: 255 })
})

test('native editable text uses positioned paragraphs instead of clipping to a substituted-font area',()=>{
 const design=fixture()
 design.pages[0].objects=[object('Text',{id:'multiline',text:'Find training.\nCompare options.',width:100,height:30,fontSize:24,lineHeight:28,fontFamily:'Arial',textRuns:[{start:15,end:31,color:'#0595ff'}]})]
 const built=buildXdDocument({jobId:'positioned-text',document:design,scope:'all',includePrototype:false})
 const entry=built.entries.find(e=>e.path.startsWith('artwork/artboard-')&&e.path.endsWith('.agc'))!
 const text=JSON.parse(entry.data.toString()).children[0].artboard.children[0]
 expect(text.type).toBe('text')
 expect(text.text.frame).toEqual({type:'positioned'})
 expect(text.text.paragraphs).toHaveLength(2)
 expect(text.text.paragraphs[1].lines[0][0]).toMatchObject({from:15,to:31,y:28})
 expect(text.text.paragraphs[0].lines[0][0]).toMatchObject({x:0,y:0})
 expect(text.transform.ty).toBe(144)
 expect(text.text.rawText).toBe('Find training.\nCompare options.')
 expect(text.meta.ux.rangedStyles.some((r:{fill:{value:number}})=>r.fill.value===0xff0595ff)).toBe(true)
})

test('centered editable point text caches negative measured advance and preserves source ink alignment',()=>{
 const design=fixture();design.pages[0].objects=[object('Text',{id:'center-label',name:'Center label',text:'Label',x:10,y:20,width:200,height:30,fontSize:20,lineHeight:30,fontFamily:'Arial',fontWeight:'400',textAlign:'center'})]
 const built=buildXdDocument({jobId:'center-ink',document:design,scope:'all',includePrototype:false},()=>{},[],[{stack:'Arial',weight:'400',style:'normal',family:'Arial',postscript:'ArialMT',sourceBaselineBySize:{20:5},baselineBySize:{20:6},inkByText:{'[20,"Label"]':{sourceWidth:100,targetWidth:96,sourceLeft:0,targetLeft:1,sourceAscent:16,targetAscent:15}}}])
 const entry=built.entries.find(e=>e.path.startsWith('artwork/artboard-')&&e.path.endsWith('.agc'))!
 const text=JSON.parse(entry.data.toString()).children[0].artboard.children[0]
 const line=text.text.paragraphs[0].lines[0][0]
 expect(line).toMatchObject({x:-48,y:0})
 expect(text.transform).toMatchObject({tx:-391,ty:159})
 expect(text.transform.tx+line.x).toBe(-439)
 expect(text.style.textAttributes.paragraphAlign).toBe('center')
})

test('clipped editable text keeps its mask at the original box rather than the text baseline',()=>{
 const d=fixture();d.pages=d.pages.slice(0,1);d.pages[0].objects=[object('Text',{id:'clipped-label',text:'Compliant:',x:24,y:32,width:1,height:1,clip:true,fontFamily:'Arial',fontSize:12,lineHeight:18})]
 const result=buildXdDocument({jobId:'clip-label',document:d,scope:'all',includePrototype:false},()=>{})
 const scene=JSON.parse(result.entries.find(e=>e.path.startsWith('artwork/artboard-')&&e.path.endsWith('.agc'))!.data.toString())
 const n=scene.children[0].artboard.children[0]
 expect(n.type).toBe('group')
 expect(n.group.children[0].type).toBe('text')
 const resources=JSON.parse(result.entries.find(e=>e.path==='resources/graphics/graphicContent.agc')!.data.toString())
 const clip=resources.resources.clipPaths[n.style.clipPath.ref].children[0]
 expect(clip.shape).toMatchObject({width:1,height:1})
 expect(clip.transform).toBeUndefined()
 expect(n.group.children[0].transform.ty).toBeGreaterThan(0)
 expect(n.transform.ty+Number(clip.transform?.ty??0)).toBe(32+d.pages[0].canvasY!)
 expect(n.transform.tx+Number(clip.transform?.tx??0)).toBe(24+d.pages[0].canvasX!)
})

test('captured text avatars retain their coloured background and original text position',()=>{
 const d=fixture();d.pages=d.pages.slice(0,1);d.pages[0].objects=[]
 d.pages[0].structured={id:'avatar-frame',name:'Avatar',viewport:'390x844',sourceRoute:'/',width:390,height:844,captureMetadata:{capturedAt:'now',engine:'domSnapshot',structuredNodeCount:1,durationMs:0},children:[{id:'avatar',name:'JM',type:'Text',parentId:null,children:[],bounds:{x:30,y:50,width:40,height:40},layout:{mode:'free'},appearance:{backgroundColor:'#2266ee',radius:[20,20,20,20],opacity:1,rotation:0,clip:false},source:{tag:'span'},constraints:{position:'static'},visibility:true,locked:false,typography:{text:'JM',fontFamily:'Arial',fontWeight:'700',fontSize:14,lineHeight:20,letterSpacing:0,textAlign:'center',color:'#ffffff',captureLines:[{text:'JM',start:0,x:10,y:10,width:20,height:20}]}}]}
 const result=buildXdDocument({jobId:'avatar',document:d,scope:'all',includePrototype:false},()=>{})
 const scene=JSON.parse(result.entries.find(e=>e.path.startsWith('artwork/artboard-')&&e.path.endsWith('.agc'))!.data.toString())
 const n=scene.children[0].artboard.children[0]
 expect(n.type).toBe('group')
 expect(n.group.children[0].type).toBe('shape')
 expect(n.group.children[0].shape).toMatchObject({width:40,height:40,r:[20,20,20,20]})
 expect(n.group.children[0].style.fill.color.value).toMatchObject({r:34,g:102,b:238})
 expect(n.group.children[1].type).toBe('text')
 expect(n.group.children[1].text.rawText).toBe('JM')
 expect(n.transform.tx+n.group.children[1].transform.tx).toBe(40+d.pages[0].canvasX!)
})

test('positioned lines use their active run size rather than the inherited wrapper baseline',()=>{
 const d=fixture()
 d.pages[0].objects=[object('Text',{name:'Run baselines',fontFamily:'Arial',fontSize:20,lineHeight:30,text:'Title\nSubtitle',textRuns:[{start:0,end:5,fontSize:12},{start:6,end:14,fontSize:11}]})]
 const b=buildXdDocument({jobId:'run-baselines',document:d,scope:'all',includePrototype:false},()=>{},[],[{stack:'Arial',weight:'400',style:'normal',family:'Arial',postscript:'ArialMT',sourceBaselineBySize:{20:7,12:4,11:3}}])
 const all=b.entries.filter(e=>e.path.startsWith('artwork/')&&e.path.endsWith('.agc')).flatMap(e=>nodes(JSON.parse(e.data.toString())))
 const text=all.find(n=>n.name==='Run baselines') as any
 expect(text.transform.ty).toBe(120+15+4)
 expect(text.text.paragraphs[1].lines[0][0].y).toBe(29)
})

test('normal-size clipped category labels keep their full box, source weight and single opacity',()=>{
 const d=fixture();d.pages=d.pages.slice(0,1);d.pages[0].objects=[object('Text',{id:'category-label',name:'Category label',text:'Crew Member Details',x:38,y:52,width:140,height:16,clip:true,fontFamily:'Arial',fontWeight:'700',fontSize:12,lineHeight:15.6,opacity:.5})]
 const result=buildXdDocument({jobId:'category-mask',document:d,scope:'all',includePrototype:false},()=>{},[{family:'Arial',style:'Bold',postscript:'Arial-BoldMT'}])
 const scene=JSON.parse(result.entries.find(e=>e.path.startsWith('artwork/artboard-')&&e.path.endsWith('.agc'))!.data.toString())
 const group=scene.children[0].artboard.children[0],text=group.group.children[0]
 const resources=JSON.parse(result.entries.find(e=>e.path==='resources/graphics/graphicContent.agc')!.data.toString())
 const mask=resources.resources.clipPaths[group.style.clipPath.ref].children[0]
 expect(group.transform.tx).toBe(38+d.pages[0].canvasX!)
 expect(group.transform.ty).toBe(52+d.pages[0].canvasY!)
 expect(mask.shape).toMatchObject({width:140,height:16})
 expect(mask.transform).toBeUndefined()
 expect(text.transform.ty).toBe(12)
 expect(text.style.font.style).toBe('Bold')
 expect(text.style.opacity).toBe(1)
 expect(group.style.opacity).toBe(.5)
})

test('missing exact source faces warn about XD weight and metric substitution',()=>{
 const d=fixture();d.pages[0].objects=[object('Text',{text:'Source heading',fontFamily:'Source Family',fontWeight:'500'})]
 const measured=[{stack:'Source Family',weight:'500',style:'normal',family:'Source Family',fontStyle:'Medium',postscript:'SourceFamily-Medium'}]
 const result=buildXdDocument({jobId:'missing-face',document:d,scope:'all',includePrototype:false},()=>{},[{family:'Arial',style:'Regular',postscript:'ArialMT'}],measured)
 expect(result.report.warnings.some(w=>w.includes('Source font face is not installed: Source Family Medium (SourceFamily-Medium)'))).toBe(true)
 const matched=buildXdDocument({jobId:'installed-face',document:d,scope:'all',includePrototype:false},()=>{},[{family:'Source Family',style:'Medium',postscript:'SourceFamily-Medium'}],measured)
 expect(matched.report.warnings.some(w=>w.includes('Source font face is not installed:'))).toBe(false)
})

test('XD serializes native flow roots and scroll groups while retaining hidden editable children',()=>{
 const d=fixture()
 const child:any={id:'row',name:'Welcome back',type:'Text',parentId:'scroll',children:[],bounds:{x:0,y:400,width:300,height:30},layout:{mode:'free'},appearance:{opacity:1,rotation:0,clip:false},source:{tag:'span'},constraints:{position:'static'},visibility:true,locked:false,typography:{text:'Welcome back',fontFamily:'Arial',fontWeight:'400',fontSize:14,lineHeight:20,letterSpacing:0,textAlign:'left',color:'#000000'}}
 const group:any={id:'scroll',name:'Scrollable crew',type:'Container',parentId:null,children:[child],bounds:{x:24,y:100,width:342,height:100},layout:{mode:'free'},appearance:{opacity:1,rotation:0,clip:true,clipY:true,scroll:{x:0,y:0,width:342,height:100,contentWidth:342,contentHeight:500}},source:{tag:'div'},constraints:{position:'static'},visibility:true,locked:false}
 d.pages[0].objects=[]
 d.pages[0].structured={id:'frame',name:'Frame',width:390,height:844,viewport:'390x844',sourceRoute:'/',children:[group]} as any
 d.prototype={version:1,flows:[{id:'flow',name:'View crew details',startArtboardId:'first',artboardIds:['first','second'],positions:{},createdAt:d.updatedAt,updatedAt:d.updatedAt}],interactions:[],variables:{},scenarios:[],imports:[]}
 const b=build(d),all=b.entries.filter(e=>e.path.endsWith('.agc')).flatMap(e=>nodes(JSON.parse(e.data.toString())))
 const root=all.find(n=>(n.artboard as any)?.meta?.ux?.isFlowRoot)
 expect((root?.artboard as any).meta.ux.flowName).toBe('View crew details')
 const scroll=all.find(n=>(n.meta as any)?.ux?.scrollingType==='vertical')
 expect((scroll?.meta as any).ux.viewportHeight).toBe(100)
 expect(JSON.stringify(scroll)).toContain('Welcome back')
 expect(b.report.scrollGroups).toBe(1)
})
