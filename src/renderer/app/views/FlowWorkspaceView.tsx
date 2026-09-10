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
    labelBgStyle: { fill: 'var(--color-panel)', fillOpacity: 1 },
    labelStyle: { fill: 'var(--color-accent-2)', fontSize: 11, fontWeight: 600 },
    style: { stroke: 'var(--color-border-strong)', strokeWidth: 1.6 },
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
  const [referenceOnlyNotice, setReferenceOnlyNotice] = useState(false)

  useEffect(() => {
    if (!activeIndex) void fetchIndex()
  }, [activeIndex, fetchIndex])

  useEffect(() => {
    setRfNodes(toRfNodes(activeFlow?.nodes ?? []))
    setRfEdges(toRfEdges(activeFlow?.edges ?? []))
    // Only resync from the store when the active flow itself changes — the
    // effect intentionally ignores nodes/edges so local drag/edit state
    // isn't clobbered on every store write from onNodesChange/onEdgesChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            labelBgStyle: { fill: 'var(--color-panel)', fillOpacity: 1 },
            labelStyle: { fill: 'var(--color-accent-2)', fontSize: 11, fontWeight: 600 },
            style: { stroke: 'var(--color-accent-2)', strokeWidth: 1.8 },
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

  async function duplicateSelectedNode() {
    if (!selectedNode || !activeProject || !activeFlow) return
    const newId = crypto.randomUUID()
    const newNode: ScreenFlowNode = {
      id: newId,
      type: 'screenNode',
      position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
      data: { ...selectedNode.data, name: `${selectedNode.data.name} Copy` },
    }
    const next = [...rfNodes, newNode]
    setRfNodes(next)
    setNodesInStore(fromRfNodes(next))

    // FLW-06: "Duplicate creates a separate design draft" — copy the
    // source screen's actual saved draft under the new node's id, not just
    // the flow-node metadata, so the duplicate isn't silently reset to blank.
    const sourceDraft = await window.frameui.workspace.getScreenDraft(activeProject.id, selectedNode.id)
    if (sourceDraft) {
      await window.frameui.workspace.saveScreenDraft({
        id: newId,
        projectId: activeProject.id,
        flowId: activeFlow.id,
        tree: sourceDraft.tree,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  function handleBack() {
    closeFlow()
    setView('workspace')
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
    // A Feature can add a page as "Reference Only" — visible in its Journey
    // for context but never given an editable design draft (spec Phase 8/9).
    // Surface why the double-click did nothing rather than silently no-op.
    if (node.data.source.referenceOnly) {
      setReferenceOnlyNotice(true)
      window.setTimeout(() => setReferenceOnlyNotice(false), 2400)
      return
    }
    await loadScreen(activeProject.id, activeFlow.id, nodeId, node.data.source)
    setView('screen-designer')
  }

  if (!activeFlow || !activeProject) return null

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-raised px-4 z-10">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={handleBack} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover">
            <ChevronRightIcon className="h-3.5 w-3.5 rotate-180 text-text-2" />
          </button>
          <FrameMark className="h-[14px] w-[14px] text-accent-2" />
          <span className="font-mono text-[12px] text-text-3">{activeProject.name}</span>
          <ChevronRightIcon className="h-3 w-3 text-text-3" />
          <input
            value={activeFlow.name}
            onChange={(e) => renameFlow(e.target.value)}
            className="rounded bg-transparent px-1 text-[13px] font-semibold text-text outline-none focus:bg-panel-2"
          />
          <span className="ml-1 text-[12px] text-text-3">{saving ? 'Saving…' : 'Saved'}</span>
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
            className="flex items-center gap-1.5 rounded-lg border border-accent bg-accent   px-3 py-2 text-[12.5px] font-semibold text-on-accent"
          >
            + Add Screen
          </button>

          {addMenuOpen === 'root' && (
            <div className="absolute right-0 top-11 z-20 w-56 rounded-xl border border-border bg-panel p-1.5 shadow-sm">
              <button
                type="button"
                onClick={() => handleAddScreen({ type: 'blank' })}
                className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-text-2 hover:bg-hover hover:text-text"
              >
                Blank Screen
              </button>
              <button
                type="button"
                onClick={() => setAddMenuOpen('pages')}
                className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-medium text-text-2 hover:bg-hover hover:text-text"
              >
                Existing Page…
              </button>
            </div>
          )}

          {addMenuOpen === 'pages' && (
            <div className="absolute right-0 top-11 z-20 w-72 rounded-xl border border-border bg-panel p-1.5 shadow-sm">
              <div className="px-2 py-1.5 text-[12px] font-semibold tracking-wide text-text-3">Detected Pages</div>
              <div className="max-h-64 overflow-y-auto">
                {!activeIndex || activeIndex.projectModel.pages.length === 0 ? (
                  <div className="px-2.5 py-3 text-[12px] text-text-3">No pages detected in this project.</div>
                ) : (
                  activeIndex.projectModel.pages.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleAddScreen({ type: 'existing-page', pageFilePath: p.source.filePath }, p.name)}
                      className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-hover"
                    >
                      <span className="text-[12.5px] font-medium text-text">{p.name}</span>
                      <span className="font-mono text-[12px] text-text-3">{p.source.filePath}</span>
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
        {referenceOnlyNotice && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-border bg-panel px-3 py-1.5 text-[12px] text-text-2 shadow-sm">
            Reference-only screens can’t be opened in the designer.
          </div>
        )}
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
          onBeforeDelete={({ nodes, edges }) => {
            // FLW-06: "Delete warns if connectors will also be removed."
            // `edges` here already includes edges implicitly removed because
            // one of their endpoints is a deleted node.
            if (nodes.length === 0 || edges.length === 0) return Promise.resolve(true)
            const connectorWord = edges.length === 1 ? 'connection' : 'connections'
            return Promise.resolve(
              window.confirm(
                `Deleting ${nodes.length === 1 ? 'this screen' : `these ${nodes.length} screens`} will also remove ${edges.length} ${connectorWord}. Continue?`,
              ),
            )
          }}
          deleteKeyCode={['Backspace', 'Delete']}
          colorMode={document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'}
          defaultViewport={(() => { try { const saved = JSON.parse(localStorage.getItem(`frameui:flow-camera:${activeProject.id}:${activeFlow.id}`) ?? 'null'); return saved && [saved.x,saved.y,saved.zoom].every(Number.isFinite) ? saved : undefined } catch { return undefined } })()}
          onMoveEnd={(_event, viewport) => localStorage.setItem(`frameui:flow-camera:${activeProject.id}:${activeFlow.id}`, JSON.stringify(viewport))}
          fitView={!localStorage.getItem(`frameui:flow-camera:${activeProject.id}:${activeFlow.id}`)}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--color-grid)" />
          <Controls showInteractive={false} />
        </ReactFlow>

        {selectedNode && (
          <div className="absolute bottom-5 left-5 flex w-[280px] flex-col gap-2.5 rounded-xl border border-border bg-panel p-4 shadow-sm">
            <div className="text-[12px] font-semibold tracking-wide text-text-3">Screen</div>
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
            <div className="text-[12px] text-text-3">Delete: select and press Backspace</div>
          </div>
        )}

        {selectedEdge && (
          <div className="absolute bottom-5 left-5 flex w-[280px] flex-col gap-2.5 rounded-xl border border-border bg-panel p-4 shadow-sm">
            <div className="text-[12px] font-semibold tracking-wide text-text-3">Connection Label</div>
            <input
              value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
              onChange={(e) => updateSelectedEdgeLabel(e.target.value)}
              placeholder="Continue, Save, Back…"
              className="rounded-lg border border-border bg-panel-2 px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent-2"
            />
          </div>
        )}

        <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 text-[12px] text-text-3">
          {rfNodes.length} screens · {rfEdges.length} connections
        </div>
      </div>
    </div>
  )
}
