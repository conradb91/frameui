import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Circle, Plus, X } from 'lucide-react'
import type { Feature, FeaturePage, JourneyConnection, JourneyStep, Provenance } from '@shared/types/model/featureModel'
import type { DesignNode } from '@shared/types/designNode'
import type { Page, ProjectModel } from '@shared/types/model/projectModel'
import { useJourneyStore } from '../../state/journeyStore'
import { useDesignStore } from '../../state/designStore'
import { openDesignThisPage } from '../../lib/designThisPage'
import { startJourneyRecording } from '../../lib/journeyRecording'
import { PreviewRenderNode } from './PreviewRenderNode'
import { ProvenanceBadge } from './ProvenanceBadge'
import { StructurePreview } from '../project/StructurePreview'

type JourneyNodeData = {
  name: string
  route: string | null
  stateName: string | null
  provenance: Provenance
  referenceOnly: boolean
  structure: Page['structure'] | null
  tree: DesignNode | null
}
type JourneyFlowNode = Node<JourneyNodeData, 'journeyStep'>

function JourneyNodeCard({ data, selected }: NodeProps<JourneyFlowNode>) {
  return (
    <div className={`w-[248px] overflow-hidden rounded-md border bg-panel-2 shadow-xl ${selected ? 'border-accent-2 ring-1 ring-accent-2/30' : 'border-border'} ${data.referenceOnly ? 'opacity-75' : ''}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-accent-2 !bg-panel" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-accent-2 !bg-panel" />
      <div className="h-32 overflow-hidden bg-white">
        {data.tree ? <div className="origin-top-left scale-[0.45] p-3 text-black"><PreviewRenderNode node={data.tree} breakpoint="desktop" /></div> : data.structure ? <StructurePreview structure={data.structure} compact /> : <div className="flex h-full items-center justify-center bg-panel text-[10px] text-text-3">Design preview unavailable</div>}
      </div>
      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2"><span className="truncate text-[12px] font-semibold text-text">{data.name}</span><ProvenanceBadge provenance={data.provenance} /></div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-text-3">{data.route ?? 'No route'}</div>
        <div className="mt-1 text-[9px] text-text-3">{data.stateName ?? 'Page'} · Desktop</div>
      </div>
    </div>
  )
}

const nodeTypes = { journeyStep: JourneyNodeCard }

function toEdges(connections: JourneyConnection[]): Edge[] {
  return connections.map((connection) => ({
    id: connection.id,
    source: connection.fromStepId,
    target: connection.toStepId,
    label: connection.label || connection.trigger,
    labelBgStyle: { fill: '#0a0a0c', fillOpacity: 1 },
    labelStyle: { fill: '#8f80ff', fontSize: 10, fontWeight: 600 },
    style: { stroke: '#8f80ff', strokeWidth: 1.6 },
  }))
}

function fromEdges(edges: Edge[], previous: JourneyConnection[]): JourneyConnection[] {
  return edges.map((edge) => {
    const existing = previous.find((item) => item.id === edge.id)
    return existing ? { ...existing, fromStepId: edge.source, toStepId: edge.target } : {
      id: edge.id,
      fromStepId: edge.source,
      toStepId: edge.target,
      trigger: 'navigate',
      elementId: null,
      elementLabel: null,
      label: typeof edge.label === 'string' ? edge.label : 'Continue',
      transitionMeta: {},
    }
  })
}

export function JourneyCanvas(props: {
  projectId: string
  featureId: string
  projectModel: ProjectModel | null
  journeyId: string | null
  onJourneyChange: (id: string | null) => void
  onOpenInDesign?: () => void
}) {
  return <ReactFlowProvider><JourneyCanvasInner {...props} /></ReactFlowProvider>
}

function JourneyCanvasInner({ projectId, featureId, projectModel, journeyId, onOpenInDesign }: {
  projectId: string
  featureId: string
  projectModel: ProjectModel | null
  journeyId: string | null
  onJourneyChange: (id: string | null) => void
  onOpenInDesign?: () => void
}) {
  const journey = useJourneyStore((state) => state.activeJourney)
  const setSteps = useJourneyStore((state) => state.setSteps)
  const setConnections = useJourneyStore((state) => state.setConnections)
  const selectStep = useJourneyStore((state) => state.selectStep)
  const selectConnection = useJourneyStore((state) => state.selectConnection)
  const [feature, setFeature] = useState<Feature | null>(null)
  const [featurePages, setFeaturePages] = useState<FeaturePage[]>([])
  const [nodes, setNodes] = useState<JourneyFlowNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [picker, setPicker] = useState<'page' | 'reference' | 'state' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      window.frameui.workspace.getFeature(projectId, featureId),
      window.frameui.workspace.listFeaturePages(projectId, featureId),
    ]).then(([nextFeature, nextPages]) => { setFeature(nextFeature); setFeaturePages(nextPages) })
  }, [featureId, projectId])

  useEffect(() => {
    if (journeyId && journey?.id !== journeyId) void useJourneyStore.getState().openJourney(projectId, journeyId)
  }, [journey?.id, journeyId, projectId])

  useEffect(() => {
    if (!journey) { setNodes([]); setEdges([]); return }
    let cancelled = false
    void Promise.all(journey.steps.map(async (step): Promise<JourneyFlowNode> => {
      const page = step.pageRef.kind === 'existing' ? projectModel?.pages.find((item) => item.id === step.pageRef.pageId) ?? null : null
      const featurePage = step.pageRef.kind === 'new' ? featurePages.find((item) => item.id === step.pageRef.pageId) ?? null : null
      const state = step.designStateId ? await window.frameui.workspace.getDesignState(projectId, step.designStateId) : null
      const treeOwner = step.alternativeId ?? step.designStateId
      const tree = treeOwner ? (await window.frameui.workspace.getDesignTree(projectId, treeOwner))?.tree ?? null : null
      return { id: step.id, type: 'journeyStep', position: step.position, data: { name: page?.name ?? featurePage?.name ?? step.pageRef.pageId, route: page?.route ?? featurePage?.suggestedRoute ?? null, stateName: state?.name ?? null, provenance: step.provenance, referenceOnly: step.referenceOnly, structure: page?.structure ?? null, tree } }
    })).then((nextNodes) => { if (!cancelled) { setNodes(nextNodes); setEdges(toEdges(journey.connections)) } })
    return () => { cancelled = true }
  }, [featurePages, journey, projectId, projectModel])

  const selectedStepId = useJourneyStore((state) => state.selectedStepId)
  const selectedStep = journey?.steps.find((step) => step.id === selectedStepId) ?? null
  const availablePages = useMemo(() => {
    if (!feature || !projectModel) return []
    const ids = picker === 'reference' ? feature.referenceOnlyPageIds : feature.pageIds
    return projectModel.pages.filter((page) => ids.includes(page.id))
  }, [feature, picker, projectModel])

  const onNodesChange: OnNodesChange<JourneyFlowNode> = useCallback((changes) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current)
      if (journey) {
        const remainingIds = new Set(next.map((node) => node.id))
        setSteps(journey.steps.filter((step) => remainingIds.has(step.id)).map((step) => ({ ...step, position: next.find((node) => node.id === step.id)?.position ?? step.position })))
      }
      return next
    })
  }, [journey, setSteps])

  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current)
      if (journey) setConnections(fromEdges(next, journey.connections))
      return next
    })
  }, [journey, setConnections])

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    setEdges((current) => {
      const next = addEdge({ ...connection, id: crypto.randomUUID(), label: 'Continue' }, current)
      setConnections(fromEdges(next, journey?.connections ?? []))
      return next
    })
  }, [journey?.connections, setConnections])

  function addStep(pageRef: JourneyStep['pageRef'], referenceOnly: boolean, provenance: Provenance) {
    if (!journey) return
    const index = journey.steps.length
    const step: JourneyStep = { id: crypto.randomUUID(), pageRef, designStateId: null, alternativeId: null, referenceOnly, provenance, position: { x: 80 + (index % 3) * 300, y: 80 + Math.floor(index / 3) * 230 } }
    setSteps([...journey.steps, step])
    setPicker(null)
  }

  async function chooseState(stateId: string) {
    if (!journey || !selectedStep) return
    setSteps(journey.steps.map((step) => step.id === selectedStep.id ? { ...step, designStateId: stateId, alternativeId: null } : step))
    setPicker(null)
  }

  async function openInDesign(stepId: string) {
    const step = journey?.steps.find((item) => item.id === stepId)
    if (!step || !feature) return
    if (step.referenceOnly) {
      setNotice('Reference-only pages cannot be opened in the designer.')
      window.setTimeout(() => setNotice(null), 2400)
      return
    }
    if (step.designStateId) await useDesignStore.getState().loadDesignState(projectId, step.designStateId, step.alternativeId)
    else if (step.pageRef.kind === 'existing') {
      const page = projectModel?.pages.find((item) => item.id === step.pageRef.pageId)
      if (page) await openDesignThisPage(projectId, feature, page)
    } else {
      const states = await window.frameui.workspace.listDesignStatesForPage(projectId, step.pageRef)
      if (states[0]) await useDesignStore.getState().loadDesignState(projectId, states[0].id)
    }
    onOpenInDesign?.()
  }

  if (!journeyId || !journey) return <div className="flex flex-1 items-center justify-center text-[12px] text-text-3">Select or create a Journey.</div>

  return (
    <div className="relative flex-1">
      <div className="absolute left-3 top-3 z-20 flex gap-1.5">
        <button type="button" onClick={() => setPicker('page')} className="flex items-center gap-1 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11px] text-text-2 shadow"><Plus size={12} /> Add Page</button>
        <button type="button" onClick={() => setPicker('reference')} className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11px] text-text-2 shadow">Add Reference</button>
        <button type="button" disabled={!selectedStep || selectedStep.referenceOnly} onClick={() => setPicker('state')} className="rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11px] text-text-2 shadow disabled:opacity-40">Add State</button>
        <button type="button" onClick={() => startJourneyRecording(projectId, featureId, journey.id)} className="flex items-center gap-1 rounded-md border border-red-500/30 bg-panel px-2.5 py-1.5 text-[11px] text-red-400 shadow"><Circle size={9} fill="currentColor" /> Record</button>
      </div>
      {notice && <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded border border-border bg-panel px-3 py-1.5 text-[11px] text-text-2 shadow">{notice}</div>}
      {picker && (
        <Picker title={picker === 'state' ? 'Choose State' : picker === 'reference' ? 'Reference Pages' : 'Feature Pages'} onClose={() => setPicker(null)}>
          {picker === 'state' && selectedStep ? <StateChoices projectId={projectId} step={selectedStep} onChoose={(id) => void chooseState(id)} /> : <>
            {availablePages.map((page) => <button key={page.id} type="button" onClick={() => addStep({ kind: 'existing', pageId: page.id }, picker === 'reference', picker === 'reference' ? 'reference-only' : 'existing')} className="w-full rounded px-2 py-2 text-left hover:bg-white/5"><div className="text-[11.5px] text-text">{page.name}</div><div className="font-mono text-[9.5px] text-text-3">{page.route}</div></button>)}
            {picker === 'page' && featurePages.map((page) => <button key={page.id} type="button" onClick={() => addStep({ kind: 'new', pageId: page.id }, false, 'new')} className="w-full rounded px-2 py-2 text-left hover:bg-white/5"><div className="text-[11.5px] text-text">{page.name}</div><div className="font-mono text-[9.5px] text-text-3">{page.suggestedRoute ?? 'New page'}</div></button>)}
            {availablePages.length === 0 && (picker !== 'page' || featurePages.length === 0) && <div className="px-2 py-3 text-[11px] text-text-3">No eligible pages in this Feature.</div>}
          </>}
        </Picker>
      )}
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeDoubleClick={(_event, node) => void openInDesign(node.id)} onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => { if (selectedNodes[0]) selectStep(selectedNodes[0].id); else if (selectedEdges[0]) selectConnection(selectedEdges[0].id); else { selectStep(null); selectConnection(null) } }} onBeforeDelete={({ nodes: removedNodes, edges: removedEdges }) => Promise.resolve(removedNodes.length > 0 && removedEdges.length > 0 ? window.confirm(`Deleting ${removedNodes.length} step(s) also removes ${removedEdges.length} interaction(s). Continue?`) : true)} deleteKeyCode={['Backspace', 'Delete']} colorMode="dark" fitView proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.08)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

function Picker({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="absolute left-3 top-12 z-30 w-72 rounded-lg border border-border bg-panel p-1.5 shadow-xl"><div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"><span>{title}</span><button type="button" onClick={onClose}><X size={12} /></button></div><div className="max-h-72 overflow-y-auto">{children}</div></div>
}

function StateChoices({ projectId, step, onChoose }: { projectId: string; step: JourneyStep; onChoose: (id: string) => void }) {
  const [states, setStates] = useState<Awaited<ReturnType<typeof window.frameui.workspace.listDesignStatesForPage>>>([])
  useEffect(() => { void window.frameui.workspace.listDesignStatesForPage(projectId, step.pageRef).then(setStates) }, [projectId, step.pageRef])
  return <>{states.map((state) => <button key={state.id} type="button" onClick={() => onChoose(state.id)} className="w-full rounded px-2 py-2 text-left text-[11.5px] text-text hover:bg-white/5">{state.name}</button>)}{states.length === 0 && <div className="px-2 py-3 text-[11px] text-text-3">No states exist for this page yet.</div>}</>
}
