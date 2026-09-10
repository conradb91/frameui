import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Annotation, DesignOperation } from '@shared/types/model/featureModel'
import * as store from './featureWorkPackageStore'
import { getFeaturesFile } from '../paths'
import { writeJsonFileAtomic } from '../atomicJson'
import * as featureStore from './featureStore'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const setup = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-work-package-')); roots.push(root); return root }
const projectId = '9cb7d60d-2a14-47a6-9c59-773e480a32b4'
const featureId = 'ddcc3bb2-36ab-4a46-ae9d-ec351ab925e7'
function seedFeature(root: string) { const now = new Date().toISOString(); writeJsonFileAtomic(getFeaturesFile(root, projectId), [{ id: featureId, projectId, name: 'Feature', description: '', status: 'designing', owner: null, reviewers: [], dueDate: null, externalTicketRef: null, pageIds: [], referenceOnlyPageIds: [], newPageIds: [], componentIds: [], createdAt: now, updatedAt: now }]) }

function operation(value: string): DesignOperation {
  return { id: 'operation-stable', revisionId: crypto.randomUUID(), featureId, ownerId: 'state.default', pageRef: { kind: 'existing', pageId: 'page.dashboard' }, designStateId: 'state.default', alternativeId: null, type: 'change-content', targetNodeId: 'title', key: 'title:content', summary: 'Change title text', property: 'content', breakpoint: null, baseValue: 'A', proposedValue: value, node: null, parentId: null, index: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

describe('Feature work-package persistence', () => {
  test('persists review state and preserves deleted-node history', () => {
    const root = setup(); const now = new Date().toISOString()
    const annotation: Annotation = { id: crypto.randomUUID(), featureId, pageRef: { kind: 'existing', pageId: 'page.dashboard' }, designStateId: 'state.default', alternativeId: null, viewport: 'mobile', context: 'proposed', elementId: 'deleted-node', elementLabel: 'PageHeader', componentId: null, versionId: null, screenshotAssetId: null, sourceReference: null, comment: 'Spacing', status: 'open', priority: 'high', needsAttention: true, createdAt: now, updatedAt: now, createdBy: 'Local designer' }
    store.saveAnnotation(root, projectId, annotation)
    store.saveAnnotation(root, projectId, { ...annotation, status: 'resolved' })
    store.saveAnnotation(root, projectId, { ...annotation, status: 'reopened' })
    assert.deepEqual({ ...store.listAnnotations(root, projectId, featureId)[0], createdAt: '', updatedAt: '', id: '' }, { ...annotation, status: 'reopened', createdAt: '', updatedAt: '', id: '' })
  })

  test('versions share operation revisions and restore without deleting newer history', () => {
    const root = setup()
    seedFeature(root)
    store.saveOperations(root, projectId, featureId, 'state.default', [operation('Concept A')])
    const first = store.createVersion(root, projectId, featureId, 'Review Round 1', 'Designer')
    store.saveOperations(root, projectId, featureId, 'state.default', [operation('Concept B')])
    store.createVersion(root, projectId, featureId, 'Review Round 2', 'Designer')
    const differences = store.compareVersions(root, projectId, featureId, first.id, null)
    assert.equal(differences[0].kind, 'changed')
    store.restoreVersion(root, projectId, featureId, first.id, 'Designer')
    assert.equal(store.listVersions(root, projectId, featureId).length, 3)
    assert.equal(store.getOperations(root, projectId, featureId, 'state.default')[0].proposedValue, 'Concept A')
    const renamed = store.renameVersion(root, projectId, featureId, first.id, 'Approved')
    assert.equal(renamed.name, 'Approved')
    store.duplicateVersion(root, projectId, featureId, first.id, 'Designer')
    assert.equal(store.listVersions(root, projectId, featureId).length, 4)
  })

  test('persists the complete lightweight Feature lifecycle', () => {
    const root = setup()
    const feature = featureStore.createFeature(root, projectId, 'Lifecycle', '')
    for (const status of ['designing', 'review', 'approved', 'ready-for-development', 'implemented', 'verified'] as const) {
      featureStore.setFeatureStatus(root, projectId, feature.id, status)
      assert.equal(featureStore.getFeature(root, projectId, feature.id)?.status, status)
    }
  })

  test('persists a Design System component on the existing Feature model', () => {
    const root = setup()
    const feature = featureStore.createFeature(root, projectId, 'Component feature', '')
    featureStore.saveFeature(root, { ...feature, componentIds: ['component.primary-button'] })
    assert.deepEqual(featureStore.getFeature(root, projectId, feature.id)?.componentIds, ['component.primary-button'])
  })

  test('persists lightweight export history and settings without binaries', () => {
    const root = setup()
    seedFeature(root)
    const record = { id: 'export.1', featureId, versionId: null, versionName: 'Approved v3', type: 'feature' as const, fileCount: 12, configuration: { pageRefs: [{ kind: 'existing' as const, pageId: 'page.dashboard' }], stateIds: ['state.default'], viewports: ['desktop' as const, 'mobile' as const], componentIds: [], journeyIds: [], includeAnnotations: true, includePageLabels: true, includeMetadata: true, embedImages: true, textHandling: 'editable' as const, background: 'design' as const, journeyLayout: 'horizontal' as const }, createdAt: new Date().toISOString(), outputPath: '/tmp/Add-Bill-Redesign' }
    store.recordExport(root, projectId, record)
    assert.deepEqual(store.listExportHistory(root, projectId, featureId), [record])
    assert.equal(JSON.stringify(store.getPackage(root, projectId, featureId)).includes('<svg'), false)
  })
})
