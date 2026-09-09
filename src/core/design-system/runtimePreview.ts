import type { CapturedElement, CapturedPage } from '@shared/types/runtimeCapture'
import type { Component, Page, RoutePattern } from '@shared/types/model/projectModel'
import type { ComponentIntelligence, RuntimeComponentRelationship } from '@shared/types/designSystem'

const key = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase()
const safeText = (value: string | undefined) => value && /(?:bearer\s+|api[_-]?key|password|secret|card\s*number|\b\d{13,19}\b)/i.test(value) ? '[redacted]' : value

export function sanitizeRuntimeElement(element: CapturedElement): CapturedElement {
  return { ...element, id: undefined, textPreview: safeText(element.textPreview), aria: element.aria ? Object.fromEntries(Object.entries(element.aria).filter(([name]) => !/value|token|secret/i.test(name))) : undefined, children: element.children.map(sanitizeRuntimeElement) }
}

function flatten(element: CapturedElement, path: number[] = []): { element: CapturedElement; path: number[] }[] {
  return [{ element, path }, ...element.children.flatMap((child, index) => flatten(child, [...path, index]))]
}
function signature(element: CapturedElement): string {
  const shape = JSON.stringify([element.tag, Math.round(element.rect.width / 4) * 4, Math.round(element.rect.height / 4) * 4, element.styles.display, element.styles.backgroundColor, element.styles.borderRadius, element.children.map((child) => child.tag)])
  // FNV-1a is sufficient for a visual deduplication key and, unlike Node's
  // crypto module, is safe in the isolated Electron renderer too.
  let hash = 2166136261
  for (let index = 0; index < shape.length; index++) { hash ^= shape.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
function routePage(capture: CapturedPage, pages: Page[]): Page | null {
  let pathname = ''; try { pathname = new URL(capture.url).pathname } catch { return null }
  return pages.find((page) => page.route && new RegExp(`^${page.route.replace(/:[^/]+|\[[^\]]+\]/g, '[^/]+')}/?$`).test(pathname)) ?? null
}

/** Conservative runtime association: explicit data-component hints or a
 * class/custom-element name matching the stable component identity. */
export function findRuntimeRelationships(captures: CapturedPage[], component: Component, intelligence: ComponentIntelligence, pages: Page[], routes: RoutePattern[]): RuntimeComponentRelationship[] {
  const componentName = key(component.name)
  const relationships: RuntimeComponentRelationship[] = []
  const seenSignatures = new Set<string>()
  for (const capture of captures) {
    const page = routePage(capture, pages)
    const pageIsKnownUsage = !page || intelligence.usages.some((usage) => usage.pageId === page.id)
    for (const item of flatten(capture.root)) {
      const classKeys = (item.element.classes ?? '').split(/\s+/).map(key)
      const explicit = key(item.element.componentHint ?? '') === componentName || key(item.element.tag) === componentName
      const classMatch = classKeys.includes(componentName)
      if (!explicit && !(pageIsKnownUsage && classMatch)) continue
      const visualSignature = signature(item.element)
      if (seenSignatures.has(visualSignature)) continue
      seenSignatures.add(visualSignature)
      relationships.push({ id: `runtime.${component.id}.${capture.id}.${item.path.join('_') || 'root'}`, componentId: component.id, captureId: capture.id, pageId: page?.id ?? null, routePatternId: routes.find((route) => route.pageId === page?.id)?.id ?? null, viewport: { width: capture.root.rect.width, height: capture.root.rect.height }, stateLabel: item.element.aria?.['aria-label'] ?? item.element.componentHint ?? `Captured state ${relationships.length + 1}`, elementPath: item.path, sourceReference: component.source, visualSignature })
    }
  }
  return relationships
}

export function runtimeElementAt(capture: CapturedPage, path: number[]): CapturedElement | null {
  let element: CapturedElement | undefined = capture.root
  for (const index of path) element = element?.children[index]
  return element ? sanitizeRuntimeElement(element) : null
}
