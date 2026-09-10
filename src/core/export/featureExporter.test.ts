import { describe, expect, test } from 'bun:test'
import type { DesignNode } from '@shared/types/designNode'
import type { FeatureExportSettings, HandoffInput } from '@shared/types/handoff'
import type { FeatureExportInput } from './featureExporter'
import { buildFeatureHandoff, describeDesignOperation } from '../handoff/buildFeatureHandoff'
import { exportFeaturePackage, sanitizeFilename, serializeJourneyBoard, validateSvg } from './featureExporter'
import { serializeScreenToSvg } from './svgSerializer'

const tree: DesignNode = {
  id: 'page-root', kind: 'stack', editability: 'editable', provenance: 'existing-modified', direction: 'column', gap: 16, align: 'stretch', children: [
    { id: 'title', kind: 'heading', editability: 'editable', provenance: 'existing-modified', content: 'Create a bill', children: [], style: { fontFamily: 'Inter', fontSize: 24, fontWeight: 700, color: '#fafafa', letterSpacing: .2 } },
    { id: 'form', kind: 'grid', editability: 'editable', provenance: 'new', columns: 2, columnGap: 24, rowGap: 16, responsiveOverrides: { mobile: { columns: 1, columnGap: 16 } }, children: [
      { id: 'card', kind: 'container', editability: 'editable', provenance: 'existing-modified', children: [], style: { backgroundColor: '#202027', borderColor: '#45454d', borderWidth: 2, borderRadius: 14, opacity: .9 } },
      { id: 'logo', kind: 'image', editability: 'editable', provenance: 'new', alt: 'Bank logo', src: 'data:image/png;base64,AAAA', objectFit: 'contain', children: [] },
      { id: 'icon', kind: 'placeholder', label: 'PrimaryButton', editability: 'limited', provenance: 'existing', sourceReference: { filePath: 'components/PrimaryButton.tsx' }, children: [] },
      { id: 'progress-instance', kind: 'concept', conceptComponentId: 'component.payment-progress', variantId: 'variant.default', propertyValues: { label: 'Processing' }, editability: 'editable', provenance: 'new', children: [] },
    ] },
  ],
}
const feature = { id: 'feature.add-bill', projectId: 'project.demo', name: 'Add Bill Redesign', description: 'Make bill creation clearer.', status: 'ready-for-development' as const, owner: null, reviewers: [], dueDate: null, externalTicketRef: null, pageIds: ['page.add-bill'], referenceOnlyPageIds: ['page.bills'], newPageIds: ['page.confirmation'], componentIds: ['component.primary-button'], createdAt: '2026-09-01', updatedAt: '2026-09-02' }
const state = { id: 'state.add-bill.default', featureId: feature.id, pageRef: { kind: 'existing' as const, pageId: 'page.add-bill' }, name: 'Default', origin: 'design' as const, capturedPageId: null, duplicatedFromStateId: null, order: 0, provenance: 'existing-modified' as const, createdAt: '2026-09-01', updatedAt: '2026-09-02' }
const operation = { id: 'op.title', revisionId: 'op.title.r2', featureId: feature.id, ownerId: state.id, pageRef: state.pageRef, designStateId: state.id, alternativeId: null, type: 'change-content' as const, targetNodeId: 'title', key: 'title:content', summary: 'Title changed', property: 'content', breakpoint: null, baseValue: 'Add bill', proposedValue: 'Create a bill', node: null, parentId: null, index: null, createdAt: '2026-09-02', updatedAt: '2026-09-02' }
const journey = { id: 'journey.add-bill', featureId: feature.id, name: 'Add Bill Journey', description: '', steps: [{ id: 'step.1', pageRef: state.pageRef, designStateId: state.id, alternativeId: null, referenceOnly: false, provenance: 'existing-modified' as const, position: { x: 0, y: 0 } }, { id: 'step.2', pageRef: { kind: 'new' as const, pageId: 'page.confirmation' }, designStateId: null, alternativeId: null, referenceOnly: false, provenance: 'new' as const, position: { x: 400, y: 0 } }], connections: [{ id: 'connection.save', fromStepId: 'step.1', toStepId: 'step.2', trigger: 'submit' as const, elementId: 'button.save', elementLabel: 'Save Bill', label: 'Continue', transitionMeta: {} }], createdAt: '2026-09-01', updatedAt: '2026-09-02' }
const projectModel = { version: 1 as const, projectId: 'project.demo', generatedAt: '2026-09-01', pages: [{ id: 'page.add-bill', name: 'Add Bill', route: '/bills/new', routeId: null, area: 'Bills', source: { filePath: 'pages/AddBill.tsx' }, structure: [], elementCount: 4, componentNames: ['PrimaryButton'], textContent: [], supportedViewports: ['desktop' as const, 'mobile' as const], states: [], analysisStatus: 'ready' as const }, { id: 'page.bills', name: 'Our Bills', route: '/bills', routeId: null, area: 'Bills', source: { filePath: 'pages/Bills.tsx' }, structure: [{ tagName: 'BillsTable', isKnownComponent: true, textPreview: 'Recent bills', children: [] }], elementCount: 2, componentNames: [], textContent: [], supportedViewports: ['desktop' as const], states: [], analysisStatus: 'ready' as const }], routes: [], areas: [], components: [{ id: 'component.primary-button', name: 'PrimaryButton', exportKind: 'default' as const, source: { filePath: 'components/PrimaryButton.tsx' } }], tokens: [{ id: 'token.spacing.md', category: 'spacing' as const, name: 'spacing.md', value: '16px', confidence: 'full' as const }], tokenSource: 'css-custom-properties' as const, styles: [], assets: [], interactions: [], diagnostics: [], designSystem: { version: 1 as const, generatedAt: '2026-09-01', categories: [], components: [{ componentId: 'component.primary-button', category: 'Buttons' as const, frameworkOrigin: 'react', props: [{ name: 'variant', required: false, type: 'string', values: ['primary'], defaultValue: 'primary' }], fixtures: [], sourceStructure: [], previewDocument: null, contextRequirements: [], tokenIds: [], layoutBehaviours: [], responsiveBehaviours: ['Full width on mobile'], usages: [{ pageId: 'page.add-bill', pageName: 'Add Bill', route: '/bills/new', source: { filePath: 'pages/AddBill.tsx' }, count: 3 }], previewApproach: 'source' as const, previewUnavailableReason: null, dependencyPaths: [], dependencyFingerprint: 'x', relatedComponentIds: [], searchText: '' }], observations: [], patterns: [], findings: [] }, statistics: { pages: 2, components: 1, tokens: 1, layouts: 0, navigationGroups: 0, connections: 0, unresolvedRoutes: 0, issues: 0, renderIssues: 0 } }
const handoffInput: HandoffInput = { feature, projectModel, featurePages: [{ id: 'page.confirmation', featureId: feature.id, name: 'Confirmation', description: '', suggestedRoute: '/bills/confirmation', initialViewport: 'desktop', layoutSource: 'blank', basedOnPageId: null, basedOnPatternName: null, status: 'approved', createdAt: '2026-09-01', updatedAt: '2026-09-02' }], states: [state], conceptComponents: [{ id: 'component.payment-progress', featureId: feature.id, name: 'PaymentProgress', description: '', variants: [{ id: 'variant.default', name: 'Default' }], properties: [{ id: 'property.label', name: 'label', type: 'text', defaultValue: 'Processing' }], createdAt: '2026-09-01', updatedAt: '2026-09-02' }], journeys: [journey], annotations: [{ id: 'note.1', featureId: feature.id, pageRef: state.pageRef, designStateId: state.id, alternativeId: null, viewport: 'mobile', context: 'proposed', elementId: 'form', elementLabel: 'Form', componentId: null, versionId: null, screenshotAssetId: null, sourceReference: null, comment: 'Save action must remain visible.', status: 'open', priority: 'high', needsAttention: false, createdAt: '2026-09-02', updatedAt: '2026-09-02', createdBy: 'Designer' }], versions: [], operations: [operation], trees: { [state.id]: tree } }
const settings: FeatureExportSettings = { pageRefs: [state.pageRef], stateIds: [state.id], viewports: ['desktop', 'mobile'], componentIds: ['component.payment-progress'], journeyIds: [journey.id], includeAnnotations: true, includePageLabels: true, includeMetadata: true, embedImages: true, textHandling: 'editable', background: 'design', journeyLayout: 'horizontal' }

describe('Feature handoff', () => {
  test('derives pages, states, responsive rules, components, interactions and review notes', () => {
    const result = buildFeatureHandoff(handoffInput)
    expect(result.summary.pages).toBe(3)
    expect(result.summary.changedPages).toBe(1)
    expect(result.summary.newPages).toBe(1)
    expect(result.summary.referencePages).toBe(1)
    expect(result.summary.states).toBe(1)
    expect(result.summary.modifiedComponents).toBe(0)
    expect(result.summary.reusedComponents).toBe(1)
    expect(result.summary.newComponents).toBe(1)
    expect(result.pages[0].responsive[0].breakpoint).toBe('mobile')
    expect(result.interactions[0]).toMatchObject({ trigger: 'submit', element: 'Save Bill', to: 'Confirmation' })
    expect(result.notes[0].comment).toContain('visible')
  })
  test('translates operations without losing inspectable technical data', () => {
    expect(describeDesignOperation(operation)).toBe('Changed content from “Add bill” to “Create a bill”')
    expect(buildFeatureHandoff(handoffInput).changes[0].technical.revisionId).toBe('op.title.r2')
  })
})

describe('structured SVG and package export', () => {
  test('preserves editable text, shapes, image data, borders, radius, opacity and stable named groups', () => {
    const result = serializeScreenToSvg(tree, 'desktop', 1440, { includeMetadata: true })
    expect(result.svg).toContain('<text')
    expect(result.svg).toContain('Create a bill</text>')
    expect(result.svg).toContain('<image')
    expect(result.svg).toContain('data:image/png;base64,AAAA')
    expect(result.svg).toContain('stroke-width="2"')
    expect(result.svg).toContain('rx="14"')
    expect(result.svg).toContain('opacity="0.9"')
    expect(result.svg).toContain('data-frameui-id="progress-instance"')
    expect(result.svg).not.toContain('file://')
    expect(validateSvg(result.svg)).toEqual([])
  })
  test('applies selected mobile responsive layout and preserves stable ids', () => {
    const desktop = serializeScreenToSvg(tree, 'desktop', 1440).svg
    const mobile = serializeScreenToSvg(tree, 'mobile', 390).svg
    expect(desktop).not.toBe(mobile)
    expect(mobile).toContain('data-frameui-id="form"')
    expect(tree.id).toBe('page-root')
  })
  test('organises selected pages, states, components, journey and manifest', () => {
    const input: FeatureExportInput = { ...handoffInput, approvedVersion: null, settings }
    const result = exportFeaturePackage(input)
    expect(result.files.map((file) => file.path)).toEqual(expect.arrayContaining(['pages/add-bill-desktop.svg', 'pages/add-bill-mobile.svg', 'components/payment-progress.svg', 'journeys/add-bill-journey.svg', 'manifest/frameui-export.json']))
    expect(result.files.every((file) => !file.path.includes('..'))).toBe(true)
    expect(result.files.filter((file) => file.mimeType === 'image/svg+xml').every((file) => validateSvg(file.content).length === 0)).toBe(true)
  })
  test('journey boards use actual page preview and labelled interactions', () => {
    const result = serializeJourneyBoard(journey, { ...handoffInput, approvedVersion: null, settings })
    expect(result.svg).toContain('Create a bill')
    expect(result.svg).toContain('Continue')
    expect(result.svg).toContain('Add Bill')
    expect(result.svg).not.toContain('group1')
  })
  test('exports reference-only pages from stable source-derived structure', () => {
    const input: FeatureExportInput = { ...handoffInput, approvedVersion: null, settings: { ...settings, pageRefs: [{ kind: 'existing', pageId: 'page.bills' }], stateIds: [], viewports: ['desktop'], componentIds: [], journeyIds: [] } }
    const result = exportFeaturePackage(input)
    expect(result.files[0].path).toBe('pages/our-bills-desktop.svg')
    expect(result.files[0].content).toContain('Recent bills')
    expect(result.files[0].content).toContain('data-frameui-id="page.bills.source.0"')
  })
  test('runs the complete delivery fixture across modified, new, reference, state, responsive, component and journey output', () => {
    const validation = { ...state, id: 'state.add-bill.validation', name: 'Validation Error', order: 1 }
    const confirmation = { ...state, id: 'state.confirmation.success', pageRef: { kind: 'new' as const, pageId: 'page.confirmation' }, name: 'Success', order: 0, provenance: 'new' as const }
    const validationTree: DesignNode = { ...tree, id: 'page-root-validation', children: [...tree.children, { id: 'validation-message', kind: 'text', content: 'Amount is required', editability: 'editable', provenance: 'new', style: { color: '#f16565' }, children: [] }] }
    const confirmationTree: DesignNode = { id: 'confirmation-root', kind: 'stack', editability: 'editable', provenance: 'new', direction: 'column', gap: 16, align: 'center', children: [{ id: 'confirmation-title', kind: 'heading', content: 'Bill created', editability: 'editable', provenance: 'new', children: [] }] }
    const completeSettings = { ...settings, pageRefs: [{ kind: 'existing' as const, pageId: 'page.add-bill' }, { kind: 'new' as const, pageId: 'page.confirmation' }, { kind: 'existing' as const, pageId: 'page.bills' }], stateIds: [state.id, validation.id, confirmation.id] }
    const result = exportFeaturePackage({ ...handoffInput, states: [state, validation, confirmation], trees: { [state.id]: tree, [validation.id]: validationTree, [confirmation.id]: confirmationTree }, approvedVersion: null, settings: completeSettings })
    const paths = result.files.map((file) => file.path)
    expect(paths).toEqual(expect.arrayContaining(['pages/add-bill-default-desktop.svg', 'pages/add-bill-validation-error-mobile.svg', 'pages/confirmation-success-desktop.svg', 'pages/our-bills-desktop.svg', 'components/payment-progress.svg', 'journeys/add-bill-journey.svg', 'manifest/frameui-export.json']))
    expect(result.warnings.filter((warning) => warning.code === 'invalid-svg' || warning.code === 'local-reference')).toEqual([])
  })
  test('sanitises filenames', () => expect(sanitizeFilename('  Add Bill / Validation: Mobile  ')).toBe('add-bill-validation-mobile'))
})
