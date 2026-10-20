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
  fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html><html><head><title>Local Product</title><style>body{font-family:Arial;margin:0;padding:48px;background:oklab(0.96 0.005 -0.01)}main{background:oklab(1 0 0);padding:32px;border:1px solid oklab(0.75 0.02 -0.04);border-radius:16px}h1{color:oklab(0.35 0.02 -0.05);max-width:260px}hr{border:0;border-top:3px solid rgb(12,121,99);margin:24px 0;width:420px}footer{margin-top:24px;padding-top:12px;border-width:1px 0 0;border-style:solid;border-color:rgb(233,238,245)}</style></head><body><main><h1><span>Local Product</span> <span>Dashboard</span></h1><hr><p>Loaded from the project URL.</p><footer>New here? <a href="/register">Create an account</a></footer></main><section style="height:1800px;background:rgb(220,20,20)"></section><section style="height:1800px;background:rgb(20,160,20)"></section><section style="height:1800px;background:rgb(20,20,220)"></section></body></html>')
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
    await page.getByLabel('Project name',{exact:true}).fill('LocalProduct');
    await page.getByRole('button',{name:'Create project',exact:true}).click();
    const setup = page.getByRole('dialog', { name: 'Open LocalProduct' })
    await setup.waitFor()
    fs.mkdirSync(root, { recursive: true })
    await page.screenshot({ path: path.join(root,'project-setup-confirm.png'), animations: 'disabled' })
    await page.getByLabel('App address', { exact: true }).fill(url)
    await page.getByText('Running application', { exact: true }).click()
    await page.getByRole('button', { name: 'Connect app', exact: true }).click()
    await page.getByText(/App address connected\./).waitFor()
    assert.equal(await page.getByLabel('App address', { exact: true }).count(), 1, 'Setup must expose one unambiguous Runtime URL field')
    await page.getByText('Running application', { exact: true }).click()
    await page.getByRole('button', { name: 'Prepare project', exact: true }).click()
    await page.getByRole('dialog', { name: 'LocalProduct is ready' }).waitFor()
    await page.screenshot({ path: path.join(root,'project-setup-ready.png'), animations: 'disabled' })
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
    await page.screenshot({ path: path.join(root,'new-design-starting-points.png'), animations: 'disabled' })

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

    assert.equal(await page.getByText('Open a page, adjust its state, then capture an editable screen.',{exact:true}).count(),0,'Capture guidance must not consume browser space')
    assert.equal(await page.getByLabel('State name', { exact: true }).inputValue(), 'payday plan', 'state name must derive from the initial URL route')
    await page.waitForFunction(() => {
      const main = document.querySelector('.ide-capture-main')
      const frame = document.querySelector('.ide-capture-viewport-frame')
      return !!main && !!frame && main.scrollWidth <= main.clientWidth && frame.scrollWidth <= frame.clientWidth
    })
    await page.getByRole('button', { name: 'Capture screen', exact: true }).click()
    await page.getByRole('dialog',{name:'Creating editable design',exact:true}).waitFor();
    await page.screenshot({path:'/tmp/frameui-capture-progress-review.png',animations:'disabled'});
    await page.getByRole('button',{name:'Stop capture',exact:true}).click()
    await page.getByRole('dialog',{name:'Creating editable design',exact:true}).waitFor({state:'hidden'})
    assert.equal(await page.getByText('Captured this session (0)',{exact:true}).count(),1,'Stopping must not add a partial frame')
    assert.equal(await page.getByText(/Could not capture this state/).count(),0,'Stopping is not a capture error')
    await page.getByRole('button',{name:'Capture screen',exact:true}).click()
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
    assert.equal(await page.locator('.ide-capture-main .ide-runtime-settings').count(),0);assert.equal(await page.locator('.ide-capture-sidebar>.ide-runtime-settings').count(),1);await page.screenshot({path:'/tmp/frameui-capture-sidebar-review.png'});
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
    const capture=capturedLibrary.pages[0];
    const samples=await app.evaluate(({nativeImage},data)=>{const image=nativeImage.createFromDataURL(data),size=image.getSize(),bitmap=image.toBitmap(),colors=[];for(let y=0;y<size.height;y+=25){const i=(y*size.width+Math.floor(size.width/2))*4;colors.push([bitmap[i+2],bitmap[i+1],bitmap[i]])}return {size,red:colors.filter(([r,g,b])=>r>180&&g<80&&b<80).length,green:colors.filter(([r,g,b])=>g>100&&r<80&&b<80).length,blue:colors.filter(([r,g,b])=>b>180&&r<80&&g<80).length}},capture.fullPageScreenshot);
    fs.writeFileSync(path.join(root,'full-page.jpg'),Buffer.from(capture.fullPageScreenshot.split(',')[1],'base64'));console.log(samples);assert(samples.red>5&&samples.green>5&&samples.blue>5,'Full-page image must contain all three sections exactly once, without repeating the viewport');
    assert.equal(await page.locator('.ide-capture-main .ide-runtime-settings').count(),0);
    console.log('PASS: full-page webview preview retains every colored section');
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
