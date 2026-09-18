import { StructuredLayers, StructuredSelectionPanel } from './StructuredSelectionPanel'
import { patchStructuredNode } from '@core/capture-compiler/edit'
import { useCanvasCamera } from './useCanvasCamera'
import { VariableEditor } from './VariableEditor'
import type { DesignVariable } from '@shared/types/visualDesign'
import type { ProjectLibraryEntry, RecentProject } from '@shared/types/project'
import type { ProjectIndex } from '@shared/types/projectIndex'
import { AssetBrowser, type LibraryAsset } from './AssetBrowser'
import { ProjectLibrary } from './ProjectLibrary'
import { CaptureWorkspace } from './CaptureWorkspace'
import { StructuredCapturePreview } from './StructuredCapturePreview'
import { ProjectSetupModal } from './ProjectSetupModal'
import { openFirstRunOnboarding } from '../onboarding/FirstRunOnboarding'
import { ProgressModal } from '../ui/ProgressModal'
import { ModalBody, ModalField, ModalFooter, ModalHeader, ModalNotice, ModalSection, ModalShell, ModalSummary } from '../ui/Modal'
import { PageBrowser } from './PageBrowser'
import { detectedAssets } from './pageLibrary'
import { type ProjectSection } from './ProjectNav'
import { useStoredValue } from './preferences'
import { DesignOverview } from './Overview'
import {
  Welcome,
  ThemeControl,
  TooltipLayer,
  CommandPalette,
  ActionMenu,
  InlineName,
  EmptyState,
  ColorField,
  type IdeAction,
} from './Ui'
import {
  MousePointer2,
  Frame,
  Group,
  Square,
  Circle,
  Minus,
  MoveUpRight,
  PenTool,
  Type,
  Image as ImageIcon,
  Component,
  Hand,
  PanelsTopLeft,
  Search,
  PanelLeftClose,
  PanelRightClose,
  Play,
  Download,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  ChevronRight,
  Settings2,
  Check,
  Monitor,
  Keyboard,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  VisualDocument,
  VisualObject,
  VisualPage,
  VisualKind,
} from '@shared/types/visualDesign'
import {
  object,
  cloneObject,
  visit,
  removeObjects,
  applyVisualLayout,
  resizeVisualObject,
  editSiblings,
  updateVisualSelection,
} from '@core/visual/model'
import { VisualSvg, FontDefinitions } from './VisualSvg'
import { StructuredFrameView } from './StructuredFrameView'
import { StructuredCanvasInteraction } from './StructuredCanvasInteraction'
import { InlineRichTextEditor, type InlineRichTextEditorHandle } from './InlineRichTextEditor'
import { ExportWorkspace } from './ExportWorkspace'
import type { TextStyleRun } from '@shared/types/richText'
import {
  findStructuredNode,
  groupStructuredNodes,
  removeStructuredNodes,
  ungroupStructuredNodes,
  updateStructuredNodeBounds,
  updateStructuredNodeText,
} from '@core/capture-compiler/edit'
import { sourceTarget } from '@core/repo-design/targets'
import './ide.css'
import './workspace-chrome.css'
const newPage = (name = 'Untitled'): VisualPage => ({
  id: crypto.randomUUID(),
  name,
  folder: 'Designs',
  pinned: false,
  state: 'Default',
  width: 1440,
  height: 1000,
  objects: [],
})
const newDocument = (name = 'Untitled'): VisualDocument => ({
  version: 1,
  id: crypto.randomUUID(),
  name,
  pages: [newPage()],
  components: [],
  variables: [],
  updatedAt: new Date().toISOString(),
})

const CANVAS_FRAME_GAP = 160
function arrangeCanvasFrames(pages: VisualPage[]) {
  let layoutX = 0
  let layoutY = 0
  let rowHeight = 0
  return pages.map((page, index) => {
    if (index > 0 && index % 2 === 0) {
      layoutX = 0
      layoutY += rowHeight + CANVAS_FRAME_GAP
      rowHeight = 0
    }
    const frame = {
      page,
      x: page.canvasX ?? layoutX,
      y: page.canvasY ?? layoutY,
    }
    layoutX += page.width + CANVAS_FRAME_GAP
    rowHeight = Math.max(rowHeight, page.height)
    return frame
  })
}

const canUseStructuredCanvas = (page: VisualPage) =>
  !!page.structured?.captureMetadata.visualMatch &&
  page.structured.captureMetadata.visualMatch.diffPercent <= 5

function CanvasFrameTitle({
  page,
  zoom,
  onRename,
  onMoveBy,
  active = true,
  selected = false,
  onActivate,
}: {
  page: VisualPage
  zoom: number
  onRename: (name: string) => void
  onMoveBy: (dx: number, dy: number) => void
  active?: boolean
  selected?: boolean
  onActivate?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState(page.name)
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null>(null)
  const ignoreClick = useRef(false)
  const scale = 1 / zoom

  useEffect(() => {
    if (!editing) setDraft(page.name)
  }, [editing, page.name])

  function finish() {
    const name = draft.trim()
    if (name && name !== page.name) onRename(name)
    else setDraft(page.name)
    setEditing(false)
  }

  return (
    <foreignObject
      x={0}
      y={-28 * scale}
      width={Math.min(page.width, 540 * scale)}
      height={26 * scale}
    >
      <div className="ide-canvas-frame-title-wrap">
        {editing ? (
          <input
            autoFocus
            className="ide-canvas-frame-name-input"
            aria-label="Frame name"
            value={draft}
            style={{
              width: `${Math.min(320, Math.max(150, draft.length * 8 + 32)) * scale}px`,
              height: `${27 * scale}px`,
              padding: `${3 * scale}px ${7 * scale}px`,
              fontSize: `${12 * scale}px`,
            }}
            onChange={(event) => setDraft(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onBlur={finish}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') finish()
              if (event.key === 'Escape') {
                setDraft(page.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="ide-canvas-frame-title"
            aria-label={`Frame title ${page.name}`}
            style={{
              fontSize: `${11 * scale}px`,
              gap: `${5 * scale}px`,
              padding: `${2 * scale}px ${3 * scale}px`,
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              drag.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                moved: false,
              }
              event.currentTarget.setPointerCapture(event.pointerId)
              setDragging(true)
            }}
            onPointerMove={(event) => {
              const current = drag.current
              if (!current || current.pointerId !== event.pointerId) return
              event.stopPropagation()
              const dx = event.clientX - current.lastX
              const dy = event.clientY - current.lastY
              if (Math.abs(dx) + Math.abs(dy) > 0) {
                if (Math.abs(event.clientX - current.startX) + Math.abs(event.clientY - current.startY) >= 3) current.moved = true
                current.lastX = event.clientX
                current.lastY = event.clientY
                onMoveBy(dx, dy)
              }
            }}
            onPointerUp={(event) => {
              event.stopPropagation()
              ignoreClick.current = !!drag.current?.moved
              drag.current = null
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              setDragging(false)
            }}
            onPointerCancel={() => { drag.current = null; ignoreClick.current = false; setDragging(false) }}
            onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
            onClick={() => {
              if (ignoreClick.current) {
                ignoreClick.current = false
                return
              }
              onActivate?.()
            }}
            onDoubleClick={(event) => {
              event.stopPropagation()
              onActivate?.()
              setDraft(page.name)
              setEditing(true)
            }}
            data-dragging={dragging ? 'true' : undefined}
            data-selected={selected ? 'true' : undefined}
            data-active={active ? 'true' : undefined}
          >
            <span>{page.name}</span>
            <small>· {page.width} × {page.height}</small>
          </button>
        )}
      </div>
    </foreignObject>
  )
}

function InlineCanvasTextEditor({ object, zoom, editorRef, onCommit, onCancel }: { object: VisualObject; zoom: number; editorRef: React.Ref<InlineRichTextEditorHandle>; onCommit: (text: string, runs: TextStyleRun[]) => void; onCancel: () => void }) {
  return <InlineRichTextEditor ref={editorRef} text={object.text ?? ''} textRuns={object.textRuns} className="ide-inline-text" onCommit={onCommit} onCancel={onCancel} style={{ fontFamily: object.fontFamily, fontSize: object.fontSize * zoom, fontWeight: object.fontWeight, lineHeight: `${object.lineHeight * zoom}px`, letterSpacing: `${object.letterSpacing * zoom}px`, textAlign: object.textAlign as React.CSSProperties['textAlign'], textDecoration: object.textDecoration, color: object.fill === 'none' ? '#161616' : object.fill }} />
}
type Tool = 'Select' | 'Hand' | VisualKind | 'Arrow' | 'Pen'
const FRAME_PRESETS = [
  { group: 'Phone', name: 'Phone', width: 390, height: 844 },
  { group: 'Phone', name: 'Phone large', width: 430, height: 932 },
  { group: 'Tablet', name: 'Tablet portrait', width: 768, height: 1024 },
  { group: 'Tablet', name: 'Tablet landscape', width: 1024, height: 768 },
  { group: 'Desktop', name: 'Desktop', width: 1440, height: 1024 },
  { group: 'Desktop', name: 'Desktop HD', width: 1920, height: 1080 },
] as const
const DEFAULT_LAYOUT_GRID: NonNullable<VisualPage['layoutGrid']> = {
  visible: false,
  type: 'columns',
  size: 8,
  columns: 12,
  gutter: 24,
  margin: 80,
  color: '#ff5c7a',
  opacity: 0.12,
}
const tools: { name: Tool; key: string }[] = [
  { name: 'Select', key: 'V' },
  { name: 'Frame', key: 'F' },
  { name: 'Section', key: 'S' },
  { name: 'Rectangle', key: 'R' },
  { name: 'Ellipse', key: 'O' },
  { name: 'Line', key: 'L' },
  { name: 'Arrow', key: 'A' },
  { name: 'Pen', key: 'P' },
  { name: 'Text', key: 'T' },
  { name: 'Image', key: 'I' },
  { name: 'Component', key: 'K' },
  { name: 'Hand', key: 'H' },
]
const toolIcons = {
  Select: MousePointer2,
  Frame,
  Section: Group,
  Rectangle: Square,
  Ellipse: Circle,
  Line: Minus,
  Arrow: MoveUpRight,
  Pen: PenTool,
  Text: Type,
  Image: ImageIcon,
  Component,
  Hand,
}
function ToolIcon({ name }: { name: string }) {
  const Icon = toolIcons[name as keyof typeof toolIcons] ?? Square
  return <Icon size={17} strokeWidth={1.6} />
}
// Project Typography — the weight dropdown only ever offers what a project
// actually loads (captured @font-face data), never a generic 100-900 scale.
const FONT_WEIGHT_NAMES: Record<string, string> = {
  '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular', '500': 'Medium',
  '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black',
}
function fontWeightLabel(weight: string): string {
  const name = FONT_WEIGHT_NAMES[weight.trim()]
  return name ? `${name}, ${weight}` : weight
}
const FONT_SIZE_VALUE = /^([\d.]+)(px|rem|em|pt|%)$/
function isFontSizeValue(value: string): boolean {
  return FONT_SIZE_VALUE.test(value.trim())
}
/** Display-only conversion (assumes a 16px root) so a size token's dropdown
 * label can show real pixels — never changes how the token itself is
 * stored. */
function tokenSizeInPx(value: string): number | null {
  const match = FONT_SIZE_VALUE.exec(value.trim())
  if (!match) return null
  const n = Number.parseFloat(match[1])
  if (match[2] === 'px') return n
  if (match[2] === 'rem' || match[2] === 'em') return n * 16
  if (match[2] === 'pt') return n * (96 / 72)
  if (match[2] === '%') return (n * 16) / 100
  return null
}
export function DesignIde() {
  const [doc, setDoc] = useState<VisualDocument | null>(null)
  const [recents, setRecents] = useState<
    Awaited<ReturnType<typeof window.frameui.design.list>>
  >([])
  // Joined into Welcome's project rows for real path/framework info —
  // VisualDocument itself has neither.
  const [projectLibrary, setProjectLibrary] = useState<ProjectLibraryEntry[]>([])
  const [pageId, setPageId] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  // Stage 6 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
  // a separate selection for structured-v2 pages — deliberately not reusing
  // `selected`, which the entire legacy `VisualObject` system assumes is
  // always a `VisualObject` id. Only ever populated when `page.structured`
  // is present.
  const [selectedStructured, setSelectedStructured] = useState<string[]>([])
  // Grouping-follow-up + Stage 7 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md §18):
  // the `StructuredNode` currently in inline text-edit mode, if any.
  const [editingStructuredId, setEditingStructuredId] = useState<string | null>(null)
  const [mode, setMode] = useState('Pages')
  const [projectSection, setProjectSection] = useState<ProjectSection>('Designs')
  const [importSummary, setImportSummary] = useState('')
  // Capture is not a destination of its own — it's entered over the current
  // design's canvas (from "New Design > Capture from application" or the
  // in-editor "Capture page" action) and exited again on Done, leaving the
  // same document open the whole time.
  const [captureMode, setCaptureMode] = useState(false)
  // Resolved fresh from the parent project whenever Capture opens. A design
  // may contain an older detected/default URL, but the project-level value
  // is the user's authoritative application address.
  const [captureProjectUrl, setCaptureProjectUrl] = useState<string>()
  // True only for a document just created via "Capture from application"
  // with no name typed — the first capture seeds the document's real name
  // instead of leaving it "Untitled design".
  const [captureNamePending, setCaptureNamePending] = useState(false)
  const [pendingProject, setPendingProject] = useState<{ project: RecentProject; index: ProjectIndex | null } | null>(null)
  const [inspector, setInspector] = useState('Design')
  const [search, setSearch] = useState('')
  const [tool, setTool] = useState<Tool>('Select')
  const { camera, setCamera, navigateCamera, finishCamera, cameraGroup, cameraOverlay } = useCanvasCamera({ x: 80, y: 70, zoom: 0.65 })
  const [sourceBusy, setSourceBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<'map' | 'system' | null>(null),
    [reviewTransition, setReviewTransition] = useState('Instant'),
    [reviewHistory, setReviewHistory] = useState<string[]>([])
  const [palette, setPalette] = useState(false),
    [help, setHelp] = useState(false),
    [settings, setSettings] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [structuredPreviewOpen, setStructuredPreviewOpen] = useState(false)
  // The legacy `selected` state is cleared at each of its own many call
  // sites individually; `selectedStructured` is simpler to keep in sync
  // this way — cleared once, centrally, whenever the open page changes.
  useEffect(() => { setSelectedStructured([]); setEditingStructuredId(null) }, [pageId])
  const [context, setContext] = useState<{
    x: number
    y: number
    kind: 'object' | 'page' | 'canvas' | 'component'
    id?: string
  } | null>(null)
  const [leftWidth, setLeftWidth] = useStoredValue('frameui:left-width', 280),
    [rightWidth, setRightWidth] = useStoredValue('frameui:right-width', 280)
  const [hideUi, setHideUi] = useState(false),
    [leftHidden, setLeftHidden] = useStoredValue('frameui:left-hidden', false),
    [rightHidden, setRightHidden] = useStoredValue(
      'frameui:right-hidden',
      false,
    )
  const [recentPageIds, setRecentPageIds] = useStoredValue<string[]>(
    'frameui:recent-pages',
    [],
  )
  const [hiddenRecent, setHiddenRecent] = useStoredValue<string[]>(
    'frameui:hidden-recent',
    [],
  )
  const spacePressed = useRef(false),
    saveError = useRef<unknown>(null)
  const [editingText, setEditingText] = useState<string | null>(null)
  const inlineTextEditor = useRef<InlineRichTextEditorHandle>(null)
  const [, setSelectionScope] = useState<string | null>(null)
  const [measureTarget, setMeasureTarget] = useState<string | null>(null)
  const [smartGuides, setSmartGuides] = useState<
    { axis: 'x' | 'y'; value: number }[]
  >([])

  const [marquee, setMarquee] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const [guides, setGuides] = useState<number[]>([])
  const [hover, setHover] = useState<VisualPage | VisualObject | null>(null)
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const [present, setPresent] = useState(false)
  const [question, setQuestion] = useState<{
    label: string
    value: string
    resolve: (value: string | null) => void
  } | null>(null)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    summary?: { label: string; value: string }[]
    confirmLabel: string
    onConfirm: () => void
  } | null>(null)
  const ask = (label: string, value = '') =>
    new Promise<string | null>((resolve) =>
      setQuestion({ label, value, resolve }),
    )
  const svg = useRef<SVGSVGElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const previewGuides = useRef<SVGGElement>(null)
  const history = useRef<VisualDocument[]>([]),
    future = useRef<VisualDocument[]>([]),
    clipboard = useRef<VisualObject[]>([])
  const docRef = useRef(doc)
  docRef.current = doc
  const saveQueue = useRef(Promise.resolve())
  const pendingSave = useRef(new Map<string, VisualDocument>())
  const saveRunning = useRef(false)
  const pointerRaf = useRef(0)
  const pendingPointer = useRef<React.PointerEvent<SVGSVGElement> | null>(null)
  const dragPreview = useRef<VisualDocument | null>(null)
  const finishPreview = useRef(() => {})
  const gesture = useRef<{
    x: number
    y: number
    objects: VisualObject[]
    ids: string[]
    kind: 'move' | 'resize' | 'frame-resize' | 'draw' | 'pan' | 'radius' | 'rotate' | 'marquee'
    checkpoint?: boolean
    points?: { x: number; y: number }[]
    target?: string
    frameWidth?: number
    frameHeight?: number
    camera: typeof camera
  } | null>(null)
  const isLibrary = !!doc?.projectId && !doc.libraryId
  const [variableDraft, setVariableDraft] = useState<DesignVariable | null>(
    null,
  )
  function createVariable() {
    setVariableDraft({
      id: crypto.randomUUID(),
      name: '',
      collection: 'Colours',
      type: 'Colour',
      value: active?.fill && active.fill !== 'none' ? active.fill : '#246BFE',
    })
  }
  const [assetLibrary, setAssetLibrary] = useState<VisualDocument | null>(null)
  const resourcePages = (assetLibrary ?? doc)?.pages
  const resourceAssets = useMemo(() => mode === 'Assets' ? detectedAssets(resourcePages ?? []) : [], [resourcePages, mode])
  useEffect(() => {
    let live = true
    setAssetLibrary(null)
    if (doc?.libraryId)
      void window.frameui.design
        .load(doc.libraryId)
        .then((value) => {
          if (live) setAssetLibrary(value)
        })
        .catch((e) => setError(String(e)))
    return () => {
      live = false
    }
  }, [doc?.libraryId])
  const page = isLibrary
    ? undefined
    : (doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0])
  const canvasFrames = useMemo(() => arrangeCanvasFrames(doc?.pages ?? []), [doc?.pages])
  const activeFramePosition = canvasFrames.find((frame) => frame.page.id === page?.id) ?? { x: 0, y: 0 }
  // Structured capture is still being visually validated asynchronously.
  // Until it has a measured, close match, draw the complete editable legacy
  // model; otherwise a partially-compiled structured tree can hide content
  // that is demonstrably present in the Layers panel.
  const useStructuredCanvas = !!page && canUseStructuredCanvas(page)
  const { flat, parentIds, byId } = useMemo(() => {
    const flat: VisualObject[] = []
    const parentIds = new Map<string, string>()
    if (page) visit(page.objects, (object) => {
      flat.push(object)
      object.children.forEach(child => parentIds.set(child.id, object.id))
    })
    return { flat, parentIds, byId: new Map(flat.map(object => [object.id, object])) }
  }, [page?.objects])
  const selectionPath = (id: string) => {
    const result: VisualObject[] = []
    let current = byId.get(id)
    while (current) {
      result.unshift(current)
      current = byId.get(parentIds.get(current.id) ?? '')
    }
    return result
  }
  const isLocked = (id: string) => selectionPath(id).some((o) => o.locked)
  function enterSelection(id: string) {
    const direct = byId.get(id)
    if (!direct) return
    setSelected([direct.id])
    setSelectionScope(parentIds.get(direct.id) ?? null)
    if (direct.kind === 'Text') setEditingText(direct.id)
  }
  const active = flat.find((o) => o.id === selected[0])
  const formatInlineSelection = (style: Pick<TextStyleRun, 'fontWeight' | 'color'>) =>
    editingText === active?.id && !!inlineTextEditor.current?.applyTextStyle(style)
  useEffect(() => {
    void window.frameui.design
      .list()
      .then(setRecents)
      .catch((e) => setError(String(e)))
    void window.frameui.project.listLibrary().then(setProjectLibrary).catch(() => {})
  }, [])
  const save = useCallback(function save(next: VisualDocument) {
    pendingSave.current.set(next.id, next)
    setStatus('Saving…')
    if (saveRunning.current) return
    saveRunning.current = true
    saveQueue.current = saveQueue.current
      .then(async () => {
        while (pendingSave.current.size) {
          const latest = pendingSave.current.values().next().value!
          pendingSave.current.delete(latest.id)
          await window.frameui.design.save(latest)
        }
        saveError.current = null
        setStatus('Saved')
      })
      .catch((e) => {
        saveError.current = e
        setStatus('Not saved')
        setError(
          'Your changes are still open, but could not be saved. Check disk space and try Save again.',
        )
      })
      .finally(() => {
        saveRunning.current = false
        if (pendingSave.current.size)
          save(pendingSave.current.values().next().value!)
      })
  }, [])
  useEffect(() => {
    const flush = async () => {
      if (gesture.current && docRef.current) save(docRef.current)
      await saveQueue.current
      if (saveError.current) throw saveError.current
    }
    Object.assign(window, { frameuiFlushSaves: flush })
    return () => {
      Object.assign(window, { frameuiFlushSaves: () => saveQueue.current })
    }
  }, [save])
  useEffect(() => {
    if (page?.id && recentPageIds[0] !== page.id) {
      localStorage.setItem(`frameui:last-page:${doc?.id}`, page.id)
      setRecentPageIds(
        [page.id, ...recentPageIds.filter((id) => id !== page.id)].slice(0, 12),
      )
    }
  }, [page?.id, doc?.id, recentPageIds, setRecentPageIds])
  useEffect(() => {
    const keyup = (e: KeyboardEvent) => {
      if (e.code === 'Space') spacePressed.current = false
    }
    const finishOutsideCanvas = () => {
      spacePressed.current = false
      finishPreview.current()
      if (gesture.current && docRef.current) {
        if (gesture.current.checkpoint || gesture.current.kind === 'draw') save(docRef.current)
        if (gesture.current.kind === 'draw') setTool('Select')
      }
      gesture.current = null
      setPanning(false)
      setMarquee(null)
      setSmartGuides([])
    }
    window.addEventListener('keyup', keyup)
    window.addEventListener('pointerup', finishOutsideCanvas)
    window.addEventListener('pointercancel', finishOutsideCanvas)
    window.addEventListener('blur', finishOutsideCanvas)
    return () => {
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('pointerup', finishOutsideCanvas)
      window.removeEventListener('pointercancel', finishOutsideCanvas)
      window.removeEventListener('blur', finishOutsideCanvas)
    }
  }, [save])
  const fittedPage = useRef('')
  const fitAllAfterCapture = useRef(false)
  useEffect(() => {
    // Do not consume either fit request before the async document has produced
    // a real page and the stage ref has mounted (notably after a reload).
    if (!page || !stage.current) return
    if (fitAllAfterCapture.current) {
      fitAllAfterCapture.current = false
      requestAnimationFrame(() => fitAllFrames())
      return
    }
    // Every page is now a frame on one shared canvas. Changing the active
    // frame (including the first click of a double-click) must preserve the
    // user's camera rather than fitting the newly active frame.
    // Design mode is one shared canvas, so switching the active frame must not
    // move the camera. Presentation renders one page at a time, so its page
    // picker still needs to fit each newly presented page.
    const key = `${present}-${doc?.id}-${present ? page.id : ''}`
    if (fittedPage.current !== key) {
      fittedPage.current = key
      requestAnimationFrame(() => fit())
    }
  })
  function fit(selection = false) {
    if (!page || !stage.current) return
    let x = activeFramePosition.x,
      y = activeFramePosition.y,
      width = page.width,
      height = page.height
    if (selection && active) {
      x += selectionPath(active.id).reduce((total, object) => total + object.x, 0)
      y += selectionPath(active.id).reduce((total, object) => total + object.y, 0)
      width = active.width
      height = active.height
    }
    const rect = stage.current.getBoundingClientRect(),
      zoom = Math.min(
        2,
        Math.max(
          0.05,
          Math.min((rect.width - 100) / width, (rect.height - 100) / height),
        ),
      )
    setCamera({
      zoom,
      x: (rect.width - width * zoom) / 2 - x * zoom,
      y: (rect.height - height * zoom) / 2 - y * zoom,
    })
  }
  function startPresent() {
    setEditingText(null)
    setEditingStructuredId(null)
    setSelected([])
    setSelectedStructured([])
    setReviewHistory([])
    setPresent(true)
  }
  function fitAllFrames() {
    if (!canvasFrames.length || !stage.current) return
    const minX = Math.min(...canvasFrames.map((frame) => frame.x))
    const minY = Math.min(...canvasFrames.map((frame) => frame.y))
    const maxX = Math.max(...canvasFrames.map((frame) => frame.x + frame.page.width))
    const maxY = Math.max(...canvasFrames.map((frame) => frame.y + frame.page.height))
    const width = maxX - minX
    const height = maxY - minY
    const rect = stage.current.getBoundingClientRect()
    const zoom = Math.min(2, Math.max(0.05, Math.min((rect.width - 100) / width, (rect.height - 100) / height)))
    setCamera({
      zoom,
      x: (rect.width - width * zoom) / 2 - minX * zoom,
      y: (rect.height - height * zoom) / 2 - minY * zoom,
    })
  }
  function panelResize(side: 'left' | 'right', e: React.PointerEvent) {
    e.preventDefault()
    const x = e.clientX,
      initial = side === 'left' ? leftWidth : rightWidth
    const move = (event: PointerEvent) => {
      const width = Math.max(
        190,
        Math.min(
          420,
          initial + (event.clientX - x) * (side === 'left' ? 1 : -1),
        ),
      )
      if (side === 'left') setLeftWidth(width)
      else setRightWidth(width)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }
  const change = useCallback((next: VisualDocument, checkpoint = true) => {
    if (checkpoint && docRef.current) {
      history.current.push(docRef.current)
      if (history.current.length > 80) history.current.shift()
      future.current = []
    }
    next = { ...next, updatedAt: new Date().toISOString() }
    docRef.current = next
    setDoc(next)
    save(next)
  }, [save])
  const edit = useCallback((
    fn: (page: VisualPage, document: VisualDocument) => void,
    checkpoint = true,
  ) => {
    if (!docRef.current) return
    const next = structuredClone(docRef.current)
    const p = next.pages.find(p => p.id === page?.id)
    if (!p) return
    const existingIds = new Set(p.objects.map(o => o.id))
    fn(p, next)
    if (p.structured) p.objects.forEach(o => { if (!existingIds.has(o.id)) o.designOnly = true })
    p.edited = true
    change(next, checkpoint)
  }, [page?.id, change])
  const editStructured = useCallback((transform: (frame: import('@shared/types/structuredDesign').StructuredFrame) => import('@shared/types/structuredDesign').StructuredFrame) => {
    const current = docRef.current
    const target = current?.pages.find(p => p.id === page?.id)
    if (!current || !target?.structured) return
    const structured = transform(target.structured)
    if (structured !== target.structured) change({ ...current, pages: current.pages.map(p => p === target ? { ...p, structured, edited: true } : p) })
  }, [page?.id, change])
  const commitStructuredText = useCallback((id: string, text: string, runs?: TextStyleRun[]) => {
    editStructured(frame => updateStructuredNodeText(frame, id, text, runs))
    setEditingStructuredId(null)
  }, [editStructured])
  const selectStructured = useCallback((ids: string[]) => {setSelectedStructured(ids);setSelected([]);setSelectedFrameId(null)}, [])
  const enterStructuredText = useCallback((id: string) => {
    setSelectedStructured([id])
    setEditingStructuredId(id)
  }, [])
  const commitStructuredBounds = useCallback((updates: {id: string; bounds: Partial<import('@shared/types/structuredDesign').StructuredNode['bounds']>}[]) => {
    editStructured(frame => updateStructuredNodeBounds(frame, updates))
  }, [editStructured])
  function patch(values: Partial<VisualObject>) {
    edit((p, d) => {
      visit(p.objects, (o) => {
        if (
          selected.includes(o.id) &&
          (!isLocked(o.id) || values.locked === false)
        ) {
          const { width, height, ...rest } = values
          if (width !== undefined || height !== undefined)
            resizeVisualObject(o, width ?? o.width, height ?? o.height)
          Object.assign(o, rest)
          if (values.layout) applyVisualLayout(o)
          if (o.kind === 'Instance')
            o.overrides = [
              ...new Set([...(o.overrides ?? []), ...Object.keys(values)]),
            ]
        }
      })
      visit(p.objects, (o) => {
        if (o.kind === 'Component' && selected.includes(o.id)) {
          const i = d.components.findIndex((c) => c.id === o.id)
          if (i >= 0) d.components[i] = structuredClone(o)
          for (const page of d.pages)
            visit(page.objects, (instance) => {
              if (instance.componentId !== o.id) return
              for (const [key, value] of Object.entries(values)) {
                if (
                  !instance.overrides?.includes(key) &&
                  !['id', 'x', 'y', 'kind'].includes(key)
                )
                  Object.assign(instance, { [key]: structuredClone(value) })
              }
            })
        }
      })
    })
  }
  function commitInlineText(pageId: string, objectId: string, text: string, textRuns?: TextStyleRun[]) {
    if (!docRef.current) return
    const next = structuredClone(docRef.current)
    const targetPage = next.pages.find((candidate) => candidate.id === pageId)
    if (!targetPage) return
    visit(targetPage.objects, (object) => {
      if (object.id === objectId) { object.text = text; object.textRuns = textRuns }
    })
    targetPage.edited = true
    change(next)
  }
  function moveCanvasFrame(
    pageId: string,
    fallbackX: number,
    fallbackY: number,
    screenDx: number,
    screenDy: number,
  ) {
    if (!docRef.current) return
    const next = structuredClone(docRef.current)
    const targetPage = next.pages.find((candidate) => candidate.id === pageId)
    if (!targetPage) return
    targetPage.canvasX = (targetPage.canvasX ?? fallbackX) + screenDx / camera.zoom
    targetPage.canvasY = (targetPage.canvasY ?? fallbackY) + screenDy / camera.zoom
    change(next, false)
  }
  function open(next: VisualDocument) {
    setDoc(next)
    setMode(next.libraryId ? 'Layers' : 'Pages')
    docRef.current = next
    setPageId(
      localStorage.getItem(`frameui:last-page:${next.id}`) ??
        next.pages[0]?.id ??
        '',
    )
    setSelected([])
    history.current = []
    future.current = []
  }
  const importSummaryTimer = useRef<ReturnType<typeof setTimeout>>()
  function announceImport(next: VisualDocument) {
    const pages = next.pageRegistry?.length ?? 0
    const styles = next.variables.length
    const components = next.sourceComponents?.length ?? 0
    setImportSummary([pages && `${pages} pages`, components && `${components} components`, styles && `${styles} styles`].filter(Boolean).join(' · ') || 'Project scanned')
    clearTimeout(importSummaryTimer.current)
    importSummaryTimer.current = setTimeout(() => setImportSummary(''), 4000)
  }
  function buildProjectDocument(project: RecentProject, index: ProjectIndex | null, name: string, appUrl: string): VisualDocument {
    const next = newDocument(name)
    next.projectId = project.id
    next.appUrl = appUrl.trim() || undefined
    next.pages = []
    next.pageRegistry = (index?.projectModel.pages ?? []).filter(page => page.route).map(page => ({
      pattern: page.route!, url: page.route!, name: page.name, source: page.source.filePath,
      needsSample: false, authProfile: 'standard', area: page.area, status: 'Discovered',
    }))
    next.sourceComponents = (index?.projectModel.components ?? []).map(c => ({ id: c.id, name: c.name, file: c.source.filePath }))
    next.variables = (index?.projectModel.tokens ?? [])
      .filter((t) => t.confidence === 'full')
      .map((t) => ({
        id: t.id,
        name: t.name,
        collection:
          t.category === 'color'
            ? 'Colours'
            : t.category === 'radius'
              ? 'Radius'
              : t.category === 'spacing'
                ? 'Spacing'
                : t.category === 'typography'
                  ? 'Typography'
                  : t.category === 'effect'
                    ? 'Shadows'
                    : 'Variables',
        type:
          t.category === 'color'
            ? 'Colour'
            : ['radius', 'spacing'].includes(t.category)
              ? 'Number'
              : 'String',
        value: t.value,
      }))
    return next
  }
  async function openProject(projectPath?: string) {
    setStatus('Scanning repository…')
    setError('')
    try {
      const result = projectPath
        ? await window.frameui.project.openPath(projectPath).then(result => {
          if (!result.ok) throw new Error('This project folder is unavailable. Choose its current location with Open Codebase.')
          return { cancelled: false as const, project: result.project }
        })
        : await window.frameui.project.openDialog()
      if (result.cancelled) {
        setStatus('')
        return
      }
      const saved = (await window.frameui.design.list()).find(
        (d) => d.projectId === result.project.id && !d.libraryId,
      )
      if (saved) {
        const existing = await window.frameui.design.load(saved.id)
        if (existing) {
          open(existing)
          setStatus('Saved design opened')
          return
        }
      }
      setPendingProject({ project: result.project, index: null })
      setStatus('')
    } catch (e) {
      setError(String(e))
      setStatus('')
    }
  }
  function confirmProjectSetup(name: string, appUrl: string, index: ProjectIndex | null, destination: 'review' | 'editor') {
    if (!pendingProject) return
    const next = buildProjectDocument(pendingProject.project, index, name, appUrl)
    save(next)
    if (destination === 'review') {
      setProjectSection('Pages')
      open(next)
    } else {
      const design = newDocument('Untitled design')
      design.projectId = next.projectId
      design.libraryId = next.id
      design.appUrl = next.appUrl
      design.variables = structuredClone(next.variables)
      open(design)
      save(design)
    }
    setPendingProject(null)
  }
  function undo(redo = false) {
    const from = redo ? future : history,
      to = redo ? history : future
    const next = from.current.pop()
    if (next && doc) {
      to.current.push(doc)
      setDoc(next)
      docRef.current = next
      save(next)
    }
  }
  function duplicate() {
    const ids: string[] = []
    edit((p) => {
      p.objects = editSiblings(p.objects, new Set(selected), (siblings) =>
        siblings.flatMap((o) => {
          if (!selected.includes(o.id)) return [o]
          const copy = { ...cloneObject(o), x: o.x + 24, y: o.y + 24 }
          ids.push(copy.id)
          return [o, copy]
        }),
      )
    })
    setSelected(ids)
  }
  function group() {
    const ids: string[] = []
    edit((p) => {
      p.objects = editSiblings(p.objects, new Set(selected), (siblings) => {
        const members = siblings.filter((o) => selected.includes(o.id))
        if (members.length < 2) return siblings
        const x = Math.min(...members.map((o) => o.x)),
          y = Math.min(...members.map((o) => o.y))
        const group = object('Group', {
          x,
          y,
          width: Math.max(...members.map((o) => o.x + o.width)) - x,
          height: Math.max(...members.map((o) => o.y + o.height)) - y,
          fill: 'none',
          children: members.map((o) => ({ ...o, x: o.x - x, y: o.y - y })),
        })
        ids.push(group.id)
        const index = siblings.findIndex((o) => selected.includes(o.id)),
          remaining = siblings.filter((o) => !selected.includes(o.id))
        remaining.splice(index, 0, group)
        return remaining
      })
    })
    if (ids.length) setSelected(ids)
  }
  function ungroup() {
    edit((p) => {
      p.objects = editSiblings(p.objects, new Set(selected), (siblings) =>
        siblings.flatMap((o) =>
          selected.includes(o.id) && o.children.length
            ? o.children.map((c) => ({ ...c, x: c.x + o.x, y: c.y + o.y }))
            : [o],
        ),
      )
    })
    setSelected([])
  }
  function reorder(front: boolean, all = false) {
    edit((p) => {
      p.objects = editSiblings(p.objects, new Set(selected), (siblings) => {
        for (const id of front ? [...selected].reverse() : selected) {
          const i = siblings.findIndex((o) => o.id === id)
          if (i < 0) continue
          const [o] = siblings.splice(i, 1)
          siblings.splice(
            all
              ? front
                ? siblings.length
                : 0
              : Math.max(0, Math.min(siblings.length, i + (front ? 1 : -1))),
            0,
            o,
          )
        }
        return siblings
      })
    })
  }
  function addPage() {
    const p = newPage()
    if (doc) {
      change({ ...doc, pages: [...doc.pages, p] })
      setPageId(p.id)
      setSelected([])
      setSelectedFrameId(p.id)
    }
  }
  function addFramePreset(name: string, width: number, height: number) {
    if (!doc) return
    const frame = { ...newPage(name), width, height }
    change({ ...doc, pages: [...doc.pages, frame] })
    setPageId(frame.id)
    setSelected([])
    setSelectedFrameId(frame.id)
    setTool('Select')
    fitAllAfterCapture.current = true
  }
  function chooseTool(next: Tool) {
    setTool(next)
    if (next === 'Frame') {
      setEditingText(null)
      setSelected([])
      setSelectedStructured([])
      setInspector('Design')
      setRightHidden(false)
    }
  }
  function updateLayoutGrid(patchValue: Partial<NonNullable<VisualPage['layoutGrid']>>) {
    edit((current) => {
      current.layoutGrid = { ...DEFAULT_LAYOUT_GRID, ...current.layoutGrid, ...patchValue }
    })
  }
  function component() {
    if (!active || !doc) return
    const master = cloneObject(active)
    master.kind = 'Component'
    master.name = active.name
    edit((p, d) => {
      d.components.push(master)
      visit(p.objects, (o) => {
        if (o.id === active.id) {
          o.kind = 'Instance'
          o.componentId = master.id
        }
      })
    })
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable]',
        )
      )
        return
      const mod = e.metaKey || e.ctrlKey
      // Stage 6 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md),
      // extended by the grouping-follow-up + Stage 7 (text editing): a
      // small, separate set of shortcuts for `selectedStructured` — kept
      // ahead of the legacy `VisualObject` chain below so the two never
      // both fire for the same keypress. Escape is deliberately NOT
      // early-returned here — it also exits present mode/closes dialogs
      // below, so clearing the structured selection just falls through.
      // (Escape/Cmd-Enter while actually mid-edit never reach this handler
      // at all — the Text `<span>` is `[contenteditable]`, which the very
      // first check in this listener already returns early on.)
      if (e.key === 'Escape') setSelectedStructured([])
      if (page?.structured && selectedStructured.length) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          editStructured(frame => removeStructuredNodes(frame, selectedStructured))
          setSelectedStructured([])
          return
        }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
          editStructured(frame => {
            const updates = selectedStructured
              .map((id) => {
                const node = findStructuredNode(frame.children, id)
                return node ? { id, bounds: { x: node.bounds.x + dx, y: node.bounds.y + dy } } : undefined
              })
              .filter((u): u is { id: string; bounds: { x: number; y: number } } => !!u)
            return updateStructuredNodeBounds(frame, updates)
          })
          return
        }
        if (e.key === 'Enter' && selectedStructured.length === 1 && !editingStructuredId) {
          const node = findStructuredNode(page.structured.children, selectedStructured[0])
          if (node?.type === 'Text') {
            e.preventDefault()
            setEditingStructuredId(node.id)
            return
          }
        }
        if (mod && e.key.toLowerCase() === 'g') {
          e.preventDefault()
          const frame = page.structured
          if (e.shiftKey) {
            const node = findStructuredNode(frame.children, selectedStructured[0])
            if (selectedStructured.length === 1 && node?.type === 'Group' && node.children.length > 0) {
              editStructured(frame => ungroupStructuredNodes(frame, [selectedStructured[0]]))
              setSelectedStructured(node.children.map((c) => c.id))
            }
          } else {
            const result = groupStructuredNodes(frame, selectedStructured)
            if (result) {
              editStructured(() => result.frame)
              setSelectedStructured([result.groupId])
            }
          }
          return
        }
      }
      if (
        mod &&
        ['z', 'd', 'c', 'v', 'g', 'a', 's', '+', '=', '-', '0'].includes(
          e.key.toLowerCase(),
        )
      )
        e.preventDefault()
      if (e.code === 'Space') {
        e.preventDefault()
        spacePressed.current = true
        return
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        setHideUi((v) => !v)
        return
      }
      if (e.key === '?' || (mod && e.key === '/')) {
        e.preventDefault()
        setHelp(true)
        return
      }
      if (mod && e.key === ',') {
        e.preventDefault()
        setSettings(true)
        return
      }
      if (!mod && e.code === 'Digit1' && e.shiftKey) {
        fit()
        return
      }
      if (!mod && e.code === 'Digit2' && e.shiftKey) {
        fit(true)
        return
      }
      if (mod && e.key === 'z') undo(e.shiftKey)
      else if (mod && e.key === 's' && doc) save(doc)
      else if (mod && e.key === 'd') duplicate()
      else if (mod && e.key === 'a')
        setSelected(
          (page?.objects ?? []).filter((o) => !o.locked).map((o) => o.id),
        )
      else if (mod && e.key === 'c')
        clipboard.current = flat
          .filter((o) => selected.includes(o.id))
          .map(cloneObject)
      else if (mod && e.key === 'v') {
        const copies = clipboard.current.map((o) => ({
          ...cloneObject(o),
          x: o.x + 24,
          y: o.y + 24,
        }))
        edit((p) => p.objects.push(...copies))
        setSelected(copies.map((o) => o.id))
      } else if (mod && e.key === 'g') {
        if (e.shiftKey) ungroup()
        else group()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        edit((p) => {
          p.objects = removeObjects(
            p.objects,
            new Set(
              selected.filter((id) => !flat.find((o) => o.id === id)?.locked),
            ),
          )
        })
        setSelected([])
      } else if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        e.preventDefault()
        edit((p) =>
          visit(p.objects, (o) => {
            if (selected.includes(o.id) && !isLocked(o.id)) {
              o.x +=
                (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0) *
                (e.shiftKey ? 10 : 1)
              o.y +=
                (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0) *
                (e.shiftKey ? 10 : 1)
            }
          }),
        )
      } else if (e.key === 'Enter' && active?.children.length) {
        setSelectionScope(active.id)
        setSelected([active.children[0].id])
      } else if (e.key === 'Escape') {
        setEditingText(null)
        const parent = active ? parentIds.get(active.id) : undefined
        setSelectionScope(parent ? (parentIds.get(parent) ?? null) : null)
        setSelected(parent ? [parent] : [])
        setTool('Select')
        setPresent(false)
      } else if (mod && ['+', '=', '-', '0'].includes(e.key))
        setCamera((c) => ({
          ...c,
          zoom:
            e.key === '0'
              ? 1
              : Math.min(
                  8,
                  Math.max(0.05, c.zoom * (e.key === '-' ? 0.8 : 1.25)),
                ),
        }))
      else if (!mod && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        updateLayoutGrid({ visible: !(page?.layoutGrid?.visible ?? false) })
      } else if (!mod) {
        const t = tools.find((t) => t.key.toLowerCase() === e.key.toLowerCase())
        if (t) chooseTool(t.name)
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  })
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.ide-tools')) return
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const dx = e.deltaX * unit, dy = e.deltaY * unit
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect(),
          x = e.clientX - rect.left,
          y = e.clientY - rect.top
        navigateCamera((c) => {
          const zoom = Math.min(
            8,
            Math.max(0.05, c.zoom * Math.exp(-dy * 0.006)),
          )
          return {
            zoom,
            x: x - ((x - c.x) * zoom) / c.zoom,
            y: y - ((y - c.y) * zoom) / c.zoom,
          }
        })
      } else navigateCamera((c) => ({ ...c, x: c.x - (e.shiftKey && !dx ? dy : dx), y: c.y - (e.shiftKey && !dx ? 0 : dy) }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [doc?.id, captureMode])
  function pointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!page) return
    if (present) {
      const id = (e.target as Element)
        .closest('[data-object-id]')
        ?.getAttribute('data-object-id')
      const target = id
        ? selectionPath(id)
            .reverse()
            .find((o) => o.interaction?.trigger === 'Click')
        : undefined
      if (target?.interaction) {
        setReviewHistory([...reviewHistory, page.id])
        setReviewTransition(target.interaction.transition)
        setPageId(target.interaction.targetPageId)
      }
      return
    }
    if (e.button === 2) return
    const clickedFrameId = (e.target as Element)
      .closest('[data-canvas-page-id]')
      ?.getAttribute('data-canvas-page-id')
    const frameSurfaceId = (e.target as Element).getAttribute('data-canvas-surface')
    const frameResizeHandle = (e.target as Element).getAttribute('data-frame-resize-handle')
    const panGesture = e.button === 1 || tool === 'Hand' || spacePressed.current
    if (clickedFrameId && clickedFrameId !== page.id && !panGesture) {
      setPageId(clickedFrameId)
      setSelected([])
      setSelectedFrameId(clickedFrameId)
      setSelectionScope(null)
      return
    }
    // Captured nodes handle direct selection and drag previews separately.
    // The legacy marquee must not capture their pointer to the SVG root:
    // that retargets the second click and prevents inline text editing.
    if (useStructuredCanvas && tool === 'Select' && !panGesture &&
      (e.target as Element).closest('[data-structured-id]')) return
    if (!panGesture && selectedStructured.length) setSelectedStructured([])
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left - camera.x) / camera.zoom - activeFramePosition.x,
      y = (e.clientY - rect.top - camera.y) / camera.zoom - activeFramePosition.y
    const target =
      (e.target as Element)
        .closest('[data-object-id]')
        ?.getAttribute('data-object-id') ?? undefined
    const handle = (e.target as Element).getAttribute('data-handle')
    let ids = selected,
      kind:
        | 'move'
        | 'resize'
        | 'frame-resize'
        | 'draw'
        | 'pan'
        | 'radius'
        | 'rotate'
        | 'marquee' = 'move'
    if (panGesture) {
      kind = 'pan'
      setPanning(true)
    }
    else if (frameResizeHandle === 'bottom-right') {
      kind = 'frame-resize'
      ids = []
      setSelected([])
      setSelectedFrameId(page.id)
    }
    else if (handle === 'resize') kind = 'resize'
    else if (handle === 'radius') kind = 'radius'
    else if (handle === 'rotate') kind = 'rotate'
    else if (tool !== 'Select') {
      kind = 'draw'
      const projectText = flat.find(item => item.kind === 'Text' && item.fontSize >= 12 && item.fontSize <= 20)
      const o = object(
        tool === 'Arrow'
          ? 'Line'
          : tool === 'Pen'
            ? 'Vector'
            : (tool as VisualKind),
        {
          x,
          y,
          width: tool === 'Text' ? 240 : 1,
          height: tool === 'Text' ? (projectText?.lineHeight || 24) : 1,
          ...(tool === 'Text' ? { fontFamily: projectText?.fontFamily || page.fonts?.[0]?.family || 'Arial, sans-serif', fontSize: projectText?.fontSize || 16, fontWeight: projectText?.fontWeight || '400', lineHeight: projectText?.lineHeight || 24 } : {}),
          arrow: tool === 'Arrow',
          fill: ['Text', 'Pen'].includes(tool)
            ? '#24262b'
            : ['Line', 'Arrow'].includes(tool)
              ? 'none'
              : '#d9dce5',
          stroke: ['Line', 'Arrow', 'Pen'].includes(tool) ? '#24262b' : 'none',
          strokeWidth: ['Line', 'Arrow', 'Pen'].includes(tool) ? 2 : 0,
          text: tool === 'Text' ? 'Text' : undefined,
        },
      )
      edit((p) => p.objects.push(o))
      ids = [o.id]
      setSelected(ids)
      setSelectedFrameId(null)
    } else if (target) {
      const o = flat.find((o) => o.id === target)
      if (o && isLocked(o.id)) return
      ids = e.shiftKey
        ? [...new Set([...selected, target])]
        : selected.includes(target)
          ? selected
          : [target]
      setSelected(ids)
      setSelectedFrameId(null)
    } else {
      kind = 'marquee'
      ids = e.shiftKey ? selected : []
      setSelected(ids)
      setSelectedFrameId(frameSurfaceId === page.id ? page.id : null)
    }
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      objects:
        docRef.current?.pages.find((p) => p.id === page.id)?.objects ?? [],
      ids,
      kind,
      target,
      frameWidth: page.width,
      frameHeight: page.height,
      camera,
      points: [],
    }
    // Preserve the native click/double-click target until movement crosses
    // the drag threshold. A window-level pointerup guard above clears a
    // below-threshold gesture even if the pointer is released off-canvas.
    if (kind !== 'move') e.currentTarget.setPointerCapture(e.pointerId)
  }
  function flushPointer() {
    cancelAnimationFrame(pointerRaf.current)
    pointerRaf.current = 0
    const event = pendingPointer.current
    pendingPointer.current = null
    if (event) applyPointerMove(event)
  }
  finishPreview.current = () => {
    flushPointer()
    previewGuides.current?.replaceChildren()
    if (dragPreview.current) {
      docRef.current = dragPreview.current
      setDoc(dragPreview.current)
      dragPreview.current = null
    }
  }
  function pointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!gesture.current || gesture.current.kind === 'pan') { applyPointerMove(e); return }
    // React clears currentTarget after dispatch; retain only the event fields
    // used by the gesture and process the latest sample once per paint.
    pendingPointer.current = { clientX:e.clientX, clientY:e.clientY, shiftKey:e.shiftKey, altKey:e.altKey, pointerId:e.pointerId, target:e.target, currentTarget:e.currentTarget } as React.PointerEvent<SVGSVGElement>
    if (!pointerRaf.current) pointerRaf.current = requestAnimationFrame(flushPointer)
  }
  function applyPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (present) return
    if (e.altKey && active) {
      const id = (e.target as Element)
        .closest('[data-object-id]')
        ?.getAttribute('data-object-id')
      setMeasureTarget(id && id !== active.id ? id : null)
    } else if (measureTarget) setMeasureTarget(null)
    const g = gesture.current
    if (!g || !page) return
    if (g.kind === 'move' && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 3)
      return
    if (!e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.setPointerCapture(e.pointerId)
    if (
      !g.checkpoint &&
      !['pan', 'marquee', 'draw'].includes(g.kind) &&
      docRef.current
    ) {
      history.current.push(docRef.current)
      if (history.current.length > 80) history.current.shift()
      future.current = []
      g.checkpoint = true
    }
    const dx = (e.clientX - g.x) / camera.zoom,
      dy = (e.clientY - g.y) / camera.zoom
    if (g.kind === 'marquee') {
      setSelectedFrameId(null)
      const rect = e.currentTarget.getBoundingClientRect(),
        startX = (g.x - rect.left - camera.x) / camera.zoom - activeFramePosition.x,
        startY = (g.y - rect.top - camera.y) / camera.zoom - activeFramePosition.y
      const box = {
        x: startX + Math.min(0, dx),
        y: startY + Math.min(0, dy),
        width: Math.abs(dx),
        height: Math.abs(dy),
      }
      setMarquee(box)
      const ids = [...g.ids]
      const walk = (objects: VisualObject[], x = 0, y = 0) => {
        for (const o of objects) {
          if (o.hidden || o.locked) continue
          const ox = x + o.x,
            oy = y + o.y
          if (
            ox >= box.x &&
            oy >= box.y &&
            ox + o.width <= box.x + box.width &&
            oy + o.height <= box.y + box.height
          )
            ids.push(o.id)
          else walk(o.children, ox, oy)
        }
      }
      walk(page.objects)
      setSelected([...new Set(ids)])
      return
    }
    if (g.kind === 'pan') {
      navigateCamera({
        ...g.camera,
        x: g.camera.x + e.clientX - g.x,
        y: g.camera.y + e.clientY - g.y,
      })
      return
    }
    if (g.kind === 'frame-resize') {
      if (!g.checkpoint && docRef.current) {
        history.current.push(docRef.current)
        if (history.current.length > 80) history.current.shift()
        future.current = []
        g.checkpoint = true
      }
      const current = docRef.current!
      const original = current.pages.find(candidate => candidate.id === page.id)
      if (!original) return
      const targetPage = { ...original, structured: original.structured ? { ...original.structured } : undefined }
      const next = { ...current, pages: current.pages.map(candidate => candidate.id === page.id ? targetPage : candidate) }
      targetPage.width = Math.max(64, Math.round((g.frameWidth ?? targetPage.width) + dx))
      targetPage.height = Math.max(64, Math.round((g.frameHeight ?? targetPage.height) + dy))
      if (targetPage.structured) {
        targetPage.structured.width = targetPage.width
        targetPage.structured.height = targetPage.height
      }
      targetPage.edited = true
      next.updatedAt = new Date().toISOString()
      docRef.current = next
      setDoc(next)
      return
    }
    const detectedGuides: { axis: 'x' | 'y'; value: number }[] = []
    const objects = updateVisualSelection(
      g.objects,
      new Set(g.ids),
      (o) => {
        if (isLocked(o.id)) return
        if (g.kind === 'rotate') {
          o.rotation =
            Math.round((o.rotation + dx) / (e.shiftKey ? 15 : 1)) *
            (e.shiftKey ? 15 : 1)
        } else if (g.kind === 'move') {
          o.x += e.shiftKey && Math.abs(dy) > Math.abs(dx) ? 0 : dx
          o.y += e.shiftKey && Math.abs(dx) > Math.abs(dy) ? 0 : dy
          if (!e.altKey) {
            const siblings =
              byId.get(parentIds.get(o.id) ?? '')?.children ?? page.objects
            const candidates = siblings.filter((c) => !g.ids.includes(c.id))
            const parentPath = selectionPath(o.id).slice(0, -1)
            const offsetX = parentPath.reduce((n, p) => n + p.x, 0),
              offsetY = parentPath.reduce((n, p) => n + p.y, 0)
            for (const axis of ['x', 'y'] as const) {
              const size = axis === 'x' ? 'width' : 'height'
              let best = 6 / camera.zoom,
                correction = 0,
                line: number | undefined
              const targets = [
                ...candidates
                  .map((c) => [
                    c[axis],
                    c[axis] + c[size] / 2,
                    c[axis] + c[size],
                  ])
                  .flat(),
              ]
              const parent = byId.get(parentIds.get(o.id) ?? '')
              if (parent) targets.push(0, parent[size] / 2, parent[size])
              for (const own of [
                o[axis],
                o[axis] + o[size] / 2,
                o[axis] + o[size],
              ])
                for (const target of targets) {
                  const delta = target - own
                  if (Math.abs(delta) < best) {
                    best = Math.abs(delta)
                    correction = delta
                    line = target
                  }
                }
              if (line !== undefined) {
                o[axis] += correction
                detectedGuides.push({
                  axis,
                  value: line + (axis === 'x' ? offsetX : offsetY),
                })
              }
            }
            for (const guide of guides)
              if (Math.abs(o.x - guide) < 6 / camera.zoom) o.x = guide
            const snapSize = page.layoutGrid?.visible && page.layoutGrid.type === 'grid' ? page.layoutGrid.size : 0
            if (snapSize) {
              o.x = Math.round(o.x / snapSize) * snapSize
              o.y = Math.round(o.y / snapSize) * snapSize
            }
          }
        } else if (g.kind === 'radius') {
          o.radius = [
            Math.max(0, Math.min(o.width / 2, dx)),
            Math.max(0, dx),
            Math.max(0, dx),
            Math.max(0, dx),
          ]
        } else {
          if (g.kind === 'resize')
            resizeVisualObject(o, o.width + dx, o.height + dy)
          else {
            o.width = Math.max(1, Math.abs(dx))
            o.height = Math.max(1, Math.abs(dy))
          }
          if (g.kind === 'draw') {
            o.x += Math.min(0, dx)
            o.y += Math.min(0, dy)
            if (o.kind === 'Vector') {
              g.points?.push({ x: dx, y: dy })
              const points = g.points ?? []
              const minX = Math.min(0, ...points.map((p) => p.x)),
                minY = Math.min(0, ...points.map((p) => p.y))
              o.x -= Math.min(0, dx)
              o.y -= Math.min(0, dy)
              o.x += minX
              o.y += minY
              o.width = Math.max(1, ...points.map((p) => p.x - minX))
              o.height = Math.max(1, ...points.map((p) => p.y - minY))
              o.path =
                `M ${-minX} ${-minY} ` +
                points.map((p) => `L ${p.x - minX} ${p.y - minY}`).join(' ')
            }
          }
        }
      },
      g.kind === 'resize',
    )
    if (g.kind !== 'move') setSmartGuides(detectedGuides)
    else previewGuides.current?.replaceChildren(...detectedGuides.map(guide => {
      const line = document.createElementNS('http://www.w3.org/2000/svg','line')
      const attrs = {x1:guide.axis==='x'?guide.value:-10000,x2:guide.axis==='x'?guide.value:10000,y1:guide.axis==='y'?guide.value:-10000,y2:guide.axis==='y'?guide.value:10000,stroke:'#3b82f6','stroke-width':1/camera.zoom,'stroke-dasharray':`${4/camera.zoom} ${3/camera.zoom}`}
      for (const [key,value] of Object.entries(attrs)) line.setAttribute(key,String(value))
      return line
    }))
    const next = {
      ...docRef.current!,
      pages: docRef.current!.pages.map((p) =>
        p.id === page.id ? { ...p, objects, edited: true } : p,
      ),
    }
    docRef.current = next
    if (g.kind === 'move') {
      dragPreview.current = next
      const walk = (items: VisualObject[], x=0, y=0) => {
        for (const item of items) {
          if (g.ids.includes(item.id)) {
            const node = svg.current?.querySelector(`[data-object-id="${CSS.escape(item.id)}"]`)
            node?.setAttribute('transform', `translate(${item.x} ${item.y}) rotate(${item.rotation} ${item.width/2} ${item.height/2})`)
            svg.current?.querySelector(`[data-selection-id="${CSS.escape(item.id)}"]`)?.setAttribute('transform', `translate(${x+item.x} ${y+item.y})`)
          }
          if (item.children.length) walk(item.children,x+item.x,y+item.y)
        }
      }
      walk(objects)
    } else setDoc(next)
  }
  function pointerUp(e?: React.PointerEvent<SVGSVGElement>) {
    finishPreview.current()
    finishCamera()
    if (gesture.current && docRef.current) {
      if (gesture.current.checkpoint || gesture.current.kind === 'draw')
        save(docRef.current)
      if (gesture.current.kind === 'draw') setTool('Select')
    }
    gesture.current = null
    setPanning(false)
    setMarquee(null)
    setSmartGuides([])
    if (e?.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  function addLibraryAsset(
    asset: LibraryAsset,
    position?: { x: number; y: number },
  ) {
    if (!page || !docRef.current) return
    const at = position ?? {
      x: 40 + page.objects.length * 24,
      y: 40 + page.objects.length * 24,
    }
    const needed = new Set<string>()
    let added: VisualObject
    if (asset.kind === 'screen') {
      const source = asset.page
      added = object('Frame', {
        name: source.name,
        x: at.x,
        y: at.y,
        width: source.width,
        height: source.height,
        fill: '#ffffff',
        clip: false,
        children: source.objects.map(cloneObject),
        source: { route: source.route },
      })
      visit(added.children, (o) => {
        if (o.componentId) needed.add(o.componentId)
      })
    } else {
      const master = asset.component
      const variant = master.variants?.find((v) => v.id === asset.variant)
      added = {
        ...cloneObject(variant?.objects[0] ?? master),
        kind: 'Instance',
        componentId: master.id,
        x: at.x,
        y: at.y,
        variant: variant?.properties ?? { State: 'Normal' },
      }
      needed.add(master.id)
    }
    edit((p, d) => {
      p.objects.push(added)
      p.width = Math.max(p.width, added.x + added.width + 40)
      p.height = Math.max(p.height, added.y + added.height + 40)
      if (asset.kind === 'screen')
        p.fonts = [...(p.fonts ?? []), ...(asset.page.fonts ?? [])].filter(
          (font, index, all) =>
            all.findIndex(
              (f) =>
                f.family === font.family &&
                f.weight === font.weight &&
                f.style === font.style,
            ) === index,
        )
      if(asset.kind==='component' && !d.components.some(c=>c.id===asset.component.id)) d.components.push(structuredClone(asset.component))
      d.components.push(
        ...(assetLibrary?.components ?? docRef.current?.components ?? [])
          .filter(
            (c) =>
              needed.has(c.id) &&
              !d.components.some((existing) => existing.id === c.id),
          )
          .map((c) => structuredClone(c)),
      )
    })
    setSelected([added.id])
    setSelectionScope(null)
    setTool('Select')
    if (!position)
      setCamera({
        zoom: Math.min(
          0.7,
          Math.max(
            0.4,
            (stage.current?.clientWidth ?? 800) / (added.width + 160),
          ),
        ),
        x: 40 - at.x * 0.5,
        y: 40 - at.y * 0.5,
      })
  }
  async function imageFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const o = object('Image', {
        name: file.name.replace(/\.[^.]+$/, ''),
        src: String(reader.result),
        width: 320,
        height: 240,
      })
      edit((p) => p.objects.push(o))
      setSelected([o.id])
    }
    reader.readAsDataURL(file)
  }
  const field = (
    label: string,
    key:
      | 'x'
      | 'y'
      | 'width'
      | 'height'
      | 'rotation'
      | 'strokeWidth'
      | 'fontSize'
      | 'lineHeight'
      | 'letterSpacing'
      | 'blur',
    min?: number,
  ) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min={min}
        placeholder="Mixed"
        value={
          flat.some((o) => selected.includes(o.id) && o[key] !== active?.[key])
            ? ''
            : Math.round((active?.[key] ?? 0) * 100) / 100
        }
        onChange={(e) => patch({ [key]: Number(e.target.value) })}
      />
    </label>
  )
  const layers = useCallback(function layers(objects: VisualObject[], depth = 0): React.ReactNode {
    return objects.map((o) => (
      <details
        key={o.id}
        open
        className="ide-layer"
        style={{ marginLeft: depth ? 10 : 0 }}
      >
        <summary
          className={selected.includes(o.id) ? 'selected' : ''}
          onClick={(e) => {
            e.preventDefault()
            setSelected(e.shiftKey ? [...new Set([...selected, o.id])] : [o.id])
          }}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('layer', o.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('layer')
            edit((p) => {
              const from = p.objects.findIndex((n) => n.id === id),
                to = p.objects.findIndex((n) => n.id === o.id)
              if (from >= 0 && to >= 0) {
                const [item] = p.objects.splice(from, 1)
                p.objects.splice(to, 0, item)
              }
            })
          }}
        >
          <span
            onClick={(e) => {
              e.stopPropagation()
              const parent = e.currentTarget.closest('details')
              if (parent) parent.open = !parent.open
            }}
          >
            {o.children.length ? '⌄' : '·'}
          </span>
          <ToolIcon name={o.kind} />
          <InlineName
            value={o.name}
            label="Layer name"
            onChange={(name) =>
              edit((p) =>
                visit(p.objects, (n) => {
                  if (n.id === o.id) n.name = name
                }),
              )
            }
          />

          <button
            title={o.locked ? 'Unlock' : 'Lock'}
            onClick={(e) => {
              e.stopPropagation()
              edit((p) =>
                visit(p.objects, (n) => {
                  if (n.id === o.id) n.locked = !n.locked
                }),
              )
            }}
          >
            {o.locked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button
            title={o.hidden ? 'Show' : 'Hide'}
            onClick={(e) => {
              e.stopPropagation()
              edit((p) =>
                visit(p.objects, (n) => {
                  if (n.id === o.id) n.hidden = !n.hidden
                }),
              )
            }}
          >
            {o.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </summary>
        {layers(o.children, depth + 1)}
      </details>
    ))
  }, [selected, edit])
  const visibleLayerTree = useMemo(() => {
    if(mode!=='Layers'||!page) return null
    const objects=useStructuredCanvas?page.objects.filter(o=>o.designOnly):page.objects
    if(!search) return layers(objects)
    const matches:VisualObject[]=[]
    visit(objects,object=>{if(object.name.toLowerCase().includes(search.toLowerCase()))matches.push({...object,children:[]})})
    return layers(matches)
  },[mode,page?.objects,search,layers,useStructuredCanvas])
  async function connectApp() {
    if (!doc?.projectId) return
    try {
      const projects = await window.frameui.workspace.listRecentProjects()
      const project = projects.find((p) => p.id === doc.projectId)
      if (!project) {
        setError(
          'Open the original codebase folder to reconnect this design. Your design is saved.',
        )
        return
      }
      await window.frameui.project.openPath(project.path)
      const index = await window.frameui.project.getIndex()
      const model = index?.projectModel
      if (model && docRef.current) {
        const next: VisualDocument = {
          ...docRef.current,
          sourceComponents: model.components.map(c => ({ id: c.id, name: c.name, file: c.source.filePath })),
          pageRegistry: model.pages.filter(page => page.route).map(page => ({
            pattern: page.route!, url: page.route!, name: page.name, source: page.source.filePath,
            needsSample: false, authProfile: 'standard', area: page.area, status: 'Discovered',
          })),
        }
        change(next, false)
        announceImport(next)
      }
    } catch {
      setError(
        'The codebase could not be opened. Your saved design is still available.',
      )
    }
  }
  async function openCaptureWorkspace() {
    const current = docRef.current
    if (!current) return
    let projectUrl = current.appUrl
    if (current.libraryId) {
      const library = await window.frameui.design.load(current.libraryId).catch(() => null)
      if (library?.appUrl && !/^about:blank\/?$/i.test(library.appUrl.trim())) projectUrl = library.appUrl
    }
    setCaptureProjectUrl(projectUrl)
    setCaptureMode(true)
  }
  async function syncCapturedPagesToProject(next: VisualDocument) {
    if (!next.libraryId) return
    const library = await window.frameui.design.load(next.libraryId).catch(() => null)
    if (!library) return
    const pages = structuredClone(library.pages)
    const capturedPages = next.pages.filter((candidate) => !!candidate.capturedAt)
    for (const captured of capturedPages) {
      const existingIndex = pages.findIndex((candidate) =>
        candidate.id === captured.id || (
          candidate.route === captured.route &&
          (candidate.authProfile || 'standard') === (captured.authProfile || 'standard') &&
          candidate.state === captured.state &&
          candidate.width === captured.width
        ),
      )
      if (existingIndex >= 0) pages[existingIndex] = structuredClone(captured)
      else pages.push(structuredClone(captured))
    }
    const capturedRoutes = new Set(capturedPages.map((candidate) => candidate.route).filter(Boolean))
    const updatedLibrary: VisualDocument = {
      ...library,
      pages,
      pageRegistry: library.pageRegistry?.map((entry) => capturedRoutes.has(entry.pattern) ? { ...entry, status: 'Captured' as const } : entry),
      updatedAt: new Date().toISOString(),
    }
    setAssetLibrary(updatedLibrary)
    save(updatedLibrary)
  }
  async function renderSource(route: string, state = 'Populated', width = 1440) {
    if (!doc?.projectId || sourceBusy) return
    setSourceBusy(true)
    setError('')
    try {
      const projects = await window.frameui.workspace.listRecentProjects()
      const project = projects.find(p => p.id === doc.projectId)
      if (!project) throw new Error('Open the original repository folder first.')
      await window.frameui.project.openPath(project.path)
      const index = await window.frameui.project.getIndex()
      const source = index && sourceTarget(index.projectModel, route)
      if (!source) throw new Error('This page is no longer in the repository index. Refresh from Code.')
      const library = doc.libraryId ? await window.frameui.design.load(doc.libraryId) : doc
      if (!library) throw new Error('The project library could not be opened.')
      if (!doc.libraryId) {
        const files = await window.frameui.design.list()
        for (const file of files.filter(f => f.libraryId === library.id)) {
          const existing = await window.frameui.design.load(file.id)
          const cached = existing?.pages.find(p => p.sourceDesign?.pageId === source.id && p.state === state && p.width === width)
          if (existing && cached) { open(existing); setPageId(cached.id); return }
        }
      }
      const result = await window.frameui.design.fromSource({ projectId: doc.projectId, pageId: source.id, state, width })
      const updatedLibrary = { ...library, pages: [...library.pages.filter(p => !(p.sourceDesign?.pageId === source.id && p.width === width && p.state === state)), result] }
      await window.frameui.design.save(updatedLibrary)
      const next = doc.libraryId ? structuredClone(doc) : newDocument(source.name)
      next.projectId = doc.projectId
      next.libraryId = library.id
      next.variables = library.variables
      if (!doc.libraryId) next.pages = []
      // State/viewport changes create separate editable versions; never overwrite designer work.
      const editable = structuredClone(result)
      editable.id = crypto.randomUUID()
      next.pages.push(editable)
      await window.frameui.design.save(next)
      open(next)
      setPageId(editable.id)
      setStatus(result.sourceDesign?.status === 'partial' ? 'Page ready · some components are partial' : 'Editable page ready')
    } catch (cause) { setError(String(cause)) }
    finally { setSourceBusy(false) }
  }
  const shortcut = navigator.platform.toLowerCase().includes('mac')
    ? '⌘'
    : 'Ctrl+'
  const objectActions: IdeAction[] = [
    {
      id: 'duplicate',
      label: 'Duplicate',
      shortcut: `${shortcut}D`,
      run: duplicate,
      disabled: !active,
    },
    {
      id: 'copy',
      label: 'Copy',
      shortcut: `${shortcut}C`,
      run: () => {
        clipboard.current = flat
          .filter((o) => selected.includes(o.id))
          .map(cloneObject)
      },
      disabled: !active,
    },
    {
      id: 'paste',
      label: 'Paste',
      shortcut: `${shortcut}V`,
      run: () => {
        const copies = clipboard.current.map(cloneObject)
        edit((p) => p.objects.push(...copies))
        setSelected(copies.map((c) => c.id))
      },
    },
    {
      id: 'group',
      label: 'Group selection',
      shortcut: `${shortcut}G`,
      run: group,
      disabled: selected.length < 2,
    },
    {
      id: 'ungroup',
      label: 'Ungroup',
      shortcut: `${shortcut}⇧G`,
      run: ungroup,
      disabled: !active?.children.length,
    },
    {
      id: 'component',
      label: 'Create component',
      shortcut: `${shortcut}Alt+K`,
      run: component,
      disabled: !active,
    },
    {
      id: 'lock',
      label: active?.locked ? 'Unlock' : 'Lock',
      run: () => patch({ locked: !active?.locked }),
      disabled: !active,
    },
    {
      id: 'hide',
      label: active?.hidden ? 'Show' : 'Hide',
      run: () => patch({ hidden: !active?.hidden }),
      disabled: !active,
    },
    {
      id: 'forward',
      label: 'Bring forward',
      shortcut: `${shortcut}]`,
      run: () => reorder(true),
      disabled: !active,
    },
    {
      id: 'backward',
      label: 'Send backward',
      shortcut: `${shortcut}[`,
      run: () => reorder(false),
      disabled: !active,
    },
    {
      id: 'delete',
      label: 'Delete selection',
      shortcut: '⌫',
      danger: true,
      run: () => {
        edit((p) => {
          p.objects = removeObjects(p.objects, new Set(selected))
        })
        setSelected([])
      },
      disabled: !active,
    },
  ]
  const targetPage = doc?.pages.find((p) => p.id === context?.id) ?? page
  const pageActions: IdeAction[] = [
    {
      id: 'page-copy',
      label: 'Duplicate page',
      run: () => {
        if (doc && targetPage) {
          const copy = {
            ...structuredClone(targetPage),
            id: crypto.randomUUID(),
            name: `${targetPage.name} copy`,
            edited: true,
          }
          change({ ...doc, pages: [...doc.pages, copy] })
          setPageId(copy.id)
        }
      },
    },
    {
      id: 'page-state',
      label: 'Create page state',
      run: async () => {
        if (!doc || !targetPage) return
        const state = await ask('Name your page state', 'Empty')
        if (state) {
          const next = {
            ...structuredClone(targetPage),
            id: crypto.randomUUID(),
            state,
            edited: true,
          }
          change({ ...doc, pages: [...doc.pages, next] })
          setPageId(next.id)
        }
      },
    },
    {
      id: 'page-export',
      label: 'Export page',
      run: () => {
        if (targetPage) setPageId(targetPage.id)
        setExportOpen(true)
      },
    },
    {
      id: 'page-delete',
      label: 'Remove page',
      danger: true,
      run: () => {
        if (!doc || !targetPage) return
        setConfirmation({
          title: `Remove “${targetPage.name}”?`,
          description: 'The page will be removed from this FrameUI design. Your original application files will not be changed.',
          confirmLabel: 'Remove page',
          summary: [
            { label: 'Page', value: targetPage.name },
            { label: 'Viewport', value: `${targetPage.width} × ${targetPage.height}` },
            { label: 'History', value: 'This change can be undone in the current session' },
          ],
          onConfirm: () => change({ ...doc, pages: doc.pages.filter((p) => p.id !== targetPage.id) }),
        })
      },
    },
  ]
  const commandActions: IdeAction[] = [
    {
      id: 'new-design',
      label: 'Create blank design',
      category: 'File',
      shortcut: `${shortcut}N`,
      run: () => {
        const next = newDocument()
        if (doc?.projectId) {
          next.projectId = doc.projectId
          next.libraryId = doc.libraryId ?? doc.id
          next.variables = structuredClone(doc.variables)
        }
        open(next)
        save(next)
      },
    },
    {
      id: 'palette',
      label: 'Search and commands',
      shortcut: `${shortcut}K`,
      run: () => setPalette((p) => !p),
    },
    {
      id: 'panels',
      label: 'Show / hide panels',
      shortcut: 'Tab',
      run: () => setHideUi((h) => !h),
    },
    { id: 'present', label: 'Present design', run: startPresent },
    {
      id: 'getting-started',
      label: 'Getting started',
      run: () => setHelp(true),
    },
    {
      id: 'open',
      label: 'Open codebase',
      category: 'File',
      shortcut: `${shortcut}O`,
      run: () => void openProject(),
    },
    {
      id: 'new-page',
      label: 'Create blank page',
      category: 'File',
      run: addPage,
    },
    {
      id: 'save',
      label: 'Save design',
      category: 'File',
      shortcut: `${shortcut}S`,
      run: () => {
        if (doc) save(doc)
      },
    },
    { id: 'undo', label: 'Undo', shortcut: `${shortcut}Z`, run: () => undo() },
    {
      id: 'redo',
      label: 'Redo',
      shortcut: `${shortcut}⇧Z`,
      run: () => undo(true),
    },
    { id: 'map', label: 'Open application map', run: () => setOverview('map') },
    {
      id: 'system',
      label: 'Explore design system',
      run: () => setOverview('system'),
    },
    { id: 'fit', label: 'Zoom to fit', shortcut: '⇧1', run: () => fit() },
    {
      id: 'selection-fit',
      label: 'Zoom to selection',
      shortcut: '⇧2',
      run: () => fit(true),
      disabled: !active,
    },
    {
      id: 'capture',
      label: 'Capture / Refresh from App',
      run: () => void connectApp(),
      disabled: !doc?.projectId,
    },
    {
      id: 'variables',
      label: 'Create variable',
      run: () => {
        setMode('Assets')
        createVariable()
      },
    },
    {
      id: 'export',
      label: 'Export design',
      category: 'File',
      run: () => setExportOpen(true),
    },
    {
      id: 'settings',
      label: 'Workspace settings',
      shortcut: `${shortcut},`,
      run: () => setSettings(true),
    },
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      shortcut: '?',
      run: () => setHelp(true),
    },
    ...pageActions,
    ...objectActions,
    ...tools.map((t) => ({
      id: `tool-${t.name}`,
      label: `Create ${t.name.toLowerCase()}`,
      category: 'Tools',
      shortcut: t.key,
      run: () => chooseTool(t.name),
    })),
    ...(doc?.pages ?? []).map((p) => ({
      id: `page-${p.id}`,
      label: p.name,
      category: `Pages · ${p.state}`,
      run: () => {
        setPageId(p.id)
        setMode('Pages')
        setSelected([])
      },
    })),
    ...flat.map((o) => ({
      id: `layer-${o.id}`,
      label: o.name,
      category: 'Layers',
      run: () => {
        setSelected([o.id])
        setMode('Layers')
      },
    })),
    ...(doc?.components ?? []).map((c) => ({
      id: `component-${c.id}`,
      label: c.name,
      category: 'Components',
      run: () => {
        const instance = {
          ...cloneObject(c),
          kind: 'Instance' as const,
          componentId: c.id,
        }
        edit((p) => p.objects.push(instance))
        setSelected([instance.id])
      },
    })),
    ...(doc?.variables ?? []).map((v) => ({
      id: `variable-${v.id}`,
      label: v.name,
      category: `Variables · ${v.collection}`,
      run: () => setVariableDraft({ ...v }),
    })),
    // Stage 3 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
    // a dev-only way to "render captured models beside the existing SVG
    // output" — never shown in a production build, never a toolbar/nav item.
    ...(import.meta.env.DEV && doc?.projectId
      ? [{ id: 'debug-structured-preview', label: 'Debug: Structured capture preview', category: 'Debug', run: () => setStructuredPreviewOpen(true) }]
      : []),
  ]
  useEffect(() =>
    window.frameui.design.onCommand((id) => {
      const input = document.activeElement?.matches(
        'input,textarea,[contenteditable]',
      )
      if (input && ['copy', 'paste', 'undo', 'redo'].includes(id)) {
        document.execCommand(id)
        return
      }
      if (id === 'selectAll') {
        setSelected(
          (page?.objects ?? []).filter((o) => !o.locked).map((o) => o.id),
        )
        return
      }
      if (id === 'cut') {
        commandActions.find((a) => a.id === 'copy')?.run()
        commandActions.find((a) => a.id === 'delete')?.run()
        return
      }
      commandActions.find((a) => a.id === id && !a.disabled)?.run()
    }),
  )
  if (!doc)
    return (
      <>
        <Welcome
          recents={recents.filter((r) => !r.libraryId && !hiddenRecent.includes(r.id))}
          projects={projectLibrary}
          onOpen={() => void openProject()}
          onOpenProject={path => void openProject(path)}
          onBlank={() => {
            const next = newDocument()
            open(next)
            save(next)
          }}
          onRecent={(id) =>
            void window.frameui.design.load(id).then((d) => {
              if (d) open(d)
            })
          }
          onDuplicate={(id) =>
            void window.frameui.design.load(id).then((d) => {
              if (d) {
                const copy = {
                  ...d,
                  id: crypto.randomUUID(),
                  name: `${d.name} copy`,
                }
                open(copy)
                save(copy)
              }
            })
          }
          onRemove={(id) => setHiddenRecent([...hiddenRecent, id])}
          onReveal={(id) => void window.frameui.project.reveal(id)}
          status={status}
          error={error}
          onGettingStarted={openFirstRunOnboarding}
        />
        {pendingProject && (
          <ProjectSetupModal
            project={pendingProject.project}
            index={pendingProject.index}
            onCancel={() => {
              setPendingProject(null)
              void window.frameui.project.listLibrary().then(setProjectLibrary).catch(() => {})
              void window.frameui.project.close()
            }}
            onOpen={confirmProjectSetup}
          />
        )}
        <TooltipLayer />
      </>
    )
  if (isLibrary)
    return (
      <div className="ide ide-library-shell">
        <ProjectLibrary
          document={doc}
          initialSection={projectSection}
          onSectionChange={setProjectSection}
          notice={importSummary}
          onBack={() => {
            setDoc(null)
            void window.frameui.design.list().then(setRecents)
            void window.frameui.project.listLibrary().then(setProjectLibrary).catch(() => {})
          }}
          onRefresh={() => void connectApp()}
          onCapture={(next) => change(next, false)}
          onRender={(route) => { void renderSource(route) }}
          onOpen={(id) =>
            void window.frameui.design.load(id).then((next) => {
              if (next) open(next)
            })
          }
          onCreate={(name, asset, fileId, viaCapture, autoNamed, captureUrl) => {
            if (viaCapture) {
              const next = newDocument(name || 'Untitled design')
              next.projectId = doc.projectId
              next.libraryId = doc.id
              next.variables = structuredClone(doc.variables)
              // The project-level "Local app URL" set in ProjectSetupModal
              // lives on the project's own document, not this new per-design
              // one — without carrying it over, Capture always opened on a
              // blank preview even when the project's URL was already known.
              next.appUrl = captureUrl || doc.appUrl
              open(next)
              save(next)
              setCaptureNamePending(!!autoNamed)
              setCaptureProjectUrl(next.appUrl)
              setCaptureMode(true)
              return
            }
            void (async () => {
              const next = fileId ? await window.frameui.design.load(fileId) : newDocument(name)
              if (!next) return
              next.projectId = doc.projectId
              next.libraryId = doc.id
              if (!fileId) next.variables = structuredClone(doc.variables)
              if (asset) {
                if (!next.pages.length) next.pages = newDocument(name).pages
                const target = next.pages[0]
                const source = asset.kind === 'screen' ? asset.page : asset.component
                const added = asset.kind === 'screen' ? object('Frame', {name:source.name,x:40,y:40,width:source.width,height:source.height,fill:'#ffffff',clip:false,children:asset.page.objects.map(cloneObject),source:{route:asset.page.route}}) : cloneObject(asset.component.variants?.find(v=>v.id===asset.variant)?.objects[0] ?? asset.component)
                added.x = 40 + target.objects.length * 24
                added.y = 40 + target.objects.length * 24
                target.objects.push(added)
                target.width = Math.max(target.width,added.x+added.width+40)
                target.height = Math.max(target.height,added.y+added.height+40)
                if(asset.kind==='screen') target.fonts = [...(target.fonts||[]),...(asset.page.fonts||[])]
                const needed = new Set<string>()
                visit([added],o=>{if(o.componentId)needed.add(o.componentId)})
                for(const id of needed) {
                  const master=doc.components.find(c=>c.id===id)
                  if(master && !next.components.some(c=>c.id===id)) {
                    next.components.push(structuredClone(master))
                    visit(master.children,o=>{if(o.componentId)needed.add(o.componentId)})
                  }
                }
              }
              open(next)
              save(next)
            })().catch(e=>setError(String(e)))
          }}
        />
        <ProgressModal open={sourceBusy} title="Preparing editable page" description="FrameUI is reading the page structure and matching it to local styles and reusable components." operation="Analysing the page and project styles" detail="This operation does not expose measurable progress. Your source files remain unchanged." />
        {error && <p role="alert">{error}</p>}
        <TooltipLayer />
      </div>
    )
  return (
    <div
      style={{ '--ide-left-width': `${leftWidth}px` } as React.CSSProperties}
      className={`ide ${present ? 'ide-present' : ''} ${hideUi ? 'ide-hide-ui' : ''} ${leftHidden ? 'ide-left-hidden' : ''} ${rightHidden ? 'ide-right-hidden' : ''}`}
    >
      <header className="ide-top app-drag-region">
        <div className="ide-breadcrumb ide-editor-breadcrumb app-no-drag">
          <button
            aria-label="Projects"
            title="Projects"
            onClick={() => {
              setDoc(null)
              void window.frameui.design.list().then(setRecents)
              void window.frameui.project.listLibrary().then(setProjectLibrary).catch(() => {})
            }}
          >
            <PanelsTopLeft size={16} />
            <span>Projects</span>
          </button>
          {doc.libraryId && (
            <>
              <ChevronRight size={12} />
              <button
                title="Back to this project's Designs"
                onClick={() =>
                  void window.frameui.design
                    .load(doc.libraryId!)
                    .then((library) => {
                      if (library) { open(library); setProjectSection('Designs') }
                    })
                }
              >
                {recents.find((r) => r.id === doc.libraryId)?.name ?? 'Project'}
              </button>
            </>
          )}
          <ChevronRight size={12} />
        </div>
        <input
          className="app-no-drag ide-doc-name"
          aria-label="Design file name"
          value={doc.name}
          onChange={(e) => change({ ...doc, name: e.target.value })}
        />
        <button
          className="app-no-drag ide-search-command"
          title={`Search and commands · ${shortcut}K`}
          onClick={() => setPalette(true)}
        >
          <Search size={15} />
          <span>Search</span>
          <kbd>{shortcut}K</kbd>
        </button>
        <span className="ide-save">
          {status === 'Saved' && <Check size={12} />} {status}
        </span>
        <div className="ide-actions app-no-drag">
          {doc.libraryId && (
            <button onClick={() => {setMode('Pages');setLeftHidden(false)}}>
              Add from library
            </button>
          )}
          <button title="Capture a screen from the running application into this design" onClick={() => void openCaptureWorkspace()}>
            <Monitor size={14} />
            Capture page
          </button>

          <button title="Workspace settings" onClick={() => setSettings(true)}>
            <Settings2 size={16} />
          </button>
          <button onClick={startPresent}>
            <Play size={14} />
            Present
          </button>
          <button className="ide-export-action" onClick={() => setExportOpen(true)}>
            <Download size={14} />
            Export
          </button>
        </div>
      </header>
      {present && (
        <div className="ide-present-bar">
          <button
            title="Back in prototype"
            disabled={!reviewHistory.length}
            onClick={() => {
              setPageId(reviewHistory.at(-1)!)
              setReviewHistory(reviewHistory.slice(0, -1))
            }}
          >
            ←
          </button>
          <strong>{doc.name}</strong>
          <select
            aria-label="Present page"
            value={page?.id ?? ''}
            onChange={(e) => setPageId(e.target.value)}
          >
            {doc.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.state}
              </option>
            ))}
          </select>
          <button onClick={() => setPresent(false)}>
            Exit presentation <kbd>esc</kbd>
          </button>
        </div>
      )}
      {captureMode ? (
        <CaptureWorkspace
          document={captureProjectUrl && captureProjectUrl !== doc.appUrl ? {...doc, appUrl: captureProjectUrl} : doc}
          onCapture={(next) => {
            change(next, false)
            void syncCapturedPagesToProject(next).catch((reason) => {
              setError(`The frame was captured, but its project page entry could not be updated: ${String(reason)}`)
            })
            if (captureNamePending && next.pages.some((p) => p.capturedAt)) setCaptureNamePending(false)
          }}
          onDone={(lastCapturedPageId) => {
            setCaptureMode(false)
            setCaptureProjectUrl(undefined)
            setCaptureNamePending(false)
            if (lastCapturedPageId) {
              fitAllAfterCapture.current = true
              setPageId(lastCapturedPageId)
            }
          }}
          focusRoute={page?.route}
        />
      ) : (
      <div className="ide-body">
        <button
          className="ide-panel-edge-toggle ide-panel-edge-toggle-left"
          style={{ left: leftHidden ? 4 : Math.max(4, leftWidth - 12) }}
          title={leftHidden ? 'Show Pages panel' : 'Hide Pages panel'}
          aria-label={leftHidden ? 'Show Pages panel' : 'Hide Pages panel'}
          onClick={() => setLeftHidden(!leftHidden)}
        >
          <PanelLeftClose size={14} style={{ transform: leftHidden ? 'rotate(180deg)' : undefined }} />
        </button>
        <button
          className="ide-panel-edge-toggle ide-panel-edge-toggle-right"
          style={{ right: rightHidden ? 4 : Math.max(4, rightWidth - 12) }}
          title={rightHidden ? 'Show Design panel' : 'Hide Design panel'}
          aria-label={rightHidden ? 'Show Design panel' : 'Hide Design panel'}
          onClick={() => setRightHidden(!rightHidden)}
        >
          <PanelRightClose size={14} style={{ transform: rightHidden ? 'rotate(180deg)' : undefined }} />
        </button>
        <aside className="ide-sidebar" style={{ width: leftWidth }}>
          <div className="ide-sidebar-header">
          <div className="ide-tabs" role="group" aria-label="Design sidebar">
            {[
              { name: 'Pages', Icon: Frame },
              { name: 'Components', Icon: Component },
              { name: 'Layers', Icon: Group },
              { name: 'Assets', Icon: ImageIcon },
            ].map(({ name: m, Icon }) => (
              <button
                key={m}
                className={mode === m ? 'active' : ''}
                aria-pressed={mode === m}
                title={m}
                onClick={() => { setMode(m); setSearch('') }}
              >
                <Icon size={13} />
                <span>{m}</span>
              </button>
            ))}
          </div>
          <label className="ide-sidebar-search">
            <Search size={14} />
            <input
              className="ide-search"
              aria-label={`Search ${mode.toLowerCase()}`}
              placeholder={`Search ${mode.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && <button aria-label="Clear search" title="Clear search" onClick={() => setSearch('')}><X size={13} /></button>}
          </label>
          </div>
          <div className="ide-sidebar-content">
          {(mode === 'File pages' || (mode === 'Pages' && !assetLibrary)) && (
            <>
              {!doc.pages.length && (
                <EmptyState
                  title="Your screens go here"
                  action={doc.projectId ? 'Capture Pages' : 'Create Blank Page'}
                  onAction={() =>
                    doc.projectId ? void connectApp() : addPage()
                  }
                >
                  Capture your product’s screens or create a design-only page.
                </EmptyState>
              )}
              {recentPageIds.filter((id) => doc.pages.some((p) => p.id === id))
                .length > 1 && (
                <details>
                  <summary className="ide-folder">Recently viewed</summary>
                  {recentPageIds.slice(0, 5).map((id) => {
                    const recent = doc.pages.find((p) => p.id === id)
                    return recent ? (
                      <button
                        className="ide-recent-page"
                        key={id}
                        onClick={() => setPageId(id)}
                      >
                        {recent.name}
                        <small>{recent.state}</small>
                      </button>
                    ) : null
                  })}
                </details>
              )}
              <div className="ide-panel-heading">
                Design pages
                <button title="New page" onClick={addPage}>
                  +
                </button>
              </div>
              {[...new Set(doc.pages.map((p) => p.folder))].map((folder) => (
                <details key={folder} open>
                  <summary className="ide-folder">{folder}</summary>
                  {doc.pages
                    .filter(
                      (p) =>
                        p.folder === folder &&
                        `${p.name} ${p.state} ${p.route ?? ''} ${p.folder}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                    .map((p) => (
                      <div
                        key={p.id}
                        className={`ide-page-row ${p.id === page?.id ? 'selected' : ''}`}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setContext({
                            x: e.clientX,
                            y: e.clientY,
                            kind: 'page',
                            id: p.id,
                          })
                        }}
                        onMouseEnter={() => setHover(p)}
                        onMouseLeave={() => setHover(null)}
                      >
                        <button
                          onClick={() => {
                            setPageId(p.id)
                            setSelected([])
                          }}
                          onDoubleClick={async () => {
                            const name = await ask('Page name', p.name)
                            if (name)
                              change({
                                ...doc,
                                pages: doc.pages.map((n) =>
                                  n.id === p.id ? { ...n, name } : n,
                                ),
                              })
                          }}
                        >
                          <Frame size={13} />
                          <InlineName
                            value={p.name}
                            label="Page name"
                            onChange={(name) =>
                              change({
                                ...doc,
                                pages: doc.pages.map((n) =>
                                  n.id === p.id ? { ...n, name } : n,
                                ),
                              })
                            }
                          />
                          <small>{p.state}</small>
                        </button>
                        <button
                          title="Pin page"
                          onClick={() =>
                            change({
                              ...doc,
                              pages: doc.pages.map((n) =>
                                n.id === p.id ? { ...n, pinned: !n.pinned } : n,
                              ),
                            })
                          }
                        >
                          <span aria-hidden="true">{p.pinned ? '●' : '○'}</span>
                        </button>
                      </div>
                    ))}
                </details>
              ))}
              {search && !doc.pages.some((p) => `${p.name} ${p.state} ${p.route ?? ''} ${p.folder}`.toLowerCase().includes(search.toLowerCase())) && (
                <p className="ide-sidebar-empty">No pages match “{search}”.</p>
              )}
              {page && (
                <details className="ide-page-actions">
                  <summary>Page actions</summary>
                  <button
                    onClick={() => {
                      const copy = {
                        ...structuredClone(page),
                        id: crypto.randomUUID(),
                        name: `${page.name} copy`,
                        edited: true,
                      }
                      change({ ...doc, pages: [...doc.pages, copy] })
                      setPageId(copy.id)
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={async () => {
                      const folder = await ask('Folder name', page.folder)
                      if (folder)
                        change({
                          ...doc,
                          pages: doc.pages.map((p) =>
                            p.id === page.id ? { ...p, folder } : p,
                          ),
                        })
                    }}
                  >
                    Move to folder
                  </button>
                  <button
                    onClick={async () => {
                      const state = await ask('State name', 'Empty')
                      if (state) {
                        const p = {
                          ...structuredClone(page),
                          id: crypto.randomUUID(),
                          state,
                          edited: true,
                        }
                        change({ ...doc, pages: [...doc.pages, p] })
                        setPageId(p.id)
                      }
                    }}
                  >
                    Create state
                  </button>
                  <button
                    onClick={() => {
                      change({
                        ...doc,
                        pages: doc.pages.filter((p) => p.id !== page.id),
                      })
                      setSelected([])
                    }}
                  >
                    Delete from FrameUI
                  </button>
                </details>
              )}
            </>
          )}
          {assetLibrary && mode === 'Pages' && <PageBrowser compact appUrl={assetLibrary.appUrl} projectId={assetLibrary.id} pages={assetLibrary.pages} search={search} onClearSearch={() => setSearch('')} onAdd={page=>addLibraryAsset({kind:'screen',page})}/>} 
          {mode === 'Layers' && <button onClick={()=>setMode('File pages')}>Design file pages</button>}
          {mode==='Layers' && useStructuredCanvas && page?.structured && <StructuredLayers nodes={page.structured.children} selected={selectedStructured} query={search} onSelect={selectStructured}/>}
          {visibleLayerTree}
          {mode === 'Layers' && !useStructuredCanvas && search && !flat.some((o) => o.name.toLowerCase().includes(search.toLowerCase())) && (
            <p className="ide-sidebar-empty">No layers match “{search}”.</p>
          )}
          {(mode === 'Assets' || mode === 'Components') && (
              <AssetBrowser
                compact
                kind="components"
                library={{
                  ...(assetLibrary ?? doc),
                  pages: assetLibrary?.pages ?? [],
                  components: mode === 'Assets' ? resourceAssets : [
                    ...(assetLibrary?.components ?? []),
                    ...doc.components.filter(
                      (c) =>
                        !assetLibrary?.components.some(
                          (master) => master.id === c.id,
                        ),
                    ),
                  ],
                }}
                search={search}
                onAdd={addLibraryAsset}
                itemLabel={mode === 'Assets' ? 'asset' : 'component'}
              />
          )}
          {mode === 'Assets' && (
            <details className="ide-sidebar-section" open>
              <summary className="ide-folder">
                <span>Variables</span>
                <small>{doc.variables.length}</small>
                <button aria-label="Create variable" title="Create variable" onClick={(event) => { event.preventDefault(); createVariable() }}>+</button>
              </summary>
              {doc.variables
                .filter((variable) => `${variable.collection} ${variable.name} ${variable.value}`.toLowerCase().includes(search.toLowerCase()))
                .map((variable) => (
                  <button className="ide-variable-row" key={variable.id} onClick={() => setVariableDraft({ ...variable })}>
                    <span>
                      {variable.type === 'Colour' && <i style={{ background: variable.value }} />}
                      {variable.name}
                      <small>{variable.collection}</small>
                    </span>
                    <code>{variable.value}</code>
                  </button>
                ))}
              {search && !doc.variables.some((variable) => `${variable.collection} ${variable.name} ${variable.value}`.toLowerCase().includes(search.toLowerCase())) && (
                <p className="ide-sidebar-empty">No variables match “{search}”.</p>
              )}
              {!search && !doc.variables.length && <button className="ide-sidebar-create" onClick={createVariable}>Create your first variable</button>}
            </details>
          )}
          </div>
        </aside>
        <div
          className="ide-panel-resizer"
          onPointerDown={(e) => panelResize('left', e)}
        />
        <main className="ide-workarea">
          {overview && (
            <DesignOverview
              document={doc}
              mode={overview}
              onClose={() => setOverview(null)}
              onPage={(id) => {
                setPageId(id)
                setSelected([])
                setOverview(null)
              }}
              onChange={change}
            />
          )}
          {page?.sourceDesign && (
            <div className="ide-source-bar">
              <button disabled={sourceBusy} title="Create a refreshed version while preserving your edits" onClick={() => { void renderSource(page.route ?? page.sourceDesign!.pageId, page.state, page.width) }}>Refresh page from Code</button>
              <select aria-label="Source state" value={page.state} disabled={sourceBusy} onChange={event => { void renderSource(page.route ?? page.sourceDesign!.pageId, event.target.value, page.width) }}>
                {page.sourceDesign.states.map(state => <option key={state}>{state}</option>)}
              </select>
              <select aria-label="Source viewport" value={page.width} disabled={sourceBusy} onChange={event => { void renderSource(page.route ?? page.sourceDesign!.pageId, page.state, Number(event.target.value)) }}>
                {[...new Set([375, 768, 1440, page.width])].sort((a,b) => a-b).map(width => <option key={width} value={width}>{width <= 480 ? 'Mobile' : width <= 1024 ? 'Tablet' : 'Desktop'} · {width}px</option>)}
              </select>
            </div>
          )}
          <div
            ref={stage}
            onPointerDownCapture={finishCamera}
            className="ide-stage"
            onContextMenu={(e) => {
              e.preventDefault()
              gesture.current = null
              const target = (e.target as Element)
                .closest('[data-object-id]')
                ?.getAttribute('data-object-id')
              if (target && !selected.includes(target)) setSelected([target])
              setContext({
                x: e.clientX,
                y: e.clientY,
                kind: target ? 'object' : 'canvas',
                id: target ?? undefined,
              })
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const payload = e.dataTransfer.getData(
                'application/frameui-asset',
              )
              if (payload) {
                const sourceLibrary = assetLibrary ?? doc
                try {
                  const item = JSON.parse(payload)
                  const rect = e.currentTarget.getBoundingClientRect()
                  const position = {
                    x: (e.clientX - rect.left - camera.x) / camera.zoom - activeFramePosition.x,
                    y: (e.clientY - rect.top - camera.y) / camera.zoom - activeFramePosition.y,
                  }
                  if (item.kind === 'screen') {
                    const page = sourceLibrary.pages.find(
                      (p) => p.id === item.id,
                    )
                    if (page)
                      addLibraryAsset({ kind: 'screen', page }, position)
                  } else {
                    const component = [
                      ...sourceLibrary.components,
                      ...detectedAssets(sourceLibrary.pages),
                      ...doc.components,
                    ].find((c) => c.id === item.id)
                    if (component)
                      addLibraryAsset(
                        { kind: 'component', component },
                        position,
                      )
                  }
                } catch {
                  setError(
                    'This asset could not be added. Try its plus button.',
                  )
                }
                return
              }
              const c = doc.components.find(
                (c) => c.id === e.dataTransfer.getData('component'),
              )
              if (c) {
                const rect = e.currentTarget.getBoundingClientRect()
                edit((p) =>
                  p.objects.push({
                    ...cloneObject(c),
                    kind: 'Instance',
                    componentId: c.id,
                    x: (e.clientX - rect.left - camera.x) / camera.zoom - activeFramePosition.x,
                    y: (e.clientY - rect.top - camera.y) / camera.zoom - activeFramePosition.y,
                  }),
                )
              }
              if (e.dataTransfer.files[0]?.type.startsWith('image/'))
                void imageFile(e.dataTransfer.files[0])
            }}
          >
            <svg
              ref={svg}
              width="100%"
              height="100%"
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onLostPointerCapture={() => pointerUp()}
              onDoubleClick={(e) => {
                const id = (e.target as Element)
                  .closest('[data-object-id]')
                  ?.getAttribute('data-object-id')
                if (id) enterSelection(id)
              }}
              style={{
                touchAction: 'none',
                cursor:
                  panning
                    ? 'grabbing'
                    : tool === 'Hand'
                      ? 'grab'
                    : tool === 'Select'
                      ? 'default'
                      : 'crosshair',
              }}
            >
              <defs>
                {page && (
                  <pattern
                    id={`layout-grid-${page.id}`}
                    width={Math.max(2, page.layoutGrid?.size ?? DEFAULT_LAYOUT_GRID.size)}
                    height={Math.max(2, page.layoutGrid?.size ?? DEFAULT_LAYOUT_GRID.size)}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={`M ${Math.max(2, page.layoutGrid?.size ?? DEFAULT_LAYOUT_GRID.size)} 0 L 0 0 0 ${Math.max(2, page.layoutGrid?.size ?? DEFAULT_LAYOUT_GRID.size)}`}
                      fill="none"
                      stroke={page.layoutGrid?.color ?? DEFAULT_LAYOUT_GRID.color}
                      strokeOpacity={page.layoutGrid?.opacity ?? DEFAULT_LAYOUT_GRID.opacity}
                      strokeWidth={1 / camera.zoom}
                    />
                  </pattern>
                )}
              </defs>
              <g
                ref={cameraGroup}
                data-canvas-camera="true"
                key={`${page?.id}-${present}`}
                className={
                  present
                    ? `ide-transition-${reviewTransition.toLowerCase()}`
                    : undefined
                }
                transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}
              >
                {!present && canvasFrames
                  .filter((frame) => frame.page.id !== page?.id)
                  .map((frame) => (
                    <g
                      key={frame.page.id}
                      data-canvas-frame={frame.page.id}
                      data-canvas-page-id={frame.page.id}
                      transform={`translate(${frame.x} ${frame.y})`}
                    >
                      <CanvasFrameTitle
                        page={frame.page}
                        zoom={camera.zoom}
                        active={false}
                        selected={selectedFrameId === frame.page.id}
                        onActivate={() => {
                          setPageId(frame.page.id)
                          setSelected([])
                          setSelectedFrameId(frame.page.id)
                          setSelectionScope(null)
                        }}
                        onRename={(name) => change({
                          ...doc,
                          pages: doc.pages.map((candidate) => candidate.id === frame.page.id ? { ...candidate, name } : candidate),
                        })}
                        onMoveBy={(dx, dy) => moveCanvasFrame(
                          frame.page.id,
                          frame.x,
                          frame.y,
                          dx,
                          dy,
                        )}
                      />
                      <rect data-canvas-page-id={frame.page.id} data-canvas-surface={frame.page.id} width={frame.page.width} height={frame.page.height} fill="white" />
                      <FontDefinitions fonts={frame.page.fonts} />
                      {canUseStructuredCanvas(frame.page) ? (
                        <foreignObject x={0} y={0} width={frame.page.width} height={frame.page.height} pointerEvents="none">
                          <StructuredFrameView
                            frame={frame.page.structured!}
                            editingId={null}
                          />
                        </foreignObject>
                      ) : (
                        <VisualSvg objects={frame.page.objects} variables={doc.variables} />
                      )}
                      {canUseStructuredCanvas(frame.page) && <VisualSvg objects={frame.page.objects.filter(o => o.designOnly)} variables={doc.variables}/>}
                    </g>
                  ))}
                <g
                  data-canvas-frame={page?.id}
                  data-canvas-page-id={page?.id}
                  transform={`translate(${activeFramePosition.x} ${activeFramePosition.y})`}
                >
                {page && (
                  <>
                    {!present && (
                      <CanvasFrameTitle
                        page={page}
                        zoom={camera.zoom}
                        selected={selectedFrameId === page.id}
                        onActivate={() => {
                          setSelected([])
                          setSelectedStructured([])
                          setSelectedFrameId(page.id)
                          setSelectionScope(null)
                        }}
                        onRename={(name) => change({
                          ...doc,
                          pages: doc.pages.map((candidate) => candidate.id === page.id ? { ...candidate, name } : candidate),
                        })}
                        onMoveBy={(dx, dy) => moveCanvasFrame(
                          page.id,
                          activeFramePosition.x,
                          activeFramePosition.y,
                          dx,
                          dy,
                        )}
                      />
                    )}
                    <rect
                      data-canvas-page-id={page.id}
                      data-canvas-surface={page.id}
                      width={page.width}
                      height={page.height}
                      fill="white"
                    />
                    <FontDefinitions fonts={page.fonts} />
                    {useStructuredCanvas ? (
                      // Stage 5 (docs/CAPTURE_ENGINE_REBUILD_SPEC.md): the
                      // canvas stage is an <svg> root (for the existing
                      // pan/zoom/rotate `<g transform>` treatment) — a
                      // `StructuredFrameView` renders plain HTML/CSS, so it
                      // needs a <foreignObject>, not a direct swap for
                      // <VisualSvg>. `objects` stays available on the page
                      // regardless (Layers panel, export, legacy fallback)
                      // but isn't drawn here while `structured` is present.
                      <foreignObject x={0} y={0} width={page.width} height={page.height}>
                        <StructuredFrameView
                          frame={page.structured!}
                          editingId={editingStructuredId}
                          onEnterTextEdit={enterStructuredText}
                          onCommitText={commitStructuredText}
                        />
                      </foreignObject>
                    ) : (
                      <VisualSvg
                        objects={page.objects}
                        variables={doc.variables}
                        editingTextId={editingText}
                      />
                    )}
                    {useStructuredCanvas && <VisualSvg objects={page.objects.filter(o => o.designOnly)} variables={doc.variables} editingTextId={editingText}/>}
                    {!present && page.layoutGrid?.visible && (() => {
                      const layoutGrid = { ...DEFAULT_LAYOUT_GRID, ...page.layoutGrid }
                      if (layoutGrid.type === 'grid') return (
                        <rect width={page.width} height={page.height} fill={`url(#layout-grid-${page.id})`} pointerEvents="none" />
                      )
                      const margin = Math.min(layoutGrid.margin, page.width / 2)
                      const columns = Math.max(1, Math.round(layoutGrid.columns))
                      const columnWidth = Math.max(0, (page.width - margin * 2 - layoutGrid.gutter * (columns - 1)) / columns)
                      return (
                        <g pointerEvents="none" aria-label="Layout columns">
                          {Array.from({ length: columns }, (_, index) => (
                            <rect
                              key={index}
                              x={margin + index * (columnWidth + layoutGrid.gutter)}
                              width={columnWidth}
                              height={page.height}
                              fill={layoutGrid.color}
                              fillOpacity={layoutGrid.opacity}
                            />
                          ))}
                        </g>
                      )
                    })()}
                    <g ref={previewGuides} pointerEvents="none"/>
                    {smartGuides.map((g, i) => (
                      <line
                        key={`smart-${i}`}
                        data-smart-guide={g.axis}
                        x1={g.axis === 'x' ? g.value : -10000}
                        x2={g.axis === 'x' ? g.value : 10000}
                        y1={g.axis === 'y' ? g.value : -10000}
                        y2={g.axis === 'y' ? g.value : 10000}
                        stroke="#3b82f6"
                        strokeWidth={1 / camera.zoom}
                        strokeDasharray={`${4 / camera.zoom} ${3 / camera.zoom}`}
                        pointerEvents="none"
                      />
                    ))}
                    {!present && guides.map((x, i) => (
                      <line
                        key={i}
                        x1={x}
                        x2={x}
                        y1={-10000}
                        y2={10000}
                        stroke="#e879ac"
                        strokeWidth={1 / camera.zoom}
                        pointerEvents="none"
                      />
                    ))}
                    {!present && selectedFrameId === page.id && (
                      <g aria-label={`Selected frame ${page.name}`}>
                        <rect
                          width={page.width}
                          height={page.height}
                          fill="none"
                          stroke="#171b23"
                          strokeWidth={2 / camera.zoom}
                          pointerEvents="none"
                        />
                        <rect
                          data-frame-resize-handle="bottom-right"
                          x={page.width - 5 / camera.zoom}
                          y={page.height - 5 / camera.zoom}
                          width={10 / camera.zoom}
                          height={10 / camera.zoom}
                          fill="#171b23"
                          stroke="white"
                          strokeWidth={1 / camera.zoom}
                          style={{ cursor: 'nwse-resize' }}
                        />
                      </g>
                    )}
                  </>
                )}
                {measureTarget &&
                  active &&
                  byId.get(measureTarget) &&
                  (() => {
                    const other = byId.get(measureTarget)!
                    const a = selectionPath(active.id).reduce(
                        (p, o) => ({ x: p.x + o.x, y: p.y + o.y }),
                        { x: 0, y: 0 },
                      ),
                      b = selectionPath(other.id).reduce(
                        (p, o) => ({ x: p.x + o.x, y: p.y + o.y }),
                        { x: 0, y: 0 },
                      )
                    const x1 = a.x + active.width / 2,
                      y1 = a.y + active.height / 2,
                      x2 = b.x + other.width / 2,
                      y2 = b.y + other.height / 2,
                      gapX = Math.max(
                        0,
                        b.x - a.x - active.width,
                        a.x - b.x - other.width,
                      ),
                      gapY = Math.max(
                        0,
                        b.y - a.y - active.height,
                        a.y - b.y - other.height,
                      )
                    return (
                      <g pointerEvents="none">
                        <path
                          d={`M${x1} ${y1}H${x2}V${y2}`}
                          fill="none"
                          stroke="#ec638b"
                          strokeWidth={1 / camera.zoom}
                          strokeDasharray={`${3 / camera.zoom} ${3 / camera.zoom}`}
                        />
                        <text
                          x={(x1 + x2) / 2}
                          y={y1 - 6 / camera.zoom}
                          fontSize={11 / camera.zoom}
                          textAnchor="middle"
                          fill="#ec638b"
                        >
                          {Math.round(gapX)} px / {Math.round(gapY)} px
                        </text>
                      </g>
                    )
                  })()}
                {marquee && (
                  <rect
                    x={marquee.x}
                    y={marquee.y}
                    width={marquee.width}
                    height={marquee.height}
                    fill="#246bfe22"
                    stroke="#246bfe"
                    strokeWidth={1 / camera.zoom}
                    pointerEvents="none"
                  />
                )}
                {!present &&
                  page &&
                  (() => {
                    const bounds: { o: VisualObject; x: number; y: number }[] =
                      []
                    const walk = (objects: VisualObject[], x = 0, y = 0) => {
                      for (const o of objects) {
                        if (selected.includes(o.id))
                          bounds.push({ o, x: x + o.x, y: y + o.y })
                        walk(o.children, x + o.x, y + o.y)
                      }
                    }
                    walk(page.objects)
                    return bounds.map(({ o, x, y }) => {
                      // The in-place rich-text editor supplies its own exact
                      // outline. Keeping the normal transform overlay here as
                      // well draws a duplicate border plus resize/rotate/radius
                      // handles through the formatting toolbar and caret.
                      if (editingText === o.id) return null
                      const selectionHeight = o.kind === 'Line' ? Math.max(1, o.strokeWidth) : o.height
                      const selectionY = o.kind === 'Line' ? y + (o.height - selectionHeight) / 2 : y
                      return (
                      <g key={o.id} data-selection-id={o.id} transform={`translate(${x} ${selectionY})`}>
                        <rect
                          width={o.width}
                          height={selectionHeight}
                          fill="none"
                          stroke="#246bfe"
                          strokeWidth={1.5 / camera.zoom}
                          pointerEvents="none"
                        />
                        <rect
                          data-handle="resize"
                          x={o.width + (Math.min(o.width,selectionHeight)*camera.zoom<32?4:-4) / camera.zoom}
                          y={selectionHeight + (Math.min(o.width,selectionHeight)*camera.zoom<32?4:-4) / camera.zoom}
                          width={8 / camera.zoom}
                          height={8 / camera.zoom}
                          fill="white"
                          stroke="#246bfe"
                          strokeWidth={1 / camera.zoom}
                        />
                        <circle
                          data-handle="rotate"
                          visibility={Math.min(o.width,selectionHeight)*camera.zoom<32?'hidden':'visible'}
                          cx={o.width / 2}
                          cy={-20 / camera.zoom}
                          r={4 / camera.zoom}
                          fill="#246bfe"
                        />
                        {!['Line', 'Text', 'Vector'].includes(o.kind) && Math.min(o.width,selectionHeight)*camera.zoom>=40 && (
                          <circle
                            data-handle="radius"
                            cx={Math.max(12, o.radius[0])}
                            cy={12}
                            r={4 / camera.zoom}
                            fill="white"
                            stroke="#246bfe"
                          />
                        )}
                      </g>
                    )})
                  })()}
                </g>
              </g>
              {editingText && active?.kind === 'Text' && (
                <g ref={cameraOverlay} transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
                <foreignObject
                  x={
                    (activeFramePosition.x + selectionPath(active.id).reduce((n, o) => n + o.x, 0))
                  }
                  y={
                    (activeFramePosition.y + selectionPath(active.id).reduce((n, o) => n + o.y, 0))
                  }
                  width={Math.max(1, active.width)}
                  height={Math.max(active.lineHeight, active.height)}
                >
                  <InlineCanvasTextEditor
                    object={active}
                    zoom={1}
                    editorRef={inlineTextEditor}
                    onCommit={(text, runs) => {
                      commitInlineText(page!.id, active.id, text, runs)
                      setEditingText(null)
                    }}
                    onCancel={() => setEditingText(null)}
                  />
                </foreignObject>
                </g>
              )}
            </svg>
            {page?.structured && useStructuredCanvas && (
              <StructuredCanvasInteraction
                frame={page.structured!}
                selected={selectedStructured}
                onSelect={selectStructured}
                onCommitBounds={commitStructuredBounds}
                zoom={camera.zoom}
                containerRef={stage}
                editingId={editingStructuredId}
                enabled={tool === 'Select' && !panning && !present}
              />
            )}
            {!page && (
              <button className="ide-empty primary" onClick={addPage}>
                Create a page
              </button>
            )}
            <div className="ide-tools">
              {tools.map((t) => (
                <button
                  key={t.name}
                  title={`${t.name} (${t.key})`}
                  aria-label={`${t.name} (${t.key})`}
                  className={tool === t.name ? 'active' : ''}
                  onClick={() => {
                    if (t.name === 'Component' && active) component()
                    else if (t.name === 'Image') {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = 'image/*'
                      input.onchange = () => {
                        if (input.files?.[0]) void imageFile(input.files[0])
                      }
                      input.click()
                    } else chooseTool(t.name)
                  }}
                >
                  <ToolIcon name={t.name} />
                </button>
              ))}
              <span />
              <button
                title="Zoom out"
                onClick={() =>
                  setCamera((c) => ({
                    ...c,
                    zoom: Math.max(0.05, c.zoom * 0.8),
                  }))
                }
              >
                −
              </button>
              <button onClick={() => setCamera({ x: 80, y: 70, zoom: 1 })}>
                {Math.round(camera.zoom * 100)}%
              </button>
              <button
                title="Zoom in"
                onClick={() =>
                  setCamera((c) => ({ ...c, zoom: Math.min(8, c.zoom * 1.25) }))
                }
              >
                +
              </button>
            </div>
          </div>
        </main>
        <div
          className="ide-panel-resizer"
          onPointerDown={(e) => panelResize('right', e)}
        />
        <aside
          className="ide-inspector"
          data-kind={active?.kind}
          style={{ width: rightWidth }}
        >
          <div className="ide-tabs">
            {['Design', 'Prototype', 'Inspect'].map((m) => (
              <button
                key={m}
                className={inspector === m ? 'active' : ''}
                aria-pressed={inspector === m}
                onClick={() => setInspector(m)}
              >
                {m}
              </button>
            ))}
          </div>
          {page?.sourceDesign && <details className="ide-source-status"><summary>{page.sourceDesign.generatedData ? 'Preview Data · generated locally' : 'Source Reference'}{page.sourceDesign.status !== 'ready' ? ' · Partial' : ''}</summary><p>Content edits belong to this design only. Changing source state or viewport creates a separate editable version.</p>{page.captureWarnings?.map(warning => <p key={warning}>{warning}</p>)}</details>}
          {inspector === 'Inspect' ? (
            <div className="ide-inspect">
              <h3>{active?.name ?? 'Source mapping'}</h3>
              <p>{active?.source?.file ?? 'Created in FrameUI'}</p>
              <p>{active?.source?.component}</p>
              <p>{active?.source?.route}</p>
              <div className="ide-source-status">
                {page?.conflicts?.length
                  ? 'Design conflict'
                  : page?.edited
                    ? 'Modified in FrameUI'
                    : 'Matches source reference'}
              </div>
              <p>
                {page?.capturedAt
                  ? `Captured ${new Date(page.capturedAt).toLocaleString()}`
                  : 'Created in FrameUI'}
              </p>
              {active && (
                <details>
                  <summary>Design values</summary>
                  <pre>
                    {JSON.stringify(
                      {
                        size: { width: active.width, height: active.height },
                        fill: active.fill,
                        stroke: active.stroke,
                        typography: {
                          font: active.fontFamily,
                          size: active.fontSize,
                        },
                        layout: active.layout,
                        variables: active.bindings,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
              {page?.conflicts?.map((c) => (
                <div className="ide-conflict" key={c.id}>
                  <strong>{c.name}</strong>
                  <p>Both your design and the app changed {c.property}.</p>
                  <button
                    onClick={() =>
                      edit((p) => {
                        p.conflicts = p.conflicts?.filter((n) => n.id !== c.id)
                      })
                    }
                  >
                    Keep design
                  </button>
                  <button
                    onClick={() =>
                      edit((p) => {
                        if (c.property === 'page')
                          p.objects = c.incoming as VisualObject[]
                        else if (c.property === 'removed')
                          p.objects = removeObjects(
                            p.objects,
                            new Set([c.objectId]),
                          )
                        else
                          visit(p.objects, (o) => {
                            if (o.id !== c.objectId) return
                            const keys = c.property.split('.')
                            let value: Record<string, unknown> =
                              o as unknown as Record<string, unknown>
                            for (const key of keys.slice(0, -1))
                              value = value[key] as Record<string, unknown>
                            value[keys.at(-1)!] = structuredClone(c.incoming)
                          })
                        p.conflicts = p.conflicts?.filter((n) => n.id !== c.id)
                      })
                    }
                  >
                    Use app change
                  </button>
                </div>
              ))}
            </div>
          ) : inspector === 'Prototype' ? (
            active ? (
              <div className="ide-prototype-properties">
                <h3>{active.name}</h3>
                <p>
                  Connect this object to a saved screen or state. It works
                  offline in Present.
                </p>
                <label>
                  Go to
                  <select
                    aria-label="Prototype destination"
                    value={active.interaction?.targetPageId ?? ''}
                    onChange={(e) =>
                      patch({
                        interaction: e.target.value
                          ? {
                              targetPageId: e.target.value,
                              transition:
                                active.interaction?.transition ?? 'Instant',
                              trigger: active.interaction?.trigger ?? 'Click',
                            }
                          : undefined,
                      })
                    }
                  >
                    <option value="">No interaction</option>
                    {doc.pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.state}
                      </option>
                    ))}
                  </select>
                </label>
                {active.interaction && (
                  <>
                    <label>
                      Transition
                      <select
                        value={active.interaction.transition}
                        onChange={(e) =>
                          patch({
                            interaction: {
                              ...active.interaction!,
                              transition: e.target.value as
                                | 'Instant'
                                | 'Dissolve'
                                | 'Slide',
                            },
                          })
                        }
                      >
                        {['Instant', 'Dissolve', 'Slide'].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <button onClick={startPresent}>
                      <Play size={14} />
                      Preview interaction
                    </button>
                    <button onClick={() => patch({ interaction: undefined })}>
                      Remove interaction
                    </button>
                  </>
                )}
                <button onClick={() => setOverview('map')}>
                  View application map
                </button>
              </div>
            ) : (
              <EmptyState title="Make your screens work together">
                Select a button or navigation item, then connect it to a page or
                state.
              </EmptyState>
            )
          ) : useStructuredCanvas && selectedStructured.length && page?.structured ? (
            <StructuredSelectionPanel node={findStructuredNode(page.structured.children,selectedStructured[0])} count={selectedStructured.length} onBounds={bounds=>commitStructuredBounds([{id:selectedStructured[0],bounds}])} onPatch={patch=>editStructured(frame=>patchStructuredNode(frame,selectedStructured[0],patch))} onEditText={()=>enterStructuredText(selectedStructured[0])}/>
          ) : active ? (
            <>
              <div className="ide-panel-heading">
                <input
                  value={active.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
                <small>{active.kind}</small>
              </div>
              <details open>
                <summary>Position</summary>
                <div className="ide-fields">
                  {field('X', 'x')}
                  {field('Y', 'y')}
                  {field('W', 'width', 1)}
                  {field('H', 'height', 1)}
                  {field('Rotation', 'rotation')}
                </div>
              </details>
              <details open={active.kind !== 'Text'}>
                <summary>Appearance</summary>
                {!['Line', 'Text'].includes(active.kind) && (
                  <ColorField
                    label="Fill"
                    value={active.fill}
                    opacity={active.fillOpacity}
                    variables={doc.variables}
                    colours={flat.map((o) => o.fill)}
                    onChange={(fill, gradient) => patch({ fill, gradient })}
                    onOpacity={(fillOpacity) => patch({ fillOpacity })}
                    onBind={(id) =>
                      patch({ bindings: { ...active.bindings, fill: id } })
                    }
                  />
                )}

                <ColorField
                  label="Stroke"
                  value={active.stroke}
                  opacity={active.strokeOpacity}
                  variables={doc.variables}
                  colours={flat.map((o) => o.stroke)}
                  onChange={(stroke) => patch({ stroke })}
                  onOpacity={(strokeOpacity) => patch({ strokeOpacity })}
                  onBind={(id) =>
                    patch({ bindings: { ...active.bindings, stroke: id } })
                  }
                />
                {field('Stroke width', 'strokeWidth', 0)}
                {(['opacity'] as const).map((key) => (
                  <label key={key}>
                    Opacity
                    <input
                      type="range"
                      aria-label="Object opacity"
                      min="0"
                      max="100"
                      value={Math.round(active[key] * 100)}
                      onChange={(e) =>
                        patch({
                          [key]:
                            Math.max(0, Math.min(100, Number(e.target.value))) /
                            100,
                        })
                      }
                    />
                  </label>
                ))}
                {active.kind !== 'Line' && <><label>
                  Corner radius
                  <input
                    type="number"
                    min="0"
                    value={active.radius[0]}
                    onChange={(e) => {
                      const r = Math.max(0, Number(e.target.value))
                      patch({ radius: [r, r, r, r] })
                    }}
                  />
                </label>
                <details>
                  <summary>Individual corners</summary>
                  <div className="ide-fields">
                    {[
                      'Top left',
                      'Top right',
                      'Bottom right',
                      'Bottom left',
                    ].map((name, i) => (
                      <label key={name}>
                        {name}
                        <input
                          type="number"
                          min="0"
                          value={active.radius[i]}
                          onChange={(e) => {
                            const radius = [
                              ...active.radius,
                            ] as VisualObject['radius']
                            radius[i] = Math.max(0, Number(e.target.value))
                            patch({ radius })
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </details>
                <label>
                  Shadow
                  <input
                    value={active.shadow ?? 'none'}
                    onChange={(e) => patch({ shadow: e.target.value })}
                  />
                </label>
                {field('Blur', 'blur', 0)}
                <label className="ide-check">
                  <input
                    type="checkbox"
                    checked={active.clip}
                    onChange={(e) => patch({ clip: e.target.checked })}
                  />
                  Clip content
                </label>
                </>}
              </details>
              {['Image', 'Avatar'].includes(active.kind) && (
                <details open>
                  <summary>Image</summary>
                  <label>
                    Fit
                    <select
                      value={active.imageFit ?? 'cover'}
                      onChange={(e) =>
                        patch({
                          imageFit: e.target.value as
                            | 'cover'
                            | 'contain'
                            | 'fill',
                        })
                      }
                    >
                      <option value="cover">Fill / crop</option>
                      <option value="contain">Fit</option>
                      <option value="fill">Stretch</option>
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = 'image/*'
                      input.onchange = () => {
                        const f = input.files?.[0]
                        if (f) {
                          const reader = new FileReader()
                          reader.onload = () =>
                            patch({ src: String(reader.result) })
                          reader.readAsDataURL(f)
                        }
                      }
                      input.click()
                    }}
                  >
                    Replace image
                  </button>
                  <button
                    onClick={() =>
                      patch({
                        radius: [
                          active.width / 2,
                          active.width / 2,
                          active.width / 2,
                          active.width / 2,
                        ],
                        clip: true,
                      })
                    }
                  >
                    Circular mask
                  </button>
                </details>
              )}
              {active.kind === 'Text' && (() => {
                const typographyVars = doc.variables.filter((v) => v.collection === 'Typography')
                const sizeVars = typographyVars.filter((v) => isFontSizeValue(v.value))
                const familyVars = typographyVars.filter((v) => !isFontSizeValue(v.value))
                const capturedFonts = doc.pages.flatMap((p) => p.fonts ?? [])
                const familyOptions = [...new Set([
                  ...familyVars.map((v) => v.value),
                  ...capturedFonts.map((f) => f.family),
                  active.fontFamily,
                ])].filter(Boolean)
                const capturedWeights = [...new Set(
                  capturedFonts.filter((f) => f.family === active.fontFamily).map((f) => f.weight),
                )]
                const weightOptions = [...new Set([
                  ...(capturedWeights.length ? capturedWeights : ['400', '700']),
                  active.fontWeight,
                ])].filter(Boolean)
                return (
                  <details open>
                    <summary>Typography</summary>
                    {editingText === active.id && (
                      <p className="ide-selection-format-hint">Formatting applies to the highlighted characters. Press {shortcut}B to toggle bold.</p>
                    )}
                    <textarea
                      value={active.text ?? ''}
                      onChange={(e) => patch({ text: e.target.value })}
                    />
                    <label>
                      Font
                      <select
                        value={active.fontFamily}
                        onChange={(e) => patch({ fontFamily: e.target.value })}
                      >
                        {familyOptions.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Weight
                      <select
                        value={active.fontWeight}
                        onChange={(e) => {
                          if (!formatInlineSelection({ fontWeight: e.target.value })) patch({ fontWeight: e.target.value })
                        }}
                      >
                        {weightOptions.map((w) => (
                          <option key={w} value={w}>{fontWeightLabel(w)}</option>
                        ))}
                      </select>
                    </label>
                    <ColorField
                      label="Colour"
                      value={active.fill}
                      opacity={active.fillOpacity}
                      variables={doc.variables}
                      colours={flat.map((o) => o.fill)}
                      onChange={(fill, gradient) => {
                        if (!gradient && formatInlineSelection({ color: fill })) return
                        patch({ fill, gradient })
                      }}
                      onOpacity={(fillOpacity) => patch({ fillOpacity })}
                      onBind={(id) => patch({ bindings: { ...active.bindings, fill: id } })}
                    />
                    <div className="ide-fields">
                      {field('Size', 'fontSize', 1)}
                      {field('Line height', 'lineHeight', 1)}
                      {field('Letter spacing', 'letterSpacing')}
                    </div>
                    {sizeVars.length > 0 && (
                      <label>
                        Size token
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) patch({ fontSize: Number.parseFloat(e.target.value) }) }}
                        >
                          <option value="">Current: {active.fontSize}px</option>
                          {sizeVars.map((v) => {
                            const px = tokenSizeInPx(v.value)
                            return px != null ? <option key={v.id} value={px}>{v.name}, {Math.round(px)}px</option> : null
                          })}
                        </select>
                      </label>
                    )}
                    <select
                      value={active.textAlign}
                      onChange={(e) => patch({ textAlign: e.target.value })}
                    >
                      {['left', 'center', 'right'].map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </details>
                )
              })()}
              <details>
                <summary>Layout</summary>
                <label>
                  Direction
                  <select
                    value={active.layout.direction}
                    onChange={(e) => {
                      patch({
                        layout: { ...active.layout, direction: e.target.value },
                      })
                    }}
                  >
                    {['none', 'row', 'column', 'grid'].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                {(['gap', 'padding'] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <input
                      type="number"
                      value={active.layout[key]}
                      onChange={(e) =>
                        patch({
                          layout: {
                            ...active.layout,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                {(() => {
                  const spacingVars = doc.variables.filter((v) => v.collection === 'Spacing')
                  if (!spacingVars.length) return null
                  return (['gap', 'padding'] as const).map((key) => (
                    <label key={`${key}-token`}>
                      {key} token
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) patch({ layout: { ...active.layout, [key]: Number.parseFloat(e.target.value) } }) }}
                      >
                        <option value="">Current: {active.layout[key]}px</option>
                        {spacingVars.map((v) => {
                          const px = tokenSizeInPx(v.value)
                          return px != null ? <option key={v.id} value={px}>{v.name}, {Math.round(px)}px</option> : null
                        })}
                      </select>
                    </label>
                  ))
                })()}
                <label>
                  Alignment
                  <select
                    value={active.layout.alignment}
                    onChange={(e) =>
                      patch({
                        layout: { ...active.layout, alignment: e.target.value },
                      })
                    }
                  >
                    {['start', 'center', 'end', 'stretch'].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Distribution
                  <select
                    value={active.layout.distribution}
                    onChange={(e) =>
                      patch({
                        layout: {
                          ...active.layout,
                          distribution: e.target.value,
                        },
                      })
                    }
                  >
                    {['start', 'center', 'end', 'space-between'].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label className="ide-check">
                  <input
                    type="checkbox"
                    checked={active.layout.wrap}
                    onChange={(e) =>
                      patch({
                        layout: { ...active.layout, wrap: e.target.checked },
                      })
                    }
                  />
                  Wrap
                </label>
                <label>
                  Grid columns
                  <input
                    type="number"
                    min="1"
                    value={Number(active.layout.grid) || 2}
                    onChange={(e) =>
                      patch({
                        layout: {
                          ...active.layout,
                          grid: e.target.value,
                          direction: 'grid',
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Min width
                  <input
                    type="number"
                    min="0"
                    value={active.layout.minWidth ?? 0}
                    onChange={(e) =>
                      patch({
                        layout: {
                          ...active.layout,
                          minWidth: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Max width
                  <input
                    type="number"
                    min="0"
                    value={active.layout.maxWidth ?? ''}
                    onChange={(e) =>
                      patch({
                        layout: {
                          ...active.layout,
                          maxWidth: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Constraints
                  <select
                    value={active.layout.constraints}
                    onChange={(e) =>
                      patch({
                        layout: {
                          ...active.layout,
                          constraints: e.target.value,
                        },
                      })
                    }
                  >
                    {[
                      'left-top',
                      'right-top',
                      'center',
                      'stretch',
                      'fixed',
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </details>
              <details>
                <summary>Arrange</summary>
                <div className="ide-button-grid">
                  <button onClick={duplicate}>Duplicate</button>
                  <button onClick={group}>Group</button>
                  <button onClick={ungroup}>Ungroup</button>
                  <button onClick={() => patch({ locked: !active.locked })}>
                    {active.locked ? 'Unlock' : 'Lock'}
                  </button>
                  <button onClick={() => patch({ hidden: !active.hidden })}>
                    {active.hidden ? 'Show' : 'Hide'}
                  </button>
                  <button onClick={() => reorder(true)}>Forward</button>
                  <button onClick={() => reorder(false)}>Backward</button>
                  <button onClick={() => reorder(true, true)}>To front</button>
                  <button onClick={() => reorder(false, true)}>To back</button>
                  {['left', 'center', 'right', 'top', 'middle', 'bottom'].map(
                    (a) => (
                      <button
                        key={a}
                        onClick={() =>
                          edit((p) => {
                            const os = p.objects.filter((o) =>
                              selected.includes(o.id),
                            )
                            if (!os.length) return
                            const left = Math.min(...os.map((o) => o.x)),
                              right = Math.max(...os.map((o) => o.x + o.width)),
                              top = Math.min(...os.map((o) => o.y)),
                              bottom = Math.max(
                                ...os.map((o) => o.y + o.height),
                              )
                            os.forEach((o) => {
                              if (a === 'left') o.x = left
                              if (a === 'right') o.x = right - o.width
                              if (a === 'center')
                                o.x = (left + right - o.width) / 2
                              if (a === 'top') o.y = top
                              if (a === 'bottom') o.y = bottom - o.height
                              if (a === 'middle')
                                o.y = (top + bottom - o.height) / 2
                            })
                          })
                        }
                      >
                        Align {a}
                      </button>
                    ),
                  )}
                  {['Horizontal', 'Vertical'].map((axis) => (
                    <button
                      key={axis}
                      onClick={() =>
                        edit((p) => {
                          const os = p.objects
                            .filter((o) => selected.includes(o.id))
                            .sort((a, b) =>
                              axis === 'Horizontal' ? a.x - b.x : a.y - b.y,
                            )
                          if (os.length < 3) return
                          const prop = axis === 'Horizontal' ? 'x' : 'y',
                            size = axis === 'Horizontal' ? 'width' : 'height'
                          const end = os.at(-1)!
                          const gap =
                            (end[prop] +
                              end[size] -
                              os[0][prop] -
                              os.reduce((n, o) => n + o[size], 0)) /
                            (os.length - 1)
                          let cursor = os[0][prop]
                          os.forEach((o) => {
                            o[prop] = cursor
                            cursor += o[size] + gap
                          })
                        })
                      }
                    >
                      {axis} spacing
                    </button>
                  ))}
                </div>
              </details>
              <details>
                <summary>Variable bindings</summary>
                {[
                  'fill',
                  'stroke',
                  'radius',
                  'opacity',
                  'width',
                  'height',
                  'fontSize',
                  'fontFamily',
                  'fontWeight',
                  'lineHeight',
                  'letterSpacing',
                  'textAlign',
                  'text',
                  'hidden',
                  'gap',
                  'padding',
                ].map((property) => (
                  <label key={property}>
                    {property}
                    <select
                      value={active.bindings?.[property] ?? ''}
                      onChange={(e) =>
                        patch({
                          bindings: {
                            ...active.bindings,
                            [property]: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Custom</option>
                      {doc.variables.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.collection} / {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </details>
              {active.kind === 'Vector' && (
                <details open>
                  <summary>Vector path</summary>
                  <textarea
                    aria-label="Vector path"
                    value={active.path ?? ''}
                    onChange={(e) => patch({ path: e.target.value })}
                  />
                </details>
              )}
              <details>
                <summary>Component</summary>
                <button onClick={component}>Create component</button>
                {active.componentId && (
                  <button
                    onClick={() => {
                      const master = doc.components.find(
                        (c) => c.id === active.componentId,
                      )
                      if (master) {
                        const p = newPage(`${master.name} master`)
                        p.objects = [structuredClone(master)]
                        change({ ...doc, pages: [...doc.pages, p] })
                        setPageId(p.id)
                        setSelected([master.id])
                      }
                    }}
                  >
                    Edit master
                  </button>
                )}
                <button
                  onClick={async () => {
                    const name = await ask('Variant name', 'Hover')
                    if (!name) return
                    const snapshot = cloneObject(active)
                    snapshot.variants = undefined
                    const variant = {
                      id: crypto.randomUUID(),
                      name,
                      properties: { ...active.variant, State: name },
                      objects: [snapshot],
                    }
                    edit((_p, d) => {
                      const master = d.components.find(
                        (c) => c.id === (active.componentId || active.id),
                      )
                      if (master)
                        master.variants = [...(master.variants ?? []), variant]
                    })
                  }}
                >
                  Save as variant
                </button>
                {(
                  doc.components.find(
                    (c) => c.id === (active.componentId || active.id),
                  )?.variants ?? []
                ).map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      const snapshot = v.objects[0]
                      if (snapshot)
                        patch({
                          ...cloneObject(snapshot),
                          id: active.id,
                          x: active.x,
                          y: active.y,
                          kind: active.kind,
                          componentId: active.componentId,
                          variant: v.properties,
                        })
                    }}
                  >
                    {v.name}
                  </button>
                ))}
                {active.componentId && (
                  <>
                    <button
                      onClick={() =>
                        patch({ kind: 'Group', componentId: undefined })
                      }
                    >
                      Detach instance
                    </button>
                    <button
                      onClick={() => {
                        const master = doc.components.find(
                          (c) => c.id === active.componentId,
                        )
                        if (master)
                          patch({
                            ...cloneObject(master),
                            id: active.id,
                            x: active.x,
                            y: active.y,
                            kind: 'Instance',
                            componentId: master.id,
                          })
                      }}
                    >
                      Reset instance
                    </button>
                  </>
                )}
                <button
                  onClick={async () => {
                    const key = await ask('Variant property', 'State'),
                      value = key ? await ask('Variant value', 'Default') : null
                    if (key && value)
                      patch({ variant: { ...active.variant, [key]: value } })
                  }}
                >
                  Add variant property
                </button>
                {Object.entries(active.variant ?? {}).map(([k, v]) => (
                  <label key={k}>
                    {k}
                    <input
                      value={v}
                      onChange={(e) =>
                        patch({
                          variant: { ...active.variant, [k]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </details>
            </>
          ) : (
            <div className="ide-hint">
              <div className="ide-inspector-context"><span><Frame size={17} /></span><div><small>{tool === 'Frame' ? 'INSERT' : 'ARTBOARD'}</small><h3>{tool === 'Frame' ? 'Frame presets' : (page?.name ?? 'Design file')}</h3></div></div>
              <p>{tool === 'Frame' ? 'Choose a preset or drag on the canvas to create a custom frame.' : 'Select an object to edit its design.'}</p>
              {tool === 'Frame' && (
                <div className="ide-frame-presets">
                  {(['Phone', 'Tablet', 'Desktop'] as const).map((group) => (
                    <section key={group}>
                      <strong>{group}</strong>
                      {FRAME_PRESETS.filter((preset) => preset.group === group).map((preset) => (
                        <button key={preset.name} onClick={() => addFramePreset(preset.name, preset.width, preset.height)}>
                          <span>{preset.name}</span>
                          <small>{preset.width} × {preset.height}</small>
                        </button>
                      ))}
                    </section>
                  ))}
                </div>
              )}
              {page && tool !== 'Frame' && (
                <>
                  <label>
                    Viewport
                    <select
                      aria-label="Viewport preset"
                      value={
                        page.width === 1440
                          ? 'Desktop'
                          : page.width === 768
                            ? 'Tablet'
                            : page.width === 390
                              ? 'Mobile'
                              : 'Custom'
                      }
                      onChange={(e) => {
                        const size = {
                          Desktop: [1440, 1000],
                          Tablet: [768, 1024],
                          Mobile: [390, 844],
                        }[e.target.value]
                        if (size)
                          edit((p) => {
                            p.width = size[0]
                            p.height = size[1]
                          })
                      }}
                    >
                      {['Desktop', 'Tablet', 'Mobile', 'Custom'].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Frame width
                    <input
                      type="number"
                      min="1"
                      value={page.width}
                      onChange={(e) =>
                        edit((p) => {
                          p.width = Math.max(1, Number(e.target.value))
                        })
                      }
                    />
                  </label>
                  <label>
                    Frame height
                    <input
                      type="number"
                      min="1"
                      value={page.height}
                      onChange={(e) =>
                        edit((p) => {
                          p.height = Math.max(1, Number(e.target.value))
                        })
                      }
                    />
                  </label>
                </>
              )}
              {page && (
                <details className="ide-layout-grid-editor" open>
                  <summary>Layout grid</summary>
                  <label className="ide-check">
                    <input
                      aria-label="Show layout grid"
                      type="checkbox"
                      checked={page.layoutGrid?.visible ?? false}
                      onChange={(e) => updateLayoutGrid({ visible: e.target.checked })}
                    />
                    Show grid <kbd>⇧G</kbd>
                  </label>
                  <label>
                    Type
                    <select aria-label="Layout grid type" value={page.layoutGrid?.type ?? DEFAULT_LAYOUT_GRID.type} onChange={(e) => updateLayoutGrid({ type: e.target.value as 'columns' | 'grid' })}>
                      <option value="columns">Columns</option>
                      <option value="grid">Square grid</option>
                    </select>
                  </label>
                  {(page.layoutGrid?.type ?? DEFAULT_LAYOUT_GRID.type) === 'columns' ? (
                    <div className="ide-fields">
                      <label>Columns<input aria-label="Layout grid columns" type="number" min="1" max="48" value={page.layoutGrid?.columns ?? DEFAULT_LAYOUT_GRID.columns} onChange={(e) => updateLayoutGrid({ columns: Math.max(1, Math.min(48, Number(e.target.value))) })} /></label>
                      <label>Gutter<input aria-label="Layout grid gutter" type="number" min="0" value={page.layoutGrid?.gutter ?? DEFAULT_LAYOUT_GRID.gutter} onChange={(e) => updateLayoutGrid({ gutter: Math.max(0, Number(e.target.value)) })} /></label>
                      <label>Margin<input aria-label="Layout grid margin" type="number" min="0" value={page.layoutGrid?.margin ?? DEFAULT_LAYOUT_GRID.margin} onChange={(e) => updateLayoutGrid({ margin: Math.max(0, Number(e.target.value)) })} /></label>
                    </div>
                  ) : (
                    <label>Grid size<input aria-label="Layout grid size" type="number" min="2" value={page.layoutGrid?.size ?? DEFAULT_LAYOUT_GRID.size} onChange={(e) => updateLayoutGrid({ size: Math.max(2, Number(e.target.value)) })} /></label>
                  )}
                  <label>
                    Colour
                    <input aria-label="Layout grid colour" type="color" value={page.layoutGrid?.color ?? DEFAULT_LAYOUT_GRID.color} onChange={(e) => updateLayoutGrid({ color: e.target.value })} />
                  </label>
                  <label>
                    Opacity
                    <input aria-label="Layout grid opacity" type="range" min="2" max="40" value={Math.round((page.layoutGrid?.opacity ?? DEFAULT_LAYOUT_GRID.opacity) * 100)} onChange={(e) => updateLayoutGrid({ opacity: Number(e.target.value) / 100 })} />
                  </label>
                  <div className="ide-guide-actions">
                    <button onClick={async () => {
                      const x = await ask('Vertical guide position', '100')
                      if (x !== null && Number.isFinite(Number(x))) setGuides([...guides, Number(x)])
                    }}>Add guide</button>
                    <button disabled={!guides.length} onClick={() => setGuides([])}>Clear guides</button>
                  </div>
                </details>
              )}
            </div>
          )}
        </aside>
      </div>
      )}
      {hover && (
        <div className="ide-hover-preview">
          <svg viewBox={`0 0 ${hover.width} ${hover.height}`}>
            <VisualSvg
              objects={
                'objects' in hover ? hover.objects : [{ ...hover, x: 0, y: 0 }]
              }
              variables={doc.variables}
            />
          </svg>
          <strong>{hover.name}</strong>
          <small>
            {Math.round(hover.width)} × {Math.round(hover.height)} ·{' '}
            {'capturedAt' in hover
              ? hover.capturedAt
                ? 'Captured'
                : 'Design'
              : 'Component'}
          </small>
        </div>
      )}
      <TooltipLayer />
      {palette && (
        <CommandPalette
          actions={commandActions}
          onClose={() => setPalette(false)}
        />
      )}
      {context && (
        <ActionMenu
          x={context.x}
          y={context.y}
          actions={context.kind === 'page' ? pageActions : objectActions}
          onClose={() => setContext(null)}
        />
      )}
      {settings && (
        <ModalShell size="standard" variant="form" onClose={() => setSettings(false)} closeOnBackdrop>
          <ModalHeader eyebrow="Preferences" title="Workspace settings" description="Adjust how this design workspace looks and reset local interface preferences." icon={<Settings2 size={17} />} onClose={() => setSettings(false)} closeLabel="Close settings" />
          <ModalBody>
            <ModalSection title="Appearance">
              <div className="ide-modal-setting-row"><div><strong>Colour theme</strong><small>Use your system setting or keep FrameUI light or dark.</small></div><ThemeControl /></div>
            </ModalSection>
            <ModalSection title="Workspace layout" description="These actions only reset interface preferences on this computer.">
              <div className="ide-modal-action-list">
              <button
                onClick={() => {
                  setLeftWidth(280)
                  setRightWidth(280)
                  setLeftHidden(false)
                  setRightHidden(false)
                  setHideUi(false)
                }}
              >
                <span><strong>Reset panel layout</strong><small>Restore the default sidebars and panel widths.</small></span>
                <ChevronRight size={14} />
              </button>
              <button
                onClick={() => {
                  Object.keys(localStorage)
                    .filter((k) => k.startsWith('frameui:help:'))
                    .forEach((k) => localStorage.removeItem(k))
                  setSettings(false)
                }}
              >
                <span><strong>Show getting-started tips again</strong><small>Restore dismissed help prompts throughout the editor.</small></span>
                <ChevronRight size={14} />
              </button>
              </div>
            </ModalSection>
            <ModalNotice tone="info">Designs save automatically on this computer. These settings never modify your application source files.</ModalNotice>
          </ModalBody>
          <ModalFooter><button className="primary" onClick={() => setSettings(false)}>Done</button></ModalFooter>
        </ModalShell>
      )}
      {help && (
        <ModalShell size="large" variant="information" onClose={() => setHelp(false)} closeOnBackdrop>
          <ModalHeader eyebrow="Desktop controls" title="Keyboard shortcuts" description="Move through FrameUI and edit without leaving the canvas." icon={<Keyboard size={17} />} onClose={() => setHelp(false)} closeLabel="Close shortcuts" />
          <ModalBody>
            <ModalSection title="Getting started" description="Review how FrameUI connects your product, captures pages, and turns them into editable designs.">
              <div className="ide-modal-action-list">
                <button onClick={() => { setHelp(false); requestAnimationFrame(openFirstRunOnboarding) }}>
                  <span><strong>View introduction</strong><small>Reopen the four-step FrameUI walkthrough.</small></span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </ModalSection>
            <ModalSection title="Commands"><div className="ide-shortcuts">
              {commandActions
                .filter((a) => a.shortcut)
                .map((a) => (
                  <div key={a.id}>
                    {a.label}
                    <kbd>{a.shortcut}</kbd>
                  </div>
                ))}
              <div>
                Pan<kbd>Space + drag</kbd>
              </div>
              <div>
                Show / hide panels<kbd>Tab</kbd>
              </div>
              <div>
                Enter a group<kbd>Double-click</kbd>
              </div>
            </div></ModalSection>
          </ModalBody>
          <ModalFooter note="Shortcuts adapt to macOS and Windows."><button className="primary" onClick={() => setHelp(false)}>Done</button></ModalFooter>
        </ModalShell>
      )}
      {exportOpen && (
        <ExportWorkspace
          document={doc}
          page={page}
          selectedIds={selected}
          selectedStructuredIds={selectedStructured}
          onClose={() => setExportOpen(false)}
          onStatus={setStatus}
          onError={setError}
        />
      )}
      {structuredPreviewOpen && doc.projectId && (
        <StructuredCapturePreview projectId={doc.projectId} onClose={() => setStructuredPreviewOpen(false)} />
      )}
      {variableDraft && (
        <VariableEditor
          variable={variableDraft}
          existing={doc.variables.some((v) => v.id === variableDraft.id)}
          collections={[...new Set(doc.variables.map((v) => v.collection))]}
          onClose={() => setVariableDraft(null)}
          onSave={(value) => {
            change({
              ...doc,
              variables: doc.variables.some((v) => v.id === value.id)
                ? doc.variables.map((v) => (v.id === value.id ? value : v))
                : [...doc.variables, value],
            })
            setVariableDraft(null)
          }}
        />
      )}
      <ProgressModal open={sourceBusy} title="Preparing editable page" description="FrameUI is reading the page structure and matching it to local styles and reusable components." operation="Analysing the page and project styles" detail="This operation does not expose measurable progress. Your source files remain unchanged." />
      {question && (
        <ModalShell
            as="form"
            size="compact"
            variant="form"
            onClose={() => { question.resolve(null); setQuestion(null) }}
            onSubmit={(e) => {
              e.preventDefault()
              question.resolve(question.value)
              setQuestion(null)
            }}
          >
            <ModalHeader title={question.label} description="Enter a clear name so this item is easy to find in the design workspace." onClose={() => { question.resolve(null); setQuestion(null) }} />
            <ModalBody><ModalField label={question.label} error={!question.value.trim() ? 'Enter a value to continue.' : undefined}>
            <input
              autoFocus
              aria-label={question.label}
              value={question.value}
              onChange={(e) =>
                setQuestion({ ...question, value: e.target.value })
              }
            />
            </ModalField></ModalBody>
            <ModalFooter>
              <button
                type="button"
                onClick={() => {
                  question.resolve(null)
                  setQuestion(null)
                }}
              >
                Cancel
              </button>
              <button type="submit" className="primary" disabled={!question.value.trim()}>
                Apply
              </button>
            </ModalFooter>
        </ModalShell>
      )}
      {confirmation && (
        <ModalShell size="compact" variant="destructive" onClose={() => setConfirmation(null)} closeOnEscape>
          <ModalHeader title={confirmation.title} description={confirmation.description} icon={<Trash2 size={17} />} onClose={() => setConfirmation(null)} />
          <ModalBody>
            {confirmation.summary && <ModalSummary items={confirmation.summary} />}
            <ModalNotice tone="warning">Only the FrameUI design is affected. The connected application and its source files stay unchanged.</ModalNotice>
          </ModalBody>
          <ModalFooter>
            <button onClick={() => setConfirmation(null)}>Cancel</button>
            <button className="danger" onClick={() => { confirmation.onConfirm(); setConfirmation(null) }}>{confirmation.confirmLabel}</button>
          </ModalFooter>
        </ModalShell>
      )}
      {error && (
        <div className="ide-error-toast" role="alert">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}
    </div>
  )
}
