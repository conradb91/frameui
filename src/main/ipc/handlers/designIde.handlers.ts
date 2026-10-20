import {SETTLE_REVEALS_SCRIPT,RESTORE_REVEALS_SCRIPT} from './capture/revealAnimations'
import {captureCompletenessWarnings} from '../../../core/capture-compiler/completeness'
import {packDocument} from '../../../shared/documentResources'
import {referenceImage} from './capture/referenceImages'
import {documentRequest} from '../../design/documentStore'
import { EXPAND_ARTIFACT_PANELS_SCRIPT } from './capture/contentHeight'
import { importSignal, importProject, abortable } from '../../artifacts/importJob'
import { explorePrototype, replayPrototype } from '../../artifacts/explorePrototype'
import { managedPrototypeRoutes, servePrototype } from '../../artifacts/prototypeImport'
import { runtimeAllowed } from '../../security/runtimePolicy'
import { enableCaptureMotion } from './cdp/captureMotion'
import { captureResources, embedIframeFallbacks } from './captureResources'
import { resolvePageName } from '@core/adapters/react/pageName'
import { captureOverlays } from './captureOverlays'
import { loginForCapture } from './loginForCapture'
import { matchRoutePattern } from '@core/design-model/matchRoutePattern'
import { captureVisualStates } from './captureVisualStates'
import { captureDomSnapshot } from './cdp/domSnapshot'
import { scrollToSettle } from './capture/scrollToSettle'
import { captureFullPageScreenshot } from './capture/fullPageScreenshot'
import { renderAndCompareStructuredCapture } from './capture/renderAndCompareStructuredCapture'
import {
  discoverFromPathSegments,
  runtimeRouteKey,
  runtimeRoutePath,
} from './runtimeRouteDiscovery'
import electron from 'electron'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getActiveProject, getCachedIndex } from '../../state/activeProject'
import { readJsonFile, writeJsonFileAtomic } from '@core/workspace/atomicJson'
import { getStructuredCapturesDir } from '@core/workspace/paths'
import { makeStructuredDocument, makeStructuredFrame } from '@core/capture-compiler/document'
import { resolveStructuredTokens } from '@core/capture-compiler/resolveTokens'
import { resolveStructuredComponents } from '@core/capture-compiler/resolveComponents'
import type { StructuredDesignDocument, StructuredFrame } from '@shared/types/structuredDesign'
import type { Component, Token } from '@shared/types/model/projectModel'
import { slugify } from '@core/design-model/id'
import { visualObjectSchema } from '@core/visual/schema'
import { normalizeVisual } from '@core/visual/normalize'
import { routePattern, safeRoute, visit } from '@core/visual/model'
import type {
  VisualObject,
  ApplicationCandidate,
  CaptureRoute,
  VisualPage,
  CaptureProgress,
  CaptureStage,
} from '@shared/types/visualDesign'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import type { ProjectModel } from '@shared/types/model/projectModel'
import {
  WAIT_FOR_CAPTURE_SCRIPT,
} from '../../../renderer/lib/captureScript'
const { ipcMain, app, BrowserWindow } = electron
/** Stage-1 capture-engine comparison helper (see `design:captureCurrentState`) —
 * a crude size signal for the legacy-script vs. DOMSnapshot trees, not a
 * structural diff. */
function countCapturedElements(el: CapturedElement): number {
  let count = 1
  for (const child of el.children) count += countCapturedElements(child)
  return count
}
/** Stage 2 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
 * compiles a `CapturedElement` into the new FrameUI Design Model and writes
 * it to a diagnostic-only, one-file-per-route+viewport location under
 * userData. Stage 3 additionally writes a paired "legacy" sibling file
 * (same slug, `.legacy.json`) when the caller has a `VisualObject[]`
 * rendering of the exact same captured tree already on hand — this is what
 * `StructuredCapturePreview.tsx` reads back to show old vs. new side by
 * side. Nothing else reads either file back yet. Never throws; callers
 * decide whether to await it (batch path) or fire-and-forget it
 * (interactive path). */
function writeStructuredCapture(
  projectId: string,
  root: CapturedElement,
  ctx: { name: string; route: string; state?: string; width: number; height: number; durationMs: number },
  legacy?: { objects: VisualObject[]; fonts: VisualPage['fonts'] },
  // Stage 8 sub-slice 1 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §10-11): the
  // project's already-scanned repository token index — resolving values to
  // token names happens here, before the first write, rather than as a
  // separate read-mutate-rewrite pass (unlike `scheduleVisualMatch`, whose
  // result genuinely isn't known until after the initial write).
  tokens?: Token[],
  // Stage 8 sub-slice 3 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §30-31): the
  // project's already-built component index — same "resolve before the
  // first write" reasoning as `tokens` above.
  components?: Component[],
): { frame: StructuredFrame; document: StructuredDesignDocument; dir: string; slug: string; warnings:string[] } {
  const model = getCachedIndex()?.projectModel
  const matchedRoute = matchRoutePattern(ctx.route, model?.routes ?? [])
  const sourceFile = model?.pages.find(page => page.id === matchedRoute?.route.pageId)?.source.filePath
  let frame = makeStructuredFrame(root, { ...ctx, file: sourceFile })
  if (tokens?.length) frame = resolveStructuredTokens(frame, tokens)
  if (components?.length) frame = resolveStructuredComponents(frame, components)
  // Stage 8 sub-slice 2 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §13): the same
  // already-fetched font bytes passed in for the `legacy` bundle above —
  // `frame.fonts` is what both `StructuredFrameView.tsx` and
  // `renderStructuredFrameToHtml.ts` actually have access to (this frame
  // is what gets saved into `VisualPage.structured`; the wider debug
  // `StructuredDesignDocument.fonts` wrapper was never the real gap).
  if (legacy?.fonts) frame = { ...frame, fonts: legacy.fonts }
  const document = makeStructuredDocument(projectId, [frame])
  const dir = getStructuredCapturesDir(app.getPath('userData'), projectId)
  const slug = `${slugify(ctx.route)}-${ctx.width}x${ctx.height}`
  writeJsonFileAtomic(path.join(dir, `${slug}.json`), document)
  if (legacy) writeJsonFileAtomic(path.join(dir, `${slug}.legacy.json`), legacy)
  return { frame, document, dir, slug, warnings:captureCompletenessWarnings(root,frame) }
}
/** Shared by both the structured-v2 (awaited) and legacy (fire-and-forget)
 * branches of `design:captureCurrentState` — compiles+writes the structured
 * document for `domSnapshotRoot`, logs the same `[FrameUI capture:compare]`/
 * `[FrameUI capture:structured]` lines either way, and never throws (a
 * failure here must never fail the real capture, on either branch). */
async function buildStructuredCapture(
  projectId: string,
  domSnapshotRoot: CapturedElement,
  legacyRoot: CapturedElement,
  ctx: { name: string; route: string; width: number; height: number; startedAt: number },
  fonts: VisualPage['fonts'],
): Promise<ReturnType<typeof writeStructuredCapture> | undefined> {
  try {
    const durationMs = Math.round(performance.now() - ctx.startedAt)
    console.info('[FrameUI capture:compare]', {
      route: ctx.route,
      ok: true,
      legacyNodeCount: countCapturedElements(legacyRoot),
      domSnapshotNodeCount: countCapturedElements(domSnapshotRoot),
      domSnapshotDurationMs: durationMs,
    })
    const legacyObjects = normalizeVisual(domSnapshotRoot, { route: ctx.route })
    const captured = writeStructuredCapture(projectId, domSnapshotRoot, {
      name: ctx.name,
      route: ctx.route,
      width: ctx.width,
      height: ctx.height,
      durationMs,
    }, { objects: legacyObjects, fonts }, getCachedIndex()?.projectModel.tokens, getCachedIndex()?.projectModel.components)
    console.info('[FrameUI capture:structured]', { route: ctx.route, ok: true, structuredNodeCount: captured.frame.captureMetadata.structuredNodeCount })
    return captured
  } catch (e) {
    console.info('[FrameUI capture:structured]', { route: ctx.route, ok: false, error: String(e) })
    return undefined
  }
}
/** Stage 4 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md
 * §20): the heavier, always-fire-and-forget follow-up to `writeStructuredCapture`
 * — spawns a hidden window, renders the structured document for real,
 * screenshots it and Pixelmatch-diffs that against the original capture's
 * own screenshot. Mutates the already-in-memory `captured.frame`/`.document`
 * and rewrites the same JSON, rather than re-reading it from disk. Never
 * throws; logs and gives up silently on failure.
 *
 * Stage 9 sub-slice 3 (§23): when `renderAndCompareStructuredCapture` also
 * returns a `correctedFrame` (its automatic raster-fallback correction pass
 * found and fixed a bad subtree), that frame REPLACES `captured.frame` —
 * both `captured.frame` and `captured.document.frames[0]` need updating
 * explicitly, since they're two separate references to what was originally
 * the same object (`makeStructuredDocument` puts `frame` directly into
 * `document.frames`); mutating `captureMetadata.visualMatch` in place (the
 * no-correction case, unchanged from Stage 4) doesn't have this problem
 * since it never replaces the object, only a property on it. */
function scheduleVisualMatch(
  captured: { frame: StructuredFrame; document: StructuredDesignDocument; dir: string; slug: string },
  originalPng: Buffer,
  signal?: AbortSignal,
): Promise<void> {
  return renderAndCompareStructuredCapture({ frame: captured.frame, originalPng, dir: captured.dir, slug: captured.slug, signal })
    .then((result) => {
      if (!result) return
      if (result.correctedFrame) {
        result.correctedFrame.captureMetadata.visualMatch = result.visualMatch
        captured.frame = result.correctedFrame
        captured.document.frames[0] = result.correctedFrame
      } else {
        captured.frame.captureMetadata.visualMatch = result.visualMatch
      }
      writeJsonFileAtomic(path.join(captured.dir, `${captured.slug}.json`), captured.document)
    })
    .catch((e) => console.info('[FrameUI capture:visualMatch]', { route: captured.frame.sourceRoute, ok: false, error: String(e) }))
}
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
const runtimeUrl = z.string().trim().url().refine(value => runtimeAllowed(app.getPath('userData'), getActiveProject()?.projectId, value), 'Connect this app address to the open project first.')
const file = (id: string) =>
  path.join(
    app.getPath('userData'),
    'design-files',
    `${idSchema.parse(id)}.json`,
  )
const partition = (profile = 'standard',projectId=getActiveProject()?.projectId) =>
  `persist:project-${projectId ?? 'design'}${profile === 'standard' ? '' : `-${profile}`}`
let approved: {
  token: string
  routes: CaptureRoute[]
  origin: string
  projectId: string
  profile: string
  artifactSteps?: Record<string,string[]>
} | null = null
let capturing = false
let captureAbort: AbortController | null = null
let captureOwner: number | null = null
const captureWindows = new Set<Electron.BrowserWindow>()
const readOnlyGuests = new Map<number, string>()
const guardedSessions = new WeakSet<Electron.Session>()
const network = new Map<
  number,
  { pending: Set<number>; changed: number; failures: string[] }
>()
function guardGuest(win: Electron.BrowserWindow, origin: string) {
  const ses = win.webContents.session
  readOnlyGuests.set(win.webContents.id, origin)
  network.set(win.webContents.id, {
    pending: new Set(),
    changed: Date.now(),
    failures: [],
  })
  const guestId = win.webContents.id
  win.once('closed', () => {
    readOnlyGuests.delete(guestId)
    network.delete(guestId)
  })
  if (guardedSessions.has(ses)) return
  guardedSessions.add(ses)
  ses.webRequest.onBeforeRequest((request, callback) => {
    const origin = readOnlyGuests.get(request.webContentsId ?? -1)
    const mutation =
      !!origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    const action =
      !!origin &&
      request.resourceType === 'mainFrame' &&
      !safeRoute(request.url, origin)
    const state = network.get(request.webContentsId ?? -1)
    if (state && !mutation && !action && request.resourceType !== 'webSocket') {
      state.pending.add(request.id)
      state.changed = Date.now()
    }
    callback({ cancel: mutation || action })
  })
  const settled = (
    request:
      | Electron.OnCompletedListenerDetails
      | Electron.OnErrorOccurredListenerDetails,
  ) => {
    const state = network.get(request.webContentsId ?? -1)
    if (!state) return
    state.pending.delete(request.id)
    state.changed = Date.now()
    if (
      ('error' in request && request.error) ||
      (request as Electron.OnCompletedListenerDetails).statusCode >= 400
    )
      state.failures.push(request.url)
  }
  ses.webRequest.onCompleted(settled)
  ses.webRequest.onErrorOccurred(settled)
}
async function waitForNetwork(win: Electron.BrowserWindow) {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const state = network.get(win.webContents.id)
    if (
      !state ||
      (state.pending.size === 0 && Date.now() - state.changed > 500)
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  // Background polling and analytics must not reject an otherwise rendered screen.
  // The DOM readiness check below still rejects blank and visibly loading pages.
}
const browserScript = `(async () => { await document.fonts.ready; return { title: document.title, heading: document.querySelector('main h1,h1')?.textContent?.trim(), links: Array.from(document.querySelectorAll('a[href]')).map(a => ({ url: a.href, name: (a.innerText || a.getAttribute('aria-label') || '').trim() })).slice(0, 1000), visible: !!(document.body && (document.body.innerText.trim() || document.querySelector('img,svg,canvas'))), images: Array.from(document.images).filter(i => !i.complete || !i.naturalWidth).length, imagesTotal: document.images.length } })()`
type DiscoveryWarning = string
type RuntimeRouteCandidate = { url: string; name: string }
type DiscoveryPage = { url: string; depth: number }
const DISCOVERY_MAX_PAGES = 28
const DISCOVERY_MAX_DEPTH = 2
const DISCOVERY_MAX_LINKS_PER_PAGE = 180
const DISCOVERY_LINK_WARNING = 'Runtime route discovery stopped early while the application has additional linked pages.'
function cleanRouteName(name: string, fallback: string) {
  const trimmed = name.trim()
  return trimmed ? trimmed.slice(0, 100) : fallback
}
async function collectRuntimeRoutes(
  origin: string,
  profile: string,
  root: ElectronBrowserWindow,
  modelRoutes: ProjectModel | undefined,
  signal: AbortSignal | undefined,
  baseRoutes: Map<string, CaptureRoute>,
  hashes: Map<string, string>,
  sourceWarnings: DiscoveryWarning[],
) {
  const originUrl = new URL(origin)
  const hashFor = (file?: string) => {
    const key = file || ''
    if (!hashes.has(key)) hashes.set(key, sourceHash(file))
    return hashes.get(key)!
  }
  const addRoute = (raw: string, name: string) => {
    if (!safeRoute(raw, origin)) return
    const concretePath = runtimeRoutePath(raw, origin)
    const match = matchRoutePattern(
      new URL(concretePath, origin).href,
      modelRoutes?.routes ?? [],
    )
    const fallbackSource = match
      ? modelRoutes?.pages?.find((page) => page.id === match.route.pageId)
      : undefined
    const pattern = match?.route.path ?? concretePath
    const existing = baseRoutes.get(pattern)
    const sources = [...new Set([...(existing?.sources ?? []), 'runtime' as const])]
    // A pattern already fully known (not a needsSample placeholder) keeps its
    // own fields — source data wins on conflicts — but the runtime hit must
    // still be recorded, or a route found by both methods would silently
    // look like it was only ever found by source analysis.
    if (existing && !existing.needsSample) {
      if (sources.length !== existing.sources?.length)
        baseRoutes.set(pattern, { ...existing, sources })
      return
    }
    const source = fallbackSource?.source?.filePath
    const candidate: CaptureRoute = {
      url: raw,
      pattern,
      name: cleanRouteName(name, fallbackSource?.name || pattern),
      source,
      hash: source ? hashes.get(source) || hashFor(source) : undefined,
      sources,
    }
    if (existing?.needsSample) candidate.needsSample = true
    baseRoutes.set(pattern, candidate)
  }
  const getBrowserInfo = async (
    window: ElectronBrowserWindow,
    sourceRoute: string,
  ): Promise<{ title: string; heading?: string; links: RuntimeRouteCandidate[]; images: number } | null> => {
    try {
      const info = (await window.webContents.executeJavaScript(browserScript)) as {
        title: string
        heading?: string
        links: RuntimeRouteCandidate[]
        visible: boolean
        images: number
      }
      if (!info.visible) {
        sourceWarnings.push('A linked page did not render visible content and was skipped.')
        return null
      }
      const safeLinks = info.links.filter((link) =>
        safeRoute(link.url, sourceRoute),
      )
      if (safeLinks.length > DISCOVERY_MAX_LINKS_PER_PAGE)
        sourceWarnings.push(DISCOVERY_LINK_WARNING)
      const links = safeLinks.slice(0, DISCOVERY_MAX_LINKS_PER_PAGE)
      return {
        title: info.title,
        heading: info.heading,
        links,
        images: info.images,
      }
    } catch {
      sourceWarnings.push('Some runtime routes were not explored because a linked page could not load. Capture remaining pages manually from your browser as needed.')
      return null
    }
  }
  const queue: DiscoveryPage[] = [
    {
      url: root.webContents.getURL(),
      depth: 0,
    },
  ]
  const scheduled = new Set<string>([
    runtimeRouteKey(root.webContents.getURL(), origin),
  ])
  const visited = new Set<string>()
  const discovered = new Map<string, string>()
  let stoppedEarly = false
  while (queue.length) {
    const entry = queue.shift()
    if (!entry) break
    const normalized = runtimeRouteKey(entry.url, origin)
    if (visited.has(normalized) || entry.depth > DISCOVERY_MAX_DEPTH) continue
    visited.add(normalized)
    const depthUrl = new URL(entry.url, origin).href
    let view: ElectronBrowserWindow | null = null
    try {
      view =
        entry.depth === 0
          ? root
          : await browser(depthUrl, 1440, 1000, signal, profile)
      if (new URL(view.webContents.getURL()).origin !== originUrl.origin)
        throw new Error('Route stayed outside application origin during discovery.')
      const info = await getBrowserInfo(view, origin)
      if (!info) continue
      const pageUrl = view.webContents.getURL()
      const pageKey = runtimeRouteKey(pageUrl, origin)
      discovered.set(pageKey, pageUrl)
      const pageName = cleanRouteName(
        resolvePageName({ title: info.title, heading: info.heading }),
        normalized,
      )
      addRoute(pageUrl, pageName)
      if (entry.depth < DISCOVERY_MAX_DEPTH) {
        for (const link of info.links)
          if (safeRoute(link.url, origin)) {
            const next = runtimeRouteKey(link.url, origin)
            if (
              next !== pageKey &&
              !scheduled.has(next) &&
              scheduled.size < DISCOVERY_MAX_PAGES
            ) {
              scheduled.add(next)
              queue.push({
                url: link.url,
                depth: entry.depth + 1,
              })
            } else if (!scheduled.has(next)) stoppedEarly = true
          }
      } else if (
        info.links.some(
          (link) =>
            safeRoute(link.url, origin) &&
            !scheduled.has(runtimeRouteKey(link.url, origin)),
        )
      ) {
        stoppedEarly = true
      }
    } catch (error) {
      if (error instanceof Error && /sign in/i.test(error.message)) {
        sourceWarnings.push('Some linked routes were not discovered because a sign-in screen was encountered during runtime discovery.')
        continue
      }
      if (error instanceof Error && /already destroyed/i.test(error.message)) continue
      sourceWarnings.push('Some runtime routes were not explored because a linked page could not load. Capture remaining pages manually from your browser as needed.')
    } finally {
      if (entry.depth > 0 && view && !view.isDestroyed()) view.destroy()
    }
  }
  if (stoppedEarly) sourceWarnings.push(DISCOVERY_LINK_WARNING)
  const inferred = discoverFromPathSegments([...discovered.values()])
  for (const [pattern, examples] of inferred.entries()) {
    if (!baseRoutes.has(pattern) && examples.length)
      baseRoutes.set(pattern, {
        needsSample: true,
        pattern,
        name: `Dynamic route: ${pattern}`,
        url: examples[0],
        sources: ['runtime'],
      })
  }
}
/** Live Fidelity Capture's exact per-device viewport heights (spec: desktop
 * 1440×1024, tablet 768×1024, mobile 390×844) — a real mobile shell's fixed
 * bottom nav, safe-area insets, and any `100vh`/`dvh` layout all render
 * against viewport *height*, not just width, so a flat capture height would
 * silently misrender them. Any width outside this feature's three sizes
 * (link-crawling during discovery, legacy/arbitrary add-route captures)
 * falls back to the pre-existing 1000, unaffected by this lookup. */
const CAPTURE_VIEWPORT_HEIGHTS: Record<number, number> = { 1920: 1080, 1440: 1024, 768: 1024, 390: 844 }
function heightForWidth(width: number): number {
  return CAPTURE_VIEWPORT_HEIGHTS[width] ?? 1000
}
async function browser(url: string, width = 1440, height = 1000, signal?: AbortSignal, profile = 'standard',project=getActiveProject()) {
  signal?.throwIfAborted()
  if(!runtimeAllowed(app.getPath('userData'),project?.projectId,url))throw new Error('Connect this app address to its project before capturing.')
  const win = new BrowserWindow({
    show: false,
    useContentSize: true,
    width,
    height,
    webPreferences: {
      partition: partition(profile,project?.projectId),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const abort = () => { if (!win.isDestroyed()) win.destroy() }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal) captureWindows.add(win)
  win.once('closed', () => { signal?.removeEventListener('abort', abort); captureWindows.delete(win) })
  let mainStatus = 200
  win.webContents.on('did-navigate', (_event, _url, status) => { mainStatus = status })
  let signInRedirect = false
  win.webContents.on('will-redirect', (_event, target) => {
    if (
      /\/(?:login|sign-in|signin|auth)(?:[/?#]|$)/i.test(
        new URL(target).pathname,
      )
    )
      signInRedirect = true
  })
  // Establish a CDP target before applying the origin guard, which correctly
  // rejects data: navigations once capture security is active.
  try { await abortable(win.loadURL('data:text/html,<body></body>'),signal) }
  catch (e) { if (!win.isDestroyed()) win.destroy(); throw e }
  signal?.throwIfAborted()
  guardGuest(win, new URL(url).origin)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, target) => {
    if (new URL(target).origin !== new URL(url).origin) e.preventDefault()
  })
  let loadTimer: ReturnType<typeof setTimeout> | undefined
  try {
    // Set this before navigation: motion libraries inspect the media query
    // during startup and can otherwise leave offscreen sections at opacity 0
    // or pin several scenes into a single viewport. The capture is a static
    // design, so the page's accessible reduced-motion layout is the complete
    // representation of those sections.
    await enableCaptureMotion(win.webContents)
    await abortable(Promise.race([
      win.loadURL(url),
      new Promise<never>((_, reject) =>
        loadTimer = setTimeout(
          () =>
            reject(
              new Error('The application did not respond within 20 seconds.'),
            ),
          20000,
        ),
      ),
    ]),signal)
    clearTimeout(loadTimer)
    if (mainStatus === 401) throw new Error('Sign in to your application before capturing this page.')
    if (mainStatus >= 400) throw new Error(`Application returned HTTP ${mainStatus}. Open this route in the application and resolve the server error, then retry.`)
    if (
      /\/(?:login|sign-in|signin)(?:\/|$)/i.test(
        new URL(win.webContents.getURL()).pathname,
      ) && !/\/(?:login|sign-in|signin)(?:\/|$)/i.test(new URL(url).pathname)
    )
      throw new Error(
        'Sign in to your application in FrameUI, then check the connection again.',
      )
    await abortable(waitForNetwork(win),signal)
    await abortable(win.webContents.executeJavaScript(WAIT_FOR_CAPTURE_SCRIPT),signal)
    if (
      /\/(?:login|sign-in|signin)(?:\/|$)/i.test(
        new URL(win.webContents.getURL()).pathname,
      ) && !/\/(?:login|sign-in|signin)(?:\/|$)/i.test(new URL(url).pathname)
    )
      throw new Error('Sign in to your application before capturing this page.')
    // Some applications render a login form at the protected URL itself,
    // or use a custom sign-in path instead of /login.
    const loginForm = await win.webContents.executeJavaScript(`(() => {
      const visible = el => !!el.getClientRects().length;
      const password = Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
      if (!password) return false;
      return Array.from((password.form || document).querySelectorAll('button,input[type="submit"]')).some(el => visible(el) && /^(sign[ -]?in|log[ -]?in)$/i.test((el.textContent || el.value || '').trim()));
    })()`)
    if (loginForm && !project?.rootPath.startsWith(path.join(app.getPath('userData'),'artifact-projects')+path.sep) && !/\/(?:login|sign-in|signin|auth)(?:\/|$)/i.test(new URL(url).pathname))
      throw new Error('Sign in to your application before capturing this page.')
    return win
  } catch (e) {
    clearTimeout(loadTimer)
    if (!win.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
    if (!win.isDestroyed()) win.destroy()
    if (signInRedirect)
      throw new Error(
        'Sign in to your application in FrameUI, then check the connection again.',
      )
    throw e
  }
}
function sourceHash(source?: string) {
  const index = getCachedIndex()
  const files = new Set<string>()
  const walk = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    for (const dependency of index?.dependencyGraph?.dependencies[file] ?? [])
      walk(dependency)
  }
  if (source) walk(source)
  // Global styles/configuration and shared layouts apply beyond explicit imports.
  for (const file of Object.keys(index?.files ?? {}))
    if (
      !source ||
      /(?:\.(?:css|scss|sass|less)$|tailwind|(?:^|\/)package\.json$|layout)/i.test(
        file,
      )
    )
      files.add(file)
  return createHash('sha256')
    .update(
      JSON.stringify(
        [...files].sort().map((file) => [file, index?.files?.[file]]),
      ),
    )
    .digest('hex')
}
export function registerDesignIdeHandlers() {
  ipcMain.handle('design:login', async (_event, raw) => {
    const input = z
      .object({
        url: runtimeUrl,
        profile: z.enum(['standard', 'admin', 'super-admin']).default('standard'),
        username: z.string().min(1).max(1000),
        password: z.string().min(1).max(5000),
      })
      .parse(raw)
    if (!getActiveProject())
      throw new Error('Open a project before signing in.')
    return loginForCapture(
      input.url,
      partition(input.profile),
      input.username,
      input.password,
    )
  })
  ipcMain.handle('design:list', () => documentRequest('list',file('index')))
  ipcMain.handle('design:load', (_e,id) => documentRequest('load',file(id)))
  ipcMain.handle('design:save', (_e,raw) => {
    // Validation/serialization and disk writes run off the UI/main event loop.
    // The worker derives the validated document ID; the renderer supplies it separately.
    const input=raw as {id:string;document:unknown}
    return documentRequest('save',file(input.id),input.document)
  })
  ipcMain.handle('design:savePatch', (_e,raw) => {const input=raw as {id:string;patch:unknown};return documentRequest('patch',file(input.id),input.patch)})
  ipcMain.handle('design:scan', async () => {
    const name = path
      .basename(getActiveProject()?.rootPath ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    const candidates = await Promise.all(
      [5173, 3000, 5000, 5001, 7000, 8080, 4200, 8000].map(async (port) => {
        const url = `http://localhost:${port}`
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(1800),
            redirect: 'error',
          })
          if (!response.headers.get('content-type')?.includes('text/html'))
            return null
          const html = (await response.text()).slice(0, 1000000)
          const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || url
          return {
            url,
            title,
            matches:
              name.length > 2 &&
              title
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .includes(name),
          }
        } catch {
          return null
        }
      }),
    )
    return candidates.filter((c): c is ApplicationCandidate => c !== null)
  })
  // Live Fidelity Capture's "Test connection" step — a cheap preflight the
  // Connect dialog can run before committing to the much heavier
  // design:discover (full route crawl). Reuses browser()/browserScript
  // exactly as design:discover does, but never explores links or touches
  // the project's route model — just proves the address is reachable and
  // reports what a designer would want to see before capturing it.
  ipcMain.handle('design:testConnection', async (_e, raw) => {
    const { url, profile } = z.object({ url: runtimeUrl, profile: z.enum(['standard', 'admin', 'super-admin']).default('standard') }).parse(typeof raw === 'string' ? { url: raw } : raw)
    if (!getActiveProject()) throw new Error('Open a repository first.')
    const win = await browser(url, 1440, heightForWidth(1440), undefined, profile)
    try {
      const info = (await win.webContents.executeJavaScript(browserScript)) as {
        title: string
        heading?: string
        links: { url: string; name: string }[]
        visible: boolean
        images: number
        imagesTotal: number
      }
      if (!info.visible)
        throw new Error('The application has not rendered visible content yet.')
      const finalUrl = new URL(win.webContents.getURL())
      return {
        ok: true as const,
        address: `${finalUrl.hostname}${finalUrl.port ? `:${finalUrl.port}` : ''}`,
        title: info.title || finalUrl.href,
        route: finalUrl.pathname + finalUrl.search + finalUrl.hash,
        assetsLoaded: Math.max(0, info.imagesTotal - info.images),
        assetsTotal: info.imagesTotal,
      }
    } finally {
      win.destroy()
    }
  })
  // Source routes are already indexed. Approve only the user-selected paths;
  // do not crawl the whole application before a single-page capture.
  ipcMain.handle('design:discoverArtifact', async (event,raw) => {
    const {id,width}=z.object({id:z.string().uuid(),width:z.number().int().min(240).max(3840).default(1440)}).parse(typeof raw==='string'?{id:raw}:raw),signal=importSignal(event.sender.id,id)
    const active=importProject(event.sender.id,id)
    if(!active.rootPath.startsWith(path.join(app.getPath('userData'),'artifact-projects')+path.sep))throw new Error('Import a local HTML or ZIP prototype first.')
    if(capturing)throw new Error('Wait for capture to finish.')
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason)
    signal.addEventListener('abort',abort,{once:true})
    capturing=true;captureAbort=controller;captureOwner=event.sender.id
    try {
      signal.throwIfAborted()
      const url=await servePrototype(active.rootPath)
      const result=await abortable(explorePrototype(url,await managedPrototypeRoutes(active.rootPath),address=>browser(address,width,heightForWidth(width),controller.signal,'standard',active),controller.signal,progress=>{
        if(!event.sender.isDestroyed())event.sender.send('project:prototypeImportProgress',{...progress,id,stage:'discover'})
      }),controller.signal)
      signal.throwIfAborted()
      await fs.promises.writeFile(path.join(active.rootPath,'frameui-discovery-report.json'),JSON.stringify({createdAt:new Date().toISOString(),scope:'Bounded safe navigation and disclosure exploration',limits:{screens:40,attempts:60,steps:4,controlsPerScreen:32,visualElements:500},queryPolicy:'Sorted query parameters distinguish state; ordinary scroll anchors do not.',deduplication:result.deduplication,warnings:result.warnings},null,2))
      if(!result.states.length)throw new Error('The prototype did not render a visible interface. Export standalone HTML with its assets, or connect a running app for source-only projects.')
      const routes=result.states.map(state=>({pattern:state.pattern,url:state.url,name:state.name,sources:['runtime' as const]}))
      approved={token:crypto.randomUUID(),routes,origin:new URL(url).origin,projectId:active.projectId,profile:'standard',artifactSteps:Object.fromEntries(result.states.map(s=>[s.pattern,s.steps]))}
      return {token:approved.token,transitions:result.transitions,warnings:result.warnings,routes}
    }finally{signal.removeEventListener('abort',abort);capturing=false;captureAbort=null;captureOwner=null}
  })
  ipcMain.handle('design:prepareCapture', async (_event, raw) => {
    const input = z.object({
      url: runtimeUrl,
      profile: z.enum(['standard', 'admin', 'super-admin']).default('standard'),
      routes: z.array(z.object({ pattern: z.string().min(1).max(2000), path: z.string().min(1).max(2000), name: z.string().min(1).max(500) })).min(1).max(500),
    }).parse(raw)
    const active = getActiveProject()
    if (!active) throw new Error('Open a project before capturing pages.')
    if (capturing) throw new Error('Wait for the current capture to finish.')
    const routes = input.routes.map(route => {
      const url = new URL(route.path, input.url).href
      runtimeUrl.parse(url)
      if (!safeRoute(url, input.url) || /[:*{}[\]]/.test(decodeURIComponent(new URL(url).pathname)))
        throw new Error(`Choose a concrete, read-only page address for ${route.pattern}.`)
      if (/[:*{}[\]]/.test(route.pattern) && !matchRoutePattern(url, [{ id: route.pattern, path: route.pattern, pageId: '', source: { filePath: '' } }]))
        throw new Error(`The example path must match ${route.pattern}. Replace its parameters with real values.`)
      const source = getCachedIndex()?.projectModel.pages.find(page => page.route === route.pattern || (page.route && routePattern(page.route) === route.pattern))?.source.filePath
      return { pattern: route.pattern, url, name: route.name, source, hash: sourceHash(source), sources: ['source'] as ('source')[] }
    })
    approved = { token: crypto.randomUUID(), routes, origin: new URL(input.url).origin, projectId: active.projectId, profile: input.profile }
    return { token: approved.token }
  })
  ipcMain.handle('design:discover', async (_e, raw) => {
    const input = z.object({ url: runtimeUrl, profile: z.enum(['standard', 'admin', 'super-admin']).default('standard') }).parse(typeof raw === 'string' ? {url: raw} : raw)
    let url = input.url
    const active = getActiveProject()
    if (!active) throw new Error('Open a repository first.')
    const win = await browser(url, 1440, 1000, undefined, input.profile)
    url = win.webContents.getURL()
    try {
      const info = (await win.webContents.executeJavaScript(browserScript)) as {
        title: string
        heading?: string
        links: { url: string; name: string }[]
        visible: boolean
        images: number
      }
      if (!info.visible)
        throw new Error('The application has not rendered visible content yet.')
      const model = getCachedIndex()?.projectModel
      const routes = new Map<string, CaptureRoute>()
      const hashes = new Map<string, string>()
      const sourceWarnings: string[] = []
      const hashFor = (file?: string) => {
        const key = file || ''
        if (!hashes.has(key)) hashes.set(key, sourceHash(file))
        return hashes.get(key)!
      }
      for (const page of model?.pages ?? []) {
        if (
          !page.route ||
          /\/(?:logout)(?:\/|$)/i.test(page.route)
        )
          continue
        const target = new URL(page.route, url).href
        if (safeRoute(target, url))
          routes.set(routePattern(page.route), {
            needsSample: /[:*{}[\]]/.test(page.route),
            url: target,
            pattern: routePattern(page.route),
            name: page.name,
            source: page.source.filePath,
            hash: hashFor(page.source.filePath),
            sources: ['source'],
          })
      }
      // Source and runtime discovery complement each other rather than
      // compete: always crawl, even when source routes already exist —
      // source wins on conflicting fields (see addRoute's merge policy),
      // but a route only reachable by clicking through the live app must
      // still be found.
      await collectRuntimeRoutes(
        url,
        input.profile,
        win,
        model,
        undefined,
        routes,
        hashes,
        sourceWarnings,
      )
      const landingPath = runtimeRoutePath(url, url)
      if (!routes.has(landingPath) && safeRoute(url, url)) routes.set(landingPath, {
        url, pattern: landingPath, name: info.heading || info.title || landingPath, sources: ['runtime'],
      })
      const runtimeWarnings = [...new Set(sourceWarnings)]
      approved = {
        token: crypto.randomUUID(),
        routes: [...routes.values()],
        origin: new URL(url).origin,
        projectId: active.projectId,
        profile: input.profile,
      }
      return {
        token: approved.token,
        routes: approved.routes,
        components: model?.statistics.components ?? 0,
        layouts: model?.statistics.layouts ?? 0,
        warnings: [
          ...runtimeWarnings,
          ...((model?.components ?? []).some((c) =>
            /modal|dialog|drawer|popover|sheet/i.test(c.name),
          )
            ? [
                'Overlay components found in source: ' +
                  (model?.components ?? [])
                    .filter((c) =>
                      /modal|dialog|drawer|popover|sheet/i.test(c.name),
                    )
                    .map((c) => c.name)
                    .slice(0, 20)
                    .join(', ') +
                  '. They must be present in the rendered page to capture their appearance.',
              ]
            : []),
          ...(info.images ? [`${info.images} images have not loaded.`] : []),
          ...(network.get(win.webContents.id)?.failures.length
            ? [
                'Some application resources could not load. Review the signed-in page before capturing.',
              ]
            : []),
        ],
      }
    } finally {
      win.destroy()
    }
  })
  ipcMain.handle('design:addRoute', (_event, raw) => {
    const { token, address } = z
      .object({ token: z.string(), address: z.string().min(1) })
      .parse(raw)
    if (
      !approved ||
      approved.token !== token ||
      approved.projectId !== getActiveProject()?.projectId
    )
      throw new Error('Discover the application first.')
    const url = new URL(address, approved.origin).href
    if (!safeRoute(url, approved.origin))
      throw new Error(
        'Use a normal page address in the connected application, without action parameters.',
      )
    const model = getCachedIndex()?.projectModel,
      match = matchRoutePattern(url, model?.routes ?? [])
    const page = model?.pages.find((p) => p.id === match?.route.pageId),
      pattern = match?.route.path ?? new URL(url).pathname
    const route: CaptureRoute = {
      url,
      pattern,
      name: page?.name ?? pattern,
      source: page?.source.filePath,
      hash: sourceHash(page?.source.filePath),
      sources: ['manual'],
    }
    approved.routes = approved.routes.filter((r) => r.pattern !== pattern)
    approved.routes.push(route)
    return approved.routes
  })
  ipcMain.handle('design:captureCurrentState', async (event, raw) => {
    const {guestId} = z.object({guestId:z.number().int().positive()}).parse(raw)
    const guest = electron.webContents.fromId(guestId)
    if (!guest || guest.hostWebContents !== event.sender || guest.getType() !== 'webview') throw new Error('The capture browser is no longer available.')
    if (!['standard', 'admin', 'super-admin'].some(profile => guest.session === electron.session.fromPartition(partition(profile)))) throw new Error('The capture browser belongs to another project.')
    const url = runtimeUrl.parse(guest.getURL())
    const project = getActiveProject()
    if (!project) throw new Error('Open a project before capturing.')
    const sendStage = (stage: CaptureStage) => { if (!event.sender.isDestroyed()) event.sender.send('design:captureStage', stage) }
    if(capturing)throw new Error('Wait for the current capture to finish.')
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])
    capturing=true;captureAbort=controller;captureOwner=event.sender.id
    const execute=(script:string)=>abortable(guest.executeJavaScript(script),signal)
    try {
    sendStage('layout')
    const position = await execute('({x:scrollX,y:scrollY})') as {x:number;y:number}
    let freezeKey: string | undefined
    let root: CapturedElement
    let domSnapshotRoot: CapturedElement | undefined
    let metadata: {title:string;heading?:string;width:number;height:number}
    let fullScreenshot: Electron.NativeImage
    const domSnapshotStartedAt = performance.now()
    const warnings: string[] = []
    try {
      await execute(WAIT_FOR_CAPTURE_SCRIPT)
      await scrollToSettle({ webContents: guest }, signal)
      await execute(SETTLE_REVEALS_SCRIPT)
      // Pausing retains animation fill styles; animation:none resets animated
      // content to its hidden starting style on many reveal implementations.
      freezeKey = await abortable(guest.insertCSS('*, *::before, *::after { transition: none !important; animation-play-state: paused !important; }'),signal)
      metadata = await execute(`({title:document.title,heading:document.querySelector('main h1,h1')?.textContent?.trim(),width:innerWidth,height:innerHeight})`)
      domSnapshotRoot = await captureDomSnapshot(guest, { width: metadata.width, height: metadata.height }, signal)
      root = domSnapshotRoot
      if (domSnapshotRoot) await embedIframeFallbacks(guest, domSnapshotRoot, signal, warnings)
      sendStage('screenshot')
      fullScreenshot = electron.nativeImage.createFromDataURL(await captureFullPageScreenshot({webContents:guest},signal))
    } finally {
      if (!guest.isDestroyed()) {
        await abortable(guest.executeJavaScript(RESTORE_REVEALS_SCRIPT),AbortSignal.timeout(500)).catch(()=>{})
        if (freezeKey) await abortable(guest.removeInsertedCSS(freezeKey),AbortSignal.timeout(500)).catch(() => {})
        await abortable(guest.executeJavaScript(`window.scrollTo({left:${position.x},top:${position.y},behavior:"instant"})`),AbortSignal.timeout(500)).catch(() => {})
      }
    }
    const thumbnail = fullScreenshot.resize({width:720}).toDataURL()
    sendStage('assets')
    if (guest.getURL() !== url || getActiveProject()?.projectId !== project.projectId) throw new Error('The page or project changed during capture. Try again.')
    runtimeUrl.parse(guest.getURL())
    const fonts = await captureResources(guest, root, url, AbortSignal.any([signal,AbortSignal.timeout(30000)]), new Map(), warnings)
    if (guest.getURL() !== url || getActiveProject()?.projectId !== project.projectId) throw new Error('The page or project changed during capture. Try again.')
    const captureName = metadata.heading || metadata.title || url
    let structured: StructuredFrame | undefined
    if (domSnapshotRoot) {
      // Awaited: the caller (CaptureWorkspace.tsx) needs `structured` on
      // this response to attach it to the real saved page. A failure here
      // degrades gracefully — `structured` stays undefined and that one
      // page falls back to the legacy SVG render route.
      const captured = await buildStructuredCapture(project.projectId, domSnapshotRoot, root, {
        name: captureName, route: url, width: metadata.width, height: metadata.height, startedAt: domSnapshotStartedAt,
      }, fonts)
      structured = captured?.frame
      if(captured)warnings.push(...captured.warnings);else warnings.push('Capture review: editable layer compilation failed. Recapture this screen before handoff.')
      // Stage 4: heavier than the compile+write above (spawns another
      // hidden window, real render + screenshot + Pixelmatch) — stays
      // fire-and-forget even though the compile+write itself is now awaited.
      if (captured) await scheduleVisualMatch(captured, fullScreenshot.toPNG())
      structured = captured?.frame
      if(structured?.captureMetadata.visualMatch&&structured.captureMetadata.visualMatch.diffPercent>2)warnings.push(`Visual comparison found ${structured.captureMetadata.visualMatch.diffPercent.toFixed(1)}% differing pixels. Native layers were preserved; review the capture against your app.`)
    }
    signal.throwIfAborted()
    return {root,metadata,thumbnail,fullPageScreenshot:referenceImage(fullScreenshot.toDataURL()),canvasPreview:referenceImage(fullScreenshot.toDataURL(),480),fonts,url,warnings:[...new Set(warnings)],structured}
    } finally {capturing=false;captureAbort=null;captureOwner=null}
  })
  // Stage 3 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
  // dev-only read-back for the debug files `writeStructuredCapture` writes.
  // Lists every structured capture for a project by reading each document's
  // own frame metadata — no filename parsing needed, and no schema
  // validation on the way back out (this feeds a debug-only preview with no
  // other consumer; a malformed file just gets skipped rather than crashing
  // the list).
  ipcMain.handle('design:listStructuredCaptures', (_e, raw) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(raw)
    const dir = getStructuredCapturesDir(app.getPath('userData'), projectId)
    const results: { baseName: string; route: string; viewport: string; name: string; capturedAt: string; hasLegacy: boolean; visualMatchPercent?: number }[] = []
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json') || entry.endsWith('.legacy.json')) continue
      const baseName = entry.slice(0, -'.json'.length)
      const doc = readJsonFile<{ frames: { sourceRoute: string; viewport: string; name: string; captureMetadata: { capturedAt: string; visualMatch?: { diffPercent: number } } }[] } | null>(path.join(dir, entry), null)
      const frame = doc?.frames[0]
      if (!frame) continue
      results.push({
        baseName,
        route: frame.sourceRoute,
        viewport: frame.viewport,
        name: frame.name,
        capturedAt: frame.captureMetadata.capturedAt,
        hasLegacy: fs.existsSync(path.join(dir, `${baseName}.legacy.json`)),
        visualMatchPercent: frame.captureMetadata.visualMatch ? 100 - frame.captureMetadata.visualMatch.diffPercent : undefined,
      })
    }
    return results.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  })
  ipcMain.handle('design:loadStructuredCapture', (_e, raw) => {
    const { projectId, baseName } = z.object({ projectId: z.string(), baseName: idSchema }).parse(raw)
    const dir = getStructuredCapturesDir(app.getPath('userData'), projectId)
    const structured = readJsonFile<import('@shared/types/structuredDesign').StructuredDesignDocument | null>(path.join(dir, `${baseName}.json`), null)
    if (!structured) return null
    const legacy = readJsonFile<{ objects: VisualObject[]; fonts: VisualPage['fonts'] } | null>(path.join(dir, `${baseName}.legacy.json`), null)
    const readPngDataUrl = (kind: 'original' | 'render' | 'diff') => {
      const file = path.join(dir, `${baseName}.${kind}.png`)
      return fs.existsSync(file) ? `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` : undefined
    }
    const images = { original: readPngDataUrl('original'), render: readPngDataUrl('render'), diff: readPngDataUrl('diff') }
    return { structured, legacy: legacy ?? undefined, images: Object.values(images).some(Boolean) ? images : undefined }
  })
  // Additive, opt-in follow-up to `design:captureCurrentState`: forces
  // hover/focus/active on the objects the renderer already normalized and
  // returns them enriched with variants. Separate from that handler's
  // return shape entirely — the live capture flow calls this right after
  // its own `normalizeVisual()`, once it has a `VisualObject[]` to enrich.
  // The single biggest reason this exists as automatic capture at all:
  // clicking the in-app "Capture screen" button requires moving the mouse
  // off whatever's hovered in the live webview, so a real :hover state is
  // otherwise impossible to preserve manually on this path.
  ipcMain.handle('design:captureLiveVisualStates', async (event, raw) => {
    const { guestId, objects } = z.object({ guestId: z.number().int().positive(), objects: z.array(visualObjectSchema) }).parse(raw)
    const guest = electron.webContents.fromId(guestId)
    if (!guest || guest.hostWebContents !== event.sender || guest.getType() !== 'webview') throw new Error('The capture browser is no longer available.')
    if (!['standard', 'admin', 'super-admin'].some(profile => guest.session === electron.session.fromPartition(partition(profile)))) throw new Error('The capture browser belongs to another project.')
    runtimeUrl.parse(guest.getURL())
    const cloned = structuredClone(objects)
    await captureVisualStates(guest, cloned)
    return cloned
  })
  ipcMain.handle('design:cancelCapture', (event) => {
    if (captureOwner !== event.sender.id) return { ok: false }
    captureAbort?.abort(new Error('Capture cancelled'))
    for (const win of captureWindows) if (!win.isDestroyed()) win.destroy()
    return { ok: true }
  })
  ipcMain.handle('design:capture', async (event, raw) => {
    const input = z
      .object({
        token: z.string(),
        transport:z.literal('json').optional(),
        artifactImportId:z.string().uuid().optional(),
        overlays: z.boolean().default(false),
        routes: z.array(z.string()).optional(),
        controlStates: z.boolean().default(false),
        widths: z.array(z.number().int().min(240).max(3840)).min(1).max(4),
        unchanged: z
          .array(z.object({ route: z.string(), hash: z.string() }))
          .default([]),
      })
      .parse(raw)
    if (
      capturing ||
      !approved ||
      approved.token !== input.token ||
      approved.projectId !== (input.artifactImportId?importProject(event.sender.id,input.artifactImportId).projectId:getActiveProject()?.projectId)
    )
      throw new Error(
        'Discover the application and approve this capture first.',
      )
    const plan = approved
    const captureProject=input.artifactImportId?importProject(event.sender.id,input.artifactImportId):getActiveProject()
    const projectIndex=getActiveProject()?.projectId===plan.projectId?getCachedIndex():null
    const importAbort=input.artifactImportId?importSignal(event.sender.id,input.artifactImportId):undefined
    capturing = true
    const controller = new AbortController()
    captureAbort = controller
    captureOwner = event.sender.id
    const stopImport=()=>controller.abort(importAbort?.reason)
    importAbort?.addEventListener('abort',stopImport,{once:true})
    const signal = controller.signal
    const startedAt = performance.now()
    const jobs = plan.routes
      .filter(r => !r.needsSample && (!input.routes || input.routes.includes(r.pattern)))
      .filter(
        (r) =>
          !input.unchanged.some(
            (p) => p.route === r.pattern && p.hash === r.hash,
          ),
      )
      .flatMap((r) => [...new Set(input.widths)].map((width) => ({ r, width })))
    const pages: VisualPage[] = []
    const imageCache = new Map<string, Promise<string>>()
    let next = 0,
      completed = 0,
      structuredDocuments = 0
    const progress = (p: CaptureProgress) => {
      if (!event.sender.isDestroyed()) event.sender.send('design:progress', {...p,artifactImportId:input.artifactImportId})
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, jobs.length) }, async () => {
          while (next < jobs.length && !signal.aborted) {
            const { r, width } = jobs[next++]
            let win: Electron.BrowserWindow | undefined
            progress({
              completed,
              total: jobs.length,
              name: r.name,
              route: r.pattern,
              width,
              status: 'Processing',
            })
            try {
              win = await browser(r.url, width, heightForWidth(width), signal, plan.profile,captureProject)
              if (new URL(win.webContents.getURL()).origin !== plan.origin)
                throw new Error('The page left the connected application.')
              const finalPath = runtimeRoutePath(win.webContents.getURL())
              const requestedPath = runtimeRoutePath(r.url)
              if (finalPath !== requestedPath)
                throw new Error(
                  `This route redirects to ${finalPath}. Capture that destination instead; the redirected screen was not saved as ${r.name}.`,
                )
              if(plan.artifactSteps?.[r.pattern])await replayPrototype(win.webContents,plan.artifactSteps[r.pattern],signal)
              if(plan.artifactSteps)await abortable(win.webContents.executeJavaScript(EXPAND_ARTIFACT_PANELS_SCRIPT),signal)
              await scrollToSettle(win, signal)
              await abortable(win.webContents.executeJavaScript(SETTLE_REVEALS_SCRIPT),signal)
              const fullPageScreenshot = await captureFullPageScreenshot(win, signal)
              const [viewportWidth, viewportHeight] = win.getContentSize()
              const domSnapshotStartedAt = performance.now()
              const root = await captureDomSnapshot(win.webContents, { width: viewportWidth, height: viewportHeight }, signal)
              const screenshot = await abortable(win.webContents.capturePage(), AbortSignal.any([signal,AbortSignal.timeout(30000)]))
              const captureWarnings: string[] = []
              const fonts = await captureResources(win.webContents, root, r.url, signal, imageCache, captureWarnings)
              const objects = normalizeVisual(root, {
                file: r.source,
                route: r.pattern,
              })
              visit(objects, (o) => {
                if (o.source?.component) {
                  const match = projectIndex?.projectModel.components.find(
                    (c) =>
                      c.name.replace(/([a-z])([A-Z])/g, '$1 $2') ===
                      o.source?.component,
                  )
                  if (match) o.source.file = match.source.filePath
                }
              })
              // Stage 2 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md): unlike the
              // interactive path's fire-and-forget version, this is awaited
              // — batch capture is explicitly meant to build the broad
              // regression-fixture sample this stage exists to produce, so
              // losing writes to unawaited-task teardown would defeat the
              // point. Its own try/catch means a compiler bug can never
              // fail the job or block the real `pages.push(...)` below.
              // Stage 3: bundles the `objects`/`fonts` just computed above
              // (the exact same `root`) as the paired legacy debug file.
              let captured: ReturnType<typeof writeStructuredCapture> | undefined
              try {
                captured = writeStructuredCapture(plan.projectId, root, {
                  name: r.name,
                  route: r.pattern,
                  width: viewportWidth,
                  height: viewportHeight,
                  durationMs: Math.round(performance.now() - domSnapshotStartedAt),
                }, { objects, fonts }, projectIndex?.projectModel.tokens, projectIndex?.projectModel.components)
                structuredDocuments++
              } catch { captureWarnings.push('Capture review: editable layer compilation failed. Recapture this screen before handoff.') }
              if (input.controlStates) await captureVisualStates(win.webContents, objects)
              signal.throwIfAborted()
              // Stage 4: heavier than the compile+write above (spawns
              // another hidden window, real render + screenshot +
              // Pixelmatch) — fire-and-forget even on this otherwise-awaited
              // path, with the job's own `signal` so an aborted run doesn't
              // leave a stray render window behind.
              if(captured)captureWarnings.push(...captured.warnings)
              if (captured) await scheduleVisualMatch(captured, screenshot.toPNG(), signal)
              if(captured?.frame.captureMetadata.visualMatch&&captured.frame.captureMetadata.visualMatch.diffPercent>2)captureWarnings.push(`Visual comparison found ${captured.frame.captureMetadata.visualMatch.diffPercent.toFixed(1)}% differing pixels. Native layers were preserved; review the capture against your app.`)
              pages.push({
                id: crypto.randomUUID(),
                name: r.name,
                authProfile: plan.profile,
                folder:
                  new URL(r.url).pathname
                    .split('/')
                    .filter(Boolean)
                    .slice(0, -1)
                    .map((part) =>
                      part
                        .replace(/[-_]/g, ' ')
                        .replace(/\b\w/g, (c) => c.toUpperCase()),
                    )
                    .join(' / ') || 'Application',
                pinned: false,
                state:
                  width >= 1100
                    ? 'Desktop'
                    : width >= 600
                      ? 'Tablet'
                      : 'Mobile',
                route: r.pattern,
                ...(plan.artifactSteps ? {artifactSource:{path:new URL(r.url).pathname+new URL(r.url).search+new URL(r.url).hash,steps:plan.artifactSteps[r.pattern]??[]}} : {}),
                sourceHash: r.hash,
                capturedAt: new Date().toISOString(),
                width,
                height: Math.max(1, Math.ceil(root.rect.height)),
                fonts,
                captureWarnings: [...new Set(captureWarnings)],
                objects,
                // The real, live-canvas-rendered content — `objects` above
                // stays populated regardless, for SVG export, the Layers
                // panel, and the legacy render route (old saved documents).
                structured: captured?.frame,
                thumbnail: referenceImage(screenshot.toDataURL(),360),
                fullPageScreenshot: referenceImage(fullPageScreenshot,width),
                canvasPreview: (()=>{const image=electron.nativeImage.createFromDataURL(fullPageScreenshot),size=image.getSize();const height=Math.min(size.height,Math.ceil(root.rect.height*size.width/width));const cropped=image.crop({x:0,y:0,width:size.width,height:Math.max(1,height)});return 'data:image/jpeg;base64,'+cropped.resize({width:Math.max(1,Math.min(480,Math.floor(size.width*2048/Math.max(1,height))))}).toJPEG(88).toString('base64')})(),
              })
              if (input.overlays)
                await captureOverlays(win, async (name) => {
                  const [overlayWidth, overlayHeight] = win!.getContentSize()
                  const overlayRoot = await captureDomSnapshot(win!.webContents, { width: overlayWidth, height: overlayHeight }, signal)
                  await captureResources(win!.webContents, overlayRoot, r.url, signal, imageCache)
                  const overlayObjects = normalizeVisual(overlayRoot, {
                    file: r.source,
                    route: r.pattern,
                  })
                  if (input.controlStates) await captureVisualStates(win!.webContents, overlayObjects)
                  signal.throwIfAborted()
                  const thumbnail = await abortable(win!.webContents.capturePage(), AbortSignal.any([signal,AbortSignal.timeout(30000)]))
                  pages.push({
                    id: crypto.randomUUID(),
                    name: r.name,
                    authProfile: plan.profile,
                    folder: pages.find(p => p.route === r.pattern)?.folder || 'Application',
                    pinned: false,
                    state: `${width >= 1100 ? 'Desktop' : width >= 600 ? 'Tablet' : 'Mobile'} · ${name}`,
                    route: r.pattern,
                    sourceHash: r.hash,
                    capturedAt: new Date().toISOString(),
                    width,
                    height: Math.max(1,Math.ceil(overlayRoot.rect.height)),
                    fonts,
                    objects: overlayObjects,
                    thumbnail: thumbnail.resize({ width: 360 }).toDataURL(),
                  })
                })
              completed++
              progress({
                completed,
                total: jobs.length,
                name: r.name,
                route: r.pattern,
                width,
                status: 'Complete',
                ...(input.artifactImportId?{thumbnail:pages.find(p=>p.route===r.pattern&&p.width===width)?.thumbnail}:{}),
              })
            } catch (error) {
              if (signal.aborted) break
              completed++
              progress({
                completed,
                total: jobs.length,
                name: r.name,
                route: r.pattern,
                width,
                status: 'Failed',
                error: error instanceof Error ? error.message : String(error),
              })
            } finally {
              if (win && !win.isDestroyed()) win.destroy()
            }
          }
        }),
      )
      return input.transport==='json'?JSON.stringify(packDocument(pages)):pages
    } finally {
      console.info('[FrameUI capture]', { durationMs: Math.round(performance.now() - startedAt), jobs: jobs.length, completed, variants: pages.length, cancelled: signal.aborted, structuredDocuments })
      importAbort?.removeEventListener('abort',stopImport)
      captureAbort = null
      captureOwner = null
      capturing = false
    }
  })
}
