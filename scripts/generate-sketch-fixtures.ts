import fs from 'node:fs'
import path from 'node:path'
import { object } from '../src/core/visual/model'
import { buildSketchDocument } from '../src/core/export/sketchDocument'
import { createStoredZip } from '../src/main/export/storedZip'
import type { VisualDocument, VisualObject } from '../src/shared/types/visualDesign'
const output = 'docs/verification/sketch-export-2026-10-16'
fs.mkdirSync(output, { recursive: true })
const base = (
  name: string,
  objects: VisualObject[],
  width = 1440,
  height = 900,
): VisualDocument => ({
  version: 1,
  id: 'fixture-' + name,
  name,
  updatedAt: '2026-10-16T00:00:00Z',
  components: [],
  variables: [],
  pages: [
    {
      id: 'artboard-' + name,
      name,
      folder: 'Export tests',
      state: 'Default',
      pinned: false,
      width,
      height,
      objects,
    },
  ],
})
const basic = base('basic', [
  object('Text', {
    id: 'title',
    text: 'Welcome back',
    fontFamily: 'Arial',
    fontSize: 32,
    width: 500,
    height: 40,
    x: 32,
    y: 32,
  }),
  object('Text', {
    id: 'body',
    text: 'Your original editable design.',
    fontFamily: 'Arial',
    x: 32,
    y: 100,
    width: 500,
    height: 32,
  }),
  object('Rectangle', {
    id: 'button',
    name: 'Primary action',
    x: 32,
    y: 160,
    width: 200,
    height: 48,
    fill: '#0d9488',
    radius: [12, 12, 12, 12],
  }),
  object('Vector', {
    id: 'icon',
    path: 'M2 12L9 19L22 3',
    width: 24,
    height: 24,
    x: 240,
    y: 170,
    fill: 'none',
    stroke: '#0d9488',
    strokeWidth: 2,
  }),
  object('Image', {
    id: 'image',
    x: 32,
    y: 240,
    width: 100,
    height: 60,
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9JkAAAAASUVORK5CYII=',
    imageFit: 'cover',
  }),
])
const dashboard = base('dashboard', [
  object('Group', {
    id: 'navigation',
    name: 'Navigation',
    width: 220,
    height: 900,
    fill: '#102030',
    children: ['Overview', 'Projects', 'Reports'].map((text, i) =>
      object('Text', {
        id: 'nav-' + i,
        name: text,
        text,
        x: 24,
        y: 100 + i * 48,
        fontFamily: 'Arial',
        fill: 'white',
      }),
    ),
  }),
  ...Array.from({ length: 12 }, (_, i) =>
    object('Group', {
      id: 'card-' + i,
      name: 'Metric ' + i,
      x: 260 + (i % 3) * 360,
      y: 40 + Math.floor(i / 3) * 180,
      width: 320,
      height: 144,
      fill: 'white',
      radius: [16, 16, 16, 16],
      shadow: '0px 4px 12px rgba(0, 0, 0, 0.1)',
      children: [
        object('Text', {
          id: 'metric-' + i,
          text: 'Open requests ' + i,
          x: 20,
          y: 20,
          width: 280,
          height: 32,
          fontFamily: 'Arial',
        }),
      ],
    }),
  ),
])
const gradient = base('gradient-heavy', [
  object('Group', {
    id: 'hero',
    width: 1440,
    height: 900,
    clip: true,
    gradient: 'linear-gradient(120deg, #008877 0%, #2266ff 100%)',
    children: [
      object('Rectangle', {
        id: 'glow',
        x: 400,
        y: 80,
        width: 500,
        height: 500,
        gradient: 'radial-gradient(circle, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 100%)',
        blur: 30,
      }),
      object('Text', {
        id: 'hero-title',
        text: 'Design without losing your structure',
        fontFamily: 'Arial',
        fontSize: 48,
        lineHeight: 56,
        fill: 'white',
        x: 80,
        y: 240,
        width: 700,
        height: 130,
      }),
      object('Rectangle', {
        id: 'glass',
        x: 800,
        y: 400,
        width: 400,
        height: 280,
        fill: 'rgba(255,255,255,0.4)',
        radius: [24, 24, 24, 24],
        shadow: '0px 12px 32px rgba(0,0,0,0.15)',
      }),
    ],
  }),
])
const mobile = base(
  'mobile',
  [
    object('Text', {
      id: 'mobile-title',
      text: 'Sign in',
      fontFamily: 'Arial',
      x: 24,
      y: 80,
      width: 342,
      height: 40,
    }),
  ],
  390,
  844,
)
mobile.pages.push({
  ...mobile.pages[0],
  id: 'mobile-success',
  name: 'Success',
  canvasX: 540,
  objects: [
    object('Text', {
      id: 'success-title',
      text: 'You are signed in',
      fontFamily: 'Arial',
      x: 24,
      y: 160,
      width: 342,
      height: 40,
    }),
  ],
})
mobile.prototype = {
  version: 1,
  flows: [
    {
      id: 'sign-in',
      name: 'Sign in',
      description: '',
      artboardIds: mobile.pages.map((p) => p.id),
      startArtboardId: mobile.pages[0].id,
      positions: {},
      createdAt: '',
      updatedAt: '',
    },
  ],
  interactions: [
    {
      id: 'nav',
      sourceArtboardId: mobile.pages[0].id,
      sourceElementId: 'mobile-title',
      trigger: 'click',
      action: 'navigate',
      destinationId: 'mobile-success',
      transition: 'instant',
    },
  ],
  scenarios: [],
  variables: {},
  imports: [],
}
const component = base('components', [
  object('Instance', {
    id: 'instance',
    name: 'Button instance',
    componentId: 'button-master',
    children: [
      object('Rectangle', { id: 'instance-bg', fill: '#0d9488', width: 160, height: 48 }),
      object('Text', {
        id: 'instance-label',
        text: 'Continue',
        fontFamily: 'Arial',
        x: 20,
        y: 10,
        width: 120,
        height: 28,
      }),
    ],
  }),
])
component.components = [object('Component', { id: 'button-master', name: 'Button' })]
const fixtures = [basic, dashboard, gradient, mobile, component]
for (const width of [390, 1440]) {
  const capture = JSON.parse(
    fs.readFileSync(
      `docs/verification/capture-quality-2026-10-16/mapmymaintenance/${width}.json`,
      'utf8',
    ),
  )
  const d = base('captured-' + width, [], capture.frame.width, capture.frame.height)
  d.pages[0].structured = capture.frame
  fixtures.push(d)
}
const results = []
for (const document of fixtures) {
  const built = buildSketchDocument({
    jobId: crypto.randomUUID(),
    document,
    scope: 'project',
    includePrototype: true,
  })
  const file = path.join(output, document.name + '.sketch')
  fs.writeFileSync(file, createStoredZip(built.entries))
  fs.writeFileSync(
    path.join(output, document.name + '-report.json'),
    JSON.stringify(built.report, null, 2),
  )
  results.push({ file, report: built.report })
  console.log(
    document.name,
    built.report.layers,
    'layers',
    built.report.warnings.length,
    'warnings',
  )
}
fs.writeFileSync(
  path.join(output, 'fixtures.json'),
  JSON.stringify(
    results.map((r) => ({ file: r.file, ...r.report })),
    null,
    2,
  ),
)
