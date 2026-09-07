import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BackgroundVariant,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type Edge,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useFlowStore } from '../../state/flowStore'
import { useProjectStore } from '../../state/projectStore'
import { useUiStore } from '../../state/uiStore'
import { useDesignStore } from '../../state/designStore'
import { usePreviewStore } from '../../state/previewStore'
import { ScreenNode, type ScreenFlowNode } from '../../components/flow/ScreenNode'
import { FrameMark, ChevronRightIcon } from '../../components/icons/icons'
import type { FlowScreenNode, FlowEdge, ScreenNodeSource } from '@shared/types/flow'

const nodeTypes = { screenNode: ScreenNode }

function toRfNodes(nodes: FlowScreenNode[]): ScreenFlowNode[] {
  return nodes.map((n) => ({ id: n.id, type: 'screenNode', position: n.position, data: { name: n.name, source: n.source } }))
}
function fromRfNodes(nodes: ScreenFlowNode[]): FlowScreenNode[] {
  return nodes.map((n) => ({ id: n.id, name: n.data.name, source: n.data.source, position: n.position }))
}
function toRfEdges(edges: FlowEdge[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    label: e.label,
    labelBgStyle: { fill: '#0a0a0c', fillOpacity: 1 },
    labelStyle: { fill: '#8f80ff', fontSize: 11, fontWeight: 600 },
    style: { stroke: 'rgba(255,255,255,0.32)', strokeWidth: 1.6 },
  }))
}
function fromRfEdges(edges: Edge[]): FlowEdge[] {
  return edges.map((e) => ({ id: e.id, sourceNodeId: e.source, targetNodeId: e.target, label: typeof e.label === 'string' ? e.label : '' }))
}

export function FlowWorkspaceView() {
  return (
    <ReactFlowProvider>
      <FlowWorkspaceCanvas />
    </ReactFlowProvider>
  )
}

function FlowWorkspaceCanvas() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeFlow = useFlowStore((s) => s.activeFlow)
  const setNodesInStore = useFlowStore((s) => s.setNodes)
  const setEdgesInStore = useFlowStore((s) => s.setEdges)
  const renameFlow = useFlowStore((s) => s.renameFlow)
  const closeFlow = useFlowStore((s) => s.closeFlow)
  const saving = useFlowStore((s) => s.saving)
  const setView = useUiStore((s) => s.setView)
  const loadScreen = useDesignStore((s) => s.loadScreen)
  const activeIndex = useProjectStore((s) => s.activeIndex)
  const fetchIndex = useProjectStore((s) => s.fetchIndex)
  const startPreview = usePreviewStore((s) => s.start)

  const [rfNodes, setRfNodes] = useState<ScreenFlowNode[]>(() => toRfNodes(activeFlow?.nodes ?? []))
  const [rfEdges, setRfEdges] = useState<Edge[]>(() => toRfEdges(activeFlow?.edges ?? []))
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState<false | 'root' | 'pages'>(false)

  useEffect(() => {
    if (!activeIndex) void fetchIndex()
  }, [activeIndex, fetchIndex])

  useEffect(() => {
    setRfNodes(toRfNodes(activeFlow?.nodes ?? []))
    setRfEdges(toRfEdges(activeFlow?.edges ?? []))
  }, [activeFlow?.id])

  const onNodesChange: OnNodesChange<ScreenFlowNode> = useCallback(
    (changes) => {
      setRfNodes((prev) => {
        const next = applyNodeChanges(changes, prev)
        setNodesInStore(fromRfNodes(next))
        return next
      })
    },
    [setNodesInStore],
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setRfEdges((prev) => {
        const next = applyEdgeChanges(changes, prev)
        setEdgesInStore(fromRfEdges(next))
        return next
      })
    },
    [setEdgesInStore],
  )

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setRfEdges((prev) => {
        const next = addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            label: 'Continue',
            labelBgStyle: { fill: '#0a0a0c', fillOpacity: 1 },
            labelStyle: { fill: '#8f80ff', fontSize: 11, fontWeight: 600 },
            style: { stroke: '#8f80ff', strokeWidth: 1.8 },
          },
          prev,
        )
        setEdgesInStore(fromRfEdges(next))
        return next
      })
    },
    [setEdgesInStore],
  )

  const selectedNode = useMemo(() => rfNodes.find((n) => n.id === selectedNodeId) ?? null, [rfNodes, selectedNodeId])
  const selectedEdge = useMemo(() => rfEdges.find((e) => e.id === selectedEdgeId) ?? null, [rfEdges, selectedEdgeId])

  function handleAddScreen(source: ScreenNodeSource, name?: string) {
    const count = rfNodes.length
    const newNode: ScreenFlowNode = {
      id: crypto.randomUUID(),
      type: 'screenNode',
      position: { x: 80 + (count % 4) * 280, y: 80 + Math.floor(count / 4) * 220 },
      data: { name: name ?? `Screen ${count + 1}`, source },
    }
    const next = [...rfNodes, newNode]
    setRfNodes(next)
    setNodesInStore(fromRfNodes(next))
    setAddMenuOpen(false)
  }

  function updateSelectedNodeName(name: string) {
    if (!selectedNode) return
    const next = rfNodes.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, name } } : n))
    setRfNodes(next)
    setNodesInStore(fromRfNodes(next))
  }

  function updateSelectedEdgeLabel(label: string) {
    if (!selectedEdge) return
    const next = rfEdges.map((e) => (e.id === selectedEdge.id ? { ...e, label } : e))
    setRfEdges(next)
    setEdgesInStore(fromRfEdges(next))
  }

  function duplicateSelectedNode() {
    if (!selectedNode) return
    const newNode: ScreenFlowNode = {
      id: crypto.randomUUID(),
      type: 'screenNode',
      position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
      data: { ...selectedNode.data, name: `${selectedNode.data.name} Copy` },
    }
    const next = [...rfNodes, newNode]
    setRfNodes(next)
    setNodesInStore(fromRfNodes(next))
  }

  function handleBack() {
    closeFlow()
    setView('project-summary')
  }

  async function handlePreview() {
    if (!activeFlow || !activeProject) return
    await startPreview(activeFlow, activeProject.id)
    setView('preview')
  }

  async function handleOpenDesigner(nodeId: string) {
    if (!activeProject || !activeFlow) return
    const node = rfNodes.find((n) => n.id === nodeId)
    if (!node) return
    await loadScreen(activeProject.id, activeFlow.id, nodeId, node.data.source)
    setView('screen-designer')
  }

  if (!activeFlow || !activeProject) return null

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Top bar */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-bg-raised px-4 z-10">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={handleBack} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/5">
            <ChevronRightIcon className="h-3.5 w-3.5 rotate-180 text-text-2" />
          </button>
          <FrameMark className="h-[14px] w-[14px] text-accent-2" />
          <span className="font-mono text-[12px] text-text-3">{activeProject.name}</span>
          <ChevronRightIcon className="h-3 w-3 text-text-3" />
          <input
            value={activeFlow.name}
            onChange={(e) => renameFlow(e.target.value)}
            className="rounded bg-transparent px-1 text-[13.5px] font-semibold text-text outline-none focus:bg-panel-2"
          />
          <span className="ml-1 text-[11px] text-text-3">{saving ? 'Saving…' : 'Saved'}</span>
        </div>
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={rfNodes.length === 0}
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-[12.5px] font-semibold text-text-2 hover:text-text disabled:opacity-40"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setView('export')}
            disabled={rfNodes.length === 0}
            className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-[12.5px] font-semibold text-text-2 hover:text-text disabled:opacity-40"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => setAddMenuOpen(addMenuOpen ? false : 'root')}
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-gradient-to-b from-[#8676F4] to-[#7461EE] px-3 py-2 text-[12.5px] font-semibold text-white"
          >
            + Add Screen
          </button>

          {addMenuOpen === 'root' && (
            <div className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-border bg-panel p-1.5 shadow-xl">
              <button
                type="button"
                onClick={() => handleAddScreen({ type: 'blank' })}
                className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-text-2 hover:bg-white/5 hover:text-text"
              >
                Blank Screen
              </button>
              <button
                type="button"
                onClick={() => setAddMenuOpen('pages')}
                className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-text-2 hover:bg-white/5 hover:text-text"
              >
                Existing Page…
              </button>
            </div>
          )}

          {addMenuOpen === 'pages' && (
            <div className="absolute right-0 top-11 z-20 w-72 rounded-xl border border-border bg-panel p-1.5 shadow-xl">
              <div className="px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-3">Detected Pages</div>
              <div className="max-h-64 overflow-y-auto">
                {!activeIndex || activeIndex.pages.length === 0 ? (
                  <div className="px-2.5 py-3 text-[12px] text-text-3">No pages detected in this project.</div>
                ) : (
                  activeIndex.pages.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleAddScreen({ type: 'existing-page', pageFilePath: p.filePath }, p.name)}
                      className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-white/5"
                    >
                      <span className="text-[12.5px] font-medium text-text">{p.name}</span>
                      <span className="font-mono text-[10.5px] text-text-3">{p.filePath}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {addMenuOpen && <div className="fixed inset-0 z-10" onClick={() => setAddMenuOpen(false)} />}

      {/* Canvas */}
      <div className="relative flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_event, node) => void handleOpenDesigner(node.id)}
          onSelectionChange={({ nodes, edges }) => {
            setSelectedNodeId(nodes[0]?.id ?? null)
            setSelectedEdgeId(edges[0]?.id ?? null)
          }}
          deleteKeyCode={['Backspace', 'Delete']}
          colorMode="dark"
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.08)" />
          <Controls showInteractive={false} />
        </ReactFlow>

        {selectedNode && (
          <div className="absolute bottom-5 left-5 flex w-[280px] flex-col gap-2.5 rounded-xl border border-border bg-panel p-4 shadow-xl">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Screen</div>
            <input
              value={selectedNode.data.name}
              onChange={(e) => updateSelectedNodeName(e.target.value)}
              className="rounded-lg border border-border bg-panel-2 px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent-2"
            />
            <button
              type="button"
              onClick={duplicateSelectedNode}
              className="rounded-lg border border-border bg-panel-2 px-2.5 py-2 text-[12px] font-semibold text-text-2 hover:text-text"
            >
              Duplicate
            </button>
            <div className="text-[10.5px] text-text-3">Delete: select and press Backspace</div>
          </div>
        )}

        {selectedEdge && (
          <div className="absolute bottom-5 left-5 flex w-[280px] flex-col gap-2.5 rounded-xl border border-border bg-panel p-4 shadow-xl">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Connection Label</div>
            <input
              value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
              onChange={(e) => updateSelectedEdgeLabel(e.target.value)}
              placeholder="Continue, Save, Back…"
              className="rounded-lg border border-border bg-panel-2 px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent-2"
            />
          </div>
        )}

        <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 text-[11px] text-text-3">
          {rfNodes.length} screens · {rfEdges.length} connections
        </div>
      </div>
    </div>
  )
}
