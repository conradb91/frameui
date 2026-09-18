import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readProjectVisuals } from './projectVisuals'
import { phpAdapter } from '../adapters/php/phpAdapter'
import { createIgnoreRules } from '../indexer/ignore'
import { projectDocument } from '../../renderer/lib/projectSurface'
import { applyCommand, invertCommand } from '../design-model/commands'
import type { DesignNode } from '@shared/types/designNode'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-visuals-')); roots.push(root); return root }

test('generic PHP opens actual scripts and starts a local PHP server, even with a JS asset script', () => {
  const root = fixture()
  fs.mkdirSync(path.join(root, 'views'))
  fs.mkdirSync(path.join(root, 'controllers'))
  fs.writeFileSync(path.join(root, 'index.php'), '<h1>Home</h1>')
  fs.writeFileSync(path.join(root, 'payment.php'), '<form>Payment</form>')
  fs.writeFileSync(path.join(root, 'views', 'receipt.php'), '<h1>Receipt</h1>')
  fs.writeFileSync(path.join(root, 'controllers', 'Order.php'), '<?php class Order {}')
  const ctx = { rootPath: root, pkg: null, composer: null, candidateFiles: ['index.php', 'payment.php'], ignoreRules: createIgnoreRules() }
  const match = phpAdapter.detect(ctx)!
  expect(match.devCommand).toEqual({ command: 'php', args: ['-S', '127.0.0.1:8080', '-t', '.'] })
  const pages = phpAdapter.findPages(ctx, match)
  expect(pages.find((p) => p.filePath === 'payment.php')?.route).toBe('/payment.php')
  expect(pages.find((p) => p.filePath === 'index.php')?.route).toBe('/')
  expect(pages.find((p) => p.filePath === 'views/receipt.php')?.route).toBeNull()
  expect(pages.some((p) => p.filePath.includes('controllers'))).toBe(false)
})

test('project visual bundle reads real CSS and embeds only bounded local assets', () => {
  const root = fixture()
  fs.writeFileSync(path.join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  fs.writeFileSync(path.join(root, 'app.css'), '@import "https://example.com/fonts.css"; .container { max-width: 72rem; gap: 1.5rem; font-family: Product Sans; color: #234567; background:url(./icon.svg) } @media (min-width: 48rem) { .mobile { display: none; } }')
  const bundle = readProjectVisuals(root, ['app.css', 'icon.svg', '../outside.css'])
  expect(bundle.breakpoints).toEqual([768])
  expect(bundle.containerWidths).toEqual([1152])
  expect(bundle.spacing).toEqual([24])
  expect(bundle.fonts).toEqual(['Product Sans'])
  expect(bundle.colors).toEqual(['#234567'])
  expect(bundle.css).not.toContain('https://example.com')
  expect(bundle.css).toContain('data:image/svg+xml;base64,')
  expect(bundle.visibilityRules.length).toBe(1)
})

test('editable project documents preserve classes and text, block scripts and network, and keep guides out of output', () => {
  const bundle = readProjectVisuals(fixture(), [])
  const node: DesignNode = { id: 'button', kind: 'placeholder', editability: 'editable', children: [], label: 'button', textPreview: '<Pay>', attributes: { class: 'payment primary', onclick: 'alert(1)' }, style: { maxWidth: 1152 } }
  const html = projectDocument(node, bundle, 'desktop')
  expect(html).toContain('class="payment primary"')
  expect(html).toContain('&lt;Pay&gt;')
  expect(html).not.toContain('onclick')
  expect(html).toContain("default-src 'none'")
  expect(html).not.toContain('layout-grid')
  const edited = applyCommand(node, { type: 'SetText', nodeId: 'button', content: 'Confirm payment' })
  expect(projectDocument(edited, bundle, 'desktop')).toContain('Confirm payment')
  const inverse = invertCommand(node, { type: 'SetText', nodeId: 'button', content: 'Confirm payment' })!
  expect(applyCommand(edited, inverse)).toEqual(node)
})


test('adapter asset roots resolve application URLs without canvas-specific framework rules', () => {
  const root = fixture()
  fs.mkdirSync(path.join(root, 'wwwroot'))
  fs.writeFileSync(path.join(root, 'wwwroot/logo.svg'), '<svg/>')
  fs.writeFileSync(path.join(root, 'wwwroot/site.css'), '.brand { background: url(/logo.svg); }')
  const visuals = readProjectVisuals(root, ['wwwroot/logo.svg', 'wwwroot/site.css'], ['wwwroot'])
  const node: DesignNode = { id: 'logo', kind: 'placeholder', label: 'img', editability: 'editable', children: [], attributes: { src: '~/logo.svg' } }
  expect(projectDocument(node, visuals, 'desktop')).toContain('src="data:image/svg+xml;base64,')
  expect(visuals.css).toContain('url("data:image/svg+xml;base64,')
})

test('editable documents honor stack, grid, responsive and border inspector changes', () => {
  const visuals = { css: '', assets: {}, breakpoints: [], containerWidths: [], spacing: [], fonts: [], colors: [], visibilityRules: [] }
  const tree: DesignNode = { id: 'stack', kind: 'stack', editability: 'editable', direction: 'row', gap: 4, align: 'start', justify: 'space-between', children: [], style: { borderWidth: 2 }, responsiveOverrides: { mobile: { align: 'center', wrap: true } } }
  const document = projectDocument(tree, visuals, 'mobile')
  expect(document).toContain('justify-content:space-between')
  expect(document).toContain('align-items:center')
  expect(document).toContain('flex-wrap:wrap')
  expect(document).toContain('border-style:solid')
  const grid: DesignNode = { id: 'grid', kind: 'grid', editability: 'editable', columns: 2, rows: 3, columnGap: 8, rowGap: 8, responsiveOverrides: { mobile: { columnGap: 12, rowGap: 16 } }, children: [{ id: 'cell', kind: 'text', editability: 'editable', content: 'Cell', children: [], gridPlacement: { columnStart: 2, columnSpan: 1 } }] }
  const rendered = projectDocument(grid, visuals, 'mobile')
  expect(rendered).toContain('grid-template-rows:repeat(3, minmax(0, 1fr))')
  expect(rendered).toContain('column-gap:12px')
  expect(rendered).toContain('grid-column-start:2;')
})
