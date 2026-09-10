import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CircleAlert, Info } from 'lucide-react'
import type { SourceConflict } from '@shared/types/model/featureModel'
import { useFeatureStore } from '../../../state/featureStore'
import { useProjectStore } from '../../../state/projectStore'

export function ChangesSection() {
  const project = useProjectStore((state) => state.activeProject)
  const index = useProjectStore((state) => state.activeIndex)
  const sourceStatus = useProjectStore((state) => state.sourceStatus)
  const features = useFeatureStore((state) => state.features)
  const [conflicts, setConflicts] = useState<SourceConflict[]>([])
  useEffect(() => {
    if (!project) return
    void Promise.all(features.map((feature) => window.frameui.workspace.listSourceConflicts(project.id, feature.id))).then((items) => setConflicts(items.flat()))
  }, [features, project])
  const problems = useMemo(() => [
    ...(index?.projectModel.diagnostics ?? []).map((item) => ({ id: item.id, severity: item.severity, area: 'Source', title: item.title, detail: item.detail })),
    ...conflicts.filter((item) => item.resolution === 'unresolved').map((item) => ({ id: item.id, severity: 'error' as const, area: 'Feature', title: item.kind === 'source-deleted' ? 'Source object deleted' : 'Source conflict', detail: item.sourcePath ?? item.targetNodeId })),
    ...(sourceStatus === 'warning' ? [{ id: 'watcher-warning', severity: 'warning' as const, area: 'Index', title: 'Source update needs attention', detail: 'FrameUI kept the previous valid index. Rebuild from Project Settings if the issue continues.' }] : []),
  ], [conflicts, index, sourceStatus])
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><header className="border-b border-border px-5 py-3"><h1 className="text-[13px] font-semibold text-text">Problems</h1><p className="mt-0.5 text-[12px] text-text-3">Technical issues that can degrade rendering, source relationships, or delivery.</p></header><div className="min-h-0 flex-1 overflow-y-auto">{problems.length === 0 ? <div className="flex h-full items-center justify-center"><div className="text-center"><Info size={20} className="mx-auto mb-2 text-success" /><div className="text-[12px] font-medium text-text">No problems detected</div><div className="mt-1 text-[12px] text-text-3">Design consistency findings remain in Design System.</div></div></div> : problems.map((problem) => <div key={problem.id} className="grid grid-cols-[20px_70px_1fr] gap-2 border-b border-border px-5 py-2.5">{problem.severity === 'error' ? <CircleAlert size={14} className="text-danger" /> : <AlertTriangle size={14} className="text-warning" />}<span className="font-mono text-[12px] text-text-3">{problem.area}</span><span><span className="block text-[12px] text-text">{problem.title}</span><span className="mt-0.5 block font-mono text-[12px] text-text-3">{problem.detail}</span></span></div>)}</div></div>
}
