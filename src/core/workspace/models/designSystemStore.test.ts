import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import * as store from './designSystemStore'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('Design System user metadata persistence', () => {
  test('persists fixtures, approvals and intentional findings without touching source', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-design-system-store-')); roots.push(userData)
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-design-system-source-')); roots.push(project)
    const sourceFile = path.join(project, 'Button.tsx'); fs.writeFileSync(sourceFile, 'export const Button = () => <button />')
    const before = crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex')
    const projectId = 'project-1'; const fixtureId = 'fixture-1'
    store.saveFixture(userData, projectId, { id: fixtureId, projectId, componentId: 'component-1', name: 'Warning', origin: 'user-defined', props: { tone: 'warning' }, updatedAt: '' })
    store.savePreviewCache(userData, projectId, { componentId: 'component-1', fixtureId, approach: 'context', dependencyFingerprint: 'hash', structure: [], runtimeElement: null, runtimeCaptureId: null, failureReason: null, updatedAt: new Date().toISOString() })
    store.setObservationApproved(userData, projectId, 'observation-1', true)
    store.saveFindingDecision(userData, projectId, { findingId: 'finding-1', evidenceSignature: 'evidence-v1', status: 'intentional', note: '', updatedAt: '' })
    const loaded = store.getData(userData, projectId)
    assert.equal(loaded.fixtures[0].props.tone, 'warning')
    assert.deepEqual(loaded.approvedObservationIds, ['observation-1'])
    assert.equal(loaded.findingDecisions[0].evidenceSignature, 'evidence-v1')
    store.deleteFixture(userData, projectId, fixtureId)
    assert.equal(store.getData(userData, projectId).previewCache.length, 0)
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex'), before)
  })
})
