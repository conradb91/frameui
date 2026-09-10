import { useEffect, useState } from 'react'
import { Frame } from 'lucide-react'
import type { ProjectVisuals } from '@shared/types/projectVisuals'
import type { DesignNode } from '@shared/types/designNode'
import { applyDesignOperations } from '@core/design-model/operations'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'
import { projectDocument } from '../../lib/projectSurface'
import { useProjectStore } from '../../state/projectStore'

export function DesignFilePreview({ projectId, fileId, visuals }: { projectId: string; fileId: string; visuals: ProjectVisuals | null }) {
  const [tree, setTree] = useState<DesignNode | null>(null)
  const [width, setWidth] = useState(1280)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const frames = JSON.parse(localStorage.getItem(`frameui:visual-canvas:${projectId}:${fileId}:v2`) ?? '[]') as { designStateId?: string; featureId?: string; pageId: string; width: number }[]
        const frame = frames[0]
        if (!frame) return
        let next: DesignNode | null = null
        if (frame.designStateId) {
          const [record, operations] = await Promise.all([window.frameui.workspace.getDesignTree(projectId, frame.designStateId), frame.featureId ? window.frameui.workspace.getDesignOperations(projectId, frame.featureId, frame.designStateId) : Promise.resolve([])])
          if (record) next = applyDesignOperations(record.tree, operations)
        } else {
          const page = useProjectStore.getState().activeIndex?.projectModel.pages.find((p) => p.id === frame.pageId)
          if (page) next = buildExistingPageDraftTree('preview', page.structure, page.source.filePath)
        }
        if (!cancelled) { setTree(next); setWidth(frame.width) }
      } catch { /* Unavailable preview keeps a clear empty state. */ }
    }
    void load()
    return () => { cancelled = true }
  }, [projectId, fileId])
  return tree && visuals ? <div className="relative h-full w-full overflow-hidden"><iframe title="Design preview" tabIndex={-1} sandbox="" srcDoc={projectDocument(tree, visuals, 'desktop')} className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-panel" style={{ width, height: width * .625, transform: `scale(${280 / width})` }}/></div> : <div className="flex flex-col items-center gap-3 text-text-3"><Frame size={28}/><span className="text-xs">Empty design</span></div>
}
