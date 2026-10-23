// Exercise project creation and the actual bundled appraisal through the UI.
// Uses an isolated profile and leaves the user's HTML unchanged.
const {_electron} = require('playwright-core')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict'), {createHash} = require('node:crypto')
;(async () => {
  const source = process.env.FRAMEUI_HTML_FIXTURE || '/Users/leadsprint/Desktop/Seafarer Appraisal.html'
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-seafarer-review-'))
  const output = path.resolve(process.env.FRAMEUI_SMOKE_OUTPUT || 'docs/verification/seafarer-import-2026-10-23')
  fs.mkdirSync(output, {recursive: true})
  const hash = () => createHash('sha256').update(fs.readFileSync(source)).digest('hex')
  const before = hash(), packaged = process.env.FRAMEUI_PACKAGED_APP
  const env = {...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1'}
  delete env.ELECTRON_RUN_AS_NODE
  let app, profile
  try {
    app = await _electron.launch({executablePath: packaged || require('electron'), args: packaged ? [] : ['.', `--user-data-dir=${root}/profile`], env})
    profile = await app.evaluate(({app}) => app.getPath('userData'))
    const page = await app.firstWindow()
    page.setDefaultTimeout(240000)
    page.on('console', message => {if (message.type() === 'error') console.log('Renderer:', message.text().slice(0, 400))})
    await page.evaluate(() => window.frameui.project.onPrototypeImportProgress(progress => console.log('Import:', progress.detail || progress.stage)))
    await page.getByRole('button', {name: 'Create project', exact: true}).waitFor()
    await app.evaluate(({BrowserWindow, dialog}, source) => {
      for (const win of BrowserWindow.getAllWindows()) {win.webContents.setBackgroundThrottling(false); win.hide()}
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [source]})
    }, source)
    await page.getByRole('button', {name: 'Create project', exact: true}).click()
    const modal = page.getByRole('dialog', {name: 'Create project', exact: true})
    assert.equal(await modal.locator('input').count(), 1, 'Creation asks only for a project name')
    assert.equal(await modal.getByRole('button', {name: /Select folder|Select files/}).count(), 0)
    await modal.getByLabel('Project name', {exact: true}).fill('Seafarer review')
    await page.screenshot({path: path.join(output, 'create-project.png')})
    await modal.getByRole('button', {name: 'Create project', exact: true}).click()
    await page.locator('.ide-library-main').getByRole('heading', {name: 'Seafarer review', exact: true}).waitFor()
    assert.equal(await page.locator('.ide-stage').count(), 0, 'Creation opens the project page, not an empty canvas')
    assert.equal(await page.getByRole('dialog').count(), 0, 'No repository or file dialog is required')
    await page.evaluate(() => window.frameuiFlushSaves?.())
    const projectBefore = await page.evaluate(async () => (await window.frameui.design.list()).find(d => d.name === 'Seafarer review' && !d.libraryId))
    assert(projectBefore?.projectId)
    await page.screenshot({path: path.join(output, 'project-page.png')})
    await page.getByRole('button', {name: 'Import files', exact: true}).click()
    await page.getByLabel('Design name', {exact: true}).fill('Seafarer Appraisal')
    assert.equal(await page.getByLabel('Project name', {exact: true}).count(), 0, 'Import stays inside the named project')
    await page.getByRole('button', {name: 'Select files', exact: true}).click()
    await page.getByRole('button', {name: 'Import files', exact: true}).last().click()
    await Promise.race([
      page.locator('.ide-stage').waitFor(),
      page.locator('.ide-error-toast').first().waitFor().then(async () => {throw Error(await page.locator('.ide-error-toast').first().innerText())}),
    ])
    await page.evaluate(() => window.frameuiFlushSaves?.())
    const summary = await page.evaluate(async () => {
      const row = (await window.frameui.design.list()).find(d => d.name === 'Seafarer Appraisal' && d.libraryId)
      if (!row) throw Error('Imported design was not saved')
      const d = await window.frameui.design.load(row.id), screens = d.pages.filter(p => !p.flowIntroductionFor)
      const nodes = [], walk = ns => ns.forEach(n => {nodes.push(n); walk(n.children)})
      for (const p of screens) if (p.structured) walk(p.structured.children)
      return {id: d.id, firstScreen: screens[0].id, projectId: d.projectId, libraryId: d.libraryId, screens: screens.length,
        textLayers: nodes.filter(n => n.type === 'Text').length,
        embeddedPages: nodes.filter(n => n.source.tag === 'frameui-embedded').length,
        rasterFallbacks: nodes.filter(n => n.type === 'RasterFallback').length,
        text: nodes.map(n => n.typography?.text || '').join('\n'),
        warnings: screens.flatMap(p => p.captureWarnings || []),
        flows: d.prototype?.flows.length, connections: d.prototype?.interactions.length,
      }
    })
    assert.equal(summary.projectId, projectBefore.projectId)
    assert.equal(summary.libraryId, projectBefore.id)
    assert(summary.textLayers > 800, 'Both embedded appraisals must contain native editable text')
    assert(summary.embeddedPages >= 2)
    assert.equal(summary.rasterFallbacks, 0)
    assert(summary.text.includes('BASELINE MARITIME KNOWLEDGE'))
    assert(summary.text.includes('VESSEL PARTICULARS'))
    assert.equal(hash(), before, 'Original HTML remains unchanged')
    delete summary.text
    await page.locator(`[data-canvas-surface="${summary.firstScreen}"]`).evaluate(el => el.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerId: 1})))
    await page.locator('.ide-stage [data-structured-frame]').waitFor()
    const canvasText = await page.locator('.ide-stage [data-structured-frame]').first().textContent()
    assert(canvasText.includes('VESSEL PARTICULARS'), 'Canvas must render the embedded editable content')
    assert(canvasText.includes('BASELINE MARITIME KNOWLEDGE'))
    await page.screenshot({path: path.join(output, 'imported-canvas.png')})
    // Reopening must restart the managed prototype server in the same project.
    const activated = await page.evaluate(id => window.frameui.project.activate(id), summary.projectId)
    assert(activated.url?.startsWith('http://127.0.0.1:'))
    const nativeDir = path.join(profile, 'workspace/structured-captures')
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({...summary, sourceSha256: before, sourceUnchanged: true, managedProjectReactivation: true, profile, nativeCaptureDirectory: nativeDir}, null, 2) + '\n')
    console.log('PASS: name-only project creation; project-page import; both Seafarer embedded pages remain editable; same project and library; no raster fallback; source unchanged; managed runtime reactivation.')
    console.log(JSON.stringify(summary))
  } finally {
    await app?.close()
    if (packaged && profile && path.basename(profile).startsWith('review-')) fs.rmSync(profile, {recursive: true, force: true})
    fs.rmSync(root, {recursive: true, force: true})
  }
})().catch(error => {console.error(error); process.exitCode = 1})
