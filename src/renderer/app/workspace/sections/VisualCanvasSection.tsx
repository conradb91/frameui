import { projectAssets } from '../../../lib/projectAssets'
import { ProjectAssetPreview } from '../../../components/designer/ProjectAssetPreview'
import { applyDesignOperations } from '@core/design-model/operations'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignHorizontalSpaceAround, ChevronDown, ChevronRight, CircleAlert, Copy, Frame,
  Home, Lock, Unlock, Group, Ungroup, Grid3X3, Hand, Maximize, Monitor, MousePointer2, Play, Plus, Redo2,
  PanelLeft, PanelRight, Search, Smartphone, Tablet, Trash2, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react'
import type { Component, Page, Viewport } from '@shared/types/model/projectModel'
import type { PageStructureItem } from '@shared/types/pageStructure'
import type { Feature } from '@shared/types/model/featureModel'
import type { DesignNode } from '@shared/types/designNode'
import type { FrameUiWebviewElement } from '../../../types/webview'
import { findNode, findParent } from '@core/design-model/tree'
import { useProjectStore } from '../../../state/projectStore'
import { useFeatureStore } from '../../../state/featureStore'
import { flushPendingDesignSaves, useDesignStore } from '../../../state/designStore'
import { ComponentThumbnail } from '../../../components/designer/ComponentThumbnail'
import { ProjectDesignSurface } from '../../../components/designer/ProjectDesignSurface'
import type { ProjectVisuals } from '@shared/types/projectVisuals'
import { useUiStore } from '../../../state/uiStore'
import { buildExistingPageDraftTree } from '@core/design-model/existingPageDraft'
import { capturedDesignTree } from '../../../lib/projectSurface'
import { CAPTURE_SCRIPT } from '../../../lib/captureScript'
import type { CapturedElement } from '@shared/types/runtimeCapture'
import { LayoutInspector } from '../../../components/designer/LayoutInspector'
import { LayersPanel } from '../../../components/designer/LayersPanel'
import { openDesignThisPage } from '../../../lib/designThisPage'

type CanvasTab = 'pages' | 'components' | 'assets' | 'layers'
type InspectorTab = 'design' | 'prototype' | 'inspect' | 'code'
type Tool = 'select' | 'hand'
type FrameKind = 'live-page' | 'design-frame'
type CanvasMode = 'design' | 'preview' | 'code'

interface CanvasFrameModel {
  id: string
  kind: FrameKind
  name: string
  pageId: string
  route: string | null
  designStateId?: string
  featureId?: string
  viewport: Viewport
  x: number
  y: number
  width: number
  height: number
  locked?: boolean
  groupId?: string
  flowNextId?: string
  overflowContainer?: boolean
  grid?: { visible: boolean; columns: number; gutter: number; margin: number; opacity: number }
}

interface Camera { x: number; y: number; zoom: number }
interface SelectionBox { x: number; y: number; width: number; height: number }

interface InspectedElement {
  tag: string
  id?: string
  classes?: string
  text?: string
  rect: { x: number; y: number; width: number; height: number }
  styles: Record<string, string>
  aria: Record<string, string>
  ancestry: string[]
  componentHint?: string
}

const VIEWPORTS: Record<Viewport, { width: number; height: number; label: string }> = {
  desktop: { width: 1280, height: 800, label: 'Desktop' },
  tablet: { width: 768, height: 900, label: 'Tablet' },
  mobile: { width: 390, height: 844, label: 'Mobile' },
}
const SNAP = 8
const EMPTY_VISUALS: ProjectVisuals = { css: '', assets: {}, breakpoints: [], containerWidths: [], spacing: [], fonts: [], colors: [], visibilityRules: [] }

function storageKey(projectId: string, designFileId: string) { return `frameui:visual-canvas:${projectId}:${designFileId}:v2` }
function snap(value: number) { return Math.round(value / SNAP) * SNAP }
function routeUrl(base: string, route: string | null) {
  try { return new URL(route || '/', base).toString() } catch { return base }
}
function routeNeedsParameters(route: string | null): boolean {
  return !!route && /(?:\{[^}]+\}|:[^/]+|\[[^\]]+\]|\(:[^)]+\))/.test(route)
}
function sourceLabel(source?: { filePath: string; line?: number }) { return source ? `${source.filePath}${source.line ? `:${source.line}` : ''}` : 'Unavailable' }

export function VisualCanvasSection({ designFileId = 'current-application', designFileName = 'Current Application', sourceLinked = true }: { designFileId?: string; designFileName?: string; sourceLinked?: boolean }) {
  const project = useProjectStore((s) => s.activeProject)
  const index = useProjectStore((s) => s.activeIndex)
  const indexProgress = useProjectStore((s) => s.indexProgress)
  const features = useFeatureStore((s) => s.features)
  const loadFeatures = useFeatureStore((s) => s.loadFeatures)
  const saveFeature = useFeatureStore((s) => s.saveFeature)
  const tree = useDesignStore((s) => s.tree)
  const selectedNodeId = useDesignStore((s) => s.selectedId)
  const breakpoint = useDesignStore((s) => s.breakpoint)
  const dispatch = useDesignStore((s) => s.dispatch)
  const selectNode = useDesignStore((s) => s.select)
  const copyNode = useDesignStore((s) => s.copy)
  const pasteNode = useDesignStore((s) => s.paste)
  const duplicateNode = useDesignStore((s) => s.duplicateSelected)
  const designPast = useDesignStore((s) => s.past)
  const designFuture = useDesignStore((s) => s.future)
  const pages = useMemo(() => index?.projectModel.pages ?? [], [index])
  const components = useMemo(() => index?.projectModel.components ?? [], [index])
  const reusableAssets = useMemo(() => projectAssets(pages), [pages])
  const tokens = useMemo(() => index?.projectModel.tokens ?? [], [index])
  const [visualsLoaded, setVisualsLoaded] = useState(false)
  const [visuals, setVisuals] = useState<ProjectVisuals>(EMPTY_VISUALS)
  const [trees, setTrees] = useState<Record<string, DesignNode>>({})
  const activeStateId = useDesignStore((s) => s.designStateId)
  const viewports = useMemo(() => {
    const widths = [...new Set([...visuals.breakpoints, ...tokens.filter((t) => t.category === 'breakpoint').map((t) => { const m = t.value.match(/^(\d+(?:\.\d+)?)(px|rem|em)$/); return m ? Number(m[1]) * (m[2] === 'px' ? 1 : 16) : 0 })])].filter((n) => n >= 320).sort((a, b) => a - b)
    return { desktop: { ...VIEWPORTS.desktop, width: widths.find((n) => n >= 1000) ?? VIEWPORTS.desktop.width }, tablet: { ...VIEWPORTS.tablet, width: widths.find((n) => n >= 600) ?? VIEWPORTS.tablet.width }, mobile: { ...VIEWPORTS.mobile, width: widths.length ? Math.min(390, widths[0] - 1) : 390 } }
  }, [visuals.breakpoints, tokens])
  const containerWidth = visuals.containerWidths.filter((n) => n >= 600).at(-1)
  const [frames, setFrames] = useState<CanvasFrameModel[]>([])
  const [past, setPast] = useState<CanvasFrameModel[][]>([])
  const [future, setFuture] = useState<CanvasFrameModel[][]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tab, setTab] = useState<CanvasTab>('pages')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('design')
  const [leftPanelOpen, setLeftPanelOpen] = useState(true)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [tool, setTool] = useState<Tool>('select')
  const [camera, setCamera] = useState<Camera>({ x: 90, y: 70, zoom: 0.42 })
  const [runtimeUrl, setRuntimeUrl] = useState<string | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<'idle' | 'running' | 'stopped' | 'error'>('idle')
  const [runtimeDetail, setRuntimeDetail] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [mode, setMode] = useState<CanvasMode>('design')
  const [inspected, setInspected] = useState<InspectedElement | null>(null)
  const [query, setQuery] = useState('')
  const [componentStructures, setComponentStructures] = useState<Record<string, PageStructureItem[]>>({})
  const [busyDesign, setBusyDesign] = useState<string | null>(null)
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const canvasRef = useRef<HTMLDivElement>(null)
  const frameRefs = useRef<Map<string, HTMLElement>>(new Map())
  const hydratedFile = useRef<string | null>(null)
  const fittedInitialCanvas = useRef(false)

  const selectedFrame = frames.find((frame) => selectedIds.includes(frame.id)) ?? null
  const selectedNode = tree && selectedNodeId ? findNode(tree, selectedNodeId) : null
  const inspectedComponent = inspected ? components.find((component) => {
    const needle = component.name.replace(/[-_.:\s]/g, '').toLowerCase()
    const evidence = `${inspected.componentHint ?? ''} ${inspected.classes ?? ''} ${inspected.ancestry.join(' ')}`.replace(/[-_.:\s]/g, '').toLowerCase()
    return needle.length > 2 && evidence.includes(needle)
  }) : undefined

  useEffect(() => {
    if (!project) return
    let cancelled = false
    void window.frameui.project.getVisuals().then((value) => { if (!cancelled) { setVisuals(value); setVisualsLoaded(true) } }).catch(() => { if (!cancelled) { setVisualsLoaded(true); setRuntimeDetail('Project styles could not be loaded.') } })
    return () => { cancelled = true }
  }, [project])

  useEffect(() => {
    if (!project || !index || !visualsLoaded) return
    const identity = `${project.id}:${designFileId}`
    if (hydratedFile.current === identity) return
    hydratedFile.current = identity
    let next: CanvasFrameModel[] = []
    const seedKey = `frameui:canvas-seed:${project.id}:${designFileId}`
    try {
      const seed = JSON.parse(localStorage.getItem(seedKey) ?? 'null') as { pageIds: string[]; blank: boolean } | null
      if (seed) {
        next = seed.pageIds.flatMap((id, position) => { const page = index.projectModel.pages.find((p) => p.id === id); return page ? [{ id: crypto.randomUUID(), kind: 'live-page' as const, name: page.name, pageId: page.id, route: page.route, viewport: 'desktop' as const, x: 80 + position * (viewports.desktop.width + 96), y: 100, width: viewports.desktop.width, height: 800 }] : [] })
        if (next.length > 1) next = next.map((frame, i) => ({ ...frame, flowNextId: next[i + 1]?.id }))
        if (seed.blank) void createBlankFrame()
        localStorage.removeItem(seedKey)
      }
    } catch { /* Invalid seed has no effect. */ }
    try {
      const saved = localStorage.getItem(storageKey(project.id, designFileId))
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (Array.isArray(parsed)) next = parsed.filter((frame): frame is CanvasFrameModel => !!frame && typeof frame.id === 'string' && ['live-page', 'design-frame'].includes(frame.kind) && [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) && frame.width > 0 && frame.height > 0)
      }
    } catch { /* replace invalid canvas UI state */ }
    // Routes are snapshots on frames for offline persistence, but the
    // source index is authoritative. Reconcile on every file open so a
    // corrected PHP route (or any source route rename) heals old canvases
    // instead of continuing to request a stale URL forever.
    next = next.map((frame) => {
      if (frame.kind !== 'live-page') return frame
      const currentPage = index.projectModel.pages.find((page) => page.id === frame.pageId)
      return currentPage ? { ...frame, route: currentPage.route } : frame
    })
    const cameraSaved = localStorage.getItem(`${storageKey(project.id, designFileId)}:camera`)
    if (cameraSaved) { try { const value = JSON.parse(cameraSaved) as Camera; if ([value.x, value.y, value.zoom].every(Number.isFinite) && value.zoom >= .1 && value.zoom <= 8) { setCamera(value); fittedInitialCanvas.current = true } } catch { /* Default camera. */ } }
    setFrames(next)
    setSelectedIds(next[0] ? [next[0].id] : [])
    void loadFeatures(project.id)
    setPast([]); setFuture([]); setInspected(null)
    // Hydrate once per file; frame mutations must not reseed the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designFileId, index, loadFeatures, project, sourceLinked, visualsLoaded])

  useEffect(() => {
    if (!project || hydratedFile.current !== `${project.id}:${designFileId}`) return
    localStorage.setItem(storageKey(project.id, designFileId), JSON.stringify(frames))
  }, [designFileId, frames, project])

  useEffect(() => {
    if (project && hydratedFile.current === `${project.id}:${designFileId}`) localStorage.setItem(`${storageKey(project.id, designFileId)}:camera`, JSON.stringify(camera))
  }, [camera, project, designFileId])

  useEffect(() => {
    if (tree && activeStateId) setTrees((current) => current[activeStateId] === tree ? current : { ...current, [activeStateId]: tree })
  }, [tree, activeStateId])

  useEffect(() => {
    if (!project) return
    let cancelled = false
    for (const frame of frames) {
      if (!frame.designStateId || trees[frame.designStateId]) continue
      const id = frame.designStateId
      void Promise.all([window.frameui.workspace.getDesignTree(project.id, id), frame.featureId ? window.frameui.workspace.getDesignOperations(project.id, frame.featureId, id) : Promise.resolve([])]).then(([record, operations]) => {
        if (record && !cancelled) setTrees((current) => current[id] ? current : { ...current, [id]: applyDesignOperations(record.tree, operations) })
      }).catch(() => setRuntimeDetail('A design frame could not be loaded.'))
    }
    return () => { cancelled = true }
  }, [frames, project, trees])

  useEffect(() => {
    let cancelled = false
    void window.frameui.preview.getStatus().then(async (status) => {
      if (cancelled) return
      setRuntimeStatus(status.status); setRuntimeUrl(status.url)
      if (project && status.status !== 'running') {
        setStarting(true)
        try {
          const result = await window.frameui.preview.start()
          if (!cancelled && !result.ok) setRuntimeDetail(result.message ?? 'The application could not be started automatically.')
        } finally { if (!cancelled) setStarting(false) }
      }
    })
    const stopStatus = window.frameui.preview.onStatus(({ status, detail }) => { setRuntimeStatus(status); if (status === 'error' || status === 'stopped') setRuntimeUrl(null); setRuntimeDetail(detail ?? null) })
    const stopUrl = window.frameui.preview.onUrlDetected(({ url }) => { setRuntimeUrl(url); setRuntimeDetail(null) })
    return () => { cancelled = true; stopStatus(); stopUrl() }
  }, [project])

  useEffect(() => {
    if (tab !== 'components') return
    const visible = components.filter((component) => !query || `${component.name} ${component.source.filePath}`.toLowerCase().includes(query.toLowerCase())).slice(0, 40)
    const missing = visible.filter((component) => componentStructures[component.source.filePath] === undefined)
    if (!missing.length) return
    let cancelled = false
    void Promise.all(missing.map(async (component) => {
      const structure = await window.frameui.project.getPageStructure(component.source.filePath).catch(() => [])
      return [component.source.filePath, structure] as const
    })).then((entries) => { if (!cancelled) setComponentStructures((value) => ({ ...value, ...Object.fromEntries(entries) })) })
    return () => { cancelled = true }
  }, [componentStructures, components, query, tab])

  useEffect(() => {
    if (!project || selectedFrame?.kind !== 'design-frame' || !selectedFrame.designStateId) return
    const pendingSelection = useDesignStore.getState().selectedId
    void useDesignStore.getState().loadDesignState(project.id, selectedFrame.designStateId).then(() => {
      const state = useDesignStore.getState()
      if (state.designStateId !== selectedFrame.designStateId) return
      state.setBreakpoint(selectedFrame.viewport)
      if (pendingSelection && state.tree && findNode(state.tree, pendingSelection)) state.select(pendingSelection)
    }).catch(() => setRuntimeDetail('The selected design could not be loaded.'))
  }, [project, selectedFrame?.designStateId, selectedFrame?.id, selectedFrame?.kind, selectedFrame?.viewport])

  const commit = useCallback((update: (current: CanvasFrameModel[]) => CanvasFrameModel[]) => {
    setFrames((current) => {
      const next = update(current)
      if (next === current) return current
      setPast((history) => [...history, current].slice(-100))
      setFuture([])
      return next
    })
  }, [])

  const undo = useCallback(() => {
    if (selectedFrame?.kind === 'design-frame' && designPast.length) { useDesignStore.getState().undo(); return }
    setPast((history) => {
      const previous = history.at(-1)
      if (!previous) return history
      setFrames((current) => { setFuture((items) => [current, ...items].slice(0, 100)); return previous })
      return history.slice(0, -1)
    })
  }, [designPast.length, selectedFrame?.kind])

  const redo = useCallback(() => {
    if (selectedFrame?.kind === 'design-frame' && designFuture.length) { useDesignStore.getState().redo(); return }
    setFuture((items) => {
      const next = items[0]
      if (!next) return items
      setFrames((current) => { setPast((history) => [...history, current].slice(-100)); return next })
      return items.slice(1)
    })
  }, [designFuture.length, selectedFrame?.kind])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)
      if (typing) return
      if (event.key.toLowerCase() === 'v' && !event.metaKey && !event.ctrlKey) setTool('select')
      if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey) { event.preventDefault(); void createBlankFrame() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); groupSelected(event.shiftKey) }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); toggleLock() }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); const step = event.shiftKey ? 10 : 1; commit((items) => items.map((f) => selectedIds.includes(f.id) && !f.locked ? { ...f, x: f.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: f.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) } : f)) }
      if (event.code === 'Space' && !typing) { event.preventDefault(); setTool('hand') }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); if (selectedFrame?.kind === 'design-frame' && !selectedFrame.locked && selectedNodeId) duplicateNode(); else duplicateFrames() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && selectedFrame?.kind === 'design-frame' && !selectedFrame.locked && selectedNodeId) { event.preventDefault(); copyNode(selectedNodeId) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v' && selectedFrame?.kind === 'design-frame' && !selectedFrame.locked && tree) {
        event.preventDefault(); const parent = selectedNodeId ? findParent(tree, selectedNodeId) : null; pasteNode(parent?.parent.id ?? tree.id, parent ? parent.index + 1 : tree.children.length)
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault(); setMode((value) => value === 'preview' ? 'design' : 'preview')
      }
      if (event.shiftKey && event.key.toLowerCase() === 'i' && !typing) {
        event.preventDefault(); setLeftPanelOpen(true); setTab('components')
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && !typing) {
        if (selectedFrame?.kind === 'design-frame' && !selectedFrame.locked && selectedNodeId && tree?.id !== selectedNodeId) { event.preventDefault(); dispatch({ type: 'DeleteNode', nodeId: selectedNodeId }); selectNode(null) }
        else if (selectedIds.length) { event.preventDefault(); removeSelected() }
      }
      if (event.key === 'Escape') { setTool('select'); setSelectedIds([]); selectNode(null); setInspected(null) }
    }
    function onKeyUp(event: KeyboardEvent) { if (event.code === 'Space') setTool('select') }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  })

  function addLiveFrame(page: Page, viewport: Viewport = 'desktop') {
    const preset = viewports[viewport]
    const x = frames.length ? Math.max(...frames.map((item) => item.x + item.width)) + 96 : 100
    const frame: CanvasFrameModel = { id: crypto.randomUUID(), kind: 'live-page', name: `${page.name} · ${preset.label}`, pageId: page.id, route: page.route, viewport, x, y: 100, width: preset.width, height: preset.height }
    commit((items) => [...items, frame]); setSelectedIds([frame.id])
  }

  function addResponsiveSet(page: Page) {
    const bottom = frames.length ? Math.max(...frames.map((item) => item.y + item.height)) + 120 : 100
    let x = frames.length ? Math.min(...frames.map((item) => item.x)) : 80
    const additions = (['desktop', 'tablet', 'mobile'] as Viewport[]).map((viewport) => {
      const preset = viewports[viewport]
      const frame: CanvasFrameModel = {
        id: crypto.randomUUID(), kind: 'live-page', name: `${page.name} · ${preset.label}`,
        pageId: page.id, route: page.route, viewport, x, y: bottom,
        width: preset.width, height: preset.height,
      }
      x += preset.width + 96
      return frame
    })
    commit((items) => [...items, ...additions])
    setSelectedIds(additions.map((item) => item.id))
  }

  async function ensureCanvasFeature(page: Page): Promise<Feature> {
    if (!project) throw new Error('No project')
    let feature = features.find((item) => item.name === 'Canvas explorations')
    if (!feature) feature = await useFeatureStore.getState().createFeature(project.id, 'Canvas explorations', 'Non-destructive visual design work created from the application canvas.')
    if (!feature.pageIds.includes(page.id)) feature = await saveFeature({ ...feature, pageIds: [...feature.pageIds, page.id] })
    return feature
  }

  async function createDesignFrame(page: Page, sourceFrame?: CanvasFrameModel, captured?: DesignNode) {
    if (!project) return
    setBusyDesign(page.id)
    try {
      const feature = await ensureCanvasFeature(page)
      await openDesignThisPage(project.id, feature, page)
      const originalId = useDesignStore.getState().designStateId
      if (!originalId) return
      const state = await window.frameui.workspace.duplicateDesignState(project.id, originalId, `${page.name} design`, 'design')
      const designStateId = state.id
      if (captured) await window.frameui.workspace.saveDesignTree({ ownerId: designStateId, projectId: project.id, tree: captured, updatedAt: new Date().toISOString() })
      await useDesignStore.getState().loadDesignState(project.id, designStateId)
      const origin = sourceFrame ?? frames.find((item) => item.pageId === page.id)
      const frame: CanvasFrameModel = {
        id: crypto.randomUUID(), kind: 'design-frame', name: `${page.name} — Design`, pageId: page.id, route: page.route,
        designStateId, featureId: feature.id, viewport: origin?.viewport ?? 'desktop',
        x: (origin?.x ?? 120) + (origin?.width ?? 640) + 96, y: origin?.y ?? 100,
        width: origin?.width ?? 640, height: origin?.height ?? 520,
      }
      commit((items) => [...items, frame]); setSelectedIds([frame.id]); setMode('design'); setTab('layers')
    } catch (error) { setRuntimeDetail(error instanceof Error ? error.message : 'Could not create design.') } finally { setBusyDesign(null) }
  }

  async function duplicateFrames() {
    if (!selectedIds.length) return
    try {
      await flushPendingDesignSaves()
      const clones = await Promise.all(frames.filter((item) => selectedIds.includes(item.id)).map(async (item) => {
        const state = item.designStateId && project ? await window.frameui.workspace.duplicateDesignState(project.id, item.designStateId, `${item.name} copy`, 'design') : null
        return { ...item, id: crypto.randomUUID(), designStateId: state?.id, groupId: undefined, name: `${item.name} copy`, x: item.x + item.width + 80, y: item.y }
      }))
      commit((items) => [...items, ...clones]); setSelectedIds(clones.map((item) => item.id))
    } catch { setRuntimeDetail('The selected frames could not be duplicated.') }
  }
  function groupSelected(ungroup = false) { const groupId = ungroup ? undefined : crypto.randomUUID(); commit((items) => items.map((f) => selectedIds.includes(f.id) && !f.locked ? { ...f, groupId } : f)) }
  function toggleLock() { const locked = !selectedFrame?.locked; commit((items) => items.map((f) => selectedIds.includes(f.id) ? { ...f, locked } : f)) }
  function removeSelected() { commit((items) => items.filter((item) => !selectedIds.includes(item.id) || item.locked)); setSelectedIds([]); selectNode(null) }

  async function responsiveCopies() {
    if (!selectedFrame || !project) return
    try {
      await flushPendingDesignSaves()
      let x = Math.max(...frames.map((f) => f.x + f.width)) + 96
      const copies: CanvasFrameModel[] = []
      for (const viewport of ['desktop', 'tablet', 'mobile'] as Viewport[]) {
        if (viewport === selectedFrame.viewport) continue
        const preset = viewports[viewport]
        const state = selectedFrame.designStateId ? await window.frameui.workspace.duplicateDesignState(project.id, selectedFrame.designStateId, `${selectedFrame.name} ${preset.label}`, 'design') : null
        copies.push({ ...selectedFrame, id: crypto.randomUUID(), name: `${selectedFrame.name} · ${preset.label}`, viewport, width: preset.width, height: preset.height, x, designStateId: state?.id, groupId: undefined, flowNextId: undefined })
        x += preset.width + 96
      }
      commit((items) => [...items, ...copies]); setSelectedIds(copies.map((f) => f.id))
    } catch { setRuntimeDetail('Responsive copies could not be created.') }
  }

  async function createBlankFrame() {
    if (!project) return
    try {
      let feature = useFeatureStore.getState().features.find((f) => f.name === 'Canvas explorations')
      if (!feature) feature = await useFeatureStore.getState().createFeature(project.id, 'Canvas explorations', '')
      const page = await window.frameui.workspace.createFeaturePage(project.id, { featureId: feature.id, name: 'New screen', layoutSource: 'blank' })
      const state = await window.frameui.workspace.createDesignState(project.id, { featureId: feature.id, pageRef: { kind: 'new', pageId: page.id }, pageSlugHint: 'new-screen', name: 'Default', origin: 'design', provenance: 'new' })
      const blank: DesignNode = { id: crypto.randomUUID(), kind: 'stack', editability: 'editable', provenance: 'new', direction: 'column', gap: visuals.spacing[0] ?? 0, align: 'start', children: [], style: { fontFamily: visuals.fonts[0] } }
      await window.frameui.workspace.saveDesignTree({ ownerId: state.id, projectId: project.id, tree: blank, updatedAt: new Date().toISOString() })
      const frame: CanvasFrameModel = { id: crypto.randomUUID(), kind: 'design-frame', name: 'New screen', pageId: page.id, route: null, designStateId: state.id, featureId: feature.id, viewport: 'desktop', x: frames.length ? Math.max(...frames.map((f) => f.x + f.width)) + 96 : 80, y: 100, width: viewports.desktop.width, height: 800 }
      commit((items) => [...items, frame]); setSelectedIds([frame.id]); setTab('components')
    } catch (error) { setRuntimeDetail(error instanceof Error ? error.message : 'Could not create a frame.') }
  }

  function updateFrame(id: string, patch: Partial<CanvasFrameModel>, record = true, historyBase?: CanvasFrameModel) {
    const moving = frames.find((item) => item.id === id)
    if (moving?.locked && patch.locked === undefined) return
    let alignedPatch = patch
    if (moving && (patch.x !== undefined || patch.y !== undefined) && !record) {
      let x = patch.x ?? moving.x; let y = patch.y ?? moving.y; let guideX: number | undefined; let guideY: number | undefined
      const tolerance = 7 / camera.zoom
      for (const other of frames) {
        if (other.id === id || selectedIds.includes(other.id) || (moving.groupId && moving.groupId === other.groupId)) continue
        const xPairs = [[x, other.x], [x + moving.width / 2, other.x + other.width / 2], [x + moving.width, other.x + other.width]]
        const yPairs = [[y, other.y], [y + moving.height / 2, other.y + other.height / 2], [y + moving.height, other.y + other.height]]
        for (const [candidate, target] of xPairs) if (Math.abs(candidate - target) <= tolerance) { x += target - candidate; guideX = target; break }
        for (const [candidate, target] of yPairs) if (Math.abs(candidate - target) <= tolerance) { y += target - candidate; guideY = target; break }
      }
      setGuides({ x: guideX, y: guideY }); alignedPatch = { ...patch, x, y }
    }
    if (record) setGuides({})
    const movingIds = new Set(moving && (patch.x !== undefined || patch.y !== undefined) ? frames.filter((f) => f.id === id || (moving.groupId && f.groupId === moving.groupId) || (selectedIds.includes(id) && selectedIds.includes(f.id))).map((f) => f.id) : [id])
    const dx = (alignedPatch.x ?? moving?.x ?? 0) - (moving?.x ?? 0); const dy = (alignedPatch.y ?? moving?.y ?? 0) - (moving?.y ?? 0)
    const updater = (items: CanvasFrameModel[]) => items.map((item) => item.id === id ? { ...item, ...alignedPatch } : movingIds.has(item.id) && !item.locked ? { ...item, x: (frames.find((f) => f.id === item.id)?.x ?? item.x) + dx, y: (frames.find((f) => f.id === item.id)?.y ?? item.y) + dy } : item)
    if (record && historyBase) {
      setFrames((current) => {
        setPast((history) => [...history, current.map((item) => item.id === id ? historyBase : movingIds.has(item.id) && !item.locked ? frames.find((f) => f.id === item.id) ?? item : item)].slice(-100))
        setFuture([])
        return updater(current)
      })
    } else if (record) commit(updater); else setFrames(updater)
  }

  function beginCanvasPan(event: React.PointerEvent) {
    if (tool !== 'hand' && event.button !== 1) {
      if (event.target !== event.currentTarget || !canvasRef.current) return
      const bounds = canvasRef.current.getBoundingClientRect()
      const start = { x: (event.clientX - bounds.left - camera.x) / camera.zoom, y: (event.clientY - bounds.top - camera.y) / camera.zoom }
      setSelectedIds([])
      const move = (moveEvent: PointerEvent) => {
        const end = { x: (moveEvent.clientX - bounds.left - camera.x) / camera.zoom, y: (moveEvent.clientY - bounds.top - camera.y) / camera.zoom }
        setSelectionBox({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) })
      }
      const up = (upEvent: PointerEvent) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
        const end = { x: (upEvent.clientX - bounds.left - camera.x) / camera.zoom, y: (upEvent.clientY - bounds.top - camera.y) / camera.zoom }
        const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
        if (box.width > 3 || box.height > 3) setSelectedIds(frames.filter((item) => item.x < box.x + box.width && item.x + item.width > box.x && item.y < box.y + box.height && item.y + item.height > box.y).map((item) => item.id))
        setSelectionBox(null)
      }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
      return
    }
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY, camera }
    const move = (moveEvent: PointerEvent) => setCamera({ ...start.camera, x: start.camera.x + moveEvent.clientX - start.x, y: start.camera.y + moveEvent.clientY - start.y })
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault()
    const bounds = canvasRef.current?.getBoundingClientRect(); if (!bounds) return
    if (event.ctrlKey || event.metaKey) {
      const nextZoom = Math.max(0.1, Math.min(8, camera.zoom * Math.exp(-event.deltaY * 0.0015)))
      const px = event.clientX - bounds.left; const py = event.clientY - bounds.top
      const worldX = (px - camera.x) / camera.zoom; const worldY = (py - camera.y) / camera.zoom
      setCamera({ zoom: nextZoom, x: px - worldX * nextZoom, y: py - worldY * nextZoom })
    } else setCamera((value) => ({ ...value, x: value.x - event.deltaX, y: value.y - event.deltaY }))
  }

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  })

  function fitAll() {
    if (!frames.length || !canvasRef.current) return
    const minX = Math.min(...frames.map((item) => item.x)); const minY = Math.min(...frames.map((item) => item.y))
    const maxX = Math.max(...frames.map((item) => item.x + item.width)); const maxY = Math.max(...frames.map((item) => item.y + item.height))
    const box = canvasRef.current.getBoundingClientRect(); const zoom = Math.max(.1, Math.min(1, Math.min((box.width - 100) / (maxX - minX), (box.height - 100) / (maxY - minY))))
    setCamera({ zoom, x: (box.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (box.height - (maxY - minY) * zoom) / 2 - minY * zoom })
  }

  useEffect(() => {
    if (frames.length && !fittedInitialCanvas.current) { fittedInitialCanvas.current = true; fitAll() }
  })

  function alignSelected() {
    const selected = frames.filter((item) => selectedIds.includes(item.id) && !item.locked); if (selected.length < 2) return
    const top = Math.min(...selected.map((item) => item.y)); commit((items) => items.map((item) => selectedIds.includes(item.id) && !item.locked ? { ...item, y: top } : item))
  }

  async function runApplication() {
    setStarting(true)
    setRuntimeDetail(null)
    try {
      const result = await window.frameui.preview.start()
      if (!result.ok) setRuntimeDetail(result.message ?? 'The application could not be started.')
    } finally { setStarting(false) }
  }

  if (!project || !index) {
    const stages = [
      { label: 'Starting application', done: runtimeStatus === 'running' },
      { label: 'Discovering routes', done: indexProgress.includes('pages') || indexProgress.includes('model') || indexProgress.includes('done') },
      { label: 'Building design model', done: indexProgress.includes('model') || indexProgress.includes('persisting') || indexProgress.includes('done') },
      { label: 'Linking components', done: indexProgress.includes('dependencies') || indexProgress.includes('model') || indexProgress.includes('done') },
    ]
    const percentage = Math.max(8, Math.min(96, Math.round((indexProgress.length / 9) * 100)))
    return <div className="flex flex-1 items-center justify-center bg-[#1c1e23]"><div className="w-[360px] rounded-lg border border-white/10 bg-[#13151a] p-5 shadow-2xl"><div className="text-[13px] font-semibold text-text">Opening {project?.name ?? 'project'}</div><div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percentage}%` }}/></div><div className="mt-2 text-right font-mono text-[8px] text-text-3">{percentage}%</div><div className="mt-4 space-y-2">{stages.map((stage) => <div key={stage.label} className={`flex items-center gap-2 text-[10px] ${stage.done ? 'text-text-2' : 'text-text-3'}`}><span className={`h-1.5 w-1.5 rounded-full ${stage.done ? 'bg-success' : 'bg-white/15'}`}/>{stage.label}</div>)}</div></div></div>
  }

  const filteredPages = pages.filter((page) => !query || `${page.name} ${page.route ?? ''} ${page.source.filePath}`.toLowerCase().includes(query.toLowerCase()))
  const filteredComponents = components.filter((component) => !query || `${component.name} ${component.source.filePath}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-[#17191e]">
      {leftPanelOpen && <aside className="flex w-[252px] shrink-0 flex-col border-r border-border bg-bg-raised">
        <div className="grid h-10 grid-cols-4 border-b border-border px-1">
          {([['pages', 'Pages'], ['components', 'Components'], ['assets', 'Assets'], ['layers', 'Layers']] as [CanvasTab, string][]).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`border-b-2 text-[9px] ${tab === id ? 'border-accent-2 text-text' : 'border-transparent text-text-3 hover:text-text-2'}`}>{label}</button>)}
        </div>
        {tab !== 'layers' && <div className="border-b border-border p-2"><div className="flex h-7 items-center gap-1.5 rounded border border-border bg-panel px-2"><Search size={11} className="text-text-3"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab}…`} className="min-w-0 flex-1 bg-transparent text-[10.5px] text-text outline-none"/></div></div>}
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {tab === 'pages' && filteredPages.map((page) => <PageLibraryItem key={page.id} page={page} busy={busyDesign === page.id} onAdd={(viewport) => addLiveFrame(page, viewport)} onAddSet={() => addResponsiveSet(page)} onDesign={() => void createDesignFrame(page)} />)}
          {tab === 'components' && reusableAssets.filter((asset) => `${asset.name} ${asset.category}`.toLowerCase().includes(query.toLowerCase())).map((asset) => <div key={asset.id} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-frameui-component', asset.id); e.dataTransfer.effectAllowed = 'copy' }} className="mb-3 cursor-grab rounded p-1 hover:bg-white/5"><ProjectAssetPreview structure={asset.structure} visuals={visuals} name={asset.name}/><div className="mt-2 truncate text-[11px] text-text-2">{asset.name}</div><div className="text-[9px] text-text-3">{asset.category}</div></div>)}
          {tab === 'components' && filteredComponents.map((component) => <ComponentLibraryItem key={component.id} component={component} visuals={visuals} structure={componentStructures[component.source.filePath] ?? null} />)}
          {tab === 'assets' && <><div className="p-2 text-xs text-text-2">Colours</div><div className="grid grid-cols-6 gap-1 p-2">{visuals.colors.slice(0, 60).map((color) => <button key={color} title={color} aria-label={`Apply ${color}`} onClick={() => { if (selectedNodeId) dispatch({ type: 'SetStyle', nodeId: selectedNodeId, style: { backgroundColor: color } }) }} className="h-6 rounded border border-white/10" style={{ background: color }}/>)}</div><div className="p-2 text-xs text-text-2">Typography</div>{visuals.fonts.map((font) => <button key={font} className="block w-full truncate p-2 text-left text-xs text-text-2" onClick={() => { if (selectedNodeId) dispatch({ type: 'SetStyle', nodeId: selectedNodeId, style: { fontFamily: font } }) }}>{font}</button>)}<AssetLibrary paths={Object.keys(visuals.assets)} assets={visuals.assets} /></>}
          {tab === 'layers' && (selectedFrame?.kind === 'design-frame' && tree ? <LayersPanel tree={tree} /> : <FrameLayers frames={frames} selectedIds={selectedIds} onSelect={(id, additive) => setSelectedIds((current) => additive ? current.includes(id) ? current.filter((value) => value !== id) : [...current, id] : [id])} />)}
        </div>
      </aside>}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="z-20 flex h-10 shrink-0 items-center justify-between border-b border-border bg-bg-raised px-2">
          <div className="flex items-center gap-1"><ToolButton title="Project Home" onClick={() => useUiStore.getState().setSection('project-home')}><Home size={14}/></ToolButton><ToolButton active={leftPanelOpen} title="Toggle pages and layers" onClick={() => setLeftPanelOpen((value) => !value)}><PanelLeft size={13}/></ToolButton><span className="px-1 text-[10px] font-medium text-text-2">{designFileName}</span><span className={`ml-1 rounded px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-[.08em] ${sourceLinked ? 'bg-green-500/12 text-green-300' : 'bg-white/[.05] text-text-3'}`}>{'Project design'}</span>{selectedIds.length > 1 && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[8px] text-accent-2">{selectedIds.length} selected</span>}</div>
          <div className="flex items-center gap-1">
            <div className="mr-2 flex rounded border border-border bg-panel p-0.5 text-[9.5px]">{([['design', 'Design'], ['preview', 'Preview'], ['code', 'Code']] as [CanvasMode, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => { setMode(value); if (value === 'code') { setInspectorTab('code'); setRightPanelOpen(true) } }} className={`rounded px-2 py-1 ${mode === value ? value === 'preview' ? 'bg-green-500/25 text-green-300' : 'bg-accent text-white' : 'text-text-3'}`}>{label}</button>)}</div>
            <ToolButton title="Zoom out" onClick={() => setCamera((value) => ({ ...value, zoom: Math.max(.1, value.zoom / 1.25) }))}><ZoomOut size={13}/></ToolButton>
            <button type="button" onClick={() => setCamera((value) => ({ ...value, zoom: 1 }))} className="w-11 text-[9.5px] text-text-2">{Math.round(camera.zoom * 100)}%</button>
            <ToolButton title="Zoom in" onClick={() => setCamera((value) => ({ ...value, zoom: Math.min(8, value.zoom * 1.25) }))}><ZoomIn size={13}/></ToolButton>
            <ToolButton title="Fit all" onClick={fitAll}><Maximize size={13}/></ToolButton>
            <ToolButton active={rightPanelOpen} title="Toggle inspector" onClick={() => setRightPanelOpen((value) => !value)}><PanelRight size={13}/></ToolButton>
            <span className="mx-1 h-4 w-px bg-border"/>
            <button type="button" onClick={() => void runApplication()} disabled={starting || runtimeStatus === 'running'} className="flex h-7 items-center gap-1.5 rounded px-2 text-[10px] text-text-2 hover:bg-white/5 disabled:opacity-60"><Play size={11} className={runtimeStatus === 'running' ? 'fill-green-400 text-green-400' : ''}/>{runtimeStatus === 'running' ? 'Application running' : starting ? 'Starting…' : 'Run application'}</button>
          </div>
        </div>
        <div ref={canvasRef} onPointerDown={beginCanvasPan} className={`relative min-h-0 flex-1 overflow-hidden ${tool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`} style={{ backgroundColor: '#1c1e23', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,.105) 1px, transparent 1px)', backgroundPosition: `${camera.x}px ${camera.y}px`, backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px` }}>
          {runtimeDetail && <div className="absolute left-1/2 top-3 z-40 flex max-w-[560px] -translate-x-1/2 items-center gap-3 rounded border border-danger/40 bg-[#341f24] px-3 py-2 text-[10px] text-red-200 shadow-xl"><span className="min-w-0 flex-1">{runtimeDetail}</span><button type="button" onClick={() => setRuntimeDetail(null)} className="text-red-300 hover:text-white">Dismiss</button></div>}
          {!frames.length && <EmptyCanvas pages={pages} onAdd={addLiveFrame} onBrowseComponents={() => { setLeftPanelOpen(true); setTab('components') }}/>} 
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
            {guides.x !== undefined && <div className="pointer-events-none absolute -top-[10000px] h-[20000px] w-px bg-pink-500" style={{ left: guides.x }}/>}
            {guides.y !== undefined && <div className="pointer-events-none absolute -left-[10000px] h-px w-[20000px] bg-pink-500" style={{ top: guides.y }}/>}
            {selectionBox && <div className="pointer-events-none absolute border border-blue-400 bg-blue-400/10" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }}/>}
            <svg className="pointer-events-none absolute overflow-visible" width="1" height="1" aria-hidden="true"><defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#91c7b9"/></marker></defs>{frames.map((frame) => { const next = frames.find((f) => f.id === frame.flowNextId); if (!next) return null; const start = frame.x + frame.width + 10; const end = next.x - 10; const y1 = frame.y + 28 + frame.height / 2; const y2 = next.y + 28 + next.height / 2; return <path key={frame.id} d={`M${start},${y1} C${start + 48},${y1} ${end - 48},${y2} ${end},${y2}`} fill="none" stroke="#91c7b9" strokeWidth="2" markerEnd="url(#flow-arrow)"/> })}</svg>
            {frames.map((frame) => <CanvasFrame key={frame.id} frame={frame} page={pages.find((page) => page.id === frame.pageId)} components={components} selected={selectedIds.includes(frame.id)} inspected={selectedFrame?.id === frame.id ? inspected : null} runtimeUrl={runtimeUrl} mode={mode} zoom={camera.zoom} visuals={visuals} containerWidth={containerWidth} tree={frame.designStateId === activeStateId ? tree : frame.designStateId ? trees[frame.designStateId] ?? null : null} onSelect={(additive) => { setSelectedIds((current) => additive ? current.includes(frame.id) ? current.filter((id) => id !== frame.id) : [...current, frame.id] : current.includes(frame.id) ? current : frame.groupId ? frames.filter((f) => f.groupId === frame.groupId).map((f) => f.id) : [frame.id]); setInspected(null) }} onMove={(patch, final, historyBase) => updateFrame(frame.id, patch, final, historyBase)} onInspect={setInspected} onCreateDesign={(captured) => { const page = pages.find((item) => item.id === frame.pageId); if (page) void createDesignFrame(page, frame, captured) }} setRef={(element) => { if (element) frameRefs.current.set(frame.id, element); else frameRefs.current.delete(frame.id) }} />)}
          </div>
          {tool === 'hand' && <div className="absolute inset-0 z-20 cursor-grab active:cursor-grabbing"/>}
          <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-[#111318]/95 p-1 shadow-2xl backdrop-blur">
            <ToolButton active={tool === 'select'} title="Select (V)" onClick={() => setTool('select')}><MousePointer2 size={13}/></ToolButton>
            <ToolButton title="New frame (F)" onClick={() => void createBlankFrame()}><Frame size={13}/></ToolButton>
            <ToolButton active={tool === 'hand'} title="Hand (Space)" onClick={() => setTool('hand')}><Hand size={13}/></ToolButton>
            {selectedIds.length > 0 && <><span className="mx-1 h-4 w-px bg-border"/><ToolButton disabled={!past.length && !designPast.length} title="Undo" onClick={undo}><Undo2 size={13}/></ToolButton><ToolButton disabled={!future.length && !designFuture.length} title="Redo" onClick={redo}><Redo2 size={13}/></ToolButton><ToolButton title="Duplicate" onClick={duplicateFrames}><Copy size={13}/></ToolButton><ToolButton title={selectedFrame?.locked ? "Unlock frames" : "Lock frames"} onClick={toggleLock}>{selectedFrame?.locked ? <Unlock size={13}/> : <Lock size={13}/>}</ToolButton><ToolButton title="Group frames" onClick={() => groupSelected()}><Group size={13}/></ToolButton><ToolButton title="Ungroup frames" onClick={() => groupSelected(true)}><Ungroup size={13}/></ToolButton><ToolButton title="Delete" onClick={removeSelected}><Trash2 size={13}/></ToolButton>{selectedIds.length > 1 && <ToolButton title="Align top" onClick={alignSelected}><AlignHorizontalSpaceAround size={13}/></ToolButton>}</>}
          </div>
        </div>
      </main>

      {rightPanelOpen && <aside className="flex w-[286px] shrink-0 flex-col border-l border-border bg-bg-raised">
        <div className="grid h-10 grid-cols-4 border-b border-border px-1">
          {(['design', 'prototype', 'inspect', 'code'] as InspectorTab[]).map((id) => <button key={id} type="button" onClick={() => setInspectorTab(id)} className={`border-b-2 text-[9px] capitalize ${inspectorTab === id ? 'border-accent-2 text-text' : 'border-transparent text-text-3'}`}>{id}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {inspectorTab === 'design' && selectedFrame && <FrameInspector frame={selectedFrame} inspected={inspected} onChange={(patch) => updateFrame(selectedFrame.id, patch)} onPreset={(viewport) => { const preset = viewports[viewport]; updateFrame(selectedFrame.id, { viewport, width: preset.width, height: preset.height }); if (selectedFrame.kind === 'design-frame') useDesignStore.getState().setBreakpoint(viewport) }} />}
          {inspectorTab === 'design' && selectedFrame && <InspectorSection title="Layout guides"><button className="mb-3 w-full rounded border border-border p-2 text-xs text-text-2 hover:bg-white/5" onClick={() => void responsiveCopies()}>Add responsive versions</button><label className="flex gap-2 text-xs text-text-2"><input type="checkbox" checked={!!selectedFrame.overflowContainer} onChange={(e) => updateFrame(selectedFrame.id, { overflowContainer: e.target.checked })}/>Overflow Container</label><p className="my-2 text-[10px] text-text-3">{containerWidth ? `Project content width: ${containerWidth}px` : 'No fixed container width detected'}</p><label className="flex gap-2 text-xs text-text-2"><input type="checkbox" checked={!!selectedFrame.grid?.visible} onChange={(e) => updateFrame(selectedFrame.id, { grid: { columns: 12, gutter: 24, margin: 32, opacity: .12, ...selectedFrame.grid, visible: e.target.checked } })}/><Grid3X3 size={12}/>Show grid</label>{selectedFrame.grid && <div className="mt-3 grid grid-cols-2 gap-2">{(['columns', 'gutter', 'margin', 'opacity'] as const).map((key) => <label key={key} className="text-[10px] text-text-3">{key}<input aria-label={key} type="number" min={key === 'columns' ? 1 : 0} max={key === 'opacity' ? 1 : key === 'columns' ? 64 : 200} step={key === 'opacity' ? .05 : 1} value={selectedFrame.grid![key]} onChange={(e) => { const value = Math.max(key === 'columns' ? 1 : 0, Math.min(key === 'opacity' ? 1 : key === 'columns' ? 64 : 200, Number(e.target.value))); updateFrame(selectedFrame.id, { grid: { ...selectedFrame.grid!, [key]: value } }) }} className="mt-1 w-full rounded border border-border bg-panel p-1 text-text"/></label>)}</div>}<p className="mt-3 text-[10px] text-text-3">Guides stay on the canvas and are excluded from output.</p></InspectorSection>}
          {inspectorTab === 'design' && selectedFrame?.kind === 'design-frame' && !selectedFrame.locked && tree && selectedNode && <div className="border-t border-border"><LayoutInspector projectFonts={visuals.fonts} projectShadows={[{ label: 'None', value: '' }, ...(index.projectModel.designSystem?.observations.filter((o) => o.category === 'shadow').map((o) => ({ label: o.name, value: o.value })) ?? [])]} node={selectedNode} tree={tree} breakpoint={breakpoint} components={components} conceptComponents={[]} tokens={tokens} dispatch={dispatch} onSelect={selectNode}/></div>}
          {inspectorTab === 'inspect' && <InspectPanel frame={selectedFrame} inspected={inspected} component={inspectedComponent} page={pages.find((item) => item.id === selectedFrame?.pageId)} />}
          {inspectorTab === 'code' && <CodePanel frame={selectedFrame} inspected={inspected} component={inspectedComponent} page={pages.find((item) => item.id === selectedFrame?.pageId)} />}
          {inspectorTab === 'prototype' && <><PrototypePanel frame={selectedFrame}/>{selectedFrame && <InspectorSection title="Next screen"><select aria-label="Next screen" value={selectedFrame.flowNextId ?? ''} onChange={(e) => updateFrame(selectedFrame.id, { flowNextId: e.target.value || undefined })} className="w-full rounded border border-border bg-panel p-2 text-xs"><option value="">End of flow</option>{frames.filter((f) => f.id !== selectedFrame.id).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></InspectorSection>}</>}
          {!selectedFrame && <div className="p-4 text-[10.5px] leading-relaxed text-text-3">Select a live page or design frame to inspect its dimensions, source relationship and responsive preset.</div>}
        </div>
      </aside>}
    </div>
  )
}

function ToolButton({ children, title, active, disabled, onClick }: { children: React.ReactNode; title: string; active?: boolean; disabled?: boolean; onClick: () => void }) { return <button type="button" title={title} disabled={disabled} onClick={onClick} className={`flex h-7 w-7 items-center justify-center rounded ${active ? 'bg-accent text-white' : 'text-text-3 hover:bg-white/5 hover:text-text'} disabled:opacity-25`}>{children}</button> }

function PageLibraryItem({ page, busy, onAdd, onAddSet, onDesign }: { page: Page; busy: boolean; onAdd: (viewport: Viewport) => void; onAddSet: () => void; onDesign: () => void }) {
  const [open, setOpen] = useState(false)
  return <div className="mb-0.5">
    <button type="button" onClick={() => setOpen((value) => !value)} className={`flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left ${open ? 'bg-white/[.045] text-text' : 'text-text-2 hover:bg-white/[.035]'}`}>
      {open ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}<Monitor size={11} className="text-text-3"/><span className="min-w-0 flex-1 truncate text-[10.5px]">{page.name}</span><span className="font-mono text-[8px] text-text-3">{page.route ?? ''}</span>
    </button>
    {open && <div className="ml-3 border-l border-border py-1 pl-2">
      {(['desktop', 'tablet', 'mobile'] as Viewport[]).map((viewport) => { const Icon = viewport === 'desktop' ? Monitor : viewport === 'tablet' ? Tablet : Smartphone; return <button key={viewport} type="button" onClick={() => onAdd(viewport)} className="flex h-7 w-full items-center gap-2 rounded px-2 text-[9.5px] text-text-3 hover:bg-white/[.04] hover:text-text-2"><Icon size={11}/><span>{VIEWPORTS[viewport].label}</span><Plus size={10} className="ml-auto"/></button> })}
      <button type="button" onClick={onAddSet} className="mt-1 flex h-7 w-full items-center gap-2 rounded bg-accent/10 px-2 text-[9.5px] text-accent-2 hover:bg-accent/15"><Frame size={11}/>Add responsive set</button>
      <button type="button" disabled={busy} onClick={onDesign} className="flex h-7 w-full items-center gap-2 rounded px-2 text-[9.5px] text-text-3 hover:bg-white/[.04] hover:text-text-2 disabled:opacity-50"><Copy size={11}/>{busy ? 'Preparing design…' : 'New design alternative'}</button>
      <div className="truncate px-2 py-1 font-mono text-[8px] text-text-3" title={page.source.filePath}>{page.source.filePath}</div>
    </div>}
  </div>
}

function ComponentLibraryItem({ component, structure, visuals }: { component: Component; structure: PageStructureItem[] | null; visuals: ProjectVisuals }) { return <div draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-frameui-component', component.id); event.dataTransfer.effectAllowed = 'copy' }} className="mb-1 flex cursor-grab items-center gap-2 rounded px-1.5 py-1.5 hover:bg-white/[.04]"><div className="w-20 shrink-0">{structure?.length ? <ProjectAssetPreview name={component.name} structure={structure} visuals={visuals}/> : <ComponentThumbnail component={component} structure={structure} size="sm"/>}</div><div className="min-w-0"><div className="truncate text-[10.5px] text-text-2">{component.name}</div><div className="truncate font-mono text-[8px] text-text-3">{component.source.filePath}</div></div></div> }

function AssetLibrary({ paths, assets }: { paths: string[]; assets: Record<string, string> }) { const assetPaths = paths.filter((path) => /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(path)); return assetPaths.length ? <div className="grid grid-cols-2 gap-1.5">{assetPaths.map((path) => <div key={path} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-frameui-component', `asset:${path}`); e.dataTransfer.effectAllowed = 'copy' }} className="rounded border border-border bg-panel p-2"><div className="flex aspect-square items-center justify-center rounded bg-white/[.035]">{/\.(woff2?|ttf|otf)$/i.test(path) ? <span className="text-xl">Aa</span> : <img src={assets[path]} alt={path.split('/').at(-1)} className="max-h-full max-w-full object-contain"/>}</div><div className="mt-1 truncate text-[8.5px] text-text-3">{path.split('/').at(-1)}</div></div>)}</div> : <div className="p-3 text-[10px] text-text-3">No image, icon, or font assets were found in the active application index.</div> }

function FrameLayers({ frames, selectedIds, onSelect }: { frames: CanvasFrameModel[]; selectedIds: string[]; onSelect: (id: string, additive: boolean) => void }) { return <div>{frames.map((frame) => <button key={frame.id} type="button" onClick={(event) => onSelect(frame.id, event.shiftKey || event.metaKey || event.ctrlKey)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${selectedIds.includes(frame.id) ? 'bg-accent/15 text-text' : 'text-text-2 hover:bg-white/[.04]'}`}>{frame.kind === 'live-page' ? <Monitor size={12}/> : <Frame size={12}/>}<span className="min-w-0 flex-1 truncate text-[10px]">{frame.name}</span><span className="text-[7px] text-text-3">{frame.kind === 'live-page' ? 'LIVE' : 'DESIGN'}</span></button>)}</div> }

function CanvasFrame({ visuals, containerWidth, frame, page, components, selected, inspected, runtimeUrl, mode, zoom, tree, onSelect, onMove, onInspect, onCreateDesign, setRef }: { visuals: ProjectVisuals; containerWidth?: number; frame: CanvasFrameModel; page?: Page; components: Component[]; selected: boolean; inspected: InspectedElement | null; runtimeUrl: string | null; mode: CanvasMode; zoom: number; tree: DesignNode | null; onSelect: (additive: boolean) => void; onMove: (patch: Partial<CanvasFrameModel>, final: boolean, historyBase?: CanvasFrameModel) => void; onInspect: (element: InspectedElement | null) => void; onCreateDesign: (captured?: DesignNode) => void; setRef: (element: HTMLElement | null) => void }) {
  const webviewRef = useRef<FrameUiWebviewElement>(null)
  const sourceTree = useMemo(() => page?.structure.length ? buildExistingPageDraftTree(`source-${page.id}`, page.structure, page.source.filePath) : null, [page])
  const [renderFailure, setRenderFailure] = useState<{ title: string; detail: string } | null>(null)
  const insertIntoDesign = useDesignStore((state) => state.dispatch)
  function beginMove(event: React.PointerEvent) {
    if (event.button !== 0 || frame.locked) return
    event.preventDefault(); event.stopPropagation(); onSelect(event.shiftKey || event.metaKey || event.ctrlKey)
    const start = { cx: event.clientX, cy: event.clientY, x: frame.x, y: frame.y }
    const move = (e: PointerEvent) => onMove({ x: snap(start.x + (e.clientX - start.cx) / zoom), y: snap(start.y + (e.clientY - start.cy) / zoom) }, false)
    const up = (e: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onMove({ x: snap(start.x + (e.clientX - start.cx) / zoom), y: snap(start.y + (e.clientY - start.cy) / zoom) }, true, frame) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  function beginResize(event: React.PointerEvent) {
    if (frame.locked) return
    event.preventDefault(); event.stopPropagation(); const start = { cx: event.clientX, cy: event.clientY, width: frame.width, height: frame.height }
    const move = (e: PointerEvent) => onMove({ width: Math.max(240, snap(start.width + (e.clientX - start.cx) / zoom)), height: Math.max(180, snap(start.height + (e.clientY - start.cy) / zoom)) }, false)
    const up = (e: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onMove({ width: Math.max(240, snap(start.width + (e.clientX - start.cx) / zoom)), height: Math.max(180, snap(start.height + (e.clientY - start.cy) / zoom)) }, true, frame) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  async function inspectAt(event: React.MouseEvent<HTMLDivElement>) {
    if (mode === 'preview' || !webviewRef.current) return
    event.stopPropagation(); onSelect(false)
    const rect = event.currentTarget.getBoundingClientRect(); const x = Math.round((event.clientX - rect.left) * frame.width / rect.width); const y = Math.round((event.clientY - rect.top) * frame.height / rect.height)
    const script = `(function(){var e=document.elementFromPoint(${x},${y});if(!e)return null;var r=e.getBoundingClientRect(),s=getComputedStyle(e),a={};Array.from(e.attributes||[]).forEach(function(v){if(v.name==='role'||v.name.indexOf('aria-')===0)a[v.name]=v.value});var p=[],n=e;while(n&&n.nodeType===1&&p.length<8){p.unshift(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+(typeof n.className==='string'&&n.className?'.'+n.className.trim().split(/\\s+/).slice(0,2).join('.') :''));n=n.parentElement}return{tag:e.tagName.toLowerCase(),id:e.id||undefined,classes:typeof e.className==='string'?e.className:undefined,text:(e.childElementCount===0?(e.textContent||'').trim().slice(0,120):undefined),rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},styles:{display:s.display,position:s.position,width:s.width,height:s.height,padding:s.padding,margin:s.margin,gap:s.gap,color:s.color,backgroundColor:s.backgroundColor,fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,borderRadius:s.borderRadius,boxShadow:s.boxShadow},aria:a,ancestry:p,componentHint:e.getAttribute('data-component')||e.getAttribute('data-frameui-component')||undefined}})()`
    try { onInspect(await webviewRef.current.executeJavaScript(script) as InspectedElement | null) } catch { onInspect(null) }
  }
  const routeRenderable = !!frame.route && !routeNeedsParameters(frame.route)
  const src = runtimeUrl && routeRenderable ? routeUrl(runtimeUrl, frame.route) : null
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !src) return
    setRenderFailure(null)
    const failed = (event: Event) => {
      const detail = (event as Event & { errorDescription?: string }).errorDescription
      setRenderFailure({ title: 'The application could not render this view', detail: detail ?? 'The preview server refused the request.' })
    }
    const inspectResponse = async () => {
      try {
        const result = await webview.executeJavaScript(`({ title: document.title, text: (document.body && document.body.innerText || '').slice(0, 1600) })`) as { title?: string; text?: string }
        const title = result.title ?? ''
        const text = result.text ?? ''
        const codeIgniter404 = /404\s*(?:page not found)?/i.test(`${title} ${text}`) && /(?:can't find a route|page not found|not found)/i.test(text)
        const runtimeError = /CodeIgniter\\(?:Database|Debug|Exceptions)|DatabaseException|Whoops!/i.test(`${title} ${text}`) || /"code"\s*:\s*5\d\d/.test(text)
        if (codeIgniter404) setRenderFailure({ title: 'This PHP route does not exist', detail: 'FrameUI will render the source view instead of leaving a router error on the canvas.' })
        else if (runtimeError) setRenderFailure({ title: 'The PHP view is blocked by a runtime dependency', detail: 'The route exists, but the application returned an error. Check services such as the database, or continue from the source view.' })
        else setRenderFailure(null)
      } catch { /* a did-fail-load event provides the useful message */ }
    }
    webview.addEventListener('did-fail-load', failed)
    webview.addEventListener('did-finish-load', inspectResponse)
    return () => {
      webview.removeEventListener('did-fail-load', failed)
      webview.removeEventListener('did-finish-load', inspectResponse)
    }
  }, [src])
  function dropComponent(event: React.DragEvent) {
    if (frame.kind !== 'design-frame' || !tree || frame.locked) return
    event.preventDefault(); event.stopPropagation()
    void insertComponent(event.dataTransfer.getData('application/x-frameui-component'))
  }
  async function insertComponent(componentId: string) {
    if (!tree || frame.locked || !frame.designStateId) return
    const projectId = useProjectStore.getState().activeProject?.id
    if (!projectId) return
    if (useDesignStore.getState().designStateId !== frame.designStateId) await useDesignStore.getState().loadDesignState(projectId, frame.designStateId)
    if (componentId.startsWith('asset:')) {
      const path = componentId.slice(6); const src = visuals.assets[path]
      if (src && !/\.(woff2?|ttf|otf)$/i.test(path)) insertIntoDesign({ type: 'InsertComponent', parentId: tree.id, index: tree.children.length, node: { id: crypto.randomUUID(), kind: 'image', editability: 'editable', provenance: 'existing', src, alt: path.split('/').at(-1) ?? '', children: [], style: { maxWidth: containerWidth } } })
      return
    }
    const pattern = projectAssets(useProjectStore.getState().activeIndex?.projectModel.pages ?? []).find((asset) => asset.id === componentId)
    const component = components.find((item) => item.id === componentId)
    if (!component && !pattern) return
    try {
      if (useDesignStore.getState().designStateId !== frame.designStateId) {
        const projectId = useProjectStore.getState().activeProject?.id
        if (!projectId) return
        await useDesignStore.getState().loadDesignState(projectId, frame.designStateId)
      }
      const sourceFilePath = pattern?.sourceFilePath ?? component!.source.filePath
      const structure = pattern?.structure ?? await window.frameui.project.getPageStructure(sourceFilePath)
      if (!structure.length) return
      const root = buildExistingPageDraftTree(crypto.randomUUID(), structure, sourceFilePath)
      const node = root.children.length === 1 ? root.children[0] : root
      const fresh = (n: DesignNode): DesignNode => ({ ...n, id: crypto.randomUUID(), children: n.children.map(fresh) })
      insertIntoDesign({ type: 'InsertComponent', parentId: tree.id, index: tree.children.length, node: { ...fresh(node), componentDefinitionId: component?.id } })
    } catch { setRenderFailure({ title: 'Component unavailable', detail: 'The project component could not be read.' }) }
  }
  async function captureDesign() {
    if (!webviewRef.current || renderFailure) { onCreateDesign(); return }
    try {
      const root = await webviewRef.current.executeJavaScript(CAPTURE_SCRIPT) as CapturedElement
      onCreateDesign(capturedDesignTree(root))
    } catch { onCreateDesign() }
  }

  return <section ref={setRef} onDragOver={(event) => { if (frame.kind === 'design-frame') event.preventDefault() }} onDrop={dropComponent} onPointerDown={(event) => { event.stopPropagation(); onSelect(event.shiftKey || event.metaKey || event.ctrlKey) }} className={`absolute ${selected ? 'z-10' : ''}`} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height + 28 }}>
    <div onPointerDown={beginMove} className="flex h-7 cursor-move items-center justify-between px-0.5 text-[11px] text-[#c8cbd2]"><div className="flex min-w-0 items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-[7px] font-bold tracking-[.1em] ${frame.kind === 'live-page' ? 'bg-green-500/18 text-green-300' : 'bg-violet-500/20 text-violet-300'}`}>{frame.kind === 'live-page' ? 'LIVE PAGE' : 'DESIGN FRAME'}</span><span className="truncate">{frame.name}</span></div><span className="font-mono text-[8px] text-[#777d88]">{Math.round(frame.width)} × {Math.round(frame.height)}</span></div>
    <div className={`relative overflow-hidden bg-white shadow-[0_4px_24px_rgba(0,0,0,.35)] ${selected ? 'outline outline-2 outline-accent-2 outline-offset-2' : 'outline outline-1 outline-white/10'}`} style={{ width: frame.width, height: frame.height }}>
      {frame.kind === 'live-page' ? ((!src || renderFailure) && sourceTree) ? <ProjectDesignSurface tree={sourceTree} visuals={visuals} breakpoint={frame.viewport} active={false} onActivate={() => onSelect(false)} onInsert={() => {}}/> : src ? <><webview ref={webviewRef} src={src} partition="persist:frameui-preview" className="h-full w-full"/><div onClick={inspectAt} className={`absolute inset-0 ${mode === 'preview' ? 'pointer-events-none' : 'cursor-crosshair'}`}/>{inspected && <div className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/10" style={{ left: inspected.rect.x, top: inspected.rect.y, width: inspected.rect.width, height: inspected.rect.height }}><span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-blue-600 px-1.5 py-0.5 font-mono text-[8px] text-white">{inspected.tag} · {inspected.rect.width} × {inspected.rect.height}</span></div>}{renderFailure && <RuntimeRenderFailure title={renderFailure.title} detail={renderFailure.detail} onRetry={() => { setRenderFailure(null); webviewRef.current?.reload() }} onCreateDesign={onCreateDesign}/>}</> : !routeRenderable ? <SourceOnlyView page={page} route={frame.route} onCreateDesign={onCreateDesign}/> : <RuntimeUnavailable onRun={() => void window.frameui.preview.start()}/> : tree ? <ProjectDesignSurface tree={tree} visuals={visuals} breakpoint={frame.viewport} maxWidth={frame.overflowContainer ? undefined : containerWidth} active={selected && !frame.locked} onActivate={() => onSelect(false)} onInsert={(id) => void insertComponent(id)}/> : page ? <DesignLoading page={page}/> : null}
      {frame.kind === 'live-page' && mode === 'design' && <button type="button" onClick={(event) => { event.stopPropagation(); void captureDesign() }} className="absolute bottom-3 right-3 rounded bg-accent px-2.5 py-1.5 text-[9px] font-semibold text-white shadow-lg">Duplicate to design</button>}
      {frame.grid?.visible && <div className="pointer-events-none absolute inset-0 flex" style={{ paddingInline: frame.grid.margin, gap: frame.grid.gutter, opacity: frame.grid.opacity }}>{Array.from({ length: frame.grid.columns }, (_, i) => <div key={i} className="h-full flex-1 bg-emerald-500"/>)}</div>}
      {selected && !frame.locked && <button type="button" aria-label="Resize frame" onPointerDown={beginResize} className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize border border-white bg-accent"/>}
    </div>
  </section>
}

function RuntimeUnavailable({ onRun }: { onRun: () => void }) { return <div className="flex h-full flex-col items-center justify-center bg-[#f4f5f7] text-[#545b66]"><Monitor size={28}/><div className="mt-2 text-[12px] font-medium">Application is not running</div><button type="button" onClick={onRun} className="mt-3 rounded bg-[#6857e5] px-3 py-1.5 text-[10px] text-white">Run application</button></div> }
function RuntimeRenderFailure({ title, detail, onRetry, onCreateDesign }: { title: string; detail: string; onRetry: () => void; onCreateDesign: () => void }) { return <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#f7f7f8]/95 px-8 text-center text-[#545b66]"><div className="max-w-[360px]"><CircleAlert size={27} className="mx-auto text-amber-500"/><div className="mt-3 text-[12px] font-semibold text-[#31343a]">{title}</div><p className="mt-1 text-[10px] leading-relaxed">{detail}</p><div className="mt-4 flex justify-center gap-2"><button type="button" onClick={onRetry} className="rounded border border-[#d8dae0] bg-white px-3 py-1.5 text-[10px] text-[#4d525b]">Retry</button><button type="button" onClick={onCreateDesign} className="rounded bg-[#3b82f6] px-3 py-1.5 text-[10px] font-medium text-white">Render from source</button></div></div></div> }
function SourceOnlyView({ page, route, onCreateDesign }: { page?: Page; route: string | null; onCreateDesign: () => void }) { const needsData = routeNeedsParameters(route); return <div className="flex h-full flex-col items-center justify-center bg-[#f7f7f8] px-8 text-center text-[#545b66]"><Frame size={26}/><div className="mt-3 text-[12px] font-semibold text-[#31343a]">{needsData ? 'This route needs application data' : 'Source view — no public route'}</div><p className="mt-1 max-w-[320px] text-[10px] leading-relaxed">{needsData ? `${route} cannot be opened until a real route parameter is selected.` : `${page?.source.filePath ?? 'This view'} is not mapped to a GET route, so FrameUI will not send a guessed URL to PHP.`}</p><button type="button" onClick={onCreateDesign} className="mt-4 rounded bg-[#3b82f6] px-3 py-1.5 text-[10px] font-medium text-white">Render from source</button></div> }
function DesignLoading({ page }: { page: Page }) { return <div className="flex h-full flex-col items-center justify-center bg-[#fafafa] text-[#555]"><Frame size={28}/><div className="mt-2 text-[12px]">Loading editable design for {page.name}…</div></div> }
function EmptyCanvas({ pages, onAdd, onBrowseComponents }: { pages: Page[]; onAdd: (page: Page) => void; onBrowseComponents: () => void }) { return <div className="absolute inset-0 flex items-center justify-center"><div className="w-[360px] rounded-xl border border-white/10 bg-[#202228]/95 p-7 text-center shadow-2xl"><Frame size={27} className="mx-auto text-accent-2"/><div className="mt-3 text-[14px] font-semibold text-text">Start designing</div><p className="mt-1.5 text-[10.5px] leading-relaxed text-text-3">This file has an empty infinite canvas. Bring in a real screen or start with components from your product.</p><div className="mt-5 grid grid-cols-2 gap-2">{pages[0] && <button type="button" onClick={() => onAdd(pages[0])} className="rounded bg-accent px-3 py-2 text-[10px] font-medium text-white">Use existing page</button>}<button type="button" onClick={onBrowseComponents} className="rounded border border-border-strong bg-panel px-3 py-2 text-[10px] text-text-2 hover:text-text">Browse components</button></div><div className="mt-5 flex justify-center gap-5 border-t border-border pt-4 font-mono text-[8.5px] text-text-3"><span><b className="text-text-2">F</b> Frame</span><span><b className="text-text-2">⇧I</b> Insert</span><span><b className="text-text-2">T</b> Text</span></div></div></div> }

function FrameInspector({ frame, inspected, onChange, onPreset }: { frame: CanvasFrameModel; inspected: InspectedElement | null; onChange: (patch: Partial<CanvasFrameModel>) => void; onPreset: (viewport: Viewport) => void }) { return <div><div className="border-b border-border p-3"><div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-text">{frame.name}</span><span className={`rounded px-1.5 py-0.5 text-[7px] font-bold ${frame.kind === 'live-page' ? 'bg-green-500/15 text-green-300' : 'bg-violet-500/15 text-violet-300'}`}>{frame.kind === 'live-page' ? 'LIVE PAGE' : 'DESIGN FRAME'}</span></div><div className="mt-1 font-mono text-[8.5px] text-text-3">{frame.route ?? 'No detected route'}</div></div><InspectorSection title="Frame"><div className="grid grid-cols-2 gap-1.5"><NumberField label="X" value={frame.x} onChange={(x) => onChange({ x })}/><NumberField label="Y" value={frame.y} onChange={(y) => onChange({ y })}/><NumberField label="W" value={frame.width} onChange={(width) => onChange({ width: Math.max(240, width) })}/><NumberField label="H" value={frame.height} onChange={(height) => onChange({ height: Math.max(180, height) })}/></div></InspectorSection><InspectorSection title="Responsive"><div className="grid grid-cols-3 gap-1">{(['desktop', 'tablet', 'mobile'] as Viewport[]).map((viewport) => { const Icon = viewport === 'desktop' ? Monitor : viewport === 'tablet' ? Tablet : Smartphone; return <button key={viewport} type="button" onClick={() => onPreset(viewport)} className={`flex flex-col items-center gap-1 rounded border px-1 py-2 text-[8px] ${frame.viewport === viewport ? 'border-accent bg-accent/10 text-accent-2' : 'border-border text-text-3'}`}><Icon size={13}/>{VIEWPORTS[viewport].label}</button>})}</div></InspectorSection>{frame.kind === 'live-page' && <div className="m-3 rounded border border-green-500/20 bg-green-500/[.06] p-2.5 text-[9px] leading-relaxed text-green-200">Live frames render the application itself. In Design mode, click an element to inspect its real geometry and computed CSS. Live Preview enables normal app interaction.</div>}{inspected && <div className="mx-3 mb-3 text-[9px] text-text-3">Selected runtime element: <span className="font-mono text-text-2">{inspected.tag}{inspected.id ? `#${inspected.id}` : ''}</span></div>}</div> }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="flex h-7 items-center rounded border border-border bg-panel px-2"><span className="w-4 text-[8px] text-text-3">{label}</span><input type="number" value={Math.round(value)} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) onChange(value) }} className="min-w-0 flex-1 bg-transparent text-right font-mono text-[9px] text-text outline-none"/></label> }
function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="border-b border-border p-3"><div className="mb-2 flex items-center justify-between text-[9px] font-semibold text-text-2">{title}<ChevronDown size={10} className="text-text-3"/></div>{children}</section> }

function InspectPanel({ frame, inspected, component, page }: { frame: CanvasFrameModel | null; inspected: InspectedElement | null; component?: Component; page?: Page }) { if (!frame) return null; return <div className="p-3"><InspectorField label="Relationship" value={frame.kind === 'live-page' ? 'Runtime → Project page' : 'Design state → Project page'}/><InspectorField label="Page source" value={sourceLabel(page?.source)} mono/>{component && <><InspectorField label="Detected component" value={component.name}/><InspectorField label="Component source" value={sourceLabel(component.source)} mono/></>}{inspected ? <><InspectorField label="Element" value={`${inspected.tag}${inspected.id ? `#${inspected.id}` : ''}`}/><InspectorField label="Bounds" value={`${inspected.rect.x}, ${inspected.rect.y} · ${inspected.rect.width} × ${inspected.rect.height}`}/>{inspected.ancestry.length > 0 && <InspectorField label="DOM ancestry" value={inspected.ancestry.join(' › ')} mono/>}<div className="mt-4 text-[9px] font-semibold text-text-2">Computed styles</div>{Object.entries(inspected.styles).filter(([, value]) => value && value !== 'none' && value !== 'normal' && value !== '0px').map(([key, value]) => <InspectorField key={key} label={key} value={value} mono/>)}{Object.keys(inspected.aria).length > 0 && <><div className="mt-4 text-[9px] font-semibold text-text-2">Accessibility</div>{Object.entries(inspected.aria).map(([key, value]) => <InspectorField key={key} label={key} value={value}/>)}</>}</> : <div className="mt-4 rounded border border-border bg-panel p-2.5 text-[9.5px] leading-relaxed text-text-3">Switch to Design mode and click any element in a live frame to read its rendered box, computed style, DOM ancestry and accessibility attributes.</div>}</div> }
function CodePanel({ frame, inspected, component, page }: { frame: CanvasFrameModel | null; inspected: InspectedElement | null; component?: Component; page?: Page }) { return <div className="p-3">{frame ? <><InspectorField label="Page source" value={sourceLabel(page?.source)} mono/>{component && <InspectorField label={`${component.name} source`} value={sourceLabel(component.source)} mono/>}<InspectorField label="Route" value={frame.route ?? 'Unavailable'} mono/>{frame.designStateId && <InspectorField label="Design state" value={frame.designStateId} mono/>}{inspected?.componentHint && <InspectorField label="Component hint" value={inspected.componentHint}/>}<div className="mt-4 rounded border border-border bg-panel p-2.5 font-mono text-[8.5px] leading-relaxed text-text-3">{inspected ? `<${inspected.tag}${inspected.id ? ` id="${inspected.id}"` : ''}${inspected.classes ? ` class="${inspected.classes}"` : ''}>` : 'Select a runtime element to reveal its source-facing identity.'}</div></> : <div className="text-[10px] text-text-3">Select a frame.</div>}</div> }
function PrototypePanel({ frame }: { frame: CanvasFrameModel | null }) { return <div className="p-3">{frame ? <><InspectorField label="Starting point" value={frame.name}/><InspectorField label="Route" value={frame.route ?? 'Design-only'}/><div className="mt-4 rounded border border-border bg-panel p-2.5 text-[9.5px] leading-relaxed text-text-3">Journey connections remain first-class workflow objects. Use Live Preview to verify real navigation and the Journeys workspace to annotate interaction triggers.</div></> : <div className="text-[10px] text-text-3">Select a frame.</div>}</div> }
function InspectorField({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div className="border-b border-border py-2"><div className="mb-1 text-[8.5px] text-text-3">{label}</div><div className={`break-all text-[9.5px] text-text-2 ${mono ? 'font-mono text-[8.5px]' : ''}`}>{value}</div></div> }
