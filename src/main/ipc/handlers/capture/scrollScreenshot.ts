import electron from 'electron'
import { PNG } from 'pngjs'
import type { WebContents } from 'electron'
import { withDebugger } from '../cdp/withDebugger'
import { raceAbort } from './raceAbort'
import { CONTENT_METRICS_SCRIPT } from './contentHeight'

/** Embedded webviews can repeat their compositor viewport when CDP captures
 * beyond it. Capture actual scrolled viewports instead, without changing the
 * page's responsive dimensions, then join non-overlapping rows. */
export async function captureScrolledPageScreenshot(contents: WebContents, signal: AbortSignal): Promise<string> {
  const execute = (script: string) => raceAbort(contents.executeJavaScript(script), signal)
  const viewport = await execute('({width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})') as { width: number; height: number; x: number; y: number }
  const metrics = await execute(CONTENT_METRICS_SCRIPT) as { height: number }
  const height = Math.max(viewport.height, Math.ceil(metrics.height))
  const scale = Math.min(1, 8192 / Math.max(viewport.width, height), Math.sqrt(16000000 / (viewport.width * height)))
  const width = Math.max(1, Math.round(viewport.width * scale))
  const output = new PNG({ width, height: Math.max(1, Math.ceil(height * scale)) })
  let hiddenKey: string | undefined
  try {
    return await withDebugger(contents, '1.3', async send => {
      await send('Page.enable')
      for (let target = 0; target < height; target += viewport.height) {
        signal.throwIfAborted()
        const actual = await execute(`(async()=>{window.scrollTo({left:0,top:${target},behavior:'instant'});await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return scrollY})()`) as number
        // Paint fixed navigation once at the top, not once per tile. The
        // temporary attributes and stylesheet never enter the editable tree.
        if (target > 0) {
          await execute(`(()=>{const records=window.__frameuiScreenshotFixed??[];for(const el of document.querySelectorAll('*')){const s=getComputedStyle(el),r=el.getBoundingClientRect(),stuck=s.position==='sticky'&&((s.top!=='auto'&&r.top<=parseFloat(s.top)+1)||(s.bottom!=='auto'&&r.bottom>=innerHeight-parseFloat(s.bottom)-1));if((s.position==='fixed'||stuck)&&!records.some(record=>record[0]===el)){records.push([el,el.style.getPropertyValue('visibility'),el.style.getPropertyPriority('visibility')]);el.style.setProperty('visibility','hidden','important')}}window.__frameuiScreenshotFixed=records})()`)
          hiddenKey = 'fixed'
        }
        const result = await send<{ data: string }>('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
        const image = electron.nativeImage.createFromBuffer(Buffer.from(result.data, 'base64'))
        if (image.isEmpty()) throw new Error('The page preview could not be captured.')
        const tile = PNG.sync.read(image.resize({ width }).toPNG())
        const destinationY = Math.round(target * scale)
        const sourceY = Math.max(0, Math.round((target - actual) * scale))
        const rows = Math.min(Math.round((target + viewport.height) * scale) - destinationY, output.height - destinationY, tile.height - sourceY)
        if (rows <= 0) throw new Error('The page moved while its preview was being captured. Try again.')
        PNG.bitblt(tile, output, 0, sourceY, width, rows, 0, destinationY)
      }
      return `data:image/png;base64,${PNG.sync.write(output).toString('base64')}`
    }, signal)
  } finally {
    if (!contents.isDestroyed()) {
      if (hiddenKey) await raceAbort(contents.executeJavaScript(`(()=>{for(const [el,value,priority] of window.__frameuiScreenshotFixed??[])value?el.style.setProperty('visibility',value,priority):el.style.removeProperty('visibility');delete window.__frameuiScreenshotFixed})()`),AbortSignal.timeout(1000)).catch(() => {})
      await raceAbort(contents.executeJavaScript(`window.scrollTo({left:${viewport.x},top:${viewport.y},behavior:'instant'})`),AbortSignal.timeout(1000)).catch(() => {})
    }
  }
}
