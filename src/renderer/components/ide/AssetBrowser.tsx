import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { VisualSvg, FontDefinitions } from './VisualSvg'
import type {
  VisualDocument,
  VisualObject,
  VisualPage,
} from '@shared/types/visualDesign'
export type LibraryAsset =
  | { kind: 'screen'; page: VisualPage }
  | { kind: 'component'; component: VisualObject; variant?: string }
export function AssetBrowser({
  library,
  search,
  onAdd,
  kind,
  destination = 'canvas',
  compact = false,
  itemLabel,
}: {
  library: VisualDocument
  destination?: 'canvas' | 'design file'
  kind?: 'components' | 'screens'
  compact?: boolean
  itemLabel?: string
  search: string
  onAdd: (asset: LibraryAsset) => void
}) {
  const fonts = useMemo(() => {
    const unique = new Map<string, NonNullable<VisualPage['fonts']>[number]>()
    library.pages.forEach((p) =>
      p.fonts?.forEach((f) =>
        unique.set(`${f.family}:${f.weight}:${f.style}`, f),
      ),
    )
    return [...unique.values()]
  }, [library.pages])
  const [tab, setTab] = useState<'screens' | 'components'>(
    library.pages.length ? 'screens' : 'components',
  )
  const [preview, setPreview] = useState<LibraryAsset | null>(null)
  const [limit, setLimit] = useState(20)
  const activeTab = kind ?? tab
  const noun = itemLabel ?? (activeTab === 'screens' ? 'screen' : 'component')
  const isMedia = itemLabel === 'asset'
  useEffect(() => { setLimit(20) }, [activeTab, search])
  const items: LibraryAsset[] =
    activeTab === 'screens'
      ? library.pages.map((page) => ({ kind: 'screen', page }))
      : library.components.map((component) => ({
          kind: 'component',
          component,
        }))
  const filtered = items.filter((asset) => {
    const item = asset.kind === 'screen' ? asset.page : asset.component
    return `${item.name} ${'route' in item ? item.route : ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  })
  const name = (a: LibraryAsset) =>
    a.kind === 'screen' ? a.page.name : a.component.name
  const id = (a: LibraryAsset) =>
    a.kind === 'screen' ? a.page.id : a.component.id
  function visual(a: LibraryAsset, large = false) {
    if (a.kind === 'screen')
      return a.page.thumbnail ? (
        <img src={a.page.thumbnail} alt={a.page.name} loading="lazy" />
      ) : (
        <div className="ide-asset-placeholder">
          {a.page.name}
          <small>
            {a.page.width} × {a.page.height}
          </small>
        </div>
      )
    const variant = a.component.variants?.find((v) => v.id === a.variant)
    const raw = variant?.objects[0] ?? a.component
    const o = { ...raw, x: 0, y: 0, hidden: false }
    return (
      <svg
        viewBox={`-12 -12 ${Math.max(o.width, 1) + 24} ${Math.max(o.height, 1) + 24}`}
        style={{ maxHeight: large ? 220 : 90 }}
      >
        <VisualSvg objects={[o]} variables={library.variables} />
      </svg>
    )
  }
  return (
    <div className={`ide-imported-assets ${compact ? 'compact' : ''}`}>
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        style={{ position: 'absolute' }}
      >
        <FontDefinitions fonts={fonts} />
      </svg>
      {!kind && <div className="ide-asset-tabs">
        <button
          className={tab === 'screens' ? 'active' : ''}
          onClick={() => {
            setTab('screens')
            setLimit(20)
          }}
        >
          Screens
        </button>
        <button
          className={tab === 'components' ? 'active' : ''}
          onClick={() => {
            setTab('components')
            setLimit(20)
          }}
        >
          Components
        </button>
      </div>}
      {(filtered.length > 0 || search) && <p className="ide-browser-summary">{filtered.length} {noun}{filtered.length === 1 ? '' : 's'}</p>}
      {filtered.slice(0, limit).map((asset) => (
        <div
          className="ide-asset-tile"
          key={id(asset)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(
              'application/frameui-asset',
              JSON.stringify({ kind: asset.kind, id: id(asset) }),
            )
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <button
            className="ide-asset-preview-trigger"
            onClick={() => setPreview(asset)}
            onDoubleClick={() => onAdd(asset)}
          >
            {visual(asset)}
            <strong>{name(asset)}</strong>
            <small>
              {asset.kind === 'screen'
                ? `${asset.page.state} · ${asset.page.route ?? asset.page.folder}`
                : isMedia
                  ? `Asset · ${asset.component.kind}`
                  : 'Component · ' +
                  (asset.component.variants?.map((v) => v.name).join(', ') ||
                    'Normal')}
            </small>
          </button>
          <button
            aria-label={`Add ${name(asset)}`}
            title={`Add to ${destination}`}
            onClick={() => onAdd(asset)}
          >
            <Plus size={16} />
          </button>
        </div>
      ))}
      {!filtered.length && <p className="ide-sidebar-empty">{search ? `No ${noun}s match “${search}”.` : `No ${noun}s yet.`}</p>}
      {filtered.length > limit && (
        <button onClick={() => setLimit(limit + 20)}>Show more</button>
      )}
      {preview && (
        <aside className="ide-asset-flyout" aria-label="Asset preview">
          <header>
            <strong>{name(preview)}</strong>
            <button
              aria-label="Close asset preview"
              onClick={() => setPreview(null)}
            >
              <X size={16} />
            </button>
          </header>
          <div className="ide-asset-large-preview">{visual(preview, true)}</div>
          <p>
            {preview.kind === 'screen'
              ? `${preview.page.folder} / ${preview.page.name} · ${preview.page.state}`
              : isMedia ? `${preview.component.kind} asset` : 'Reusable component'}
          </p>
          <code>
            {preview.kind === 'screen'
              ? preview.page.route
              : preview.component.source?.file}
          </code>
          {preview.kind === 'component' && (
            <div className="ide-asset-states">
              <button
                onClick={() => setPreview({ ...preview, variant: undefined })}
              >
                Normal
              </button>
              {preview.component.variants
                ?.filter((v) => !['Default', 'Normal'].includes(v.name))
                .map((v) => (
                  <button
                    className={preview.variant === v.id ? 'active' : ''}
                    key={v.id}
                    onClick={() => setPreview({ ...preview, variant: v.id })}
                  >
                    {v.name}
                  </button>
                ))}
            </div>
          )}
          <button className="primary" onClick={() => onAdd(preview)}>
            <Plus size={16} />
            Add to {destination}
          </button>
        </aside>
      )}
    </div>
  )
}
