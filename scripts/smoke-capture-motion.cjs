// Real Chromium regression: emulation must survive capture CDP commands and reloads.
const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-motion-'))
const outfile = path.join(root, 'main.cjs')
buildSync({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import { app, BrowserWindow, nativeImage } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { enableCaptureMotion } from './src/main/ipc/handlers/cdp/captureMotion'
import { installCaptureWebviewGuard } from './src/main/security/captureWebviewGuard'
import { captureDomSnapshot } from './src/main/ipc/handlers/cdp/domSnapshot'
import { scrollToSettle } from './src/main/ipc/handlers/capture/scrollToSettle'
import { captureFullPageScreenshot } from './src/main/ipc/handlers/capture/fullPageScreenshot'
import { makeStructuredFrame } from './src/core/capture-compiler/document'
import { renderStructuredFrameToHtml } from './src/core/capture-compiler/renderStructuredFrameToHtml'
import { captureResources } from './src/main/ipc/handlers/captureResources'
import { WAIT_FOR_CAPTURE_SCRIPT } from './src/renderer/lib/captureScript'
app.commandLine.appendSwitch('user-data-dir', ${JSON.stringify(path.join(root, 'profile'))})
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1440,height:1024,webPreferences:{backgroundThrottling:false}})
  await win.loadURL('about:blank')
  await enableCaptureMotion(win.webContents)
  const fixture = '<!doctype html><style>html{scroll-behavior:smooth}body{margin:0}.reveal{opacity:0} @media(prefers-reduced-motion:reduce){.reveal{opacity:1}}</style><h1 class="reveal">Motion ready</h1><div style="transform:scale(.5);transform-origin:top left;font-size:20px"><strong>Scaled label</strong></div><div style="height:2800px"></div><section id="lazy" style="height:100px"></section><dialog hidden>Keep hidden</dialog><script>window.motionAtStartup=matchMedia("(prefers-reduced-motion: reduce)").matches;new IntersectionObserver(es=>{if(es.some(e=>e.isIntersecting))document.querySelector("#lazy").textContent="Lazy footer ready"}).observe(document.querySelector("#lazy"))</script>'
  await win.loadURL('data:text/html,'+encodeURIComponent(fixture))
  assert.equal(await win.webContents.executeJavaScript('window.motionAtStartup'),true)
  await scrollToSettle(win, AbortSignal.timeout(30000))
  const tree = await captureDomSnapshot(win.webContents,{width:1440,height:1024})
  assert(JSON.stringify(tree).includes('Lazy footer ready'))
  const findText = node => node.textPreview === 'Scaled label' ? node : node.children.map(findText).find(Boolean)
  assert.equal(findText(tree)?.styles.fontSize,'10px','Scaled DOM text must match its captured geometry')
  assert.equal(await win.webContents.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'),true)
  await captureFullPageScreenshot(win,AbortSignal.timeout(10000))
  assert.equal(await win.webContents.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'),true)
  const host = new BrowserWindow({show:false,webPreferences:{webviewTag:true,backgroundThrottling:false}})
  installCaptureWebviewGuard(host)
  let resolveGuest
  const guestReady = new Promise(resolve=>resolveGuest=resolve)
  host.webContents.once('did-attach-webview',(_event,guest)=>resolveGuest(guest))
  await host.loadURL('data:text/html,'+encodeURIComponent('<webview style="width:1440px;height:1024px" src="about:blank"></webview>'))
  const guest:any = await guestReady
  await guest.loadURL('data:text/html,'+encodeURIComponent(fixture))
  assert.equal(await guest.executeJavaScript('window.motionAtStartup'),true,'Interactive browser must have reduced motion before page scripts')
  await scrollToSettle({webContents:guest},AbortSignal.timeout(30000))
  await captureDomSnapshot(guest,{width:1440,height:1024})
  assert.equal(await guest.executeJavaScript('matchMedia("(prefers-reduced-motion: reduce)").matches'),true)
  console.log('PASS: hidden and interactive capture, lazy content, smooth scrolling, persistent motion emulation')
  if(process.env.FRAMEUI_BUDGET_URL) {
    for(const width of [1440,390]) {
      win.setContentSize(width,1024)
      await win.loadURL(process.env.FRAMEUI_BUDGET_URL)
      await win.webContents.executeJavaScript(WAIT_FOR_CAPTURE_SCRIPT)
      await scrollToSettle(win,AbortSignal.timeout(120000))
      const state = await win.webContents.executeJavaScript('({reduce:matchMedia("(prefers-reduced-motion: reduce)").matches,height:document.body.scrollHeight,hidden:[...document.querySelectorAll("[data-reveal]")].filter(x=>getComputedStyle(x).opacity==="0").length,pins:document.querySelectorAll(".pin-spacer").length})')
      assert(state.reduce);assert.equal(state.hidden,0);assert.equal(state.pins,0)
      const tree = await captureDomSnapshot(win.webContents,{width,height:1024})
      assert(JSON.stringify(tree).includes('Questions before you start?'))
      const screenshot = await captureFullPageScreenshot(win,AbortSignal.timeout(30000))
      fs.mkdirSync('docs/verification',{recursive:true})
      fs.writeFileSync('docs/verification/budget-motion-'+width+'.png',nativeImage.createFromDataURL(screenshot).resize({width:480}).toPNG())
      const fonts = await captureResources(win.webContents,tree,process.env.FRAMEUI_BUDGET_URL,AbortSignal.timeout(30000),new Map(),[])
      const frame = makeStructuredFrame(tree,{name:'Budget',route:'/',width,height:1024,durationMs:0})
      frame.fonts = fonts
      const textNodes:any[] = []
      const collect = nodes => nodes.forEach(node=>{if(node.type==='Text')textNodes.push(node);collect(node.children)})
      collect(frame.children)
      assert(textNodes.some(node=>JSON.stringify(node).includes('Questions before you start?')),'FAQ must remain editable text')
      const render = new BrowserWindow({show:false,width,height:1024,useContentSize:true,webPreferences:{backgroundThrottling:false}})
      const htmlPath = ${JSON.stringify(path.join(root, 'budget-render.html'))}
      fs.writeFileSync(htmlPath,renderStructuredFrameToHtml(frame))
      await render.loadFile(htmlPath)
      await render.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))')
      const renderedScreenshot = await captureFullPageScreenshot(render,AbortSignal.timeout(30000))
      fs.writeFileSync('docs/verification/budget-canvas-'+width+'.png',nativeImage.createFromDataURL(renderedScreenshot).resize({width:480}).toPNG())
      render.destroy()
      console.log('PASS Budget',width,{...state,editableTextNodes:textNodes.length})
    }
  }
  app.quit()
}).catch(error=>{console.error(error);app.exit(1)})
` }, outfile, bundle:true, platform:'node', format:'cjs', external:['electron'], logLevel:'warning' })
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),[outfile],{env,stdio:'inherit'})
fs.rmSync(root,{recursive:true,force:true})
process.exit(result.status ?? 1)
