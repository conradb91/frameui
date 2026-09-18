import { useMemo, useState } from 'react'
import {
  X,
  ArrowRight,
  Plus,
  Layers,
  Palette,
  Type,
  Component,
} from 'lucide-react'
import type { VisualDocument, VisualObject } from '@shared/types/visualDesign'
import { visit } from '@core/visual/model'
import { VisualSvg } from './VisualSvg'
import { EmptyState } from './Ui'
export function DesignOverview({
  document,
  mode,
  onClose,
  onPage,
  onChange,
}: {
  document: VisualDocument
  mode: 'map' | 'system'
  onClose: () => void
  onPage: (id: string) => void
  onChange: (doc: VisualDocument) => void
}) {
  const [tab, setTab] = useState('Colours'),
    [folder, setFolder] = useState('All')
  const objects = useMemo(() => {
    const result: VisualObject[] = []
    document.pages.forEach((p) => visit(p.objects, (o) => result.push(o)))
    return result
  }, [document.pages])
  const colours = new Map<string, number>(),
    radii = new Map<number, number>(),
    typeStyles = new Map<string, VisualObject>()
  objects.forEach((o) => {
    if (o.fill && !['none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(o.fill))
      colours.set(o.fill, (colours.get(o.fill) ?? 0) + 1)
    if (o.radius[0]) radii.set(o.radius[0], (radii.get(o.radius[0]) ?? 0) + 1)
    if (o.kind === 'Text')
      typeStyles.set(`${o.fontFamily}/${o.fontSize}/${o.fontWeight}`, o)
  })
  const pages = document.pages
    .filter((p) => folder === 'All' || p.folder === folder)
    .slice(0, 24)
  const edges: { from: number; to: number }[] = []
  pages.forEach((p, i) =>
    visit(p.objects, (o) => {
      const to = pages.findIndex((p) => p.id === o.interaction?.targetPageId)
      if (
        to >= 0 &&
        to !== i &&
        !edges.some((e) => e.from === i && e.to === to)
      )
        edges.push({ from: i, to })
    }),
  )
  function addVariable(
    value: string,
    type: 'Colour' | 'Number',
    collection: string,
  ) {
    const count = document.variables.filter(
      (v) => v.collection === collection,
    ).length
    onChange({
      ...document,
      variables: [
        ...document.variables,
        {
          id: crypto.randomUUID(),
          name: `${collection === 'Colours' ? 'Colour' : 'Radius'} ${count + 1}`,
          collection,
          type,
          value,
        },
      ],
    })
  }
  return (
    <div className="ide-overview">
      <header>
        <div>
          <small>YOUR PRODUCT, AT A GLANCE</small>
          <h2>{mode === 'map' ? 'Application map' : 'Design system'}</h2>
        </div>
        <button title="Back to canvas" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {mode === 'map' ? (
        <>
          <p>
            Explore saved screens and their known navigation. Choose a screen to
            continue designing.
          </p>
          <label>
            Folder
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>
              {['All', ...new Set(document.pages.map((p) => p.folder))].map(
                (f) => (
                  <option key={f}>{f}</option>
                ),
              )}
            </select>
          </label>
          {!pages.length ? (
            <EmptyState title="Your application map starts with a page">
              Capture screens or create pages, then connect them in Prototype.
            </EmptyState>
          ) : (
            <div className="ide-map-scroll">
              <svg
                width="100%"
                viewBox={`0 0 780 ${Math.ceil(pages.length / 3) * 220 + 20}`}
              >
                <defs>
                  <marker
                    id="map-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                  >
                    <path d="M0 0L10 5L0 10Z" fill="var(--ide-accent)" />
                  </marker>
                </defs>
                {edges.map((e, i) => {
                  const x1 = (e.from % 3) * 260 + 230,
                    y1 = Math.floor(e.from / 3) * 220 + 90,
                    x2 = (e.to % 3) * 260 + 15,
                    y2 = Math.floor(e.to / 3) * 220 + 90
                  return (
                    <path
                      key={i}
                      d={`M${x1} ${y1} C${x1 + 40} ${y1} ${x2 - 40} ${y2} ${x2} ${y2}`}
                      fill="none"
                      stroke="var(--ide-accent)"
                      opacity=".5"
                      markerEnd="url(#map-arrow)"
                    />
                  )
                })}
                {pages.map((p, i) => (
                  <foreignObject
                    key={p.id}
                    x={(i % 3) * 260 + 15}
                    y={Math.floor(i / 3) * 220 + 15}
                    width="215"
                    height="190"
                  >
                    <button
                      className="ide-map-page"
                      onClick={() => onPage(p.id)}
                    >
                      <svg viewBox={`0 0 ${p.width} ${p.height}`}>
                        <VisualSvg
                          objects={p.objects}
                          variables={document.variables}
                        />
                      </svg>
                      <strong>{p.name}</strong>
                      <small>
                        {p.state}
                        <ArrowRight size={12} />
                      </small>
                    </button>
                  </foreignObject>
                ))}
              </svg>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="ide-system-tabs">
            {[
              { name: 'Colours', Icon: Palette },
              { name: 'Typography', Icon: Type },
              { name: 'Radius', Icon: Layers },
              { name: 'Components', Icon: Component },
            ].map(({ name, Icon }) => (
              <button
                key={name}
                className={tab === name ? 'selected' : ''}
                onClick={() => setTab(name)}
              >
                <Icon size={14} />
                {name}
              </button>
            ))}
          </div>
          <p>
            Explore the visual language already in your product. Add frequently
            used values as variables, then rename them in Assets.
          </p>
          <div className="ide-system-content">
            {tab === 'Colours' &&
              [...colours]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 40)
                .map(([color, count]) => (
                  <div className="ide-system-colour" key={color}>
                    <span style={{ background: color }} />
                    <div>
                      <strong>{color}</strong>
                      <small>Used {count} times</small>
                    </div>
                    <button
                      title="Create a colour variable"
                      disabled={document.variables.some(
                        (v) => v.value === color,
                      )}
                      onClick={() => addVariable(color, 'Colour', 'Colours')}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                ))}
            {tab === 'Typography' &&
              [...typeStyles].slice(0, 30).map(([key, o]) => (
                <div className="ide-system-type" key={key}>
                  <div
                    style={{
                      fontFamily: o.fontFamily,
                      fontWeight: o.fontWeight,
                      fontSize: Math.min(34, o.fontSize),
                    }}
                  >
                    The details make the design.
                  </div>
                  <small>
                    {o.fontFamily} · {o.fontSize}px · {o.fontWeight}
                  </small>
                </div>
              ))}
            {tab === 'Radius' &&
              [...radii]
                .sort((a, b) => a[0] - b[0])
                .map(([radius, count]) => (
                  <div className="ide-system-radius" key={radius}>
                    <span style={{ borderRadius: radius }} />
                    <div>
                      <strong>{radius}px</strong>
                      <small>Used {count} times</small>
                    </div>
                    <button
                      title="Create radius variable"
                      onClick={() =>
                        addVariable(String(radius), 'Number', 'Radius')
                      }
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                ))}
            {tab === 'Components' &&
              document.components.map((c) => (
                <div className="ide-system-component" key={c.id}>
                  <svg viewBox={`0 0 ${c.width} ${c.height}`}>
                    <VisualSvg
                      objects={[{ ...c, x: 0, y: 0 }]}
                      variables={document.variables}
                    />
                  </svg>
                  <strong>{c.name}</strong>
                  <small>{c.variants?.length ?? 1} designs</small>
                </div>
              ))}
          </div>
          {!objects.length && (
            <EmptyState title="Discover your design language">
              Capture a screen or draw a few objects. Their colours, type styles
              and components will appear here.
            </EmptyState>
          )}
        </>
      )}
    </div>
  )
}
