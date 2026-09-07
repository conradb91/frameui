import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ScreenNodeSource } from '@shared/types/flow'

export type ScreenNodeData = {
  name: string
  source: ScreenNodeSource
}

export type ScreenFlowNode = Node<ScreenNodeData, 'screenNode'>

export function ScreenNode({ data, selected }: NodeProps<ScreenFlowNode>) {
  return (
    <div
      className={`w-[220px] overflow-hidden rounded-xl border bg-panel-2 shadow-lg ${
        selected ? 'border-accent-2 shadow-[0_0_0_1px_#8f80ff,0_10px_30px_-10px_rgba(124,106,242,0.5)]' : 'border-border'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-accent-2 !bg-panel" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-accent-2 !bg-panel" />

      <div className="flex h-24 items-center justify-center bg-panel">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20">
          <div className="h-3.5 w-3.5 rounded bg-accent" />
        </div>
      </div>
      <div className="border-t border-border px-3 py-2.5">
        <div className="truncate text-[12.5px] font-semibold text-text">{data.name}</div>
        <div className="mt-0.5 truncate text-[10.5px] text-text-3">
          {data.source.type === 'blank' ? 'Blank screen' : `Existing page · ${data.source.pageFilePath}`}
        </div>
      </div>
    </div>
  )
}
