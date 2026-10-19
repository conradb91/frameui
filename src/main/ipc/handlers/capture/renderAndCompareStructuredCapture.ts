import fs from 'node:fs'
import path from 'node:path'
import electron from 'electron'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import type { StructuredFrame } from '@shared/types/structuredDesign'
import { renderStructuredFrameToHtml } from '@core/capture-compiler/renderStructuredFrameToHtml'
import { applyRasterFallbacks } from '@core/capture-compiler/edit'
import type { DiffMask } from '@core/capture-compiler/selectRasterFallbackCandidates'
import { selectRasterFallbackCandidates } from '@core/capture-compiler/selectRasterFallbackCandidates'
import { clipRectToViewport } from '../captureResources'
import { raceAbort } from './raceAbort'

const { BrowserWindow } = electron

export interface VisualMatchResult {
  diffPixels: number
  totalPixels: number
  diffPercent: number
}

export interface RenderAndCompareResult {
  visualMatch: VisualMatchResult
  /** Present only when Stage 9 sub-slice 3's automatic correction pass
   * (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §23) rasterized one or more
   * subtrees — callers should save this frame (and update any document
   * wrapper referencing the original object) instead of the input `frame`. */
  correctedFrame?: StructuredFrame
}

/** Skip the correction attempt below this whole-frame diff — not worth the
 * extra render+diff round-trip for an already-good render. A reasonable,
 * documented default, not derived from real-world data yet — see this
 * stage's plan for why (Stage 10's real-world testing is the intended
 * place to tune this). */
const CORRECTION_ATTEMPT_THRESHOLD_PERCENT = 2
/** That many simultaneous leaf-level failures suggests a broader rendering
 * problem selective fallback isn't meant to patch over (wrong engine,
 * mostly-blank render) — skip correction rather than rasterize a large
 * fraction of the page piecemeal. */
const MAX_CANDIDATES = 20

/**
 * Stage 4 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md
 * §20): renders `frame` for real (a hidden `BrowserWindow` loading the pure
 * HTML `renderStructuredFrameToHtml` built, screenshotted at the exact same
 * dimensions as the original capture), then Pixelmatch-diffs that render
 * against `originalPng` — the same PNG buffer the original Chromium
 * screenshot for this capture already produced.
 *
 * Stage 9 sub-slice 3 (§23): when the whole-frame diff is bad enough to be
 * worth it, also attempts one automatic correction pass — see
 * `attemptRasterFallbackCorrection` below — and returns the corrected
 * frame/diff instead of the original if that pass improved things.
 *
 * Diagnostic only: any failure anywhere in this chain returns `undefined`
 * rather than throwing, so callers can treat this as pure best-effort
 * background work.
 */
export async function renderAndCompareStructuredCapture(params: {
  frame: StructuredFrame
  originalPng: Buffer
  dir: string
  slug: string
  signal?: AbortSignal
}): Promise<RenderAndCompareResult | undefined> {
  const { frame, dir, slug, signal } = params
  let originalPng=params.originalPng
  let originalSize: PNG
  try { originalSize = PNG.sync.read(originalPng) } catch { return undefined }
  const contentPixels=Math.min(originalSize.height,Math.ceil(frame.height*originalSize.width/frame.width))
  if(contentPixels<originalSize.height){const cropped=new PNG({width:originalSize.width,height:contentPixels});PNG.bitblt(originalSize,cropped,0,0,originalSize.width,contentPixels,0,0);originalPng=PNG.sync.write(cropped);originalSize=cropped}
  const viewportHeight = Math.round(originalSize.height * frame.width / originalSize.width)
  const renderPng = await renderFrameToScreenshotPng(frame, dir, slug, signal, '', viewportHeight)
  if (!renderPng) return undefined
  const diffed = diffAgainstOriginal(originalPng, renderPng, dir, slug)
  if (!diffed) return undefined
  const { visualMatch, original, render } = diffed
  if (visualMatch.diffPercent <= CORRECTION_ATTEMPT_THRESHOLD_PERCENT) return { visualMatch }

  const corrected = await attemptRasterFallbackCorrection({ frame, originalPng, original, render, dir, slug, signal }).catch(() => undefined)
  return corrected ?? { visualMatch }
}

/**
 * Renders `frame` to a hidden `BrowserWindow`, waits for fonts/images to
 * settle, and screenshots it — the shared render step both the initial
 * diff and the post-correction re-diff use. `variant` (e.g. `'corrected'`)
 * keeps the two attempts' debug HTML files distinct on disk.
 */
async function renderFrameToScreenshotPng(
  frame: StructuredFrame,
  dir: string,
  slug: string,
  signal?: AbortSignal,
  variant = '',
  viewportHeight = frame.height,
): Promise<Buffer | undefined> {
  const suffix = variant ? `.${variant}` : ''
  const htmlPath = path.join(dir, `${slug}${suffix}.render.html`)
  try {
    fs.writeFileSync(htmlPath, renderStructuredFrameToHtml(frame), 'utf-8')
  } catch {
    return undefined
  }

  // Deliberately minimal window-creation options — unlike this file's
  // `browser()` (designIde.handlers.ts), this loads a static local file
  // with no navigation, redirects or auth to guard against.
  const win = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: frame.width,
    height: viewportHeight,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const abort = () => { if (!win.isDestroyed()) win.destroy() }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const load = win.loadFile(htmlPath)
    await (signal ? raceAbort(load, signal) : load)
    // `did-finish-load` (what `loadFile`'s promise resolves on) only
    // guarantees the HTML/CSS parse finished — inline `data:` images and
    // whatever font the browser resolved `typography.fontFamily` to can
    // still be mid-decode/layout a tick later.
    const settle = win.webContents.executeJavaScript(
      'Promise.all([document.fonts.ready, ...[...document.images].map(img => img.decode().catch(()=>{}))])',
    )
    await (signal ? raceAbort(settle, signal) : settle)
    const capture = win.webContents.capturePage()
    const renderImage = await (signal ? raceAbort(capture, signal) : capture)
    return renderImage.toPNG()
  } catch {
    return undefined
  } finally {
    signal?.removeEventListener('abort', abort)
    if (!win.isDestroyed()) win.destroy()
  }
}

function diffAgainstOriginal(
  originalPng: Buffer,
  renderPng: Buffer,
  dir: string,
  slug: string,
  variant = '',
): { visualMatch: VisualMatchResult; original: PNG; render: PNG } | undefined {
  try {
    const original = PNG.sync.read(originalPng)
    const render = PNG.sync.read(renderPng)
    if (original.width !== render.width || original.height !== render.height) return undefined
    const suffix = variant ? `.${variant}` : ''
    const diff = new PNG({ width: original.width, height: original.height })
    const diffPixels = pixelmatch(original.data, render.data, diff.data, original.width, original.height, { threshold: 0.1 })
    fs.writeFileSync(path.join(dir, `${slug}${suffix}.original.png`), originalPng)
    fs.writeFileSync(path.join(dir, `${slug}${suffix}.render.png`), renderPng)
    fs.writeFileSync(path.join(dir, `${slug}${suffix}.diff.png`), PNG.sync.write(diff))
    const totalPixels = original.width * original.height
    return {
      visualMatch: { diffPixels, totalPixels, diffPercent: totalPixels ? (diffPixels / totalPixels) * 100 : 0 },
      original,
      render,
    }
  } catch {
    return undefined
  }
}

/**
 * Stage 9 sub-slice 3 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §23) — the
 * correction attempt itself: builds a per-pixel diff mask from the
 * already-decoded `original`/`render` PNGs (no new window, no new I/O —
 * `pixelmatch` a second time with `diffMask: true`, over buffers already in
 * memory), selects candidate leaf nodes via
 * `selectRasterFallbackCandidates`, crops the ORIGINAL screenshot (ground
 * truth pixels) to each candidate's rect via `PNG.bitblt`, and — only if
 * anything qualified — re-renders and re-diffs the corrected frame once to
 * confirm/report the improvement. Never throws (the caller wraps this in
 * `.catch()`); returns `undefined` on any failure or when nothing
 * qualified, so the caller falls back to the original, still-valid
 * diagnostic rather than losing it.
 */
async function attemptRasterFallbackCorrection(params: {
  frame: StructuredFrame
  originalPng: Buffer
  original: PNG
  render: PNG
  dir: string
  slug: string
  signal?: AbortSignal
}): Promise<RenderAndCompareResult | undefined> {
  const { frame, originalPng, original, render, dir, slug, signal } = params
  const pixelMask = buildDiffMask(original, render)
  const pixelScale=original.width/frame.width
  const mask:DiffMask={width:frame.width,height:original.height/pixelScale,hasDiff:(x,y)=>pixelMask.hasDiff(Math.floor(x*pixelScale),Math.floor(y*pixelScale))}
  const candidates = selectRasterFallbackCandidates(frame, mask)
  if (!candidates.length || candidates.length > MAX_CANDIDATES) return undefined

  const patches: { id: string; imageSrc: string }[] = []
  for (const candidate of candidates) {
    const rect = clipRectToViewport({x:candidate.rect.x*pixelScale,y:candidate.rect.y*pixelScale,width:candidate.rect.width*pixelScale,height:candidate.rect.height*pixelScale}, { width: original.width, height: original.height })
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    if (width <= 0 || height <= 0) continue
    const cropped = new PNG({ width, height })
    PNG.bitblt(original, cropped, Math.round(rect.x), Math.round(rect.y), width, height, 0, 0)
    patches.push({ id: candidate.nodeId, imageSrc: `data:image/png;base64,${PNG.sync.write(cropped).toString('base64')}` })
  }
  if (!patches.length) return undefined

  const correctedFrame = applyRasterFallbacks(frame, patches)
  const correctedRenderPng = await renderFrameToScreenshotPng(correctedFrame, dir, slug, signal, 'corrected', Math.round(original.height * frame.width / original.width))
  if (!correctedRenderPng) return undefined
  const diffed = diffAgainstOriginal(originalPng, correctedRenderPng, dir, slug, 'corrected')
  if (!diffed) return undefined
  return { visualMatch: diffed.visualMatch, correctedFrame }
}

/**
 * A second, in-memory-only `pixelmatch` pass over already-decoded buffers,
 * with `diffMask: true` — draws ONLY the differing pixels (non-zero
 * alpha); everything else is fully transparent. Exactly the shape
 * `selectRasterFallbackCandidates`'s `DiffMask` needs. Not derived from
 * the default-visualization diff `diffAgainstOriginal` already computed:
 * in default mode, non-diff pixels are blended with a dimmed original
 * color at FULL alpha too, so alpha alone can't distinguish "differs" from
 * "doesn't" there — only in `diffMask` mode.
 */
function buildDiffMask(original: PNG, render: PNG): DiffMask {
  const mask = new PNG({ width: original.width, height: original.height })
  pixelmatch(original.data, render.data, mask.data, original.width, original.height, { threshold: 0.1, diffMask: true })
  const { width, height, data } = mask
  return {
    width,
    height,
    hasDiff: (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] > 0,
  }
}
