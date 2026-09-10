import { themes } from '@shared/theme'
import type { DesignNode, Breakpoint } from '@shared/types/designNode'
import type { ProjectVisuals } from '@shared/types/projectVisuals'
import type { CapturedElement } from '@shared/types/runtimeCapture'

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const tags = new Set('div span main section article header footer nav aside h1 h2 h3 h4 h5 h6 p a button label input textarea select option form fieldset legend ul ol li table thead tbody tr th td img picture source svg path circle rect line polyline polygon ellipse g defs use br hr strong em b i small figure figcaption details summary'.split(' '))
const voidTags = new Set(['input', 'img', 'source', 'br', 'hr'])
function localAsset(value: string, visuals: ProjectVisuals) {
  if (value.startsWith('data:')) return value
  let clean = value
  try { if (/^https?:/.test(value)) clean = new URL(value).pathname } catch { return '' }
  clean = clean.replace(/^\//, '').split(/[?#]/)[0]
  return visuals.assets[clean] ?? visuals.assets[`public/${clean}`] ?? ''
}
const cssName = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
function styleText(style: Record<string, unknown>): string { return Object.entries(style).filter(([, v]) => v !== undefined).map(([k, v]) => `${cssName(k)}:${typeof v === 'number' && !['opacity', 'fontWeight', 'lineHeight', 'flexGrow', 'zIndex'].includes(k) ? `${v}px` : v === 'fill' ? '100%' : v}`).join(';') }
export function renderProjectNode(node: DesignNode, visuals: ProjectVisuals, breakpoint: Breakpoint): string {
  if (node.hidden || (breakpoint !== 'desktop' && node.responsiveHidden?.[breakpoint])) return ''
  const override = breakpoint === 'desktop' ? undefined : node.responsiveOverrides?.[breakpoint]
  const style: Record<string, unknown> = { ...node.style, ...override?.style }
  if (style.borderWidth !== undefined) style.borderStyle = 'solid'
  if (node.gridPlacement) {
    const placement = node.gridPlacement
    if (placement.columnStart !== undefined) style.gridColumnStart = String(placement.columnStart)
    if (placement.columnSpan !== undefined) style.gridColumnEnd = `span ${placement.columnSpan}`
    if (placement.rowStart !== undefined) style.gridRowStart = String(placement.rowStart)
    if (placement.rowSpan !== undefined) style.gridRowEnd = `span ${placement.rowSpan}`
  }
  let tag = 'div', content = '', attrs: Record<string, string> = {}
  if (node.kind === 'placeholder') {
    tag = tags.has(node.label.toLowerCase()) ? node.label.toLowerCase() : 'div'
    attrs = { ...node.attributes }
    content = node.textPreview ?? ''
  } else if (node.kind === 'stack') {
    Object.assign(style, { display: 'flex', flexDirection: override?.direction ?? node.direction, gap: override?.gap ?? node.gap, alignItems: override?.align ?? node.align, justifyContent: override?.justify ?? node.justify, flexWrap: (override?.wrap ?? node.wrap) ? 'wrap' : 'nowrap' })
  } else if (node.kind === 'grid') Object.assign(style, { display: 'grid', gridTemplateColumns: `repeat(${override?.columns ?? node.columns}, minmax(0, 1fr))`, gridTemplateRows: typeof node.rows === 'number' ? `repeat(${node.rows}, minmax(0, 1fr))` : undefined, columnGap: override?.columnGap ?? node.columnGap, rowGap: override?.rowGap ?? node.rowGap })
  else if (node.kind === 'text' || node.kind === 'heading') { tag = node.kind === 'heading' ? 'h2' : 'p'; content = node.content }
  else if (node.kind === 'button') { tag = 'button'; content = node.label }
  else if (node.kind === 'image') { tag = 'img'; attrs = { src: node.src ?? '', alt: node.alt } }
  else if (node.kind === 'divider') tag = 'hr'
  const attributes = Object.entries(attrs).filter(([k]) => /^(class|className|id|style|type|placeholder|alt|title|role|viewBox|d|fill|stroke|width|height|cx|cy|r|x|y|points|aria-[\w-]+|src)$/.test(k)).map(([k, v]) => {
    if (k === 'style') return ''
    if (k === 'src') v = localAsset(v, visuals)
    return ` ${k === 'className' ? 'class' : k}="${escape(v)}"`
  }).join('')
  const renderedStyle = `${attrs.style ?? ''};${styleText(style)}`.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote, value: string) => `url("${localAsset(value, visuals)}")`)
  const open = `<${tag} data-frameui-node="${escape(node.id)}"${attributes} style="${escape(renderedStyle)}">`
  return voidTags.has(tag) ? open : `${open}${escape(content)}${node.children.map((child) => renderProjectNode(child, visuals, breakpoint)).join('')}</${tag}>`
}
export function projectDocument(node: DesignNode, visuals: ProjectVisuals, breakpoint: Breakpoint, maxWidth?: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>${visuals.css.replace(/<\/style/gi, '<\\/style')}\nhtml,body{margin:0;min-height:100%;}#frameui-surface{max-width:${maxWidth ? `${maxWidth}px` : 'none'};margin-inline:auto;min-height:100vh} [data-frameui-selected]{outline:2px solid ${themes.dark.accent}!important;outline-offset:1px}</style></head><body><div id="frameui-surface">${renderProjectNode(node, visuals, breakpoint)}</div></body></html>`
}
export function capturedDesignTree(element: CapturedElement): DesignNode {
  return { id: crypto.randomUUID(), kind: 'placeholder', label: element.tag, editability: 'editable', provenance: 'existing', attributes: { ...element.attributes, class: element.classes ?? '', style: styleText(element.styles) }, textPreview: element.textPreview, children: element.children.map(capturedDesignTree) }
}
