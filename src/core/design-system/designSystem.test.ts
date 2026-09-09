import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyseDesignSystem } from './analyseDesignSystem'
import { findRuntimeRelationships, runtimeElementAt, sanitizeRuntimeElement } from './runtimePreview'
import { previewDependencyFingerprint, validCachedPreview } from './previewCache'
import { searchDesignSystem } from './searchDesignSystem'
import type { Component, Page, Token } from '@shared/types/model/projectModel'
import type { CapturedElement, CapturedPage } from '@shared/types/runtimeCapture'
import type { ComponentIntelligence, PreviewCacheEntry } from '@shared/types/designSystem'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const setup = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-design-system-')); roots.push(root); return root }
const source = (filePath: string) => ({ filePath })
const node = (tagName: string, children: ReturnType<typeof node>[] = [], attributes?: Record<string, string>) => ({ tagName, isKnownComponent: /^[A-Z]/.test(tagName), children, attributes })
function page(id: string, name: string, route: string, componentNames: string[], structure: ReturnType<typeof node>[]): Page { return { id, name, route, routeId: `route.${id}`, area: 'App', source: source(`${id}.tsx`), structure, elementCount: structure.length, componentNames, textContent: [], supportedViewports: ['desktop', 'mobile'], states: [{ id: `state.${id}`, pageId: id, name: 'Default', kind: 'default' }], analysisStatus: 'ready' } }

describe('Design System source intelligence', () => {
  test('normalizes cross-stack components, fixtures, usages, tokens, values and patterns', () => {
    const root = setup()
    fs.writeFileSync(path.join(root, 'styles.css'), '.a{padding:16px;border-radius:6px;color:#101828;font-size:14px;font-weight:400}.b{padding:16px;border-radius:6px;color:#111827;font-size:14px;font-weight:400}.odd{padding:18px;border-radius:10px;font-size:13px;font-weight:700}')
    fs.writeFileSync(path.join(root, 'PrimaryButton.tsx'), "import './styles.css'; interface PrimaryButtonProps { variant?: 'primary' | 'warning'; size: 'small' | 'large' } export function PrimaryButton(p: PrimaryButtonProps){ return <button className='a'>{p.variant}</button> }")
    fs.writeFileSync(path.join(root, 'ActionButton.tsx'), "import './styles.css'; export const ActionButton=()=> <button className='b'><span>Action</span></button>")
    fs.writeFileSync(path.join(root, 'StatusBadge.vue'), "<script setup lang='ts'>const props=defineProps({ status: { type: String, default: 'paid' } })</script><template><span class='odd'>{{ props.status }}</span></template>")
    fs.writeFileSync(path.join(root, 'field.blade.php'), "<label>Name<input class='a' /></label>")
    for (const id of ['dashboard', 'settings', 'plain', 'form']) fs.writeFileSync(path.join(root, `${id}.tsx`), '<main/>')
    const components: Component[] = [
      { id: 'c.primary', name: 'PrimaryButton', exportKind: 'named', source: source('PrimaryButton.tsx') },
      { id: 'c.action', name: 'ActionButton', exportKind: 'named', source: source('ActionButton.tsx') },
      { id: 'c.status', name: 'StatusBadge', exportKind: 'default', source: source('StatusBadge.vue') },
      { id: 'c.field', name: 'Field', exportKind: 'template', source: source('field.blade.php') },
    ]
    const pages = [
      page('dashboard', 'Dashboard', '/dashboard', ['PrimaryButton', 'StatusBadge'], [node('main', [node('h1'), node('PrimaryButton'), node('StatusBadge')], { className: 'grid gap-4' })]),
      page('settings', 'Settings', '/settings', ['ActionButton'], [node('main', [node('h1'), node('ActionButton')], { className: 'flex' })]),
      page('plain', 'Plain', '/plain', [], [node('main', [node('h1')])]),
      page('form', 'Profile form', '/profile', ['Field'], [node('form', [node('Field'), node('button')])]),
    ]
    const tokens: Token[] = [{ id: 'token.spacing.4', category: 'spacing', name: '4', value: '16px', confidence: 'full' }, { id: 'token.radius', category: 'radius', name: 'DEFAULT', value: '6px', confidence: 'full' }, { id: 'token.breakpoint.md', category: 'breakpoint', name: 'md', value: '768px', confidence: 'full' }]
    const model = analyseDesignSystem(root, pages, components, tokens, 'mixed source adapters')
    assert.deepEqual(model.categories.slice(0, 5), ['components', 'colours', 'typography', 'spacing', 'radius'])
    const button = model.components.find((item) => item.componentId === 'c.primary')!
    assert.equal(button.category, 'Buttons')
    assert.equal(button.previewApproach, 'source')
    assert.match(button.previewDocument?.html ?? '', /<button/)
    assert.match(button.previewDocument?.css ?? '', /border-radius:6px/)
    assert.deepEqual(button.props.find((prop) => prop.name === 'variant')?.values, ['primary', 'warning'])
    assert.ok(button.fixtures.some((fixture) => fixture.name === 'Warning'))
    assert.equal(button.usages[0].pageId, 'dashboard')
    assert.ok(model.components.find((item) => item.componentId === 'c.field')!.sourceStructure.length > 0)
    assert.ok(model.observations.some((item) => item.category === 'colour' && item.value === '#101828'))
    assert.ok(model.observations.some((item) => item.category === 'typography'))
    assert.ok(model.observations.some((item) => item.category === 'spacing' && item.value === '16px'))
    assert.ok(model.observations.some((item) => item.category === 'breakpoint' && item.value === '768px'))
    assert.ok(model.patterns.some((item) => item.category === 'layout' && item.name === 'Grid layout'))
    assert.ok(model.patterns.some((item) => item.category === 'form'))
    assert.ok(model.findings.some((item) => item.kind === 'near-duplicate-colour'))
    assert.ok(model.findings.some((item) => item.kind === 'spacing-outlier'))
    assert.ok(model.findings.some((item) => item.kind === 'radius-outlier'))
    assert.ok(model.findings.some((item) => item.kind === 'typography-difference'))
    assert.ok(model.findings.some((item) => item.kind === 'possible-duplicate-component'))
    assert.ok(model.findings.some((item) => item.kind === 'pattern-difference'))
    assert.equal(searchDesignSystem('warning', components, model.components, model.observations, model.patterns)[0].id, 'c.primary')
    assert.ok(searchDesignSystem('16px', components, model.components, model.observations, model.patterns).some((item) => item.kind === 'Value'))
  })

  test('detects minimum context without claiming an isolated preview', () => {
    const root = setup(); fs.writeFileSync(path.join(root, 'ContextCard.tsx'), "import { useTheme } from './theme'; export const ContextCard=()=> <section>{useTheme().name}</section>"); fs.writeFileSync(path.join(root, 'DataOnly.ts'), 'export const value = 1')
    const component: Component = { id: 'c.context', name: 'ContextCard', exportKind: 'named', source: source('ContextCard.tsx') }
    const unavailable: Component = { id: 'c.data', name: 'DataOnly', exportKind: 'named', source: source('DataOnly.ts') }
    const analysed = analyseDesignSystem(root, [], [component, unavailable], [], 'React TSX')
    const info = analysed.components[0]
    assert.equal(info.previewApproach, 'context')
    assert.deepEqual(info.contextRequirements, ['Theme'])
    assert.equal(analysed.components[1].previewApproach, 'unavailable')
    assert.match(analysed.components[1].previewUnavailableReason ?? '', /No safe standalone render/)
  })
})

const element = (backgroundColor: string, textPreview: string): CapturedElement => ({ tag: 'button', componentHint: 'PrimaryButton', textPreview, rect: { x: 0, y: 0, width: backgroundColor === 'red' ? 120 : 100, height: 40 }, styles: { display: 'block', backgroundColor }, children: [] })
describe('runtime fallback and preview cache', () => {
  test('associates meaningful visual states, deduplicates text-only differences and redacts secrets', () => {
    const component: Component = { id: 'c.primary', name: 'PrimaryButton', exportKind: 'named', source: source('PrimaryButton.tsx') }
    const info = { componentId: component.id, usages: [] } as unknown as ComponentIntelligence
    const rootElement: CapturedElement = { tag: 'body', rect: { x: 0, y: 0, width: 1280, height: 720 }, styles: {}, children: [element('blue', 'Save'), element('blue', 'Continue'), element('red', 'Delete')] }
    const capture: CapturedPage = { id: 'capture.1', projectId: 'project', url: 'https://example.test/unknown', capturedAt: new Date().toISOString(), root: rootElement }
    const relationships = findRuntimeRelationships([capture], component, info, [], [])
    assert.equal(relationships.length, 2)
    assert.equal(runtimeElementAt(capture, relationships[0].elementPath)?.textPreview, 'Save')
    assert.equal(sanitizeRuntimeElement(element('blue', 'Bearer abc.secret')).textPreview, '[redacted]')
  })

  test('invalidates only when relevant component dependencies or fixture props change', () => {
    const info = { componentId: 'c.primary', dependencyFingerprint: 'source-v1' } as ComponentIntelligence
    const fixture = { id: 'fixture.paid', name: 'Paid', origin: 'detected' as const, props: { status: 'paid' } }
    const entry: PreviewCacheEntry = { componentId: info.componentId, fixtureId: fixture.id, approach: 'source', dependencyFingerprint: previewDependencyFingerprint(info, fixture), structure: [], runtimeElement: null, runtimeCaptureId: null, failureReason: null, updatedAt: new Date().toISOString() }
    assert.equal(validCachedPreview([entry], info, fixture), entry)
    assert.equal(validCachedPreview([entry], { ...info, dependencyFingerprint: 'source-v2' }, fixture), null)
    assert.equal(validCachedPreview([entry], info, { ...fixture, props: { status: 'overdue' } }), null)
  })
})
