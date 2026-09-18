import type { VisualPage } from '@shared/types/visualDesign'
export type Viewport = 'All' | 'Desktop' | 'Tablet' | 'Mobile'
export function viewportOf(page: VisualPage): Exclude<Viewport, 'All'> {
  const state = /^(Desktop|Tablet|Mobile)\b/i.exec(page.state)?.[1]
  return state ? (state[0].toUpperCase() + state.slice(1).toLowerCase()) as Exclude<Viewport, 'All'> : page.width < 600 ? 'Mobile' : page.width < 1024 ? 'Tablet' : 'Desktop'
}
export function groupPages(pages: VisualPage[]) {
  const groups = new Map<string, { key: string; name: string; route: string; group: string; pages: VisualPage[] }>()
  for (const page of pages) {
    const key = `${page.route || page.id}\u0000${page.authProfile || 'standard'}`
    const route = page.route || ''
    let pathname = route
    try { pathname = new URL(route, 'http://local').pathname } catch { /* display original route */ }
    const segment = pathname.split('/').filter(Boolean)[0]
    const group = /^(login|signin|register|forgot-password|reset-password)$/.test(segment || '') ? 'Authentication' : page.folder && page.folder !== 'Application' ? page.folder : segment ? segment[0].toUpperCase() + segment.slice(1).replace(/[-_]/g, ' ') : 'Home'
    if (!groups.has(key)) groups.set(key, { key, name: page.name, route, group, pages: [] })
    groups.get(key)!.pages.push(page)
  }
  return [...groups.values()]
}
export function detectedAssets(pages: VisualPage[]) {
  const found = new Map<string, VisualPage['objects'][number]>()
  function walk(objects: VisualPage['objects']) { for (const o of objects) { if (['Image','Icon','Vector'].includes(o.kind)) found.set(o.src || o.path || o.id, o); walk(o.children) } }
  pages.forEach(p => walk(p.objects))
  return [...found.values()]
}
