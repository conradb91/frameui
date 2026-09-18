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
