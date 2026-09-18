const { _electron } = require('playwright-core')
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  http = require('node:http')
;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-ide-'))
  const source = path.join(root, 'Ledger')
  fs.mkdirSync(source)
  const html = `<!doctype html><html><head><title>Ledger</title><style>body{margin:0;background:#f5f5f8;font-family:Arial;padding:40px}nav{display:flex;gap:20px}article{background:white;border-radius:16px;padding:24px;width:400px;margin-top:25px}h1{font-size:32px}button{background:#6750a4;color:white;border:0;border-radius:12px;padding:12px 24px}button:hover{background:#234567}button:active{background:#b13555}</style></head><body><nav><a href="/">Dashboard</a><a href="/projects/123">Project details</a><a href="/projects/456">Second project</a><a href="/logout">Sign out</a></nav><article><h1>Account Summary</h1><p>$12,450.00</p><button>Save</button></article><script>fetch("/write",{method:"POST"}).catch(()=>{})</script></body></html>`
  fs.writeFileSync(path.join(source, 'index.html'), html)
  const auth = process.env.FRAMEUI_AUTH_SMOKE === '1'
  let requests = [],
    writes = 0
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    if (auth && req.url === '/login' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        const values = new URLSearchParams(body)
        if(values.get('username') !== 'fixture-user' || values.get('password') !== 'fixture-password') {
          res.writeHead(401); res.end('Invalid fixture credentials'); return
        }
        res.writeHead(302, { 'Set-Cookie': 'signedIn=yes; Path=/; HttpOnly; SameSite=Lax', Location: '/dashboard' }); res.end()
      })
      return
    }
    if (auth && req.url.startsWith('/login')) {
      const switchButton = process.env.FRAMEUI_PASSWORD_SWITCH_SMOKE ? `<button type="button" onclick="document.querySelector('form').hidden=false;this.hidden=true">Or sign in with password</button>` : ''
      const loginForm = `<form ${process.env.FRAMEUI_PASSWORD_SWITCH_SMOKE ? 'hidden' : ''} method="POST" action="/login"><label>Username<input name="username"></label><label>Password<input type="password" name="password"></label><button>Sign in to fixture</button></form>`
      res.writeHead(200, {'Content-Type':'text/html'}); res.end(switchButton + loginForm.replace(process.env.FRAMEUI_PASSKEY_SMOKE ? 'type="password"' : '__unused__', 'type="hidden"')); return
    }
    if (auth && !req.headers.cookie?.includes('signedIn=yes')) {
      res.writeHead(302, {Location:'/login?return=/dashboard'});res.end();return
    }
    if (req.method === 'POST') writes++
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(process.env.FRAMEUI_OVERLAY_SMOKE ? html.replace('</body>','<dialog aria-label="Settings dialog" style="width:300px;padding:20px;background:white"><h2>Settings dialog</h2><p>Editable modal content</p><button>Close</button></dialog></body>') : html)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://${auth ? 'budget.localhost' : '127.0.0.1'}:${server.address().port}${auth ? '/dashboard' : ''}`
  const env = { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  let app, reviewProfile
  try {
    app = await _electron.launch({
      executablePath:
        process.env.FRAMEUI_PACKAGED_APP ||
        process.env.FRAMEUI_ELECTRON ||
        path.resolve(
          'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
        ),
      args: process.env.FRAMEUI_PACKAGED_APP
        ? []
        : ['.', `--user-data-dir=${path.join(root, 'profile')}`],
      env,
    })
    if (process.env.FRAMEUI_PACKAGED_APP) {
      const info = await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        profile: app.getPath('userData'),
      }))
      assert(info.packaged)
      assert(/^review-/.test(path.basename(info.profile)))
      reviewProfile = info.profile
    }
    const page = await app.firstWindow()
    page.setDefaultTimeout(20000)
    const skipIntroduction = page.getByRole('button', { name: 'Skip introduction', exact: true })
    if (await skipIntroduction.isVisible().catch(() => false)) await skipIntroduction.click()
    await page
      .getByRole('button', { name: 'Create Blank Design', exact: true })
      .waitFor()
    if (reviewProfile)
      assert.deepEqual(
        await page.evaluate(() => window.frameui.design.list()),
        [],
      )
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page
      .getByRole('button', { name: 'Create Blank Design', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Rectangle (R)', exact: true })
      .click()
    const box = await page.locator('.ide-stage').boundingBox()
    await page.mouse.move(box.x + 150, box.y + 150)
    await page.mouse.down()
    await page.mouse.move(box.x + 300, box.y + 250)
    await page.mouse.up()
    await page.getByRole('button', { name: 'Layers', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelectorAll('[data-object-id]').length > 0,
    )
    const fileId = await page.evaluate(async () => {
      const files = await window.frameui.design.list()
      return files[0].id
    })
    const saved = await page.evaluate(
      (id) => window.frameui.design.load(id),
      fileId,
    )
    assert.equal(saved.pages[0].objects[0].kind, 'Rectangle')
    assert(saved.pages[0].objects[0].width > 100)
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      })
    }, source)
    await page
      .getByRole('button', { name: 'Open Codebase', exact: true })
      .click()
    await page.getByRole('dialog', { name: 'Prepare Ledger for FrameUI' }).waitFor()
    await page.getByLabel('Local preview', { exact: true }).fill(url)
    await page.getByRole('button', { name: 'Prepare project', exact: true }).click()
    await page.getByRole('dialog', { name: 'Ledger is ready' }).waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: 'Review project', exact: true }).click()
    await page.getByRole('button', { name: 'Connect app', exact: true }).click()
    await page
      .getByRole('heading', { name: 'Connect your running app', exact: true })
      .waitFor({ timeout: 60000 })
    if (auth) {
      await app.evaluate(({clipboard}, value) => clipboard.writeText(value), url)
      await page.getByLabel('Application address', {exact:true}).focus()
      await page.keyboard.press('Meta+a'); await page.keyboard.press('Meta+v')
      await page.waitForFunction(value => document.querySelector('input[aria-label="Application address"]').value === value, url)
      await page.keyboard.press('Meta+a');await page.keyboard.press('Meta+c');await page.waitForTimeout(100)
      assert.equal(await app.evaluate(({clipboard}) => clipboard.readText()), url)
    } else await page.getByLabel('Application address', { exact: true }).fill(url)
    if(process.env.FRAMEUI_CREDENTIALS_SMOKE) {await page.getByLabel('Use login details for capture',{exact:true}).check();await page.getByRole('note').filter({hasText:'Multi-factor authentication (MFA)'}).waitFor({state:'visible'});await page.screenshot({path:'docs/verification/login-method-cards.png'});await page.getByLabel('Username or email',{exact:true}).fill('fixture-user');await page.getByLabel('Password',{exact:true}).fill('fixture-password')}
    await page
      .getByRole('button', { name: 'Connect Running App', exact: true })
      .click()
    if (auth && !process.env.FRAMEUI_CREDENTIALS_SMOKE) {
      await page.getByRole('button', {name:'Check sign-in & find pages',exact:true}).waitFor({timeout:30000})
      // The manual browser must accept native clipboard commands and POST login,
      // while the hidden capture workers remain read-only.
      await page.waitForFunction(() => !!document.querySelector('webview')?.getWebContentsId())
      const guestId = await page.locator('webview').evaluate(el => el.getWebContentsId())
      const guestBox = await page.locator('webview').boundingBox()
      const fieldBox = await app.evaluate(({webContents}, id) => webContents.fromId(id).executeJavaScript(`(()=>{const r=document.querySelector('input[name="username"]').getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`), guestId)
      await page.mouse.click(guestBox.x+fieldBox.x,guestBox.y+fieldBox.y)
      await app.evaluate(({clipboard}) => clipboard.writeText('fixture-user'))
      await page.keyboard.press('Meta+v');await page.waitForTimeout(200)
      assert.equal(await app.evaluate(({webContents}, id) => webContents.fromId(id).executeJavaScript(`document.querySelector('input[name="username"]').value`), guestId), 'fixture-user')
      await app.evaluate(async ({webContents}, id) => { const guest=webContents.fromId(id); await guest.executeJavaScript(`document.querySelector('input[name="password"]').value='fixture-password';document.querySelector('button').click()`); }, guestId)
      await page.waitForFunction(() => document.querySelector('webview')?.getURL().endsWith('/dashboard'))
      await page.waitForTimeout(300)
      writes = 0 // Manual sign-in is interactive; only subsequent automated workers must block writes.
      await page.getByRole('button',{name:'Check sign-in & find pages',exact:true}).click()
    }
    await page
      .getByRole('heading', { name: 'Ready to capture', exact: true })
      .waitFor({ timeout: 60000 })
    if(process.env.FRAMEUI_CREDENTIALS_SMOKE) writes=0
    assert(!requests.some((r) => r.includes('logout')))
    assert.equal(await page.locator('.ide-capture-page-list>div').count(), auth ? 3 : 2)
    if(process.env.FRAMEUI_OVERLAY_SMOKE) await page.getByLabel('Include tablet and mobile layouts',{exact:true}).check()
    await page
      .getByRole('button', { name: 'Capture Application', exact: true })
      .click()
    await page.getByRole('button', { name: 'Open project library', exact: true }).click()
    await page
      .locator('.ide-overlay')
      .waitFor({ state: 'hidden', timeout: 60000 })
    const docs = await page.evaluate(() => window.frameui.design.list())
    const imported = await page.evaluate(
      (id) => window.frameui.design.load(id),
      docs.find((d) => d.projectId).id,
    )
    assert.equal(imported.pages.length, (auth ? 3 : 2)*(process.env.FRAMEUI_OVERLAY_SMOKE?6:1))
    assert(!JSON.stringify(imported).includes('fixture-password'),'Credentials must not be saved in the design')
    if(process.env.FRAMEUI_OVERLAY_SMOKE) {
      const overlays=imported.pages.filter(p=>p.folder==='Overlays')
      assert.equal(overlays.length,(auth?3:2)*3)
      for(const viewport of ['Desktop','Tablet','Mobile']) assert(overlays.some(p=>p.state===`${viewport} · Settings dialog`))
      const text=(objects)=>objects.flatMap(o=>[o.text??'',...text(o.children)])
      assert(overlays.every(p=>text(p.objects).includes('Editable modal content')))
      assert.equal(writes,0,'Overlay inspection must not submit app actions')
      console.log('PASS: hidden dialog captured as editable separate states on desktop, tablet and mobile, with read-only requests.');return
    }
    assert(imported.pages.every((p) => p.objects.length > 0))
    assert(!requests.some((r) => r.includes('logout')))
    const collect = (os) => os.flatMap((o) => [o, ...collect(o.children)])
    assert(
      collect(imported.pages[0].objects).some(
        (o) =>
          ['Button', 'Instance'].includes(o.kind) && o.name === 'Save Button',
      ),
    )
    assert(
      !collect(imported.pages[0].objects).some((o) =>
        ['div', 'span', 'container', 'wrapper'].includes(o.name.toLowerCase()),
      ),
    )
    assert.equal(writes, 0, 'Automated browsing must block writes')
    assert(
      imported.components.some((c) =>
        c.variants?.some((v) => v.name === 'Hover'),
      ),
      'Real CSS hover state becomes a component variant',
    )
    assert.equal(await page.locator('.ide-stage').count(), 0, 'Capture must finish in the project library')
    await page.screenshot({path:'docs/verification/project-library.png'})
    const projectNav = page.getByRole('navigation',{name:'Project navigation'})
    await projectNav.getByRole('button',{name:/^Pages/}).click()
    assert.equal(await page.locator('.ide-page-card').count(),auth?3:2)
    await page.getByLabel('Search pages, routes or states',{exact:true}).fill('/projects/')
    assert.equal(await page.locator('.ide-page-card').count(),1)
    await page.getByLabel('Search pages, routes or states',{exact:true}).fill('')
    await page.locator('.ide-browser-controls').getByRole('button',{name:'Mobile',exact:true}).click()
    assert.equal(await page.locator('.ide-page-card').count(),0)
    await page.locator('.ide-browser-controls').getByRole('button',{name:'All',exact:true}).click()
    await page.getByLabel('Switch to list',{exact:true}).click()
    await page.locator('.ide-page-thumbnail').first().hover()
    await page.getByRole('complementary',{name:'Page preview'}).waitFor()
    await page.screenshot({path:'docs/verification/project-pages-browser.png'})
    await projectNav.getByRole('button',{name:/^Design Files/}).click()

    await page.getByLabel('Design file name', {exact:true}).fill('Dashboard redesign')
    await page.getByRole('button', {name:'Create design file',exact:true}).click()
    assert.equal(await page.locator('[data-object-id]').count(), 0, 'New design starts blank')
    await page.getByRole('button', {name:'Add from library',exact:true}).click()
    await page.locator('.ide-page-thumbnail').first().click()
    await page.getByRole('complementary',{name:'Page preview'}).waitFor()
    await page.screenshot({path:'docs/verification/asset-screen-preview.png'})
    assert.equal(await page.locator('.ide-stage [data-object-id]').count(),0,'Preview must not add a screen')
    await page.getByRole('button',{name:'Close page preview',exact:true}).click()
    await page.locator('.ide-page-card > button[title="Add to canvas"]').last().click()
    await page.locator('.ide-stage [data-object-id]').first().waitFor()
    const idleWrites = await page.evaluate(async () => {
      let writes=0;const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key.includes('recent') || key.includes('last-page')) writes++;return original.call(this,key,value)};
      await new Promise(resolve=>setTimeout(resolve,500));Storage.prototype.setItem=original;return writes
    })
    assert(idleWrites < 3, `Idle canvas must not loop: ${idleWrites} preference writes`)
    await page.evaluate(() => window.frameuiFlushSaves())
    const files = await page.evaluate(() => window.frameui.design.list())
    const design = await page.evaluate(id => window.frameui.design.load(id),files.find(file => file.name === 'Dashboard redesign').id)
    assert.equal(design.libraryId, imported.id)
    assert.equal(design.pages.length,1)
    assert.equal(design.pages[0].objects[0].kind,'Frame')
    assert(collect(design.pages[0].objects).some(o=>o.kind==='Text'),'Added screen must contain editable text')
    assert.equal(design.pages[0].objects[0].src,undefined,'Screen must not be a raster image')
    assert.notEqual(design.pages[0].objects[0].id, imported.pages[0].objects[0].id)
    const textObject=collect(design.pages[0].objects).find(o=>o.kind==='Text' && o.text==='Account Summary')
    assert(textObject)
    console.log('CHECK: Editing captured text')
    await page.locator(`.ide-stage [data-object-id="${textObject.id}"] text`).dblclick()
    await page.locator('.ide-inline-text').fill('Budget overview')
    await page.keyboard.press('Tab')
    console.log('CHECK: Editing captured font')
    await page.getByLabel('Font',{exact:true}).fill('Georgia')
    await page.keyboard.press('Tab')
    await page.evaluate(()=>window.frameuiFlushSaves())
    let edited=await page.evaluate(id=>window.frameui.design.load(id),design.id)
    assert.equal(collect(edited.pages[0].objects).find(o=>o.id===textObject.id).text,'Budget overview')
    assert.equal(collect(edited.pages[0].objects).find(o=>o.id===textObject.id).fontFamily,'Georgia')
    console.log('CHECK: Moving captured card')
    const card=collect(edited.pages[0].objects).find(o=>o.width>=390&&o.width<=500&&o.children.length&&collect(o.children).some(child=>child.id===textObject.id))
    assert(card)
    const cardBox=await page.locator(`.ide-stage [data-object-id="${card.id}"] > g > path`).first().boundingBox()
    await page.keyboard.down('Meta');await page.mouse.click(cardBox.x+cardBox.width-20,cardBox.y+20);await page.keyboard.up('Meta')
    await page.mouse.move(cardBox.x+cardBox.width-20,cardBox.y+20);await page.mouse.down();await page.mouse.move(cardBox.x+cardBox.width+30,cardBox.y+60,{steps:5});await page.mouse.up()
    await page.evaluate(()=>window.frameuiFlushSaves());edited=await page.evaluate(id=>window.frameui.design.load(id),design.id)
    assert(collect(edited.pages[0].objects).find(o=>o.id===card.id).x>card.x,'Nested container must move independently')
    const movedBox=await page.locator(`.ide-stage [data-object-id="${card.id}"] > g > path`).first().boundingBox()
    await page.mouse.move(movedBox.x+movedBox.width-20,movedBox.y+20);await page.mouse.down();await page.mouse.move(cardBox.x+cardBox.width-18,movedBox.y+50,{steps:5})
    assert(await page.locator('.ide-stage [data-smart-guide]').count()>0,'Moving into alignment must show guide bars')
    await page.screenshot({path:'docs/verification/editable-canvas.png'});await page.mouse.up()
    console.log('CHECK: Previewing captured component states', imported.components.map(c=>({name:c.name,states:c.variants?.map(v=>v.name)})))
    await page.locator('.ide-sidebar .ide-tabs').getByRole('button',{name:'Components',exact:true}).click()
    await page.locator('.ide-asset-preview-trigger').filter({has:page.locator('strong').filter({hasText:'Save Button'})}).first().click()
    await page.getByRole('complementary',{name:'Asset preview'}).getByRole('button',{name:'Active',exact:true}).click()
    await page.screenshot({path:'docs/verification/component-state-preview.png'})
    await page.getByRole('button',{name:'Close asset preview',exact:true}).click()
    await page.locator('.ide-sidebar .ide-tabs').getByRole('button',{name:'Pages',exact:true}).click()
    await page.locator('.ide-page-card').first().dragTo(page.locator('.ide-stage'),{targetPosition:{x:500,y:400}})
    await page.evaluate(()=>window.frameuiFlushSaves());edited=await page.evaluate(id=>window.frameui.design.load(id),design.id)
    assert.equal(edited.pages[0].objects.length,2,'Dragging a screen must add another editable frame')
    const original = await page.evaluate(id => window.frameui.design.load(id),imported.id)
    assert.deepEqual(original.pages, imported.pages, 'Adding assets must preserve imported originals')
    await new Promise((resolve) => server.close(resolve))
    await page.reload()
    await page.getByRole('button', { name: /Ledger/ }).click()
    await page.getByRole('button', {name:/Dashboard redesign/}).click()
    await page.locator('.ide-stage [data-object-id]').first().waitFor()
    await page.getByRole('navigation',{name:'Project navigation'}).getByRole('button',{name:'Design Files',exact:true}).click()
    await page.getByRole('button',{name:'Archive',exact:true}).click()
    await page.getByRole('navigation',{name:'Project navigation'}).getByRole('button',{name:/^Archive/}).click()
    await page.getByRole('button',{name:'Restore',exact:true}).click()
    await page.getByRole('navigation',{name:'Project navigation'}).getByRole('button',{name:/^Pages/}).click()
    await page.locator('.ide-page-card > button[title="Add to design file"]').first().click()
    await page.getByLabel('Destination design file',{exact:true}).selectOption(design.id)
    await page.getByRole('button',{name:'Add and open design file',exact:true}).click()
    await page.locator('.ide-stage [data-object-id]').first().waitFor()
    await page.evaluate(()=>window.frameuiFlushSaves())
    assert.equal((await page.evaluate(id=>window.frameui.design.load(id),design.id)).pages[0].objects.length,3)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: path.join(root, 'design-ide.png') })
    fs.mkdirSync('docs/verification', { recursive: true })
    fs.copyFileSync(
      path.join(root, 'design-ide.png'),
      'docs/verification/design-ide.png',
    )
    console.log(
      'PASS: drawing, local persistence, approved capture, route deduplication, semantic layers, library-first import, blank design files, selective asset copies, idle render stability, offline reopening, no renderer errors.',
    )
  } finally {
    if (app) await app.close()
    server.close()
    if (reviewProfile && path.basename(reviewProfile).startsWith('review-'))
      fs.rmSync(reviewProfile, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
