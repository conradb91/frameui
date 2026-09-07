import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DesignNode } from '@shared/types/designNode'
import { useDesignStore } from '../../state/designStore'
import { findParent } from '@core/design-model/tree'

const KIND_LABEL: Record<DesignNode['kind'], string> = {
  stack: 'Stack',
  text: 'Text',
  heading: 'Heading',
  button: 'Button',
  container: 'Container',
  divider: 'Divider',
  image: 'Image',
  placeholder: 'Detected',
}

export function LayersPanel({ tree }: { tree: DesignNode }) {
  const dispatch = useDesignStore((s) => s.dispatch)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeInfo = findParent(tree, String(active.id))
    const overInfo = findParent(tree, String(over.id))
    if (!activeInfo || !overInfo) return
    if (activeInfo.parent.id !== overInfo.parent.id) return // siblings only (spec LAY-03)

    const ids = activeInfo.parent.children.map((c) => c.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    const reordered = arrayMove(ids, oldIndex, newIndex)
    dispatch({ type: 'MoveNode', nodeId: String(active.id), newParentId: activeInfo.parent.id, newIndex: reordered.indexOf(String(active.id)) })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <LayerGroup nodes={[tree]} depth={0} isRoot />
    </DndContext>
  )
}

function LayerGroup({ nodes, depth, isRoot }: { nodes: DesignNode[]; depth: number; isRoot?: boolean }) {
  return (
    <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col">
        {nodes.map((node) => (
          <LayerRow key={node.id} node={node} depth={depth} isRoot={isRoot} />
        ))}
      </div>
    </SortableContext>
  )
}

function LayerRow({ node, depth, isRoot }: { node: DesignNode; depth: number; isRoot?: boolean }) {
  const selectedId = useDesignStore((s) => s.selectedId)
  const select = useDesignStore((s) => s.select)
  const dispatch = useDesignStore((s) => s.dispatch)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id, disabled: isRoot })

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const isSelected = selectedId === node.id
  const label = describeLabel(node)

  return (
    <div>
      <div
        ref={setNodeRef}
        {...(isRoot ? {} : attributes)}
        {...(isRoot ? {} : listeners)}
        onClick={() => select(node.id)}
        className={`flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[12px] ${
          isSelected ? 'bg-accent/15 text-white' : 'text-text-2 hover:bg-white/5'
        } ${node.hidden ? 'opacity-40' : ''}`}
        style={{ ...style, paddingLeft: 6 + depth * 14 }}
      >
        <span className="w-3 shrink-0 font-mono text-[9px] text-text-3">{KIND_LABEL[node.kind][0]}</span>
        <span className="flex-1 truncate">{label}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: 'SetHidden', nodeId: node.id, hidden: !node.hidden })
          }}
          className="rounded px-1 text-[10px] text-text-3 hover:text-text"
          title={node.hidden ? 'Show' : 'Hide'}
        >
          {node.hidden ? '○' : '●'}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: 'SetLocked', nodeId: node.id, locked: !node.locked })
          }}
          className="rounded px-1 text-[10px] text-text-3 hover:text-text"
          title={node.locked ? 'Unlock' : 'Lock'}
        >
          {node.locked ? '\u{1F512}' : '\u{1F513}'}
        </button>
      </div>
      {node.children.length > 0 && <LayerGroup nodes={node.children} depth={depth + 1} />}
    </div>
  )
}

function describeLabel(node: DesignNode): string {
  if (node.kind === 'text' || node.kind === 'heading') return node.content || KIND_LABEL[node.kind]
  if (node.kind === 'button') return node.label || 'Button'
  if (node.kind === 'placeholder') return node.label
  return KIND_LABEL[node.kind]
}
