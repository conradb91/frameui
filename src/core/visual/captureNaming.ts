import type { CapturedElement } from '@shared/types/runtimeCapture'
import { humanizeComponentName } from '@core/adapters/react/pageName'

const LANDMARK_ROLES = new Set(['main', 'region', 'dialog', 'alertdialog'])

function walk(el: CapturedElement, visit: (el: CapturedElement) => void) {
  visit(el)
  for (const child of el.children) walk(child, visit)
}

/** Pulls a screen-naming signal out of a raw capture: an authored ARIA
 * landmark label (deliberate, high-confidence) and a matched repository
 * component's name (real evidence, but generic — many screens can share a
 * component like "DetailPage"). Depth-first, so the outermost matching
 * element wins over one nested deeper inside it. Feeds `resolvePageName`'s
 * evidence chain; never a naming decision on its own. */
export function deriveCaptureNameEvidence(root: CapturedElement): { ariaLabel?: string; component?: string } {
  let ariaLabel: string | undefined
  let component: string | undefined
  walk(root, (el) => {
    if (!ariaLabel) {
      const role = el.aria?.role ?? (el.tag === 'main' ? 'main' : undefined)
      const label = el.aria?.['aria-label']
      if (label && role && LANDMARK_ROLES.has(role)) ariaLabel = label
    }
    if (!component && el.componentHint && /(Page|Screen|View|Route)$/.test(el.componentHint)) {
      component = humanizeComponentName(el.componentHint)
    }
  })
  return { ariaLabel, component }
}
