import { describe, expect, test } from 'bun:test'
import { object } from '../visual/model'
import { buildFrameUiPackage } from './frameuiPackage'
import type { VisualDocument } from '@shared/types/visualDesign'
import type { FrameUiExportOptions } from '@shared/types/frameuiExport'

const options: FrameUiExportOptions = {
  scope: 'design', includeComponents: true, includeTokens: true, includePrototype: true,
  includeHiddenLayers: false, includeAnnotations: false, rasterizeUnsupported: 'ask', outlineMissingFonts: false,
}

function fixture(): VisualDocument {
  const component = object('Component', { id: 'component-button', name: 'Button / Primary', children: [object('Text', { id: 'component-label', text: 'Continue', name: 'Label' })] })
  return {
    version: 1, id: 'design-one', name: 'Banking UI', projectId: 'project-one', updatedAt: '2026-09-15T00:00:00.000Z',
    components: [component], variables: [{ id: 'token-brand', collection: 'Colour', name: 'color/brand/primary', type: 'Colour', value: '#149d91' }],
    pages: [{
      id: 'page-one', name: 'Welcome', folder: 'Designs', pinned: false, state: 'Desktop', width: 1440, height: 1024,
      fonts: [{ family: 'Acme Sans', style: 'normal', weight: '400', data: 'data:font/woff2;base64,U0VDUkVU' }],
      objects: [
        object('Text', { id: 'welcome-text', name: 'Welcome back', text: 'Welcome back', textRuns: [{ start: 0, end: 7, fontWeight: '700', color: '#149d91' }], fill: '#0d172a', bindings: { fill: 'token-brand' } }),
        object('Image', { id: 'brand-image', name: 'Brand mark', src: 'data:image/png;base64,iVBORw0KGgo=', width: 64, height: 64 }),
        object('Instance', { id: 'button-instance', name: 'Continue button', componentId: component.id }),
      ],
    }],
  }
}

describe('FrameUI interchange package', () => {
  test('keeps editable hierarchy, stable IDs, range formatting, assets, components and tokens', () => {
    const built = buildFrameUiPackage({ documents: [fixture()], activeDocumentId: 'design-one', activePageId: 'page-one', selectionIds: [], structuredSelectionIds: [], target: 'figma', options, frameuiVersion: '0.1.0', exportedAt: '2026-09-15T00:00:00.000Z' })
    expect(built.manifest).toMatchObject({ formatVersion: '1.0.0', targetApplication: 'Figma', artboardCount: 1, componentCount: 1, assetCount: 1, tokenCount: 1 })
    const documentFile = built.files.find((file) => file.path === 'document.json')!
    const document = JSON.parse(documentFile.content)
    const text = document.pages[0].root.children[0]
    expect(text.id).toBe('welcome-text')
    expect(text.type).toBe('TEXT')
    expect(text.text.runs).toEqual([{ start: 0, end: 7, fontWeight: '700', color: '#149d91' }])
    expect(built.files.some((file) => file.path.endsWith('.png') && file.encoding === 'base64')).toBe(true)
    expect(built.warnings).toEqual([])
  })

  test('exports user-drawn overlays with a structured capture without duplicating its legacy objects', () => {
    const design = fixture()
    design.pages[0].structured = {
      id:'captured-frame', name:'Capture', viewport:'1440x1024', sourceRoute:'/', width:1440, height:1024, children:[],
      captureMetadata:{capturedAt:'2026-09-17T00:00:00Z',engine:'domSnapshot',structuredNodeCount:0,durationMs:1,visualMatch:{diffPixels:0,totalPixels:100,diffPercent:0}},
    }
    design.pages[0].objects.push(object('Rectangle', {id:'designer-overlay',designOnly:true}))
    const built = buildFrameUiPackage({documents:[design],activeDocumentId:design.id,activePageId:'page-one',selectionIds:[],structuredSelectionIds:[],target:'figma',options,frameuiVersion:'0.1.0'})
    const root = JSON.parse(built.files.find(file=>file.path==='document.json')!.content).pages[0].root
    expect(root.children.map((node:{id:string})=>node.id)).toEqual(['designer-overlay'])
  })

  test('never packages repository paths, font bytes, credentials or environment data', () => {
    const design = fixture()
    design.pages[0].objects[0].source = { file: '/Users/person/private/repository/src/Login.tsx', selector: '#welcome' }
    const built = buildFrameUiPackage({ documents: [design], activeDocumentId: design.id, activePageId: 'page-one', selectionIds: [], structuredSelectionIds: [], target: 'figma', options, frameuiVersion: '0.1.0' })
    const archiveText = built.files.filter((file) => file.encoding === 'utf8').map((file) => file.content).join('\n')
    expect(archiveText).not.toContain('/Users/person')
    expect(archiveText).not.toContain('U0VDUkVU')
    expect(archiveText).not.toMatch(/password|apiKey|cookie|session/i)
    expect(archiveText).toContain('CHECK_ON_IMPORT')
  })

  test('selection scope exports only selected editable layers and blocks an empty selection', () => {
    const design = fixture()
    const selected = buildFrameUiPackage({ documents: [design], activeDocumentId: design.id, activePageId: 'page-one', selectionIds: ['welcome-text'], structuredSelectionIds: [], target: 'figma', options: { ...options, scope: 'selection' }, frameuiVersion: '0.1.0' })
    expect(JSON.parse(selected.files.find((file) => file.path === 'document.json')!.content).pages[0].root.children.map((node: { id: string }) => node.id)).toEqual(['welcome-text'])
    const empty = buildFrameUiPackage({ documents: [design], activeDocumentId: design.id, activePageId: 'page-one', selectionIds: [], structuredSelectionIds: [], target: 'figma', options: { ...options, scope: 'selection' }, frameuiVersion: '0.1.0' })
    expect(empty.warnings).toContainEqual(expect.objectContaining({ code: 'empty-frame', severity: 'error' }))
  })
})

test('computed SVG fill on HTML and SVG wrappers never becomes an opaque CSS background',()=>{
 const design=fixture();design.pages[0].objects=[]
 const base:any={parentId:null,children:[],bounds:{x:0,y:0,width:100,height:40},layout:{mode:'free'},appearance:{fill:'#000000',stroke:'#345673',strokeWidth:1.8,backgroundImage:'none',radius:[0,0,0,0],opacity:1,rotation:0,clip:false},source:{tag:'div'},constraints:{position:'static'},visibility:true,locked:false}
 design.pages[0].structured={id:'paint-dispatch',name:'Paint dispatch',width:1440,height:1024,viewport:'1440x1024',sourceRoute:'/',captureMetadata:{capturedAt:'2026-10-20T00:00:00Z',engine:'domSnapshot',structuredNodeCount:4,durationMs:1},children:[{...structuredClone(base),id:'transparent-html',name:'Transparent HTML',type:'Container'},{...structuredClone(base),id:'white-html',name:'White HTML',type:'Container',appearance:{...base.appearance,backgroundColor:'#ffffff'}},{...structuredClone(base),id:'svg-wrapper',name:'SVG wrapper',type:'SVG',source:{tag:'svg',svgGeometry:{viewBox:'0 0 100 40'}}},{...structuredClone(base),id:'svg-path',name:'SVG path',type:'Shape',source:{tag:'path',svgGeometry:{d:'M0 0H100V40Z'}}}]}
 const built=buildFrameUiPackage({documents:[design],activeDocumentId:design.id,activePageId:'page-one',selectionIds:[],structuredSelectionIds:[],target:'adobe-xd',options,frameuiVersion:'0.1.0'})
 const nodes=JSON.parse(built.files.find(f=>f.path==='document.json')!.content).pages[0].root.children
 expect(nodes[0].fills).toEqual([])
 expect(nodes[1].fills).toEqual([{type:'SOLID',color:'#ffffff',opacity:1}])
 expect(nodes[2].fills).toEqual([])
 expect(nodes[0].strokes).toEqual([])
 expect(nodes[2].strokes).toEqual([])
 expect(nodes[2].strokeWidth).toBe(0)
 expect(nodes[3].strokes).toEqual([{type:'SOLID',color:'#345673',opacity:1}])
 expect(nodes[3].strokeWidth).toBe(1.8)
 expect(nodes[3].fills).toEqual([{type:'SOLID',color:'#000000',opacity:1}])
})

test('HTML captured absolute children retain border-edge offsets without adding padding or shifting SVG geometry', () => {
  const design = fixture()
  const leaf = (id: string): any => ({ id, name: id, type: 'Container', parentId: 'parent', children: [], bounds: { x: 10, y: 12, width: 20, height: 18 }, layout: { mode: 'free' }, appearance: { opacity: 1, rotation: 0, clip: false, radius: [0,0,0,0] }, source: { tag: 'div' }, constraints: { position: 'static' }, visibility: true, locked: false })
  const parent = leaf('bordered parent')
  parent.bounds = { x: 20, y: 30, width: 100, height: 100 }
  parent.appearance.border = { width: 3, style: 'solid', color: '#000' }
  parent.layout.padding = { top: 40, right: 40, bottom: 40, left: 40 }
  const nested = leaf('nested')
  nested.appearance.border = { width: 2, style: 'solid', color: '#000' }
  nested.children = [leaf('grandchild')]
  parent.children = [nested]
  const svg = leaf('SVG viewport')
  svg.type = 'SVG'; svg.source.tag = 'svg'; svg.appearance.border = { width: 3, style: 'solid', color: '#000' }; svg.children = [leaf('SVG child')]
  design.pages[0].objects = []
  design.pages[0].structured = { id: 'frame', name: 'Boxes', width: 1440, height: 1024, viewport: '1440x1024', sourceRoute: '/', children: [parent, svg] } as any
  const built = buildFrameUiPackage({ documents: [design], activeDocumentId: design.id, activePageId: 'page-one', selectionIds: [], structuredSelectionIds: [], target: 'figma', options, frameuiVersion: '0.1.0' })
  const children = JSON.parse(built.files.find((f) => f.path === 'document.json')!.content).pages[0].root.children
  expect(children[0].children[0]).toMatchObject({ x: 13, y: 15 })
  expect(children[0].children[0].children[0]).toMatchObject({ x: 12, y: 14 })
  expect(children[1].children[0]).toMatchObject({ x: 10, y: 12 })
})
