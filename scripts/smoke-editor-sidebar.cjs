const { _electron } = require('playwright-core')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

;(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-sidebar-'))
  const env = { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  try {
    app = await _electron.launch({
      executablePath: process.env.FRAMEUI_ELECTRON || path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      args: ['.', `--user-data-dir=${profile}`],
      env,
    })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20000)
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    const skipIntroduction = page.getByRole('button', { name: 'Skip introduction', exact: true })
    if (await skipIntroduction.isVisible().catch(() => false)) await skipIntroduction.click()
    await page.getByRole('button', { name: 'Create Blank Design', exact: true }).click()
    await page.getByRole('button', { name: 'Rectangle (R)', exact: true }).click()
    const stage = await page.locator('.ide-stage').boundingBox()
    await page.mouse.move(stage.x + 100, stage.y + 100)
    await page.mouse.down()
    await page.mouse.move(stage.x + 220, stage.y + 180)
    await page.mouse.up()
    await page.evaluate(() => window.frameuiFlushSaves())

    await page.evaluate(async () => {
      const [entry] = await window.frameui.design.list()
      const current = await window.frameui.design.load(entry.id)
      const basePage = current.pages[0]
      const rectangle = {
        id: crypto.randomUUID(), kind: 'Rectangle', name: 'Rectangle', x: 20, y: 20, width: 120, height: 80,
        rotation: 0, fill: '#246bfe', stroke: 'none', strokeWidth: 0, opacity: 1, fillOpacity: 1, strokeOpacity: 1,
        radius: [6, 6, 6, 6], hidden: false, locked: false, clip: false, fontFamily: 'Inter, sans-serif',
        fontSize: 16, fontWeight: '400', lineHeight: 24, letterSpacing: 0, textAlign: 'left',
        layout: { direction: 'none', alignment: 'start', distribution: 'start', gap: 0, padding: 0, wrap: false, constraints: 'left-top' },
        children: [],
      }
      const projectId = 'sidebar-review-project'
      const libraryId = crypto.randomUUID()
      const image = {
        ...structuredClone(rectangle),
        id: crypto.randomUUID(),
        kind: 'Image',
        name: 'Hero artwork',
        src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="50"%3E%3Crect width="80" height="50" fill="%23246bfe"/%3E%3C/svg%3E',
        children: [],
      }
      const makePage = (name, route, state, width) => ({
        ...structuredClone(basePage),
        id: crypto.randomUUID(),
        name,
        route,
        state,
        width,
        folder: 'Application',
        objects: [{ ...structuredClone(image), id: crypto.randomUUID() }],
      })
      const library = {
        ...structuredClone(current),
        id: libraryId,
        name: 'Sidebar Project',
        projectId,
        libraryId: undefined,
        pages: [
          makePage('Login', '/login', 'Desktop', 1440),
          makePage('Login', '/login', 'Mobile', 390),
          makePage('Settings', '/settings/profile', 'Desktop', 1440),
        ],
        components: [{ ...structuredClone(rectangle), id: crypto.randomUUID(), kind: 'Component', name: 'Primary button' }],
      }
      const design = { ...current, name: 'Sidebar Review', projectId, libraryId }
      await window.frameui.design.save(library)
      await window.frameui.design.save(design)
    })

    await page.reload()
    await page.getByRole('button', { name: 'Open Sidebar Project', exact: true }).click()
    await page.getByRole('button', { name: 'Open Sidebar Review', exact: true }).click()
    const sidebar = page.locator('.ide-sidebar')
    await sidebar.waitFor()
    await sidebar.getByRole('button', { name: 'Pages', exact: true }).click()
    assert.equal(await sidebar.getByLabel('Search pages', { exact: true }).count(), 1)
    assert.equal(await sidebar.locator('.ide-page-card').count(), 2)
    await sidebar.getByLabel('Search pages', { exact: true }).fill('settings')
    assert.equal(await sidebar.locator('.ide-page-card').count(), 1)
    await sidebar.getByRole('button', { name: 'Clear search', exact: true }).click()
    await sidebar.getByLabel('Device filter', { exact: true }).selectOption('Mobile')
    assert.equal(await sidebar.locator('.ide-page-card').count(), 1)
    await sidebar.getByLabel('Device filter', { exact: true }).selectOption('All')
    await sidebar.getByLabel('Route group', { exact: true }).selectOption('Authentication')
    assert.equal(await sidebar.locator('.ide-page-card').count(), 1)
    await sidebar.getByLabel('Route group', { exact: true }).selectOption('All Routes')
    await page.screenshot({ path: path.join(os.tmpdir(), 'frameui-sidebar-pages.png'), animations: 'disabled' })

    await sidebar.getByRole('button', { name: 'Components', exact: true }).click()
    assert.equal(await sidebar.locator('.ide-asset-tile').count(), 1)
    await sidebar.getByLabel('Search components', { exact: true }).fill('missing')
    assert.equal(await sidebar.locator('.ide-asset-tile').count(), 0)
    await sidebar.getByRole('button', { name: 'Clear search', exact: true }).click()

    await sidebar.getByRole('button', { name: 'Assets', exact: true }).click()
    assert.equal(await sidebar.locator('.ide-asset-tile').count(), 1)
    assert(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth), 'Default sidebar must not overflow horizontally')
    await page.screenshot({ path: path.join(os.tmpdir(), 'frameui-sidebar-assets.png'), animations: 'disabled' })
    await sidebar.evaluate(element => { element.style.width = '220px' })
    assert(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth), 'Narrow sidebar must not overflow horizontally')
    assert.equal(await sidebar.locator('.ide-tabs button span:visible').count(), 0, 'Narrow sidebar uses unclipped icon tabs')
    await page.screenshot({ path: path.join(os.tmpdir(), 'frameui-sidebar-review.png'), animations: 'disabled' })
    assert.deepEqual(errors, [])
    console.log('PASS: one search, page/device/route filters, compact assets/components, responsive tabs, and no sidebar overflow.')
  } finally {
    if (app) await app.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
