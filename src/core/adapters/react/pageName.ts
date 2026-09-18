/** Evidence-based labels; keep the route separately for disambiguation.
 * Ordered most to least deliberate/specific: an active nav link or an
 * authored ARIA landmark label is a stronger signal of a screen's identity
 * than a generic page title (which often carries an app-name suffix) or a
 * matched component's name (which is real evidence but the most generic —
 * many screens can share a component like "DetailPage"). */
export function resolvePageName(evidence: { navigation?: string; ariaLabel?: string; metadata?: string; heading?: string; title?: string; component?: string; fallback?: string; route?: string }): string {
  for (const candidate of [evidence.navigation, evidence.ariaLabel, evidence.metadata, evidence.heading, evidence.title, evidence.component, evidence.fallback]) {
    const value = candidate?.replace(/\s+/g, ' ').trim()
    if (value && value.length <= 160 && !/^(?:loading|please wait|untitled)[.\s…]*$/i.test(value)) return value
  }
  return evidence.route?.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Home'
}
/** Humanizes a PascalCase/camelCase component name into a readable label,
 * stripping a trailing "Page"/"Screen"/"View"/"Route" suffix (the part that
 * identifies it as a page-level component, not part of its actual name) —
 * e.g. "DashboardOverviewPage" -> "Dashboard Overview". */
export function humanizeComponentName(name: string): string {
  const withoutSuffix = name.replace(/(Page|Screen|View|Route)$/, '')
  const spaced = (withoutSuffix || name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim()
  return spaced || name
}
