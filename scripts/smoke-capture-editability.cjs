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
  if (process.env.FRAMEUI_DIRECT_DRAG) {
    const file=path.join(source,'index.html')
    fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('<hr>','<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1H15V15H1Z" fill="#246bfe"/></svg><hr>'))
  }
  if (process.env.FRAMEUI_CANVAS_STRESS) {
    const file = path.join(source, 'index.html')
    const cards = Array.from({length: 300}, (_, i) => `<section style="display:inline-block;width:180px;height:90px;padding:12px"><strong>Card ${i}</strong><p>Editable canvas content</p><span>Ready</span></section>`).join('')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</main>', cards + '</main>'))
  }
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
  const url = process.env.FRAMEUI_BUDGET_URL || `http://127.0.0.1:${server.address().port}/payday-plan`
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
    const setup = page.getByRole('dialog', { name: 'Prepare LocalProduct for FrameUI' })
    await setup.waitFor()
    fs.mkdirSync('docs/verification', { recursive: true })
    await page.screenshot({ path: 'docs/verification/project-setup-confirm.png', animations: 'disabled' })
    await page.getByLabel('Local preview', { exact: true }).fill(url)
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
    const hint = dialog.getByText('Give the design a clear workspace name. You can change it later.', { exact: true })
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
    assert.equal(await page.locator('webview').evaluate(w => w.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches')), true)
    await page.waitForFunction(() => {
      const main = document.querySelector('.ide-capture-main')
      const frame = document.querySelector('.ide-capture-viewport-frame')
      return !!main && !!frame && main.scrollWidth <= main.clientWidth && frame.scrollWidth <= frame.clientWidth
    })
    await page.getByRole('button', { name: 'Capture screen', exact: true }).click()
    await page.getByText('Captured this session (1)', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    let captured
    for (let attempt=0; attempt<120; attempt++) {
      captured = await page.evaluate(async()=>{
        const files=await window.frameui.design.list()
        for(const file of files) {
          const doc=await window.frameui.design.load(file.id)
          const capture=doc?.pages.find(p=>p.capturedAt)
          if(capture)return capture
        }
      })
      if(captured)break
      await page.waitForTimeout(100)
    }
    assert(captured?.structured,'Capture must contain editable structured content')
    const texts=[]
    const collect=nodes=>nodes.forEach(n=>{if(n.type==='Text')texts.push(n);collect(n.children)})
    collect(captured.structured.children)
    if(process.env.FRAMEUI_BUDGET_URL) assert(texts.some(n=>n.typography?.text.includes('Questions before you start?')))
    const heading=texts.find(n=>/Payday should|Local Product/.test(n.typography?.text || ''))
    assert(heading,'An editable heading must survive capture')
    const element=page.locator(`[data-structured-id="${heading.id}"]`).first()
    await element.waitFor()
    if (process.env.FRAMEUI_CANVAS_PROFILE) {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.start')
      const timings = await page.evaluate(async () => {
        const stage = document.querySelector('.ide-stage')
        const samples = []
        for (let i=0;i<60;i++) {
          const start=performance.now()
          stage.dispatchEvent(new WheelEvent('wheel',{deltaY:i%2 ? -4 : 4,bubbles:true,cancelable:true}))
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
          samples.push(performance.now()-start)
        }
        samples.sort((a,b)=>a-b)
        return {median:samples[30],p95:samples[57],max:samples[59],nodes:document.querySelectorAll('[data-structured-id]').length}
      })
      const {profile}=await cdp.send('Profiler.stop')
      fs.writeFileSync(process.env.FRAMEUI_CANVAS_PROFILE,JSON.stringify({timings,profile}))
      console.log('Canvas timings',timings)
      await cdp.detach()
    }
    if (process.env.FRAMEUI_CAMERA_GESTURES) {
      const result = await page.evaluate(async () => {
        const stage = document.querySelector('.ide-stage')
        const group = document.querySelector('[data-canvas-camera]')
        const read = () => { const m = group.transform.baseVal.consolidate().matrix; return {x:m.e,y:m.f,zoom:m.a} }
        const before = read(), rect = stage.getBoundingClientRect(), x = 210, y = 180
        for (let i=0;i<20;i++) stage.dispatchEvent(new WheelEvent('wheel',{deltaY:-2,ctrlKey:true,clientX:rect.left+x,clientY:rect.top+y,bubbles:true,cancelable:true}))
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
        const during = read(), navigating = stage.classList.contains('ide-navigating')
        await new Promise(resolve=>setTimeout(resolve,180))
        const after = read()
        stage.dispatchEvent(new WheelEvent('wheel',{deltaY:2,deltaMode:1,shiftKey:true,bubbles:true,cancelable:true}))
        await new Promise(resolve=>setTimeout(resolve,180))
        const shifted = read()
        return {before,during,after,shifted,navigating,x,y}
      })
      assert(result.navigating, 'Live navigation bypasses editor commits')
      assert(result.during.zoom > result.before.zoom)
      assert(Math.abs((result.x-result.before.x)/result.before.zoom-(result.x-result.during.x)/result.during.zoom)<0.01,'Zoom must stay anchored to cursor')
      assert.deepEqual(result.after,result.during,'Settling must not jump')
      assert(Math.abs(result.shifted.x-result.after.x+32)<0.01,'Shift + line wheel pans horizontally')
      assert.equal(result.shifted.y,result.after.y)
      await page.getByRole('button',{name:/^\d+%$/}).click()
      const restart = await page.evaluate(async () => {
        const stage = document.querySelector('.ide-stage'), group = document.querySelector('[data-canvas-camera]')
        const before = group.transform.baseVal.consolidate().matrix.e
        stage.dispatchEvent(new WheelEvent('wheel',{deltaX:12,bubbles:true,cancelable:true}))
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
        const after = group.transform.baseVal.consolidate().matrix.e
        stage.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))
        return {before,after,pending:stage.classList.contains('ide-navigating')}
      })
      assert(Math.abs(restart.after-restart.before+12)<0.01,'Navigation still paints after toolbar camera changes')
      assert.equal(restart.pending,false,'Pointer input synchronizes navigation immediately')
      console.log('Canvas gesture checks passed')
    }
    await page.getByRole('button',{name:/^\d+%$/}).click()
    await page.screenshot({path:'docs/verification/budget-editability-before.png'})
    if (process.env.FRAMEUI_DIRECT_DRAG) {
      const original = await element.boundingBox()
      await page.mouse.move(original.x+10,original.y+10)
      await page.mouse.down()
      const dragTiming = await page.evaluate(async ({x,y})=>{
        const samples=[];let last=performance.now()
        for(let i=1;i<=40;i++){
          window.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:x+i,clientY:y+i/2,buttons:1,bubbles:true}))
          await new Promise(requestAnimationFrame)
          const now=performance.now();samples.push(now-last);last=now
        }
        samples.sort((a,b)=>a-b)
        return {median:samples[20],p95:samples[38],max:samples[39]}
      },{x:original.x+10,y:original.y+10})
      const preview=await element.boundingBox()
      assert(Math.abs(preview.x-original.x-40)<2,'unselected text moves on the first drag')
      await page.mouse.up()
      const committed=await element.boundingBox()
      assert(Math.abs(committed.x-preview.x)<2,'release does not jump')
      await page.keyboard.press('Meta+z')
      await page.waitForFunction(({id,x})=>Math.abs(document.querySelector(`[data-structured-id="${id}"]`).getBoundingClientRect().x-x)<2,{id:heading.id,x:original.x})
      // Cancellation restores the preview and leaves history untouched.
      await page.mouse.move(original.x+10,original.y+10);await page.mouse.down();await page.mouse.move(original.x+55,original.y+25,{steps:5})
      await page.keyboard.press('Escape');await page.mouse.up()
      assert(Math.abs((await element.boundingBox()).x-original.x)<2,'Escape cancels movement')
      await element.click({force:true})
      const widthInput=page.getByLabel('Captured width',{exact:true})
      const modelWidth=Number(await widthInput.inputValue())
      await widthInput.fill(String(modelWidth+20));await widthInput.press('Tab')
      assert((await element.boundingBox()).width>original.width+15,'inspector edits the rendered captured node')
      await page.evaluate(()=>document.activeElement.blur())
      await page.keyboard.press('Meta+z')
      await page.getByLabel('Search layers',{exact:true}).fill(heading.name)
      await page.locator(`[data-structured-layer-id="${heading.id}"]`).click()
      assert.equal(Number(await widthInput.inputValue()),modelWidth,'Layers and canvas select the same editable node')
      await page.getByLabel('Search layers',{exact:true}).fill('')
      // The fixture icon is one selectable SVG even when clicking its inner path.
      const iconId=await page.locator('svg[data-structured-id]').evaluateAll(nodes=>{const stage=document.querySelector('.ide-stage').getBoundingClientRect();return nodes.find(node=>{const b=node.getBoundingClientRect();return b.width>0&&b.height>0&&(b.width<40||b.height<28)&&b.left>stage.left+10&&b.right<stage.right-10&&b.top>stage.top+10&&b.bottom<stage.bottom-10})?.getAttribute('data-structured-id')})
      const icon=page.locator(`[data-structured-id="${iconId}"]`)
      if(iconId){
        await icon.click({force:true})
        assert.equal(await page.locator('.ide-direct-selection[data-tiny="true"]').count(),1)
        assert.equal(await page.locator('.ide-direct-handle:visible').count(),1,'tiny icons expose one external handle')
        const handleBox=await page.locator('.ide-direct-handle:visible').boundingBox()
        assert(Math.abs(handleBox.width-handleBox.height)<1,'tiny handle stays square')
        await page.screenshot({path:'docs/verification/canvas-small-icon.png'})
        await icon.click({modifiers:['Shift'],force:true})
        assert.equal(await page.locator('.ide-direct-selection:visible').count(),0,'Shift-click clears the last selected object')
      }
      // New vector tools must paint above captures and survive persistence.
      await page.getByRole('button',{name:'Rectangle (R)',exact:true}).click()
      await page.mouse.move(original.x+5,original.y+5);await page.mouse.down();await page.mouse.move(original.x+105,original.y+55,{steps:5});await page.mouse.up()
      const overlay=page.locator('[data-canvas-frame] [data-object-id]').last()
      await overlay.waitFor()
      assert((await overlay.boundingBox()).width>90,'new rectangle renders on captured content')
      await page.evaluate(()=>window.frameuiFlushSaves())
      const preserved=await page.evaluate(async()=>{for(const f of await window.frameui.design.list()){const d=await window.frameui.design.load(f.id);if(d.pages.some(p=>p.objects.some(o=>o.designOnly)))return true}return false})
      assert(preserved,'overlay flag survives validated save/load')
      const overlayBox=await overlay.boundingBox()
      await page.mouse.move(overlayBox.x+30,overlayBox.y+20);await page.mouse.down();await page.mouse.move(overlayBox.x+90,overlayBox.y+45,{steps:12});await page.mouse.up()
      assert((await overlay.boundingBox()).x>overlayBox.x+45,'vector overlays drag above a captured page')
      await page.keyboard.press('Meta+z')
      await page.keyboard.press('Meta+z')
      console.log('PASS: first-press drag, stable commit, Escape, tiny icon, Shift-deselect and drawing over captures',dragTiming)
    }
    await element.dblclick({force:true})
    await page.locator('[contenteditable="true"]').first().waitFor()
    await page.locator('[contenteditable="true"]').first().fill('Capture edit verified')
    await page.locator('[contenteditable="true"]').first().press('Meta+Enter')
    await page.getByText('Capture edit verified',{exact:true}).first().waitFor()
    if (process.env.FRAMEUI_CANVAS_PROFILE) {
      await element.click({force:true})
      assert.equal(await page.locator('.ide-structured-constrained-outline').count(),0,'Text should have a normal resize selection, not a dashed constrained outline')
      const handle=page.locator('.ide-direct-handle[data-structured-resize="nw"]').first()
      await handle.waitFor()
      await page.screenshot({path:'docs/verification/budget-text-resize.png'})
      const waitForWidth = async width => {
        let actual = 0
        for (let attempt=0;attempt<60;attempt++) {
          actual = await element.evaluate(node => node.getBoundingClientRect().width)
          if (Math.abs(actual-width)<3) return
          await page.waitForTimeout(50)
        }
        assert.fail(`Expected resized text width ${width}, got ${actual}`)
      }
      const before=await element.boundingBox()
      const grip=await handle.boundingBox()
      await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2)
      await page.mouse.down()
      await page.mouse.move(grip.x+grip.width/2-40,grip.y+grip.height/2,{steps:8})
      await page.mouse.up()
      await waitForWidth(before.width+40)
      await page.keyboard.press('Meta+z')
      await waitForWidth(before.width)
      await page.keyboard.press('Meta+Shift+z')
      await waitForWidth(before.width+40)
      await page.evaluate(()=>window.frameuiFlushSaves())
      console.log('PASS: solid text selection, resize, undo, redo and save')
    }
    assert.deepEqual(errors,[])
    console.log(JSON.stringify({captureHeight:captured.height,editableTextNodes:texts.length,checks:['interactive capture','saved structured content','canvas rendering','inline text editing','reduced motion']},null,2))
  } finally {
    if(app)await app.close()
    if(reviewProfile)fs.rmSync(reviewProfile,{recursive:true,force:true})
    server.close()
    fs.rmSync(root,{recursive:true,force:true})
  }
})().catch(error=>{console.error(error);process.exitCode=1})
