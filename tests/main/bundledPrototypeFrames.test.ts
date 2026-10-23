import {expect, test} from 'bun:test'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {chromium} from 'playwright-core'
import {servePrototype, stopPrototype, isImportedPrototype, isManagedProjectFolder} from '../../src/main/artifacts/prototypeImport'
import {reconstructSnapshotTree} from '../../src/main/ipc/handlers/cdp/reconstructSnapshotTree'
import {CAPTURED_STYLE_PROPERTIES} from '../../src/shared/captureStyleProperties'
import {compileStructuredNodes} from '../../src/core/capture-compiler/compile'

test('a project created before import is recognized after receiving its prototype, without treating source repositories as managed folders', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'frameui-project-import-'))
  try {
    const folder = path.join(userData, 'blank-projects', 'Appraisal-123')
    await mkdir(folder, {recursive: true})
    expect(isManagedProjectFolder(folder, userData)).toBe(true)
    expect(isImportedPrototype(folder, userData)).toBe(false)
    await writeFile(path.join(folder, 'frameui-artifact.json'), '{"version":1}')
    expect(isImportedPrototype(folder, userData)).toBe(true)
    expect(isManagedProjectFolder(path.join(userData, 'source-repository'), userData)).toBe(false)
    expect(isManagedProjectFolder(path.join(userData, 'blank-projects-other', 'project'), userData)).toBe(false)
    expect(isManagedProjectFolder(path.join(userData, 'blank-projects', '..', 'outside'), userData)).toBe(false)
  } finally {await rm(userData, {recursive: true, force: true})}
})

test('import server permits bundled blob pages as editable layers while blocking remote frames', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'frameui-bundled-frames-'))
  const browser = await chromium.launch({channel: 'chrome', headless: true})
  try {
    await mkdir(path.join(folder, 'prototype'))
    await writeFile(path.join(folder, 'prototype/index.html'), `<!doctype html><title>Appraisal</title>
      <iframe id="first" width="600" height="1500"></iframe>
      <iframe id="second" width="600" height="1800"></iframe>
      <iframe src="https://example.invalid/" title="External"></iframe>
      <script>
      first.src=URL.createObjectURL(new Blob(['<h1>Peer appraisal</h1><button>View details</button>'],{type:'text/html'}));
      second.src=URL.createObjectURL(new Blob(['<h1>Maritime knowledge</h1><p>Final answer</p>'],{type:'text/html'}));
      </script>`)
    const page = await browser.newPage()
    const violations: string[] = []
    page.on('console', message => {if (message.type() === 'error') violations.push(message.text())})
    const url = await servePrototype(folder)
    await page.goto(url)
    await page.frameLocator('#first').getByRole('heading').waitFor()
    expect(await page.frameLocator('#first').getByRole('heading').textContent()).toBe('Peer appraisal')
    expect(await page.frameLocator('#second').getByText('Final answer').textContent()).toBe('Final answer')
    expect(violations.some(message => message.includes('example.invalid') && message.includes('Content Security Policy'))).toBe(true)
    expect(violations.some(message => message.includes("Framing 'blob:"))).toBe(false)
    const cdp = await page.context().newCDPSession(page)
    const snapshot = await cdp.send('DOMSnapshot.captureSnapshot', {
      computedStyles: CAPTURED_STYLE_PROPERTIES.map(property => property.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())),
      includeDOMRects: true,
    })
    const root = reconstructSnapshotTree(snapshot, CAPTURED_STYLE_PROPERTIES, {width: 1280, height: 720})
    const nodes = compileStructuredNodes(root)
    const serialized = JSON.stringify(nodes)
    expect(serialized).toContain('Peer appraisal')
    expect(serialized).toContain('Maritime knowledge')
    expect(serialized).toContain('Final answer')
    expect(serialized).toContain(' ||| ')
    expect(serialized).toContain('View details')
  } finally {
    await browser.close()
    stopPrototype(folder)
    await rm(folder, {recursive: true, force: true})
  }
}, 20000)
