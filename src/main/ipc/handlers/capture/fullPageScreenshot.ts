import type { BrowserWindow } from 'electron'
import type { Protocol } from 'devtools-protocol'
import { withDebugger } from '../cdp/withDebugger'
import { raceAbort } from './raceAbort'
import {CONTENT_METRICS_SCRIPT} from './contentHeight'

/**
 * A true full-page screenshot via CDP's `captureBeyondViewport`, meant to be
 * taken after `scrollToSettle` so all lazy content is already visible.
 * Electron's own `webContents.capturePage()` (used everywhere else in this
 * pipeline for the page thumbnail) is strictly viewport-bound and cannot do
 * this. Used for full-height canvas previews and visual comparison; editable
 * geometry remains independent of the reference image resolution.
 *
 * Races against `signal` for the same reason `scrollToSettle` does:
 * destroying `win` mid-call (exactly what cancellation does) doesn't
 * reliably reject an in-flight CDP call in Electron.
 */
export async function captureFullPageScreenshot(
  win: Pick<BrowserWindow,'webContents'>,
  jobSignal: AbortSignal,
): Promise<string> {
  const signal=AbortSignal.any([jobSignal,AbortSignal.timeout(30000)])
  signal.throwIfAborted()
  return raceAbort(
    withDebugger(win.webContents, '1.3', async (send) => {
      await send('Page.enable')
      const { cssContentSize } = await send<Protocol.Page.GetLayoutMetricsResponse>(
        'Page.getLayoutMetrics',
      )
      const rendered=await raceAbort(win.webContents.executeJavaScript(CONTENT_METRICS_SCRIPT),signal) as {height:number}
      if(Number.isFinite(rendered.height))cssContentSize.height=Math.max(cssContentSize.height,rendered.height)
      // Retina full-page captures otherwise exceed Chromium's GPU texture
      // limit (e.g. a 14k CSS-pixel page becomes a 28k-pixel render target).
      // Bound only the reference image; editable geometry stays full size.
      const pixelRatio = await raceAbort(win.webContents.executeJavaScript('devicePixelRatio'),signal) as number
      const ratio = Math.max(1, pixelRatio || 1)
      const scale = Math.min(1, 8192 / (Math.max(cssContentSize.width, cssContentSize.height) * ratio),
        Math.sqrt(16000000 / (cssContentSize.width * cssContentSize.height * ratio * ratio)))
      const request: Protocol.Page.CaptureScreenshotRequest = {
        format: 'png',
        captureBeyondViewport: true,
        clip: { ...cssContentSize, scale },
      }
      const { data } = await send<Protocol.Page.CaptureScreenshotResponse>(
        'Page.captureScreenshot',
        request,
      )
      return `data:image/png;base64,${data}`
    },signal),
    signal,
  )
}
