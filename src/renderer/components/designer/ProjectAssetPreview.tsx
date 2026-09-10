import { useMemo } from 'react'
import type { ProjectVisuals } from '@shared/types/projectVisuals'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'
import { projectDocument } from '../../lib/projectSurface'
export function ProjectAssetPreview({ structure, visuals, name }: { structure: PageStructureItem[]; visuals: ProjectVisuals; name: string }) {
  const html = useMemo(() => { const tree = buildExistingPageDraftTree('preview', structure, ''); if (tree.kind === 'stack') tree.align = 'start'; return projectDocument(tree, visuals, 'desktop') }, [structure, visuals])
  return <div className="relative h-16 w-full overflow-hidden rounded border border-border bg-white"><iframe title={`${name} preview`} tabIndex={-1} sandbox="" srcDoc={html} className="pointer-events-none absolute left-0 top-0 h-[256px] w-[800px] origin-top-left scale-[.25] border-0"/></div>
}
