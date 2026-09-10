import { projectAssets } from '../../lib/projectAssets'
import { useProjectStore } from '../../state/projectStore'
import { useState } from 'react'
import { findParent } from '@core/design-model/tree'
import type { DesignCommand } from '@core/design-model/commands'
import type { DesignNode, Breakpoint, NodeStyle, PlaceholderNode, ConceptNode } from '@shared/types/designNode'
import type { Component, Token } from '@shared/types/model/projectModel'
import type { ConceptComponent } from '@shared/types/model/featureModel'
import { ProvenanceBadge } from './ProvenanceBadge'
import { snapToSpacingToken } from '../../lib/spacingSnap'

/**
 * Phase 12 — the context-sensitive right-inspector. Replaces
 * `ScreenDesignerView`'s `SelectedNodePanel`: instead of one flat property
 * list, every section below is gated on `node.kind` (and, for grid
 * placement, on whether the node's parent is a `GridNode`) so the panel
 * only ever shows fields that are actually meaningful for the current
 * selection (spec Phase 12: "no generic property list that shows
 * irrelevant fields for every element").
 */

const BREAKPOINT_LABEL: Record<Breakpoint, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' }

const SHADOW_PRESETS: { label: string; value: string }[] = [
  { label: 'None', value: '' },
  { label: 'Small', value: '0 1px 2px rgba(0,0,0,0.24)' },
  { label: 'Medium', value: '0 4px 8px rgba(0,0,0,0.28)' },
  { label: 'Large', value: '0 12px 24px rgba(0,0,0,0.32)' },
]

const FONT_PRESETS = ['Inter', 'system-ui', 'Georgia', 'Helvetica Neue', 'Menlo, monospace']


export function LayoutInspector(props: {
  node: DesignNode
  tree: DesignNode
  breakpoint: Breakpoint
  components: Component[]
  conceptComponents: ConceptComponent[]
  tokens: Token[]
  projectFonts?: string[]
  projectShadows?: { label: string; value: string }[]
  dispatch: (command: DesignCommand) => void
  onSelect: (id: string | null) => void
}): JSX.Element {
  const { node: baseNode, tree, breakpoint, components, conceptComponents, tokens, dispatch, onSelect, projectFonts, projectShadows } = props
  const node = breakpoint === 'desktop' ? baseNode : { ...baseNode, style: { ...baseNode.style, ...baseNode.responsiveOverrides?.[breakpoint]?.style } }
  const isRoot = node.id === tree.id
  const parentInfo = findParent(tree, node.id)
  const parentIsGrid = parentInfo?.parent.kind === 'grid'
  const locked = !!node.locked
  const nonDesktopBp = breakpoint === 'desktop' ? null : breakpoint

  function setStyle(style: Partial<NodeStyle>) {
    if (breakpoint === 'desktop') dispatch({ type: 'SetStyle', nodeId: node.id, style })
    else dispatch({ type: 'SetResponsiveOverride', nodeId: node.id, breakpoint, override: { ...baseNode.responsiveOverrides?.[breakpoint], style: { ...baseNode.responsiveOverrides?.[breakpoint]?.style, ...style } } })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-text-3">{node.kind}</span>
        <div className="flex items-center gap-1">
          <ProvenanceBadge provenance={node.provenance} />
          <EditabilityBadge editability={node.editability} />
        </div>
      </div>

      {node.kind === 'placeholder' && <TypographyFields fonts={projectFonts} style={node.style} disabled={locked} onChange={setStyle} showAlign/>}
      {node.kind === 'placeholder' && !node.children.length && node.textPreview !== undefined && <Field label="Text"><textarea value={node.textPreview} disabled={locked} onChange={(event) => dispatch({ type: 'SetText', nodeId: node.id, content: event.target.value })} className="w-full rounded border border-border bg-panel p-2 text-xs text-text"/></Field>}
      {node.kind === 'placeholder' && <PlaceholderFields node={node} components={components} dispatch={dispatch} locked={locked} />}

      {node.kind === 'concept' && (
        <ConceptFields node={node} conceptComponents={conceptComponents} dispatch={dispatch} locked={locked} />
      )}

      {node.kind === 'stack' && (
        <>
          <Field label="Direction">
            <div className="flex gap-1.5">
              {(['column', 'row'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  disabled={locked}
                  onClick={() => dispatch({ type: 'SetDirection', nodeId: node.id, direction: dir })}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[11.5px] font-semibold disabled:opacity-40 ${
                    node.direction === dir ? 'border-accent-2 bg-selected text-accent-2' : 'border-border bg-panel-2 text-text-2'
                  }`}
                >
                  {dir === 'column' ? 'Vertical' : 'Horizontal'}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Wrap">
            <label className="flex items-center gap-2 text-[12px] text-text-2">
              <input
                type="checkbox"
                checked={!!node.wrap}
                disabled={locked}
                onChange={(e) => dispatch({ type: 'SetWrap', nodeId: node.id, wrap: e.target.checked })}
              />
              Wrap children
            </label>
          </Field>

          <SpacingField
            label="Gap"
            value={node.gap}
            tokens={tokens}
            disabled={locked}
            onChange={(gap) => dispatch({ type: 'SetGap', nodeId: node.id, gap })}
          />

          <Field label="Alignment">
            <Segmented
              value={node.align}
              disabled={locked}
              options={['start', 'center', 'end', 'stretch'] as const}
              onChange={(align) => dispatch({ type: 'SetAlign', nodeId: node.id, align })}
            />
          </Field>

          <Field label="Justification">
            <Segmented
              value={node.justify ?? 'start'}
              disabled={locked}
              options={['start', 'center', 'end', 'space-between'] as const}
              labels={{ 'space-between': 'Between' }}
              onChange={(justify) => dispatch({ type: 'SetJustify', nodeId: node.id, justify })}
            />
          </Field>

          <SpacingField
            label="Padding"
            value={node.style?.padding ?? 0}
            tokens={tokens}
            disabled={locked}
            onChange={(padding) => setStyle({ padding })}
          />

          <DimensionsFields style={node.style} disabled={locked} onChange={setStyle} />
        </>
      )}

      {node.kind === 'grid' && (
        <>
          <NumberField
            label="Columns"
            value={node.columns}
            min={1}
            disabled={locked}
            onChange={(columns) => dispatch({ type: 'SetGridColumns', nodeId: node.id, columns })}
          />
          <Field label="Rows">
            <div className="flex items-center gap-1.5">
              <label className="flex items-center gap-1.5 text-[11.5px] text-text-2">
                <input
                  type="checkbox"
                  checked={node.rows === 'auto' || node.rows === undefined}
                  disabled={locked}
                  onChange={(e) => dispatch({ type: 'SetGridRows', nodeId: node.id, rows: e.target.checked ? 'auto' : 1 })}
                />
                Auto
              </label>
              {node.rows !== 'auto' && node.rows !== undefined && (
                <input
                  type="number"
                  min={1}
                  value={node.rows}
                  disabled={locked}
                  onChange={(e) => dispatch({ type: 'SetGridRows', nodeId: node.id, rows: Number(e.target.value) })}
                  className="w-16 rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
                />
              )}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <SpacingField
              label="Column gap"
              value={node.columnGap}
              tokens={tokens}
              disabled={locked}
              onChange={(columnGap) => dispatch({ type: 'SetGridGap', nodeId: node.id, columnGap, rowGap: node.rowGap })}
            />
            <SpacingField
              label="Row gap"
              value={node.rowGap}
              tokens={tokens}
              disabled={locked}
              onChange={(rowGap) => dispatch({ type: 'SetGridGap', nodeId: node.id, columnGap: node.columnGap, rowGap })}
            />
          </div>
        </>
      )}

      {(node.kind === 'text' || node.kind === 'heading') && (
        <>
          <Field label="Content">
            <textarea
              value={node.content}
              disabled={locked}
              onChange={(e) => dispatch({ type: 'SetText', nodeId: node.id, content: e.target.value })}
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
            />
          </Field>
          <TypographyFields fonts={projectFonts} style={node.style} disabled={locked} onChange={setStyle} showAlign />
        </>
      )}

      {node.kind === 'button' && (
        <>
          <Field label="Label">
            <input
              type="text"
              value={node.label}
              disabled={locked}
              onChange={(e) => dispatch({ type: 'SetLabel', nodeId: node.id, label: e.target.value })}
              className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
            />
          </Field>
          <Field label="Variant">
            <Segmented
              value={node.variant}
              disabled={locked}
              options={['primary', 'secondary'] as const}
              onChange={(variant) => dispatch({ type: 'SetVariant', nodeId: node.id, variant })}
            />
          </Field>
          <TypographyFields fonts={projectFonts} style={node.style} disabled={locked} onChange={setStyle} />
        </>
      )}

      {node.kind === 'image' && (
        <>
          <Field label="Alt text">
            <input
              type="text"
              value={node.alt}
              disabled={locked}
              onChange={(e) => dispatch({ type: 'SetAlt', nodeId: node.id, alt: e.target.value })}
              className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
            />
          </Field>
          <DimensionsFields style={node.style} disabled={locked} onChange={setStyle} />
        </>
      )}

      {parentIsGrid && (
        <Field label="Grid placement">
          <div className="grid grid-cols-2 gap-2">
            <LabeledNumber
              label="Column start"
              value={node.gridPlacement?.columnStart}
              disabled={locked}
              onChange={(v) => dispatch({ type: 'SetGridPlacement', nodeId: node.id, placement: { ...node.gridPlacement, columnStart: v } })}
            />
            <LabeledNumber
              label="Column span"
              value={node.gridPlacement?.columnSpan}
              disabled={locked}
              onChange={(v) => dispatch({ type: 'SetGridPlacement', nodeId: node.id, placement: { ...node.gridPlacement, columnSpan: v } })}
            />
            <LabeledNumber
              label="Row start"
              value={node.gridPlacement?.rowStart}
              disabled={locked}
              onChange={(v) => dispatch({ type: 'SetGridPlacement', nodeId: node.id, placement: { ...node.gridPlacement, rowStart: v } })}
            />
            <LabeledNumber
              label="Row span"
              value={node.gridPlacement?.rowSpan}
              disabled={locked}
              onChange={(v) => dispatch({ type: 'SetGridPlacement', nodeId: node.id, placement: { ...node.gridPlacement, rowSpan: v } })}
            />
          </div>
        </Field>
      )}

      {!isRoot && <NormalElementFields presets={projectShadows} style={node.style} disabled={locked} onChange={setStyle} />}

      <Field label="Visibility">
        <label className="flex items-center gap-2 text-[12px] text-text-2">
          <input type="checkbox" checked={!!node.hidden} onChange={(e) => dispatch({ type: 'SetHidden', nodeId: node.id, hidden: e.target.checked })} />
          Hidden (all sizes)
        </label>
        {nonDesktopBp && (
          <label className="mt-1.5 flex items-center gap-2 text-[12px] text-text-2">
            <input
              type="checkbox"
              checked={node.responsiveHidden?.[nonDesktopBp] ?? false}
              onChange={(e) => dispatch({ type: 'SetResponsiveHidden', nodeId: node.id, breakpoint: nonDesktopBp, hidden: e.target.checked })}
            />
            Hidden on {BREAKPOINT_LABEL[nonDesktopBp]}
            {node.responsiveHidden?.[nonDesktopBp] === undefined && <span className="text-text-3">(inherits Desktop)</span>}
          </label>
        )}
      </Field>

      {!isRoot ? (
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'DeleteNode', nodeId: node.id })
            onSelect(null)
          }}
          className="rounded-md border border-danger/30 bg-panel px-2 py-1.5 text-[11.5px] font-semibold text-danger"
        >
          Delete
        </button>
      ) : (
        <div className="text-[11px] text-text-3">Root screen container</div>
      )}
    </div>
  )
}

function PlaceholderFields({
  node,
  components,
  dispatch,
  locked,
}: {
  node: PlaceholderNode
  components: Component[]
  dispatch: (command: DesignCommand) => void
  locked: boolean
}) {
  const model = useProjectStore((s) => s.activeIndex?.projectModel)
  const styles = projectAssets(model?.pages ?? []).filter((asset) => asset.structure[0]?.tagName.toLowerCase() === node.label.toLowerCase())
  const intelligence = model?.designSystem?.components.find((component) => component.componentId === node.componentDefinitionId)
  const classKey = node.attributes?.className !== undefined ? 'className' : 'class'
  const filePath = node.sourceReference?.filePath ?? node.sourceFilePath
  const line = node.sourceReference?.line ?? node.sourceLine
  return (
    <>
      {styles.length > 1 && <Field label="Project styles"><select aria-label="Project style" value={node.attributes?.[classKey] ?? ''} disabled={locked} onChange={(e) => { dispatch({ type: 'SetAttribute', nodeId: node.id, name: classKey, value: e.target.value }); if (node.attributes?.style) dispatch({ type: 'SetAttribute', nodeId: node.id, name: 'style', value: null }) }} className="w-full rounded border border-border bg-panel p-2 text-xs"><option value={node.attributes?.[classKey] ?? ''}>Current style</option>{styles.map((asset) => <option key={asset.id} value={asset.structure[0].attributes?.class ?? asset.structure[0].attributes?.className ?? ''}>{asset.name}</option>)}</select></Field>}
      {['placeholder', 'title', 'alt', 'aria-label'].filter((name) => node.attributes?.[name] !== undefined).map((name) => <Field key={name} label={name}><input value={node.attributes?.[name] ?? ''} disabled={locked} onChange={(e) => dispatch({ type: 'SetAttribute', nodeId: node.id, name, value: e.target.value })} className="w-full rounded border border-border bg-panel p-2 text-xs"/></Field>)}
      {intelligence && intelligence.props.length > 0 && <Field label="Detected component properties">{intelligence.props.map((prop) => <div key={prop.name} className="mb-2 text-xs"><span className="text-text">{prop.name}</span><p className="mt-1 text-text-3">{prop.values.join(' · ') || prop.type}</p></div>)}<p className="text-[11px] text-text-3">Application-dependent properties are shown as source information.</p></Field>}
      {node.editability === 'limited' && !locked && (
        <SwapField node={node} components={components} onSwap={(c) => dispatch({ type: 'SwapComponent', nodeId: node.id, component: c })} />
      )}
      <Field label="Source">
        <div className="break-all font-mono text-[11px] leading-relaxed text-text-2">
          {filePath ?? 'Unknown source'}
          {line ? `:${line}` : ''}
        </div>
      </Field>
      {(node.attributes?.className || node.attributes?.class) && (
        <Field label="Classes">
          <div className="break-all font-mono text-[11px] leading-relaxed text-text-2">{node.attributes.className ?? node.attributes.class}</div>
        </Field>
      )}
      {node.textPreview && (
        <Field label="Text">
          <div className="text-[11px] leading-relaxed text-text-2">{node.textPreview}</div>
        </Field>
      )}
    </>
  )
}

function SwapField({
  node,
  components,
  onSwap,
}: {
  node: PlaceholderNode
  components: Component[]
  onSwap: (component: { name: string; filePath: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const candidates = components.filter((c) => c.source.filePath !== node.sourceFilePath)

  return (
    <Field label="Component">
      <div className="rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text">{node.label}</div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 text-[11px] font-semibold text-accent-2 hover:underline">
        {open ? 'Cancel Swap' : 'Swap Component'}
      </button>
      {open && (
        <div className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-border">
          {candidates.length === 0 ? (
            <div className="px-2.5 py-2 text-[11.5px] text-text-3">No other detected components to swap in.</div>
          ) : (
            candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSwap({ name: c.name, filePath: c.source.filePath })
                  setOpen(false)
                }}
                className="block w-full truncate px-2.5 py-1.5 text-left text-[12px] text-text-2 hover:bg-hover hover:text-text"
              >
                {c.name}
              </button>
            ))
          )}
        </div>
      )}
    </Field>
  )
}

function ConceptFields({
  node,
  conceptComponents,
  dispatch,
  locked,
}: {
  node: ConceptNode
  conceptComponents: ConceptComponent[]
  dispatch: (command: DesignCommand) => void
  locked: boolean
}) {
  const conceptComponent = conceptComponents.find((c) => c.id === node.conceptComponentId)
  if (!conceptComponent) {
    return <div className="text-[11px] text-text-3">Unknown concept component.</div>
  }
  return (
    <>
      <Field label="Component">
        <div className="rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text">{conceptComponent.name}</div>
      </Field>
      {conceptComponent.variants.length > 0 && (
        <Field label="Variant">
          <select
            value={node.variantId ?? ''}
            disabled={locked}
            onChange={(e) => dispatch({ type: 'SetConceptVariant', nodeId: node.id, variantId: e.target.value || null })}
            className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
          >
            <option value="">None</option>
            {conceptComponent.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {conceptComponent.properties.map((property) => {
        const raw = node.propertyValues[property.id] ?? property.defaultValue
        const set = (value: string) => dispatch({ type: 'SetConceptProperty', nodeId: node.id, propertyId: property.id, value })
        return (
          <Field key={property.id} label={property.name}>
            {property.type === 'boolean' ? (
              <label className="flex items-center gap-2 text-[12px] text-text-2">
                <input type="checkbox" checked={raw === 'true'} disabled={locked} onChange={(e) => set(e.target.checked ? 'true' : 'false')} />
                Enabled
              </label>
            ) : property.type === 'number' ? (
              <input
                type="number"
                value={raw}
                disabled={locked}
                onChange={(e) => set(e.target.value)}
                className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
              />
            ) : property.type === 'select' ? (
              <select
                value={raw}
                disabled={locked}
                onChange={(e) => set(e.target.value)}
                className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
              >
                {(property.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={raw}
                disabled={locked}
                onChange={(e) => set(e.target.value)}
                className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
              />
            )}
          </Field>
        )
      })}
    </>
  )
}

function TypographyFields({
  fonts = FONT_PRESETS,
  style,
  disabled,
  onChange,
  showAlign,
}: {
  style: NodeStyle | undefined
  disabled: boolean
  onChange: (style: Partial<NodeStyle>) => void
  showAlign?: boolean
  fonts?: string[]
}) {
  return (
    <>
      <Field label="Font family">
        <input
          list="frameui-font-presets"
          type="text"
          value={style?.fontFamily ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
          className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
        />
        <datalist id="frameui-font-presets">
          {fonts.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <LabeledNumber label="Size" value={style?.fontSize} disabled={disabled} onChange={(v) => onChange({ fontSize: v })} />
        <LabeledNumber label="Weight" value={style?.fontWeight} step={100} disabled={disabled} onChange={(v) => onChange({ fontWeight: v })} />
        <LabeledNumber label="Line height" value={style?.lineHeight} step={0.1} disabled={disabled} onChange={(v) => onChange({ lineHeight: v })} />
        <LabeledNumber label="Letter spacing" value={style?.letterSpacing} step={0.1} disabled={disabled} onChange={(v) => onChange({ letterSpacing: v })} />
      </div>
      <Field label="Color">
        <ColorField value={style?.color} disabled={disabled} onChange={(color) => onChange({ color })} />
      </Field>
      {showAlign && (
        <Field label="Alignment">
          <Segmented
            value={style?.textAlign ?? 'left'}
            disabled={disabled}
            options={['left', 'center', 'right'] as const}
            onChange={(textAlign) => onChange({ textAlign })}
          />
        </Field>
      )}
    </>
  )
}

function DimensionsFields({
  style,
  disabled,
  onChange,
}: {
  style: NodeStyle | undefined
  disabled: boolean
  onChange: (style: Partial<NodeStyle>) => void
}) {
  return (
    <Field label="Dimensions">
      <div className="grid grid-cols-2 gap-2">
        <SizeField label="Width" value={style?.width} disabled={disabled} onChange={(width) => onChange({ width })} />
        <SizeField label="Height" value={style?.height} disabled={disabled} onChange={(height) => onChange({ height })} />
        <LabeledNumber label="Min width" value={style?.minWidth} disabled={disabled} onChange={(v) => onChange({ minWidth: v })} />
        <LabeledNumber label="Max width" value={style?.maxWidth} disabled={disabled} onChange={(v) => onChange({ maxWidth: v })} />
      </div>
    </Field>
  )
}

function NormalElementFields({
  presets = SHADOW_PRESETS,
  style,
  disabled,
  onChange,
}: {
  presets?: { label: string; value: string }[]
  style: NodeStyle | undefined
  disabled: boolean
  onChange: (style: Partial<NodeStyle>) => void
}) {
  const matchedPreset = presets.find((p) => p.value === (style?.boxShadow ?? ''))
  return (
    <>
      <Field label="Border">
        <div className="grid grid-cols-2 gap-2">
          <ColorField value={style?.borderColor} disabled={disabled} onChange={(borderColor) => onChange({ borderColor })} />
          <LabeledNumber label="Width" value={style?.borderWidth} disabled={disabled} onChange={(v) => onChange({ borderWidth: v })} />
        </div>
      </Field>
      <LabeledNumber label="Border radius" value={style?.borderRadius} disabled={disabled} onChange={(v) => onChange({ borderRadius: v })} />
      <Field label="Box shadow-sm">
        <select
          value={matchedPreset ? matchedPreset.value : style?.boxShadow ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ boxShadow: e.target.value || undefined })}
          className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
        >
          {presets.map((p) => (
            <option key={p.label} value={p.value}>
              {p.label}
            </option>
          ))}
          {!matchedPreset && style?.boxShadow && <option value={style.boxShadow}>Custom</option>}
        </select>
      </Field>
      <Field label="Opacity">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((style?.opacity ?? 1) * 100)}
            disabled={disabled}
            onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
            className="flex-1 disabled:opacity-40"
          />
          <span className="w-8 text-right text-[11px] text-text-2">{Math.round((style?.opacity ?? 1) * 100)}%</span>
        </div>
      </Field>
    </>
  )
}

function ColorField({ value, disabled, onChange }: { value: string | undefined; disabled: boolean; onChange: (value: string) => void }) {
  const swatch = value && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : '#000000'
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={swatch}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-[26px] w-7 shrink-0 rounded border border-border bg-panel-2 disabled:opacity-40"
      />
      <input
        type="text"
        value={value ?? ''}
        placeholder="inherit"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
      />
    </div>
  )
}

function SizeField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number | 'auto' | 'fill' | undefined
  disabled: boolean
  onChange: (value: number | 'auto' | 'fill') => void
}) {
  const mode = value === 'auto' || value === 'fill' ? value : 'fixed'
  return (
    <Field label={label}>
      <div className="flex gap-1">
        <select
          value={mode}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value
            if (next === 'auto' || next === 'fill') onChange(next)
            else onChange(typeof value === 'number' ? value : 0)
          }}
          className="rounded-md border border-border bg-panel-2 px-1.5 py-1.5 text-[12px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
        >
          <option value="fixed">Fixed</option>
          <option value="auto">Auto</option>
          <option value="fill">Fill</option>
        </select>
        {mode === 'fixed' && (
          <input
            type="number"
            value={typeof value === 'number' ? value : 0}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full min-w-0 rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
          />
        )}
      </div>
    </Field>
  )
}

function LabeledNumber({
  label,
  value,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number | undefined
  step?: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        step={step ?? 1}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
      />
    </Field>
  )
}

function NumberField({
  label,
  value,
  min,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min?: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
      />
    </Field>
  )
}

/** Number input for gap/padding that nudges to the nearest spacing token on
 * blur, while dispatching every raw keystroke immediately so typing an
 * exact value never feels blocked (see `snapToSpacingToken` above). */
function SpacingField({
  label,
  value,
  tokens,
  disabled,
  onChange,
}: {
  label: string
  value: number
  tokens: Token[]
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={0}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={(e) => onChange(snapToSpacingToken(Number(e.target.value), tokens))}
        className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[12.5px] text-text outline-none focus:border-accent-2 disabled:opacity-40"
      />
    </Field>
  )
}

function Segmented<T extends string>({
  value,
  options,
  labels,
  disabled,
  onChange,
}: {
  value: T
  options: readonly T[]
  labels?: Partial<Record<T, string>>
  disabled: boolean
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt)}
          className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold capitalize disabled:opacity-40 ${
            value === opt ? 'border-accent-2 bg-selected text-accent-2' : 'border-border bg-panel-2 text-text-2'
          }`}
        >
          {labels?.[opt] ?? opt}
        </button>
      ))}
    </div>
  )
}

function EditabilityBadge({ editability }: { editability: DesignNode['editability'] }) {
  const styles = {
    editable: 'text-success border-success/30 bg-panel',
    limited: 'text-warning border-warning/30 bg-panel',
    locked: 'text-danger border-danger/30 bg-panel',
  } as const
  return <span className={`rounded px-1.5 py-px text-[11px] font-semibold ${styles[editability]}`}>{editability}</span>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-text-3">{label}</div>
      {children}
    </div>
  )
}
