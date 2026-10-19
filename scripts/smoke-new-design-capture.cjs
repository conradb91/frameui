const { _electron } = require('playwright-core')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-new-design-'))
  const source = path.join(root, 'LocalProduct')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'local-product', scripts: { dev: 'vite' }, dependencies: { vite: '^5.0.0' } }))
  fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html><html><head><title>Local Product</title><style>body{font-family:Arial;margin:0;padding:48px;background:oklab(0.96 0.005 -0.01)}main{background:oklab(1 0 0);padding:32px;border:1px solid oklab(0.75 0.02 -0.04);border-radius:16px}h1{color:oklab(0.35 0.02 -0.05);max-width:260px}hr{border:0;border-top:3px solid rgb(12,121,99);margin:24px 0;width:420px}footer{margin-top:24px;padding-top:12px;border-width:1px 0 0;border-style:solid;border-color:rgb(233,238,245)}</style></head><body><main><h1><span>Local Product</span> <span>Dashboard</span></h1><hr><p>Loaded from the project URL.</p><footer>New here? <a href="/register">Create an account</a></footer></main></body></html>')
  const server = http.createServer((_request, response) => {
    // Keep the response pending briefly so Electron's transient about:blank
    // navigation has a chance to race the requested URL, matching the
    // packaged-app failure this regression protects against.
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end(fs.readFileSync(path.join(source, 'index.html')))
    }, 250)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/payday-plan`
  const normalizedUrl = new URL(url).href
  const env = { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const packagedExecutable = process.env.FRAMEUI_PACKAGED_APP
  let app
  let reviewProfile
  try {
    app = await _electron.launch({
      executablePath: packagedExecutable || process.env.FRAMEUI_ELECTRON || require('electron'),
      args: packagedExecutable ? [] : ['.', `--user-data-dir=${path.join(root, 'profile')}`],
      env,
    })
    if (packagedExecutable) {
      const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData'), arch: process.arch }))
      assert(info.packaged)
      assert.equal(info.arch, 'x64')
      assert(path.basename(info.profile).startsWith('review-'))
      reviewProfile = info.profile
    }
    const page = await app.firstWindow()
    page.setDefaultTimeout(60_000)
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    const skipIntroduction = page.getByRole('button', { name: 'Skip introduction', exact: true })
    if (await skipIntroduction.isVisible().catch(() => false)) await skipIntroduction.click()
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
    }, source)
    await page.getByRole('button', { name: 'Open Codebase', exact: true }).click()
    const setup = page.getByRole('dialog', { name: 'Open LocalProduct' })
    await setup.waitFor()
    fs.mkdirSync('docs/verification', { recursive: true })
    await page.screenshot({ path: 'docs/verification/project-setup-confirm.png', animations: 'disabled' })
    await page.getByLabel('App address', { exact: true }).fill(url)
    await page.getByText('Running application', { exact: true }).click()
    await page.getByRole('button', { name: 'Connect app', exact: true }).click()
    await page.getByText(/App address connected\./).waitFor()
    assert.equal(await page.getByLabel('App address', { exact: true }).count(), 1, 'Setup must expose one unambiguous Runtime URL field')
    await page.getByText('Running application', { exact: true }).click()
    await page.getByRole('button', { name: 'Prepare project', exact: true }).click()
    await page.getByRole('dialog', { name: 'LocalProduct is ready' }).waitFor()
    await page.screenshot({ path: 'docs/verification/project-setup-ready.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Review project', exact: true }).click()
    await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('button', { name: 'Designs', exact: true }).click()
    await page.getByRole('button', { name: 'New Design', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Create editable design' })
    await dialog.waitFor()
    const cards = dialog.getByRole('radio')
    assert.equal(await cards.count(), 3)
    for (let index = 0; index < 3; index++) {
      const border = await cards.nth(index).evaluate((node) => getComputedStyle(node).borderTopStyle)
      assert.notEqual(border, 'none', 'every starting-point option must render as a card')
    }
    const nameInput = page.getByLabel('Design name', { exact: true })
    const hint = dialog.getByText('You can rename it later.', { exact: true })
    const inputBox = await nameInput.boundingBox()
    const hintBox = await hint.boundingBox()
    assert(inputBox && hintBox && hintBox.y > inputBox.y + inputBox.height, 'design name help must sit below the input')
    await page.screenshot({ path: 'docs/verification/new-design-starting-points.png', animations: 'disabled' })

    await dialog.getByRole('radio', { name: /Capture application/ }).click()
    await page.getByRole('button', { name: 'Open capture', exact: true }).click()
    for (let attempt = 0; attempt < 12; attempt++) {
      const visibleAddress = await page.getByLabel('Address', { exact: true }).inputValue()
      assert(!/about:blank/i.test(visibleAddress), `transient webview URL leaked into the address field: ${visibleAddress}`)
      await page.waitForTimeout(25)
    }
    let loadedUrl = ''
    for (let attempt = 0; attempt < 120; attempt++) {
      loadedUrl = await page.locator('webview').evaluate((webview) => webview.getURL()).catch(() => '')
      if (loadedUrl.startsWith(url)) break
      await page.waitForTimeout(100)
    }
    assert(loadedUrl.startsWith(url), `capture browser should load ${url}, received ${loadedUrl || 'no URL'}`)
    assert.equal(await page.getByLabel('Address', { exact: true }).inputValue(), normalizedUrl)
    // Remote application connection is explicit, with no ownership file required.
    await page.getByText('Running application', { exact: true }).click()
    await page.getByLabel('App address', { exact: true }).fill('https://runtime.example.com/dashboard')
    await page.getByLabel('Environment', { exact: true }).selectOption('production')
    assert.equal(await page.getByText('Domain ownership (optional)',{exact:true}).count(),1)
    assert.equal(await page.getByRole('button',{name:'Download verification file',exact:true}).isVisible(),false)
    await page.getByRole('button',{name:'Connect app',exact:true}).click()
    await page.getByText(/App address connected/).waitFor()
    const connection=await page.evaluate(()=>window.frameui.project.getRuntime())
    assert(connection.connectedAt&&!connection.verifiedAt)
    const projectId=(await page.evaluate(()=>window.frameui.project.getIndex())).projectId
    await app.evaluate(({session},{projectId,html})=>{globalThis.ownershipFileRequests=0;session.fromPartition('persist:project-'+projectId).protocol.handle('https',request=>{if(request.url.includes('/.well-known/'))globalThis.ownershipFileRequests++;return new Response(html,{headers:{'content-type':'text/html'}})})},{projectId,html:fs.readFileSync(path.join(source,'index.html'),'utf8')})
    const remote=await page.evaluate(()=>window.frameui.design.testConnection('https://runtime.example.com/dashboard'))
    assert(remote.ok);assert.equal(await app.evaluate(()=>globalThis.ownershipFileRequests),0)
    await page.getByLabel('App address',{exact:true}).fill(url)
    await page.getByRole('button',{name:'Connect app',exact:true}).click()
    await page.getByText(/App address connected/).waitFor()
    assert.equal(await page.getByRole('button',{name:'Download verification file',exact:true}).count(),0)
    await page.getByText('Running application',{exact:true}).click()

    assert.equal(await page.getByLabel('State name', { exact: true }).inputValue(), 'payday plan', 'state name must derive from the initial URL route')
    await page.waitForFunction(() => {
      const main = document.querySelector('.ide-capture-main')
      const frame = document.querySelector('.ide-capture-viewport-frame')
      return !!main && !!frame && main.scrollWidth <= main.clientWidth && frame.scrollWidth <= frame.clientWidth
    })
    await page.getByRole('button', { name: 'Capture screen', exact: true }).click()
    await page.getByText('Captured this session (1)', { exact: true }).waitFor()
    await page.getByLabel('State name', { exact: true }).fill('menu open')
    await page.getByRole('button', { name: 'Capture screen', exact: true }).click()
    await page.getByText('Captured this session (2)', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Rename capture Payday Plan', exact: true }).last().click()
    await page.getByRole('textbox', { name: 'Capture title', exact: true }).fill('Register capture')
    await page.getByRole('textbox', { name: 'Capture title', exact: true }).press('Enter')
    await page.getByRole('button', { name: 'Rename capture Register capture', exact: true }).waitFor()
    const sidebarPencilBox = await page.locator('.ide-capture-session-name svg').last().boundingBox()
    assert(sidebarPencilBox && sidebarPencilBox.width <= 16 && sidebarPencilBox.height <= 16, 'the capture rename pencil must not inherit thumbnail dimensions')
    await page.getByRole('button', { name: 'Done', exact: true }).click()

    let capturedLibrary
    for (let attempt = 0; attempt < 120; attempt++) {
      capturedLibrary = await page.evaluate(async () => {
        const files = await window.frameui.design.list()
        const project = files.find((file) => file.projectId && !file.libraryId)
        return project ? window.frameui.design.load(project.id) : null
      })
      if (capturedLibrary?.pages.filter((candidate) => candidate.capturedAt).length === 2) break
      await page.waitForTimeout(50)
    }
    assert.equal(capturedLibrary?.pages.filter((candidate) => candidate.capturedAt).length, 2, 'every captured state must be saved into the project library')
    assert.equal(capturedLibrary.pages[1].name, 'Register capture', 'renaming a session capture must rename its saved canvas frame')
    for (const capturedPage of capturedLibrary.pages) {
      const text = [], dividers = []
      const collect = (objects) => objects.forEach((object) => { if (object.kind === 'Text') text.push(object.text); if (object.kind === 'Line') dividers.push(object); collect(object.children) })
      collect(capturedPage.objects)
      assert.equal(text.filter((value) => value === 'Local Product Dashboard').length, 1, 'a wrapped heading with inline spans must be one editable text object')
      assert(!text.includes('Local Product') && !text.includes('Dashboard'), 'the wrapped heading must not leave separate line/span text objects')
      const htmlRule = dividers.find((divider) => divider.stroke === 'rgb(12, 121, 99)')
      const footerBorder = dividers.find((divider) => divider.name === 'Top border')
      assert(htmlRule, 'an HTML horizontal rule must be one line object, not a container')
      assert.equal(htmlRule.width, 420, 'the horizontal rule must retain its measured pixel width')
      assert.equal(htmlRule.height, 3, 'the horizontal rule selection must collapse to its stroke thickness')
      assert.equal(htmlRule.strokeWidth, 3, 'the horizontal rule must retain its measured pixel thickness')
      assert(footerBorder, 'a one-sided container border must be a line layer')
      assert.equal(footerBorder.stroke, 'rgb(233, 238, 245)')
      const findFooter = (objects) => objects.find((object) => object.children?.some((child) => child.name === 'Top border')) ?? objects.map((object) => findFooter(object.children ?? [])).find(Boolean)
      const footer = findFooter(capturedPage.objects)
      assert(footer && footer.stroke === 'none' && footer.strokeWidth === 0, 'the bordered footer must not retain a rectangular outline')
      const structuredDividers = []
      const collectStructured = (nodes) => nodes.forEach((node) => { if (node.type === 'Divider') structuredDividers.push(node); collectStructured(node.children) })
      collectStructured(capturedPage.structured?.children ?? [])
      assert.equal(structuredDividers.length, 1, 'the structured capture must classify an HTML horizontal rule as a divider')
      assert.equal(structuredDividers[0].appearance.strokeWidth, 3)
      assert.equal(structuredDividers[0].bounds.height, 3, 'the structured divider must not retain container-height geometry')
      assert.equal(structuredDividers[0].appearance.stroke, 'rgb(12, 121, 99)')
    }
    // The structured renderer has its own drag/edit regression in
    // smoke-capture-editability. Exercise the legacy fallback here explicitly;
    // improved capture fidelity must not silently switch this SVG-specific test.
    const fallbackDesignName = await page.evaluate(async () => {
      await window.frameuiFlushSaves()
      const files = await window.frameui.design.list()
      const entry = files.find(file => file.libraryId)
      const design = await window.frameui.design.load(entry.id)
      await window.frameui.design.save({ ...design, pages: design.pages.map(({ structured, ...rest }) => rest) })
      return design.name
    })
    await page.reload()
    await page.getByRole('button', { name: /LocalProduct/ }).first().click()
    await page.getByRole('button', { name: `Open ${fallbackDesignName}`, exact: true }).click()
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
    await page.getByRole('button', { name: 'Preview Payday Plan', exact: true }).waitFor()
    assert.equal(await page.getByText('1 page · 2 variants', { exact: true }).count(), 1, 'Pages panel must refresh after capture')
    assert.equal(await page.locator('[data-canvas-frame]').count(), 2, 'all captured states must share the visible design canvas')
    assert.equal(await page.getByLabel('Page state', { exact: true }).count(), 0, 'captured states must not be hidden behind a canvas dropdown')
    const findTextObject = (objects, value) => {
      for (const object of objects) {
        if (object.kind === 'Text' && object.text === value) return object
        const nested = findTextObject(object.children, value)
        if (nested) return nested
      }
    }
    const headingObjects = capturedLibrary.pages.map((capturedPage) => findTextObject(capturedPage.objects, 'Local Product Dashboard'))
    assert(headingObjects.every(Boolean), 'each captured frame must retain the semantic heading object')
    const capturedHeadings = page.locator(headingObjects.map((object) => `[data-object-id="${object.id}"] text`).join(', '))
    await capturedHeadings.first().waitFor()
    assert.equal(await capturedHeadings.count(), 2, 'both captured frames must paint their content on the shared canvas')
    const headingLines = capturedHeadings.first().locator('tspan')
    assert((await headingLines.count()) > 1, 'normal canvas rendering must wrap captured text to its saved object width')
    const headingWidth = headingObjects[0].width
    assert(headingWidth)
    const renderedLineWidths = await headingLines.evaluateAll((nodes) => nodes.map((node) => node.getComputedTextLength()))
    assert(renderedLineWidths.every((width) => width <= headingWidth + 1), 'painted text lines must stay inside the saved text container')
    const dividerObjects = capturedLibrary.pages.map((capturedPage) => {
      const find = (objects) => objects.find((object) => object.kind === 'Line') ?? objects.map((object) => find(object.children)).find(Boolean)
      return find(capturedPage.objects)
    })
    const renderedDividers = page.locator(dividerObjects.map((object) => `[data-object-id="${object.id}"] line`).join(', '))
    assert.equal(await renderedDividers.count(), 2, 'both horizontal rules must render as SVG line elements')
    for (let index = 0; index < 2; index++) {
      const divider = renderedDividers.nth(index)
      assert.equal(await divider.getAttribute('stroke-width'), '3')
      assert.equal(await divider.getAttribute('stroke'), 'rgb(12, 121, 99)')
      assert.equal(await divider.getAttribute('y1'), await divider.getAttribute('y2'), 'a horizontal rule must not render diagonally')
    }
    await renderedDividers.last().click({ force: true })
    assert.equal(await page.locator('.ide-inspector').getAttribute('data-kind'), 'Line', 'one click on a horizontal rule must select the line itself, not an ancestor container')
    assert.equal(await page.getByLabel('Corner radius', { exact: true }).count(), 0, 'line controls must not expose container-only radius settings')
    assert.match(await capturedHeadings.last().getAttribute('fill'), /^rgb\(/, 'captured OKLab text paint must render as sRGB on canvas')
    assert.equal(await page.locator('[data-object-id] > title').count(), 0, 'moving across elements must not show native object-name tooltips')

    const stage = page.locator('.ide-stage')
    const cameraGroup = stage.locator('> svg > g').first()
    const stageBox = await stage.boundingBox()
    assert(stageBox)
    const cameraBeforeWheel = await cameraGroup.getAttribute('transform')
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2)
    await page.mouse.wheel(70, 45)
    await page.waitForTimeout(50)
    const cameraAfterPan = await cameraGroup.getAttribute('transform')
    assert.notEqual(cameraAfterPan, cameraBeforeWheel, 'trackpad/mouse wheel must pan the shared canvas')
    await stage.dispatchEvent('wheel', { deltaY: -120, ctrlKey: true, clientX: stageBox.x + stageBox.width / 2, clientY: stageBox.y + stageBox.height / 2 })
    await page.waitForTimeout(50)
    assert.notEqual(await cameraGroup.getAttribute('transform'), cameraAfterPan, 'pinch/control-wheel must zoom the shared canvas')
    const cameraBeforeSpaceDrag = await cameraGroup.getAttribute('transform')
    await page.keyboard.down('Space')
    await page.mouse.move(stageBox.x + stageBox.width * 0.8, stageBox.y + stageBox.height * 0.75)
    await page.mouse.down()
    await page.mouse.move(stageBox.x + stageBox.width * 0.8 + 90, stageBox.y + stageBox.height * 0.75 + 40, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    await page.waitForTimeout(50)
    assert.notEqual(await cameraGroup.getAttribute('transform'), cameraBeforeSpaceDrag, 'Space-drag must pan the shared canvas')
    const cameraBeforeFrameSelection = await cameraGroup.getAttribute('transform')
    await capturedHeadings.first().dispatchEvent('click')
    await page.waitForTimeout(50)
    assert.equal(await cameraGroup.getAttribute('transform'), cameraBeforeFrameSelection, 'selecting another canvas must preserve the current zoom and pan')
    await capturedHeadings.first().dispatchEvent('dblclick')
    await page.waitForTimeout(50)
    assert.equal(await cameraGroup.getAttribute('transform'), cameraBeforeFrameSelection, 'double-clicking an element must not fit or zoom the canvas')
    const frameSwitchEditor = page.locator('.ide-inline-text')
    if (await frameSwitchEditor.isVisible().catch(() => false)) await frameSwitchEditor.press('Escape')
    await page.screenshot({ path: 'docs/verification/captured-page-library.png', animations: 'disabled' })

    await page.keyboard.press('Shift+1')
    await page.waitForTimeout(100)
    await page.getByRole('button', { name: 'Select (V)', exact: true }).click()
    await page.getByLabel(`Frame title ${capturedLibrary.pages[1].name}`, { exact: true }).click()
    const editableText = page.locator(`[data-canvas-frame="${capturedLibrary.pages[1].id}"] tspan`).filter({ hasText: 'Loaded from the project URL.' }).first()
    await editableText.click()
    await page.locator('.ide-inspector[data-kind="Text"]').waitFor()
    await editableText.dblclick()
    const inlineText = page.locator('.ide-inline-text')
    await inlineText.waitFor()
    assert.equal(await inlineText.evaluate((node) => node.tagName), 'DIV', 'canvas text editing must use an in-place content editor')
    assert.equal(await inlineText.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)', 'in-place text editing must not cover the artboard with a textarea surface')
    assert.equal(await page.locator('.ide-stage > svg text').filter({ hasText: /^\d+ × \d+$/ }).count(), 0, 'selection outlines must not show dimension annotations')
    assert.equal(await page.getByRole('toolbar', { name: 'Selected text formatting' }).count(), 0, 'text formatting must stay in the inspector instead of covering the canvas')
    assert.equal(await page.locator('[data-handle="resize"], [data-handle="rotate"], [data-handle="radius"]').count(), 0, 'transform handles must be hidden while editing text')
    await page.screenshot({ path: 'docs/verification/canvas-inline-text-edit.png', animations: 'disabled' })
    await inlineText.fill('Edited directly on canvas.')
    await page.mouse.move(stageBox.x + stageBox.width * 0.8, stageBox.y + stageBox.height * 0.8)
    await page.mouse.wheel(12, 8)
    await page.waitForTimeout(50)
    assert.equal(await inlineText.innerText(), 'Edited directly on canvas.', 'an unsaved text draft must survive canvas rerenders')
    const selectTextRange = async (start, end) => inlineText.evaluate((node, offsets) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let cursor = 0, startNode, endNode, startOffset = 0, endOffset = 0
      while (walker.nextNode()) {
        const textNode = walker.currentNode, next = cursor + textNode.textContent.length
        if (!startNode && offsets.start <= next) { startNode = textNode; startOffset = offsets.start - cursor }
        if (!endNode && offsets.end <= next) { endNode = textNode; endOffset = offsets.end - cursor; break }
        cursor = next
      }
      const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset)
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    }, { start, end })
    await selectTextRange(7, 15)
    await inlineText.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b')
    await selectTextRange(19, 25)
    await page.locator('.ide-inspector .ide-colour-field').filter({ hasText: 'Colour' }).getByRole('button').first().click()
    await page.getByLabel('Colour colour picker', { exact: true }).evaluate((input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#149d91')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const activeFrameRect = page.locator(`[data-canvas-frame="${capturedLibrary.pages[1].id}"] > rect`).first()
    const activeFrameBoxForCommit = await activeFrameRect.boundingBox()
    assert(activeFrameBoxForCommit)
    await page.mouse.click(activeFrameBoxForCommit.x + activeFrameBoxForCommit.width - 12, activeFrameBoxForCommit.y + activeFrameBoxForCommit.height - 12)
    await inlineText.waitFor({ state: 'detached' })
    await page.locator(`[data-canvas-frame="${capturedLibrary.pages[1].id}"] text`).filter({ hasText: 'Edited directly on canvas.' }).first().waitFor({ state: 'visible' })

    const editedTextBeforeMove = await page.evaluate(async () => {
      const files = await window.frameui.design.list()
      const design = await window.frameui.design.load(files.find((file) => file.libraryId).id)
      const flat = []
      const visit = (objects) => objects.forEach((object) => { flat.push(object); visit(object.children) })
      visit(design.pages[1].objects)
      const object = flat.find((candidate) => candidate.text === 'Edited directly on canvas.')
      return object && { id: object.id, x: object.x, y: object.y, textRuns: object.textRuns }
    })
    assert(editedTextBeforeMove)
    assert.deepEqual(editedTextBeforeMove.textRuns, [
      { start: 7, end: 15, fontWeight: '700' },
      { start: 19, end: 25, color: '#149d91' },
    ], 'font weight and colour must persist only on the highlighted ranges')
    const editedTextShape = page.locator(`[data-object-id="${editedTextBeforeMove.id}"] text`).last()
    const editedTextBox = await editedTextShape.boundingBox()
    assert(editedTextBox)
    // Re-enter and finish editing without changing the value so the exact
    // nested text node, rather than its captured parent group, is selected
    // for the movement assertion below.
    await editedTextShape.dblclick()
    await inlineText.waitFor()
    await inlineText.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await inlineText.waitFor({ state: 'detached' })
    await page.mouse.move(editedTextBox.x + editedTextBox.width / 2, editedTextBox.y + editedTextBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(editedTextBox.x + editedTextBox.width / 2 + 45, editedTextBox.y + editedTextBox.height / 2 + 25, { steps: 5 })
    await page.mouse.up()
    await page.evaluate(() => window.frameuiFlushSaves())
    const editedTextAfterMove = await page.evaluate(async (id) => {
      const files = await window.frameui.design.list()
      const design = await window.frameui.design.load(files.find((file) => file.libraryId).id)
      let match
      const visit = (objects) => objects.forEach((object) => { if (object.id === id) match = object; visit(object.children) })
      visit(design.pages[1].objects)
      return match && { x: match.x, y: match.y, text: match.text }
    }, editedTextBeforeMove.id)
    assert(editedTextAfterMove.x !== editedTextBeforeMove.x || editedTextAfterMove.y !== editedTextBeforeMove.y, 'edited text must remain movable')
    assert.equal(editedTextAfterMove.text, 'Edited directly on canvas.', 'moving edited text must not restore its old content')

    const rename = page.getByRole('button', { name: /Frame title Register capture/ })
    const otherTitle = page.getByRole('button', { name: /Frame title Payday Plan/ })
    await rename.waitFor()
    await otherTitle.waitFor()
    const titleBeforeDrag = await rename.boundingBox()
    const otherTitleBeforeDrag = await otherTitle.boundingBox()
    const activeCanvasBeforeDrag = await activeFrameRect.boundingBox()
    const otherCanvas = page.locator(`[data-canvas-frame="${capturedLibrary.pages[0].id}"] > rect`).first()
    const otherCanvasBeforeDrag = await otherCanvas.boundingBox()
    const cameraBeforeTitleDrag = await cameraGroup.getAttribute('transform')
    assert(titleBeforeDrag && otherTitleBeforeDrag && activeCanvasBeforeDrag && otherCanvasBeforeDrag)
    const titleGap = activeCanvasBeforeDrag.y - (titleBeforeDrag.y + titleBeforeDrag.height)
    assert(titleGap >= -2 && titleGap <= 14, `frame title must stay close to its canvas at low zoom; received ${titleGap}px`)
    await page.mouse.move(titleBeforeDrag.x + titleBeforeDrag.width / 2, titleBeforeDrag.y + titleBeforeDrag.height / 2)
    await page.mouse.down()
    await page.mouse.move(titleBeforeDrag.x + titleBeforeDrag.width / 2 + 80, titleBeforeDrag.y + titleBeforeDrag.height / 2 + 40, { steps: 5 })
    await page.mouse.up()
    const titleAfterDrag = await rename.boundingBox()
    const otherTitleAfterDrag = await otherTitle.boundingBox()
    const activeCanvasAfterDrag = await activeFrameRect.boundingBox()
    const otherCanvasAfterDrag = await otherCanvas.boundingBox()
    assert(titleAfterDrag && otherTitleAfterDrag && activeCanvasAfterDrag && otherCanvasAfterDrag)
    assert(titleAfterDrag.x > titleBeforeDrag.x + 50 && titleAfterDrag.y > titleBeforeDrag.y + 20, 'dragging the frame title must move that canvas')
    assert(activeCanvasAfterDrag.x > activeCanvasBeforeDrag.x + 50 && activeCanvasAfterDrag.y > activeCanvasBeforeDrag.y + 20, 'the named canvas must follow its title')
    assert(Math.abs(otherCanvasAfterDrag.x - otherCanvasBeforeDrag.x) < 2 && Math.abs(otherCanvasAfterDrag.y - otherCanvasBeforeDrag.y) < 2, 'dragging one canvas must not move another canvas')
    assert(Math.abs(otherTitleAfterDrag.x - otherTitleBeforeDrag.x) < 2 && Math.abs(otherTitleAfterDrag.y - otherTitleBeforeDrag.y) < 2, 'the other canvas title must remain anchored')
    assert.equal(await cameraGroup.getAttribute('transform'), cameraBeforeTitleDrag, 'dragging a canvas title must not pan the shared camera')
    assert.equal(await page.getByRole('textbox', { name: 'Frame name', exact: true }).count(), 0, 'dragging the frame title must not start rename')
    await rename.dblclick()
    assert.equal(await page.getByRole('dialog', { name: 'Frame name' }).count(), 0, 'frame rename must stay on the canvas')
    await page.screenshot({ path: 'docs/verification/canvas-frame-inline-rename.png', animations: 'disabled' })
    await page.getByRole('textbox', { name: 'Frame name', exact: true }).fill('Dashboard frame')
    await page.getByRole('textbox', { name: 'Frame name', exact: true }).press('Enter')
    await page.evaluate(() => window.frameuiFlushSaves())
    const saved = await page.evaluate(async () => {
      const files = await window.frameui.design.list()
      const design = files.find((file) => file.libraryId)
      return design ? window.frameui.design.load(design.id) : null
    })
    assert(saved)
    assert.equal(saved.appUrl, normalizedUrl)
    assert.equal(saved.pages.length, 2, 'the first capture must replace the blank placeholder and later captures must add frames')
    assert.equal(saved.pages[1].name, 'Dashboard frame')
    assert(Number.isFinite(saved.pages[1].canvasX) && Number.isFinite(saved.pages[1].canvasY), 'the moved canvas position must persist on its page')
    assert.equal(saved.pages[0].height, 1024, 'interactive capture frame must match the selected viewport height')
    assert.equal(saved.pages[0].state, 'Desktop · payday plan')
    assert.equal(saved.pages[1].state, 'Desktop · menu open')
    assert(JSON.stringify(saved.pages[1].objects).includes('Edited directly on canvas.'), 'in-place text edits must persist')
    assert.notEqual(saved.name, 'Untitled design', 'first capture must name an auto-named design')
    await page.screenshot({ path: 'docs/verification/canvas-frame-rename.png', animations: 'disabled' })

    // Existing designs can carry an old detected/default URL. Capture must
    // always resolve the current project-level URL instead.
    await page.evaluate(async (design) => {
      await window.frameui.design.save({ ...design, appUrl: 'http://localhost:3000' })
    }, saved)
    await page.reload()
    await page.getByRole('button', { name: /LocalProduct/ }).first().click()
    await page.getByRole('button', { name: `Open ${saved.name}`, exact: true }).click()
    await page.getByRole('button', { name: 'Capture page', exact: true }).click()
    let reopenedAddress = ''
    for (let attempt = 0; attempt < 120; attempt++) {
      reopenedAddress = await page.getByLabel('Address', { exact: true }).inputValue().catch(() => '')
      if (reopenedAddress === normalizedUrl) break
      await page.waitForTimeout(50)
    }
    assert.equal(reopenedAddress, normalizedUrl, 'capture must prefer the URL saved on the parent project')
    assert.deepEqual(errors, [])
    console.log('PASS: URL-derived names, multi-frame canvas, visible paint, pan/zoom/Space-drag, in-place text editing, page persistence, title drag, and inline rename.')
  } finally {
    if (app) await app.close()
    await new Promise((resolve) => server.close(resolve))
    if (reviewProfile && path.basename(reviewProfile).startsWith('review-')) fs.rmSync(reviewProfile, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
