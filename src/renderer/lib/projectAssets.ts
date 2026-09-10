import type { Page } from '@shared/types/model/projectModel'
import type { PageStructureItem } from '@shared/types/pageStructure'
export interface ProjectAsset { id: string; name: string; category: string; sourceFilePath: string; structure: PageStructureItem[] }
/** Reusable native UI observed in the project, including PHP template markup. */
export function projectAssets(pages: Page[]): ProjectAsset[] {
  const assets: ProjectAsset[] = []; const seen = new Set<string>()
  function visit(items: PageStructureItem[], page: Page, parent: string) {
    items.forEach((item, i) => {
      const path = `${parent}.${i}`; const tag = item.tagName.toLowerCase()
      const classes = item.attributes?.class ?? item.attributes?.className ?? ''
      const category = tag === 'button' || (tag === 'a' && /btn|button/i.test(classes)) ? 'Buttons' : ['input', 'textarea', 'select'].includes(tag) ? 'Inputs' : tag === 'form' ? 'Forms' : tag === 'nav' ? 'Navigation' : /(?:^|\s)(?:card|panel)(?:\s|[-_]|$)/i.test(classes) ? 'Cards' : tag === 'dialog' || /modal|dialog/i.test(classes) ? 'Modals' : null
      if (category) {
        const signature = `${tag}:${classes}:${item.attributes?.type ?? ''}`
        if (!seen.has(signature)) {
          seen.add(signature)
          assets.push({ id: `pattern:${page.id}${path}`, category, name: item.textPreview?.slice(0, 40) || item.attributes?.placeholder || classes.split(/\s+/).find(Boolean) || `${category.slice(0, -1)} from ${page.name}`, sourceFilePath: page.source.filePath, structure: [item] })
        }
      }
      visit(item.children, page, path)
    })
  }
  for (const page of pages) visit(page.structure, page, '')
  return assets.slice(0, 300)
}
