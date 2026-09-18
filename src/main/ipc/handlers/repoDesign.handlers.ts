import electron from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import postcss from 'postcss'
import { sourceTarget } from '@core/repo-design/targets'
import { z } from 'zod'
import { compileRepositoryPage, designIRMarkup } from '@core/repo-design/compiler'
import { normalizeVisual } from '@core/visual/normalize'
import { readJsonFile, writeJsonFileAtomic } from '@core/workspace/atomicJson'
import { getActiveProject, getCachedIndex } from '../../state/activeProject'
import { CAPTURE_SCRIPT } from '../../../renderer/lib/captureScript'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import type { VisualPage } from '@shared/types/visualDesign'

const request = z.object({ projectId: z.string(), pageId: z.string(), width: z.number().int().min(320).max(2560).default(1440), state: z.string().max(40).default('Populated') })
let resolving = false
// Large pages (inlined images/fonts as data: URIs, full utility CSS) can easily exceed
// Chromium's ~2M character URL cap, so the document itself is served over a privileged
// custom scheme instead of a `data:` URL passed to loadURL.
electron.protocol.registerSchemesAsPrivileged([{ scheme: 'frameui-design', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } }])
export function registerRepoDesignHandlers() {
  electron.ipcMain.handle('design:fromSource', async (_event, raw) => {
    const input = request.parse(raw), project = getActiveProject(), index = getCachedIndex()
    if (!project || project.projectId !== input.projectId || !index) throw new Error('Open this repository before analysing a page.')
    const page = sourceTarget(index.projectModel, input.pageId)
    if (!page) throw new Error('This page is no longer in the project index. Refresh from Code.')
    if (resolving) throw new Error('Another page is being analysed. Please wait for it to finish.')
    resolving = true
    let win: Electron.BrowserWindow | undefined
    try {
      const ir = compileRepositoryPage(project.rootPath, page, index.projectModel, input.state)
      const cacheFile = path.join(electron.app.getPath('userData'), 'source-design-cache', `${ir.hash}-${input.width}.json`)
      const cached = readJsonFile<VisualPage | null>(cacheFile, null)
      if (cached) return cached
      const isolated = electron.session.fromPartition(`source-design-${randomUUID()}`, { cache: false })
      const documentUrl = 'frameui-design://preview/index.html'
      const markup = designIRMarkup(ir)
      isolated.protocol.handle('frameui-design', req => req.url === documentUrl
        ? new Response(markup, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        : new Response('', { status: 404 }))
      // No file access, HTTP, WebSocket or privileged protocol is allowed, including redirects.
      isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') && details.url !== documentUrl }))
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      isolated.setPermissionCheckHandler(() => false)
      win = new electron.BrowserWindow({ show: false, width: input.width, height: 1000, useContentSize: true, webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false, webviewTag: false } })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', event => event.preventDefault())
      const timeout = setTimeout(() => { if (win && !win.isDestroyed()) win.destroy() }, 20000)
      try {
        await win.loadURL(documentUrl)
        await win.webContents.executeJavaScript('Promise.all([document.fonts.ready, ...Array.from(document.images).map(i => i.decode().catch(() => {}))]).then(() => true)')
        const measured = await win.webContents.executeJavaScript(CAPTURE_SCRIPT) as CapturedElement
        const localImages = (node: CapturedElement) => {
          const data = /url\(["']?(data:image\/[^"')]+)["']?\)/.exec(node.styles.backgroundImage ?? '')?.[1]
          if (data) node.attributes = { ...node.attributes, backgroundSrc: data }
          node.children.forEach(localImages)
        }
        localImages(measured)
        const objects = normalizeVisual(measured, { file: page.source.filePath, route: page.route ?? undefined })
        const fonts: NonNullable<VisualPage['fonts']> = []
        postcss.parse(ir.styles).walkAtRules('font-face', rule => {
          const values: Record<string, string> = {}
          rule.walkDecls(decl => { values[decl.prop] = decl.value })
          const data = /url\("(data:font\/[^"\s]+)"\)/.exec(values.src ?? '')?.[1]
          if (data) fonts.push({family:(values['font-family'] ?? '').replace(/^['"]|['"]$/g,''),weight:values['font-weight'] ?? '400',style:values['font-style'] ?? 'normal',data})
        })
        const result: VisualPage = {
          id: `source-${randomUUID()}`, name: page.name, folder: page.area, pinned: false,
          route: page.route ?? undefined, state: input.state, width: input.width,
          height: Math.max(1000, measured.rect.height), sourceHash: ir.hash,
          objects, importedObjects: structuredClone(objects), captureWarnings: ir.warnings, fonts,
          sourceDesign: { pageId: page.id, state: input.state, states: ir.states, status: ir.status, generatedData: ir.generatedData },
          thumbnail: (await win.webContents.capturePage()).resize({ width: 480 }).toDataURL(),
        }
        writeJsonFileAtomic(cacheFile, result)
        writeJsonFileAtomic(cacheFile.replace('.json', '.ir.json'), ir)
        return result
      } finally { clearTimeout(timeout) }
    } finally { if (win && !win.isDestroyed()) win.destroy(); resolving = false }
  })
}
