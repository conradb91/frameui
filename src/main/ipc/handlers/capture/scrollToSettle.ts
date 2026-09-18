import type { WebContents } from 'electron'
import { scrollStepScript, scrollToTopScript } from '../../../../renderer/lib/captureScript'
import { raceAbort } from './raceAbort'

export const SCROLL_STEP_RATIO = 0.75
export const STABLE_HEIGHT_PASSES = 3
export const DOM_QUIET_WINDOW_MS = 350
export const POST_SCROLL_MAX_WAIT_MS = 5000
export const MAX_SCROLL_PASSES = 120

/**
 * Scrolls through the page once to trigger lazy-loaded/`IntersectionObserver`
 * content, waiting for DOM+image quiescence after each step, until document
 * height stops growing for `STABLE_HEIGHT_PASSES` consecutive passes (or
 * `MAX_SCROLL_PASSES` is hit) — then returns the page to its original top
 * scroll position.
 *
 * A single `DOMSnapshot` capture taken after this call already reflects
 * everything meaningful: Chromium computes layout for the whole document
 * regardless of scroll position, so content that's simply below the fold
 * needs no special handling at all — only content that doesn't exist in the
 * DOM until scrolled into view needs this step to run first. No multi-capture
 * merge is needed as a result (virtualized lists, where old content is
 * evicted rather than just added, are a separate, deliberately deferred
 * problem).
 */
export async function scrollToSettle(
  win: { webContents: WebContents },
  signal: AbortSignal,
): Promise<void> {
  const { scrollHeight, viewportHeight } = (await raceAbort(
    win.webContents.executeJavaScript(
      '({scrollHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight})',
    ),
    signal,
  )) as { scrollHeight: number; viewportHeight: number }
  // Even a short page needs a font/image/animation settle pass.
  if (scrollHeight <= viewportHeight + 1) {
    await raceAbort(win.webContents.executeJavaScript(scrollToTopScript(POST_SCROLL_MAX_WAIT_MS, DOM_QUIET_WINDOW_MS)), signal)
    return
  }
  const stepPx = Math.max(1, Math.round(viewportHeight * SCROLL_STEP_RATIO))
  let lastHeight = -1
  let stablePasses = 0
  let reachedEnd = false
  for (let pass = 0; pass < MAX_SCROLL_PASSES; pass++) {
    const position = (await raceAbort(
      win.webContents.executeJavaScript(
        scrollStepScript(stepPx, POST_SCROLL_MAX_WAIT_MS, DOM_QUIET_WINDOW_MS),
      ),
      signal,
    )) as { height: number; bottom: boolean }
    // A fixed-height page may contain many viewports of lazy content. Height
    // stability is only meaningful after we have actually visited the end.
    if (position.height === lastHeight && position.bottom) {
      if (++stablePasses >= STABLE_HEIGHT_PASSES) { reachedEnd = true; break }
    } else {
      stablePasses = 0
      lastHeight = position.height
    }
  }
  if (!reachedEnd) throw new Error('This page keeps growing or is too long to capture completely. Open a shorter page or stop infinite scrolling and try again.')
  await raceAbort(
    win.webContents.executeJavaScript(
      scrollToTopScript(POST_SCROLL_MAX_WAIT_MS, DOM_QUIET_WINDOW_MS),
    ),
    signal,
  )
}
