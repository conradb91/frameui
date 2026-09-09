import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ScreenNodeSource } from '@shared/types/flow'
import { useProjectStore } from '../../state/projectStore'
import { StructurePreview } from '../project/StructurePreview'

export type ScreenNodeData = {
  name: string
  source: ScreenNodeSource
}

export type ScreenFlowNode = Node<ScreenNodeData, 'screenNode'>

export function ScreenNode({ data, selected }: NodeProps<ScreenFlowNode>) {
  const model = useProjectStore((state) => state.activeIndex?.projectModel)
  const screen = data.source.type === 'existing-page' ? model?.pages.find((item) => item.source.filePath === data.source.pageFilePath) : null
  const actionCount = screen ? model?.interactions.filter((item) => item.sourcePageId === screen.id).length ?? 0 : 0
  const referenceOnly = data.source.referenceOnly === true
  return (
    <div
      className={`w-[240px] overflow-hidden rounded-[6px] border bg-panel-2 shadow-lg ${
        referenceOnly ? 'opacity-70' : ''
      } ${selected ? 'border-blue-400 shadow-[0_0_0_1px_rgb(96_165_250/0.35),0_10px_30px_-10px_rgb(0_0_0/0.7)]' : 'border-border'}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-accent-2 !bg-panel" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-accent-2 !bg-panel" />

      <div className="relative h-32 overflow-hidden bg-white">
        {screen ? <StructurePreview structure={screen.structure} compact /> : <div className="flex h-full items-center justify-center bg-panel text-[10px] text-text-3">Blank screen</div>}
        {referenceOnly && (
          <span className="absolute right-1.5 top-1.5 rounded-full border border-border bg-panel/90 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-text-3">
            Reference
          </span>
        )}
      </div>
      <div className="border-t border-border px-3 py-2.5">
        <div className="truncate text-[12.5px] font-semibold text-text">{data.name}</div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-text-3">{screen?.route ?? (data.source.type === 'blank' ? 'Blank screen' : data.source.pageFilePath)}</div>
        <div className="mt-1 text-[9px] text-text-3">
          {referenceOnly ? 'Reference only · not editable' : <>Desktop · {actionCount} action{actionCount === 1 ? '' : 's'}</>}
        </div>
      </div>
    </div>
  )
}
