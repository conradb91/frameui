import {userFacingError} from '../../lib/userFacingError'
import type { XdExportReport } from '@shared/types/xdExport'
import { DeveloperHandoff } from './prototype/DeveloperHandoff'
import { useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Check,
  ChevronDown,
  Download,
  FileImage,
  FileText,
  Layers3,
  PackageOpen,
  PenTool,
} from 'lucide-react'
import { buildFrameUiPackage } from '@core/export/frameuiPackage'
import type {
  FrameUiExportOptions,
  FrameUiExportScope,
  FrameUiExportTarget,
} from '@shared/types/frameuiExport'
import type { VisualDocument, VisualPage } from '@shared/types/visualDesign'
import { svgToPngBase64 } from '../../lib/svgToPngBase64'
import {
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalNotice,
  ModalProgress,
  ModalSection,
  ModalShell,
  ModalSummary,
} from '../ui/Modal'
import { FontDefinitions, VisualSvg } from './VisualSvg'

type ExportFormat = 'figma' | 'adobe-xd' | 'svg' | 'pdf' | 'png'

interface Props {
  initialFormat?: ExportFormat
  document: VisualDocument
  page: VisualPage | undefined
  selectedIds: string[]
  selectedStructuredIds: string[]
  onClose: () => void
  onStatus: (message: string) => void
  onError: (message: string) => void
}

const defaultOptions: FrameUiExportOptions = {
  scope: 'design',
  includeComponents: true,
  includeTokens: true,
  includePrototype: true,
  includeHiddenLayers: false,
  includeAnnotations: false,
  rasterizeUnsupported: 'ask',
  outlineMissingFonts: false,
}

const labels: Record<ExportFormat, { title: string; description: string; features: string[] }> = {
  figma: {
    title: 'FIGMA',
    description: 'Continue editing in Figma.',
    features: ['Editable layers', 'Auto Layout', 'Components', 'Variables', 'Original assets'],
  },
  'adobe-xd': {
    title: 'ADOBE XD · .xd',
    description: 'Native editable document. XD application testing pending.',
    features: ['Editable layers', 'Artboards', 'Vectors', 'Text', 'Original assets'],
  },
  svg: {
    title: 'SVG',
    description: 'Portable editable vector output.',
    features: ['Text', 'Vectors', 'Embedded images'],
  },
  pdf: {
    title: 'PDF',
    description: 'Presentation or review copy.',
    features: ['Current artboard', 'Print ready'],
  },
  png: {
    title: 'PNG',
    description: 'Export the selected design as an image.',
    features: ['2× resolution', 'Current artboard'],
  },
}

function safeName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._ -]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '') || 'FrameUI-design'
  )
}

function svgForPage(page: VisualPage, document: VisualDocument): string {
  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={page.width}
      height={page.height}
      viewBox={`0 0 ${page.width} ${page.height}`}
    >
      <FontDefinitions fonts={page.fonts} />
      <VisualSvg objects={page.objects} variables={document.variables} />
    </svg>,
  )
}

const waitForPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

export function ExportWorkspace({
  document,
  page,
  selectedIds,
  selectedStructuredIds,
  onClose,
  onStatus,
  initialFormat = 'figma',
}: Props) {
  const [exportError,setExportError]=useState('')
  const [handoff, setHandoff] = useState(false)
  const [format, setFormat] = useState<ExportFormat>(initialFormat)
  const [options, setOptions] = useState(defaultOptions)
  const [advanced, setAdvanced] = useState(false)
  const [stage, setStage] = useState<'configure' | 'working' | 'complete' | 'instructions'>(
    'configure',
  )
  const [progress, setProgress] = useState({
    current: 0,
    title: '',
    detail: '',
  })
  const [result, setResult] = useState<{
    filePath: string
    stats: {
      designs: number
      artboards: number
      components: number
      assets: number
      variables: number
    }
    warnings: number
  } | null>(null)
  const [validation, setValidation] = useState<{
    warnings: number
    errors: number
    messages: string[]
  } | null>(null)
  const cancelled = useRef(false)
  const xdJob = useRef<string>()
  const [xdReport, setXdReport] = useState<XdExportReport | null>(null)
  const [xdScope, setXdScope] = useState<'current' | 'selected' | 'all'>('all')
  const [xdPageIds, setXdPageIds] = useState<string[]>(page ? [page.id] : [])
  function cancelExport() {
    cancelled.current = true
    if (xdJob.current) void window.frameui.export.cancelXd(xdJob.current)
  }
  useEffect(
    () =>
      window.frameui.export.onXdProgress((event) => {
        if (event.jobId === xdJob.current)
          setProgress({
            current: 0,
            title: event.stage,
            detail: 'Processing locally. Your FrameUI design is unchanged.',
          })
      }),
    [],
  )
  useEffect(
    () => () => {
      if (xdJob.current) void window.frameui.export.cancelXd(xdJob.current)
    },
    [],
  )
  const isPackage = format === 'figma' || format === 'adobe-xd'
  const hasSelection = selectedIds.length > 0 || selectedStructuredIds.length > 0
  const pageCount =
    format === 'adobe-xd'
      ? xdScope === 'all'
        ? document.pages.length
        : xdScope === 'current'
          ? Number(!!page)
          : xdPageIds.length
      : options.scope === 'artboard' || options.scope === 'selection'
        ? page
          ? 1
          : 0
        : document.pages.length
  const firstFigmaExport = useMemo(
    () => localStorage.getItem('frameui:figma-export-seen') !== 'true',
    [],
  )

  useEffect(() => {
    if (!hasSelection && options.scope === 'selection')
      setOptions((current) => ({ ...current, scope: 'artboard' }))
  }, [hasSelection, options.scope])

  function updateOption<K extends keyof FrameUiExportOptions>(
    key: K,
    value: FrameUiExportOptions[K],
  ) {
    setOptions((current) => ({ ...current, [key]: value }))
    setValidation(null)
  }

  async function documentsForScope(): Promise<VisualDocument[]> {
    if (options.scope !== 'all-designs') return [document]
    const summaries = await window.frameui.design.list()
    const related = summaries.filter(
      (item) =>
        item.id === document.id ||
        (!!document.projectId && item.projectId === document.projectId) ||
        (!!document.libraryId &&
          (item.libraryId === document.libraryId || item.id === document.libraryId)),
    )
    const loaded = await Promise.all(
      related
        .filter((item) => item.id !== document.id)
        .map((item) => window.frameui.design.load(item.id)),
    )
    return [document, ...loaded.filter((item): item is VisualDocument => !!item)]
  }

  async function runExport() {
    if (!page) return
    cancelled.current = false
    setValidation(null)
    setExportError('')
    setStage('working')
    try {
      if (format === 'adobe-xd') {
        const jobId = crypto.randomUUID()
        xdJob.current = jobId
        setProgress({
          current: 0,
          title: 'Choose where to save',
          detail: 'Creating a native Adobe XD document.',
        })
        if (cancelled.current) {
          xdJob.current = undefined
          setStage('configure')
          return
        }
        const saved = await window.frameui.export.saveXd({
          jobId,
          document,
          scope: xdScope,
          pageId: page.id,
          pageIds: xdPageIds,
          includePrototype: options.includePrototype,
        })
        xdJob.current = undefined
        if (!saved.ok) {
          if (saved.error) throw new Error(saved.error)
          setStage('configure')
          return
        }
        setXdReport(saved.report!)
        setResult({
          filePath: saved.filePath!,
          stats: {
            designs: 1,
            artboards: saved.report!.artboards,
            components: saved.report!.components,
            assets: saved.report!.images,
            variables: 0,
          },
          warnings: saved.report!.warnings.length,
        })
        setStage('complete')
        onStatus('Native .xd saved · Adobe XD application testing pending')
        return
      }
      if (!isPackage) {
        setProgress({
          current: 1,
          title: 'Preparing artboard',
          detail: `${page.name} · ${page.width} × ${page.height}`,
        })
        await waitForPaint()
        const svg = svgForPage(page, document)
        if (cancelled.current) {
          setStage('configure')
          return
        }
        if (format === 'svg') {
          setProgress({
            current: 2,
            title: 'Saving editable SVG',
            detail: 'Text, vectors, groups and image layers remain separate.',
          })
          const saved = await window.frameui.export.saveSvg(svg, `${safeName(page.name)}.svg`)
          if (saved.ok) {
            onStatus('Editable SVG saved')
            onClose()
          } else setStage('configure')
          return
        }
        if (format === 'png') {
          setProgress({
            current: 2,
            title: 'Rendering selected design',
            detail: 'Creating a 2× PNG from the current artboard.',
          })
          const base64 = await svgToPngBase64(svg, page.width, page.height, 2)
          if (cancelled.current) {
            setStage('configure')
            return
          }
          const saved = await window.frameui.export.savePng(base64, `${safeName(page.name)}.png`)
          if (saved.ok) {
            onStatus('PNG saved')
            onClose()
          } else setStage('configure')
          return
        }
        setProgress({
          current: 2,
          title: 'Preparing review PDF',
          detail: 'Creating a print-ready copy of the current artboard.',
        })
        const html = `<!doctype html><meta charset="utf-8"><style>@page{size:${page.width}px ${page.height}px;margin:0}html,body{margin:0;width:${page.width}px;height:${page.height}px;overflow:hidden}</style>${svg}`
        const saved = await window.frameui.export.generateReviewPdf(
          html,
          `${safeName(page.name)}.pdf`,
        )
        if (saved.ok) {
          onStatus('PDF saved')
          onClose()
        } else if (saved.error) throw new Error(saved.error)
        else setStage('configure')
        return
      }

      setProgress({
        current: 1,
        title: 'Preparing design structure',
        detail: 'Loading the designs included in this export.',
      })
      const documents = await documentsForScope()
      if (cancelled.current) {
        setStage('configure')
        return
      }
      setProgress({
        current: 2,
        title: 'Resolving components and assets',
        detail: `${documents.length} design${documents.length === 1 ? '' : 's'} ready to package.`,
      })
      await waitForPaint()
      const frameuiVersion = await window.frameui.app.getVersion()
      const built = buildFrameUiPackage({
        documents,
        activeDocumentId: document.id,
        activePageId: page.id,
        selectionIds: selectedIds,
        structuredSelectionIds: selectedStructuredIds,
        target: format as FrameUiExportTarget,
        options,
        frameuiVersion,
      })
      const errors = built.warnings.filter((warning) => warning.severity === 'error')
      setValidation({
        warnings: built.warnings.length - errors.length,
        errors: errors.length,
        messages: built.warnings.slice(0, 5).map((warning) => warning.message),
      })
      if (errors.length) {
        setStage('configure')
        return
      }
      if (cancelled.current) {
        setStage('configure')
        return
      }
      setProgress({
        current: 3,
        title: 'Validating package',
        detail: built.warnings.length
          ? `${built.warnings.length} item${built.warnings.length === 1 ? '' : 's'} will be reported to the importer.`
          : 'Every required package document is present.',
      })
      await waitForPaint()
      setProgress({
        current: 4,
        title: 'Saving file',
        detail: 'Writing the local FrameUI design package.',
      })
      const saved = await window.frameui.export.saveFrameUiPackage(
        built.files,
        `${safeName(document.name)}.frameui`,
      )
      if (!saved.ok) {
        if (saved.error) throw new Error(saved.error)
        setStage('configure')
        return
      }
      localStorage.setItem(`frameui:${format}-export-seen`, 'true')
      setResult({
        filePath: saved.filePath!,
        stats: built.stats,
        warnings: built.warnings.length,
      })
      setStage('complete')
      onStatus(`${format === 'figma' ? 'Figma' : 'Adobe XD'} export ready`)
    } catch (cause) {
      setStage('configure')
      const detail=userFacingError(cause)
      setExportError(/ENOSPC/i.test(detail)?'There isn’t enough free space to save this export. Free some space and try again.':/EACCES|EPERM/i.test(detail)?'FrameUI couldn’t write to that folder. Choose another save location and try again.':/ENOENT/i.test(detail)?'That save folder is unavailable. Choose another location and try again.':detail)
    }
  }

  if (handoff) return <DeveloperHandoff document={document} onClose={() => setHandoff(false)} />
  if (stage === 'working')
    return (
      <ModalShell
        size="standard"
        variant="progress"
        onClose={() => {
          cancelExport()
        }}
        closeOnEscape
      >
        <ModalHeader
          eyebrow="Export"
          title={`Preparing ${format === 'figma' ? 'Figma' : format === 'adobe-xd' ? 'Adobe XD' : format.toUpperCase()} export`}
          description="FrameUI is preserving editable design structure and validating the output locally."
          icon={<Download size={17} />}
        />
        <ModalBody>
          <div className="ide-export-progress" role="status">
            {format !== 'adobe-xd' && (
              <span>
                {progress.current} / {isPackage ? 4 : 2}
              </span>
            )}
            <div>
              <strong>{progress.title}</strong>
              <p>{progress.detail}</p>
            </div>
          </div>
          <ModalProgress
            label="Preparing export"
            detail={
              format === 'adobe-xd'
                ? 'Working locally'
                : `Stage ${progress.current} of ${isPackage ? 4 : 2}`
            }
          />
        </ModalBody>
        <ModalFooter note="The export stays on this computer.">
          <button
            onClick={() => {
              cancelExport()
            }}
          >
            Cancel export
          </button>
        </ModalFooter>
      </ModalShell>
    )

  if (stage === 'complete' && result)
    return (
      <ModalShell size="standard" variant="completion" onClose={onClose} closeOnBackdrop>
        <ModalHeader
          eyebrow={
            format === 'adobe-xd' ? 'File saved · compatibility unverified' : 'Export complete'
          }
          title={format === 'adobe-xd' ? 'Native .xd file saved' : 'Figma export ready'}
          description={
            format === 'adobe-xd'
              ? 'Native scenegraph and archive checks passed. Opening and editing in Adobe XD remains unverified.'
              : 'Your editable FrameUI design package is ready to import.'
          }
          icon={<Check size={17} />}
          onClose={onClose}
        />
        <ModalBody>
          <ModalProgress
            value={100}
            label={format === 'adobe-xd' ? 'Archive checks passed' : 'Export complete'}
          />
          <ModalSummary
            items={
              format === 'adobe-xd' && xdReport
                ? [
                    { label: 'Artboards', value: xdReport.artboards },
                    { label: 'Editable text', value: xdReport.editableText },
                    {
                      label: 'Vector objects',
                      value: xdReport.editableVectors,
                    },
                    { label: 'Images', value: xdReport.images },
                  ]
                : [
                    { label: 'Artboards', value: result.stats.artboards },
                    { label: 'Components', value: result.stats.components },
                    { label: 'Assets', value: result.stats.assets },
                    { label: 'Variables', value: result.stats.variables },
                  ]
            }
          />
          <ModalNotice
            tone={result.warnings ? 'warning' : 'success'}
            title={
              result.warnings
                ? `${result.warnings} item${result.warnings === 1 ? '' : 's'} require attention`
                : 'Ready to continue editing'
            }
          >
            {format === 'adobe-xd'
              ? 'Native archive checks passed. Adobe XD open, edit, save and reopen testing remains pending.'
              : result.warnings
                ? 'The importer will identify affected layers without silently dropping them.'
                : 'All package checks passed.'}
          </ModalNotice>
          {format === 'adobe-xd' && xdReport && (
            <details>
              <summary>Compatibility report · {xdReport.layers} layers</summary>
              <div style={{ maxHeight: 240, overflow: 'auto' }}>
                {xdReport.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </div>
              <small>
                The report is stored in frameui/compatibility.json inside the native XD archive.
              </small>
            </details>
          )}
          <div className="ide-export-saved">
            <span>Saved as</span>
            <strong>{result.filePath.split(/[\\/]/).at(-1)}</strong>
            <small>{result.filePath}</small>
          </div>
        </ModalBody>
        <ModalFooter>
          <button onClick={() => void window.frameui.export.revealSaved(result.filePath)}>
            Open folder
          </button>
          <button onClick={() => setStage('instructions')}>
            How to import into {format === 'figma' ? 'Figma' : 'Adobe XD'}
          </button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </ModalFooter>
      </ModalShell>
    )

  if (stage === 'instructions')
    return (
      <ModalShell
        size="standard"
        variant="information"
        onClose={() => setStage('complete')}
        closeOnBackdrop
      >
        <ModalHeader
          title={`Continue in ${format === 'figma' ? 'Figma' : 'Adobe XD'}`}
          description={
            format === 'adobe-xd'
              ? 'Open the native document directly. No importer or plugin is needed.'
              : 'The importer reconstructs native, editable layers from the FrameUI package.'
          }
          icon={<PackageOpen size={17} />}
          onClose={() => setStage('complete')}
        />
        <ModalBody>
          {format === 'adobe-xd' ? (
            <ol className="ide-export-instructions">
              <li>
                <span>1</span>
                <div>
                  <strong>Open the .xd file in Adobe XD</strong>
                  <p>Use File → Open in Adobe XD.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Check layers, fonts and interactions</strong>
                  <p>Review the compatibility report and reconnect unsupported interactions.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Verify application compatibility</strong>
                  <p>
                    Inspect the layers, save, close and reopen. This application-level check remains
                    unverified.
                  </p>
                </div>
              </li>
            </ol>
          ) : (
            <ol className="ide-export-instructions">
              <li>
                <span>1</span>
                <div>
                  <strong>Open the FrameUI Importer</strong>
                  <p>
                    Run the bundled importer inside {format === 'figma' ? 'Figma' : 'Adobe XD'}.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Choose the .frameui file</strong>
                  <p>Select {result?.filePath.split(/[\\/]/).at(-1)}.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Import the design</strong>
                  <p>Select the content to import and continue editing normally.</p>
                </div>
              </li>
            </ol>
          )}
          <ModalNotice tone="info">
            FrameUI never needs your Figma or Adobe password. The transfer remains local.
          </ModalNotice>
        </ModalBody>
        <ModalFooter>
          {format === 'figma' && (
            <button onClick={() => void window.frameui.export.revealFigmaImporter()}>
              Open importer folder
            </button>
          )}
          <button className="primary" onClick={() => setStage('complete')}>
            Back
          </button>
        </ModalFooter>
      </ModalShell>
    )

  return (
    <ModalShell
      size={initialFormat === 'adobe-xd' ? 'standard' : 'wide'}
      variant="selection"
      onClose={onClose}
    >
      <ModalHeader
        eyebrow="Export"
        title="Export design"
        description={
          format === 'adobe-xd'
            ? 'Create one native .xd document with editable artboards and layers.'
            : 'Continue your FrameUI work in another design tool while keeping layers, text, components and project styling editable.'
        }
        icon={<Download size={17} />}
        onClose={onClose}
        meta={
          <>
            <span>
              Design <strong>{document.name}</strong>
            </span>
            <span>
              {pageCount} artboard{pageCount === 1 ? '' : 's'}
            </span>
          </>
        }
      />
      <ModalBody className="ide-export-workspace">
          {exportError&&<ModalNotice tone="danger" title="Couldn’t save the export"><p>{exportError}</p><p>Your design is unchanged. Adjust the export options or try exporting again.</p></ModalNotice>}
        {initialFormat !== 'adobe-xd' && (
          <ModalSection title="Format">
            <div className="ide-export-formats">
              {(Object.keys(labels) as ExportFormat[]).map((value) => {
                const details = labels[value]
                const Icon =
                  value === 'figma'
                    ? Layers3
                    : value === 'adobe-xd'
                      ? PenTool
                      : value === 'pdf'
                        ? FileText
                        : FileImage
                return (
                  <button
                    key={value}
                    type="button"
                    className={format === value ? 'active' : ''}
                    onClick={() => {
                      setFormat(value)
                      setExportError('')
                      setValidation(null)
                    }}
                  >
                    <Icon size={19} />
                    <span>
                      <strong>
                        {details.title}
                        {value === 'figma' && <em>Primary</em>}
                      </strong>
                      <small>{details.description}</small>
                      <i>{details.features.join(' · ')}</i>
                    </span>
                  </button>
                )
              })}
            </div>
          </ModalSection>
        )}
        {isPackage && (
          <>
            {format === 'figma' && firstFigmaExport && (
              <ModalNotice tone="info" title="Continue in Figma">
                Export this package, open the FrameUI Importer in Figma, choose the file, and
                continue designing normally.
              </ModalNotice>
            )}
            {format === 'adobe-xd' && (
              <ModalNotice tone="info" title="Native Adobe XD · .xd">
                All chosen artboards are saved in one native document. Archive checks run locally.
                Adobe XD application compatibility remains unverified; review the report for
                unsupported features.
              </ModalNotice>
            )}
            {format === 'adobe-xd' ? (
              <ModalSection title="Export content">
                <label className="ide-export-select">
                  <span>Content</span>
                  <select
                    aria-label="XD export content"
                    value={xdScope}
                    onChange={(e) => setXdScope(e.target.value as typeof xdScope)}
                  >
                    <option value="current">Current artboard</option>
                    <option value="selected">Selected artboards</option>
                    <option value="all">All artboards in this design</option>
                  </select>
                </label>
                {xdScope === 'selected' && (
                  <div role="group" aria-label="Artboards to export">
                    {document.pages.map((artboard) => (
                      <label
                        key={artboard.id}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          padding: 4,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={xdPageIds.includes(artboard.id)}
                          onChange={(event) =>
                            setXdPageIds((ids) =>
                              event.target.checked
                                ? [...ids, artboard.id]
                                : ids.filter((id) => id !== artboard.id),
                            )
                          }
                        />
                        <span>{artboard.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <p>
                  Editable text, vectors, groups, original images and the compatibility report are
                  always included.
                </p>
                <Toggle
                  label="Include prototype information"
                  checked={options.includePrototype}
                  onChange={(v) => updateOption('includePrototype', v)}
                />
              </ModalSection>
            ) : (
              <>
                <ModalSection title="Export scope">
                  <div className="ide-export-scope">
                    {(
                      [
                        ['selection', 'Current selection'],
                        ['artboard', 'Current artboard'],
                        ['design', 'Current design'],
                        ['all-designs', 'All designs'],
                      ] as [FrameUiExportScope, string][]
                    ).map(([value, label]) => (
                      <label key={value} data-disabled={value === 'selection' && !hasSelection}>
                        <input
                          type="radio"
                          name="export-scope"
                          value={value}
                          checked={options.scope === value}
                          disabled={value === 'selection' && !hasSelection}
                          onChange={() => updateOption('scope', value)}
                        />
                        <span>
                          <strong>{label}</strong>
                          {value === 'selection' && (
                            <small>
                              {hasSelection
                                ? `${selectedStructuredIds.length || selectedIds.length} selected layer${(selectedStructuredIds.length || selectedIds.length) === 1 ? '' : 's'}`
                                : 'Select a layer first'}
                            </small>
                          )}
                          {value === 'artboard' && <small>{page?.name}</small>}
                          {value === 'design' && (
                            <small>
                              {document.pages.length} artboard
                              {document.pages.length === 1 ? '' : 's'}
                            </small>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </ModalSection>
                <details
                  className="ide-export-advanced"
                  open={advanced}
                  onToggle={(event) => setAdvanced(event.currentTarget.open)}
                >
                  <summary>
                    <span>
                      <strong>Advanced</strong>
                      <small>Components, variables, prototypes and fallbacks</small>
                    </span>
                    <ChevronDown size={15} />
                  </summary>
                  <div>
                    <Toggle
                      label="Include components"
                      checked={options.includeComponents}
                      onChange={(value) => updateOption('includeComponents', value)}
                    />
                    <Toggle
                      label="Include design tokens"
                      checked={options.includeTokens}
                      onChange={(value) => updateOption('includeTokens', value)}
                    />
                    <Toggle
                      label="Include prototype information"
                      checked={options.includePrototype}
                      onChange={(value) => updateOption('includePrototype', value)}
                    />
                    <Toggle
                      label="Include hidden layers"
                      checked={options.includeHiddenLayers}
                      onChange={(value) => updateOption('includeHiddenLayers', value)}
                    />
                    <Toggle
                      label="Include development annotations"
                      checked={options.includeAnnotations}
                      onChange={(value) => updateOption('includeAnnotations', value)}
                    />
                    <Toggle
                      label="Outline missing fonts"
                      checked={options.outlineMissingFonts}
                      onChange={(value) => updateOption('outlineMissingFonts', value)}
                      hint="Off keeps text editable and flags missing fonts."
                    />
                    <label className="ide-export-select">
                      <span>
                        <strong>Rasterize unsupported elements</strong>
                        <small>Only individual unsupported layers are affected.</small>
                      </span>
                      <select
                        value={options.rasterizeUnsupported}
                        onChange={(event) =>
                          updateOption(
                            'rasterizeUnsupported',
                            event.target.value as FrameUiExportOptions['rasterizeUnsupported'],
                          )
                        }
                      >
                        <option value="ask">Ask me</option>
                        <option value="always">Always</option>
                        <option value="never">Never</option>
                      </select>
                    </label>
                  </div>
                </details>
              </>
            )}
          </>
        )}
        {validation && (
          <ModalNotice
            tone={validation.errors ? 'danger' : validation.warnings ? 'warning' : 'success'}
            title={
              validation.errors
                ? `Export needs ${validation.errors} correction${validation.errors === 1 ? '' : 's'}`
                : validation.warnings
                  ? `Ready to export with ${validation.warnings} warning${validation.warnings === 1 ? '' : 's'}`
                  : 'Ready to export'
            }
          >
            {validation.messages.length
              ? validation.messages.join(' · ')
              : 'All required package checks passed.'}
          </ModalNotice>
        )}
      </ModalBody>
      <ModalFooter
        note={
          isPackage
            ? 'The package contains design data only—never repository paths, credentials, cookies, or API keys.'
            : 'Exporting does not change this FrameUI design.'
        }
      >
        <button onClick={onClose}>Cancel</button>
        <button onClick={() => setHandoff(true)}>Developer handoff</button>
        <button
          className="primary"
          disabled={!page || (format === 'adobe-xd' && xdScope === 'selected' && !xdPageIds.length)}
          onClick={() => void runExport()}
        >
          {format === 'figma'
            ? 'Export for Figma'
            : format === 'adobe-xd'
              ? 'Export .xd'
              : `Export ${format.toUpperCase()}`}
        </button>
      </ModalFooter>
    </ModalShell>
  )
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  hint?: string
}) {
  return (
    <label className="ide-export-toggle">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  )
}
