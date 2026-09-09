import type { ComponentIntelligence, DetectedComponentFixture, PreviewCacheEntry } from '@shared/types/designSystem'

function stableProps(props: Record<string, string>): string {
  return Object.keys(props).sort().map((key) => `${key}=${props[key]}`).join('&')
}

function fixtureHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Cache scope is deliberately local to a component, its relevant source/token
 * dependencies and the selected fixture. Unrelated project edits remain valid. */
export function previewDependencyFingerprint(component: ComponentIntelligence, fixture: DetectedComponentFixture | null): string {
  return `${component.dependencyFingerprint}:${fixture ? fixtureHash(stableProps(fixture.props)) : 'no-fixture'}`
}

export function validCachedPreview(entries: PreviewCacheEntry[], component: ComponentIntelligence, fixture: DetectedComponentFixture | null): PreviewCacheEntry | null {
  const expected = previewDependencyFingerprint(component, fixture)
  return entries.find((entry) => entry.componentId === component.componentId && entry.fixtureId === (fixture?.id ?? null) && entry.dependencyFingerprint === expected) ?? null
}
