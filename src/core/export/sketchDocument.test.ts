import { expect, test } from 'bun:test'
import { object } from '../visual/model'
import { buildSketchDocument } from './sketchDocument'
import { pathContours } from './sketchGeometry'
import type { VisualDocument } from '@shared/types/visualDesign'
export function sketchFixture(): VisualDocument {
  return {
    version: 1,
    id: 'xd-test',
    name: 'Design export',
    updatedAt: new Date().toISOString(),
    components: [],
    variables: [],
    pages: [
      {
        id: 'mobile',
        name: 'Login',
        folder: 'Designs',
        state: 'Mobile',
        pinned: false,
        width: 390,
        height: 844,
        canvasX: 80,
        canvasY: 120,
        objects: [
          object('Group', {
            id: 'form',
            name: 'Sign in',
            x: 24,
            y: 100,
            width: 342,
            height: 500,
            clip: true,
            radius: [16, 16, 16, 16],
            fill: '#ffffff',
            children: [
              object('Text', {
                id: 'title',
                name: 'Heading',
                text: 'Welcome back',
                x: 0,
                y: 16,
                width: 300,
                height: 48,
                fontSize: 28,
                fontWeight: '700',
                fill: '#102030',
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
    ],
  }
}
const build = (document = sketchFixture()) =>
  buildSketchDocument({
    jobId: crypto.randomUUID(),
    document,
    scope: 'project',
    includePrototype: true,
  })
const json = (built: ReturnType<typeof build>, name: string) =>
  JSON.parse(built.entries.find((e) => e.path === name)!.data.toString())
test('official Sketch schemas accept editable artboards, text, groups, gradients and paths', () => {
  const d = sketchFixture(),
    before = JSON.stringify(d)
  const b = build(d)
  const page = json(b, b.entries.find((e) => e.path.startsWith('pages/'))!.path)
  expect(page.layers[0].frame).toMatchObject({ x: 80, y: 120, width: 390, height: 844 })
  const group = page.layers[0].layers[0]
  expect(group._class).toBe('group')
  expect(group.layers.some((l: { hasClippingMask?: boolean }) => l.hasClippingMask)).toBe(true)
  expect(
    group.layers.find((l: { _class: string }) => l._class === 'text').attributedString.string,
  ).toBe('Welcome back')
  expect(b.report.editableText).toBe(1)
  expect(b.report.editableVectors).toBeGreaterThan(0)
  expect(b.report.xdValidation).toBe('unverified')
  expect(JSON.stringify(d)).toBe(before)
})
test('cubic/quadratic/arc geometry stays editable and invalid paths fail', () => {
  expect(
    pathContours('M0 0Q5 10 10 0A5 5 0 0 1 20 0Z', 20, 10)[0].points.some((p) => p.hasCurveTo),
  ).toBe(true)
  expect(() => pathContours('not a path', 10, 10)).toThrow()
})
test('selected flow includes its states and reports unsupported actions', () => {
  const d = sketchFixture()
  d.pages.push({ ...d.pages[0], id: 'modal', name: 'Modal', objects: [] })
  d.prototype = {
    version: 1,
    flows: [
      {
        id: 'flow',
        name: 'Sign in',
        description: '',
        artboardIds: ['mobile', 'modal'],
        startArtboardId: 'mobile',
        positions: {},
        createdAt: '',
        updatedAt: '',
      },
    ],
    interactions: [
      {
        id: 'click',
        sourceArtboardId: 'mobile',
        sourceElementId: 'button',
        trigger: 'click',
        action: 'navigate',
        destinationId: 'modal',
        transition: 'instant',
      },
      {
        id: 'open',
        sourceArtboardId: 'mobile',
        sourceElementId: 'title',
        trigger: 'hover',
        action: 'open-modal',
        destinationId: 'modal',
        transition: 'fade',
      },
    ],
    variables: {},
    scenarios: [],
    imports: [],
  }
  const b = buildSketchDocument({
    jobId: crypto.randomUUID(),
    document: d,
    scope: 'flow',
    flowId: 'flow',
    includePrototype: true,
  })
  expect(b.report.artboards).toBe(2)
  expect(b.report.unconvertedInteractions).toBe(1)
  expect(b.entries.some((e) => e.path === 'frameui/prototype.json')).toBe(true)
})
test('compound paths, hidden locks and original PNG bytes survive export without rasterizing text', () => {
  const d = sketchFixture()
  d.pages[0].objects.push(
    object('Vector', {
      id: 'compound',
      name: 'Compound',
      path: 'M0 0H40V40H0ZM10 10H30V30H10Z',
      width: 40,
      height: 40,
      hidden: true,
      locked: true,
    }),
  )
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9JkAAAAASUVORK5CYII='
  d.pages[0].objects.push(
    object('Image', {
      id: 'photo',
      src: 'data:image/png;base64,' + png,
      width: 100,
      height: 50,
      imageFit: 'cover',
    }),
  )
  const b = build(d)
  expect(
    b.entries
      .filter((e) => e.path.startsWith('images/'))[0]
      .data.equals(Buffer.from(png, 'base64')),
  ).toBe(true)
  const page = json(b, b.entries.find((e) => e.path.startsWith('pages/'))!.path)
  const compound = page.layers[0].layers.find((l: { name: string }) => l.name === 'Compound')
  expect(compound._class).toBe('shapeGroup')
  expect(compound.isVisible).toBe(false)
  expect(compound.isLocked).toBe(true)
  expect(b.report.fallbackEffects).toBe(0)
})
test('current structured design wins over a stale flattened screenshot regardless of visual diff', () => {
  const d = sketchFixture(),
    p = d.pages[0]
  p.objects = [object('Image', { id: 'old', src: 'data:image/png;base64,AAAA' })]
  p.structured = {
    id: 'native',
    name: p.name,
    viewport: '390x844',
    sourceRoute: '/',
    width: 390,
    height: 844,
    captureMetadata: { engine: 'design', capturedAt: '', structuredNodeCount: 1, durationMs: 0 },
    children: [
      {
        id: 'input',
        type: 'Input',
        name: 'Email',
        parentId: null,
        children: [],
        bounds: { x: 24, y: 180, width: 300, height: 48 },
        layout: { mode: 'free', padding: { top: 12, bottom: 12, left: 16, right: 16 } },
        appearance: {
          backgroundColor: '#f8fafc',
          radius: [12, 12, 12, 12],
          opacity: 1,
          rotation: 0,
          clip: false,
        },
        source: { tag: 'input', control: { type: 'email', placeholder: 'Work email' } },
        typography: {
          text: '',
          color: '#223344',
          fontFamily: 'Arial',
          fontSize: 16,
          fontWeight: '400',
          lineHeight: 24,
          letterSpacing: 0,
          textAlign: 'left',
        },
        constraints: { position: 'static' },
        visibility: true,
        locked: false,
      },
    ],
  }
  const b = build(d)
  expect(b.report.images).toBe(0)
  expect(b.report.editableText).toBe(1)
  const text = b.entries.find((e) => e.path.startsWith('pages/'))!.data.toString()
  expect(text).toContain('Work email')
  expect(text).toContain('rectangle')
})
test('scopes and bad references fail safely, deterministic IDs persist', () => {
  const d = sketchFixture()
  expect(() =>
    buildSketchDocument({
      jobId: 'x',
      document: d,
      scope: 'flow',
      flowId: 'absent',
      includePrototype: true,
    }),
  ).toThrow('Choose')
  expect(build(d).report.idMap).toEqual(build(d).report.idMap)
  d.pages[0].objects.push({ ...d.pages[0].objects[0] })
  expect(() => build(d)).toThrow('Duplicate')
})
test('project exports keep saved documents on separate pages and validate their references', async () => {
  const { buildSketchProject } = await import('./sketchProject')
  const a = sketchFixture(),
    b = sketchFixture()
  b.id = 'second-design'
  b.pages[0].id = 'second-page'
  const built = buildSketchProject({
    jobId: crypto.randomUUID(),
    document: a,
    documents: [b],
    scope: 'project',
    includePrototype: true,
  })
  expect(built.report.artboards).toBe(2)
  expect(built.entries.filter((e) => e.path.startsWith('pages/'))).toHaveLength(2)
  const doc = JSON.parse(built.entries.find((e) => e.path === 'document.json')!.data.toString())
  for (const page of doc.pages)
    expect(built.entries.some((e) => e.path === page._ref + '.json')).toBe(true)
})
test('CSS colour 4 is converted to sRGB and real font face names are resolved without embedding fonts', async () => {
  const { color } = await import('./sketchStyles')
  const { resolveExportFont } = await import('./sketchFonts')
  expect(color('oklch(60% 0.15 180)').green).toBeGreaterThan(0)
  expect(
    resolveExportFont(
      [{ family: 'Arial', style: 'Bold', postscript: 'Arial-BoldMT' }],
      'Arial',
      '700',
      'normal',
    ),
  ).toBe('Arial-BoldMT')
  expect(resolveExportFont([], 'Missing Font', '700', 'normal')).toBeUndefined()
})
