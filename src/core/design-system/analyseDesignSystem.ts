import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DesignSystemModel, ComponentCategory, ComponentIntelligence, ComponentPropOption, DesignPattern, DesignValueObservation, ConsistencyFinding } from '@shared/types/designSystem'
import type { Component, Page, Token } from '@shared/types/model/projectModel'
import type { PageStructureItem } from '@shared/types/pageStructure'
import { extractPageStructureFromSource } from '@core/adapters/markup/extractPageStructure'

const id = (prefix: string, value: string) => `${prefix}.${value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 70) || 'item'}_${crypto.createHash('sha1').update(value).digest('hex').slice(0, 8)}`
const componentKey = (name: string) => name.replace(/^(?:x-|x:|svelte:)/i, '').replace(/[-_.:]/g, '').toLowerCase()
const read = (root: string, file: string) => { try { return fs.readFileSync(path.join(root, file), 'utf8') } catch { return '' } }
const allNodes = (items: PageStructureItem[]): PageStructureItem[] => items.flatMap((item) => [item, ...allNodes(item.children)])
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function previewMarkup(items: PageStructureItem[]): string {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
  return items.map((item) => {
    const tag = /^[a-z][a-z0-9-]*$/i.test(item.tagName) && !item.isKnownComponent ? item.tagName.toLowerCase() : 'div'
    const attributes = Object.entries(item.attributes ?? {}).filter(([name]) => ['class', 'className', 'role', 'type', 'name', 'aria-label', 'src', 'alt'].includes(name)).map(([name, value]) => ` ${name === 'className' ? 'class' : name}="${escapeHtml(value)}"`).join('')
    const componentAttribute = item.isKnownComponent ? ` data-frameui-source-component="${escapeHtml(item.tagName)}"` : ''
    if (voidTags.has(tag)) return `<${tag}${attributes}${componentAttribute}>`
    return `<${tag}${attributes}${componentAttribute}>${previewMarkup(item.children)}${item.children.length ? '' : escapeHtml(item.textPreview ?? '')}</${tag}>`
  }).join('')
}
function previewCss(root: string, filePath: string, content: string): string {
  const imported = dependencies(content).filter((dependency) => /\.(?:css|scss|sass|less)$/i.test(dependency)).map((dependency) => read(root, path.join(path.dirname(filePath), dependency)))
  const embedded = [...content.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map((match) => match[1])
  return [...imported, ...embedded].join('\n').replace(/<\/style/gi, '<\\/style').slice(0, 100_000)
}

function categoryFor(name: string, structure: PageStructureItem[]): ComponentCategory {
  const haystack = `${name} ${allNodes(structure).map((item) => item.tagName).join(' ')}`.toLowerCase()
  const rules: [RegExp, ComponentCategory][] = [
    [/(button|btn)/, 'Buttons'], [/(input|field|textarea)/, 'Inputs'], [/(select|combobox)/, 'Selects'], [/(check|radio|switch)/, 'Checkboxes'], [/(nav|menu|sidebar|breadcrumb)/, 'Navigation'], [/(tab)/, 'Tabs'], [/(card|panel|tile)/, 'Cards'], [/(table|grid|datagrid)/, 'Tables'], [/(modal|dialog)/, 'Modals'], [/(drawer|sheet)/, 'Drawers'], [/(badge|pill|status|chip)/, 'Badges'], [/(alert|banner|notice)/, 'Alerts'], [/(toast|snackbar)/, 'Toasts'], [/(pageheader|page-header)/, 'Page Headers'], [/(empty)/, 'Empty States'], [/(loading|spinner|skeleton)/, 'Loading States'], [/(form)/, 'Forms'],
  ]
  return rules.find(([pattern]) => pattern.test(haystack))?.[1] ?? 'Project Components'
}

function extractProps(content: string): ComponentPropOption[] {
  const result: ComponentPropOption[] = []
  const blocks = [...content.matchAll(/(?:interface|type)\s+\w*Props\w*\s*(?:=)?\s*\{([\s\S]*?)\}/g)]
  for (const block of blocks) {
    for (const match of block[1].matchAll(/(?:^|\n)\s*([A-Za-z_$][\w$]*)(\?)?\s*:\s*([^;\n]+)/g)) {
      const type = match[3].trim()
      const values = [...type.matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1])
      if (!result.some((item) => item.name === match[1])) result.push({ name: match[1], required: !match[2], type, values, defaultValue: null })
    }
  }
  for (const match of content.matchAll(/(?:defineProps|withDefaults)\s*(?:<[^>]+>)?\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const prop of match[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(?:\{[^}]*default\s*:\s*)?([^,}\n]+)/g)) {
      if (!result.some((item) => item.name === prop[1])) result.push({ name: prop[1], required: false, type: prop[2].trim(), values: [], defaultValue: null })
    }
  }
  return result.slice(0, 80)
}

function fixturesFor(componentId: string, props: ComponentPropOption[]) {
  const fixtures = [{ id: id('fixture', `${componentId}:default`), name: 'Default', origin: 'detected' as const, props: Object.fromEntries(props.filter((prop) => prop.defaultValue !== null).map((prop) => [prop.name, prop.defaultValue!])) }]
  for (const prop of props) for (const value of prop.values.slice(0, 8)) fixtures.push({ id: id('fixture', `${componentId}:${prop.name}:${value}`), name: value.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase()), origin: 'detected' as const, props: { [prop.name]: value } })
  return fixtures.slice(0, 20)
}

function requirements(content: string): string[] {
  const checks: [RegExp, string][] = [[/(ThemeProvider|useTheme|theme\.)/, 'Theme'], [/(RouterProvider|useRouter|useNavigate|<Link)/, 'Router'], [/(FormProvider|useFormContext)/, 'Form'], [/(IntlProvider|useTranslation|\$t\()/, 'Localization'], [/(Provider|useSelector|useStore)/, 'Application state']]
  return checks.filter(([pattern]) => pattern.test(content)).map(([, label]) => label)
}

function dependencies(content: string): string[] {
  const values = [
    ...[...content.matchAll(/\bimport\s+(?:[\s\S]*?\bfrom\s*)?['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ...[...content.matchAll(/\brequire\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  ]
  return [...new Set(values.filter((value) => value.startsWith('.'))) ].slice(0, 100)
}

function sourceRefs(pages: Page[], component: Component) {
  return pages.filter((page) => page.componentNames.some((name) => componentKey(name) === componentKey(component.name))).map((page) => ({ pageId: page.id, pageName: page.name, route: page.route, source: page.source, count: countName(page.structure, component.name) }))
}
function countName(items: PageStructureItem[], name: string): number { return allNodes(items).filter((item) => componentKey(item.tagName) === componentKey(name)).length }

function observations(root: string, pages: Page[], components: Component[], tokens: Token[]): DesignValueObservation[] {
  const entryFiles = [...pages.map((item) => item.source), ...components.map((item) => item.source)]
  const dependencyFiles = entryFiles.flatMap((source) => dependencies(read(root, source.filePath)).map((dependency) => ({ filePath: path.normalize(path.join(path.dirname(source.filePath), dependency)) })))
  const files = [...new Map([...entryFiles, ...dependencyFiles].map((source) => [source.filePath, source])).values()]
  const values = new Map<string, { category: DesignValueObservation['category']; value: string; count: number; sources: typeof files; pages: Set<string> }>()
  const add = (category: DesignValueObservation['category'], value: string, source: typeof files[number], pageId?: string) => {
    const key = `${category}:${value.toLowerCase()}`; const current = values.get(key) ?? { category, value, count: 0, sources: [], pages: new Set<string>() }
    current.count++; if (!current.sources.some((item) => item.filePath === source.filePath)) current.sources.push(source); if (pageId) current.pages.add(pageId); values.set(key, current)
  }
  for (const source of files) {
    const content = read(root, source.filePath); const pageId = pages.find((page) => page.source.filePath === source.filePath)?.id
    for (const match of content.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi)) add('colour', match[0], source, pageId)
    for (const match of content.matchAll(/(?:padding|margin|gap|top|right|bottom|left)(?:-[a-z]+)?\s*:\s*(-?\d+(?:\.\d+)?(?:px|rem))/gi)) add('spacing', match[1], source, pageId)
    for (const match of content.matchAll(/border-radius\s*:\s*([^;\n}]+)/gi)) add('radius', match[1].trim(), source, pageId)
    for (const match of content.matchAll(/border(?:-[a-z]+)?\s*:\s*([^;\n}]+)/gi)) add('border', match[1].trim(), source, pageId)
    for (const match of content.matchAll(/box-shadow\s*:\s*([^;\n}]+)/gi)) add('shadow', match[1].trim(), source, pageId)
    for (const match of content.matchAll(/font-size\s*:\s*([^;\n}]+)(?:[\s\S]{0,100}?font-weight\s*:\s*([^;\n}]+))?/gi)) add('typography', `${match[1].trim()}${match[2] ? ` / ${match[2].trim()}` : ''}`, source, pageId)
    for (const match of content.matchAll(/<([A-Z][A-Za-z0-9_$]*Icon)\b/g)) add('icon', match[1], source, pageId)
    for (const match of content.matchAll(/\b(?:p|m|gap|space-[xy])-(\d+(?:\.5)?)\b/g)) { const token = tokens.find((item) => item.category === 'spacing' && item.name === match[1]); if (token) add('spacing', token.value, source, pageId) }
    for (const match of content.matchAll(/\b(?:rounded)(?:-([\w-]+))?\b/g)) { const token = tokens.find((item) => item.category === 'radius' && item.name === (match[1] ?? 'DEFAULT')); if (token) add('radius', token.value, source, pageId) }
    for (const match of content.matchAll(/\b(?:text|bg|border)-([\w-]+)\b/g)) { const token = tokens.find((item) => item.category === 'color' && item.name.replace(/\./g, '-') === match[1]); if (token) add('colour', token.value, source, pageId) }
  }
  for (const token of tokens) {
    const category = token.category === 'color' ? 'colour' : token.category
    if (category === 'breakpoint') add('breakpoint', token.value, { filePath: 'project configuration' })
  }
  return [...values.values()].map((item): DesignValueObservation => { const token = tokens.find((candidate) => candidate.value === item.value && (candidate.category === item.category || (candidate.category === 'color' && item.category === 'colour'))); return { id: id('observation', `${item.category}:${item.value}`), category: item.category, name: token?.name ?? item.value, value: item.value, usageCount: item.count, sources: item.sources.slice(0, 30), pageIds: [...item.pages], status: 'observed' } }).sort((a, b) => b.usageCount - a.usageCount)
}

function patterns(pages: Page[], components: ComponentIntelligence[]): DesignPattern[] {
  const result: DesignPattern[] = []
  const add = (category: DesignPattern['category'], name: string, page: Page, evidence: string[]) => {
    const key = `${category}:${name}`; const existing = result.find((item) => item.id === id('pattern', key))
    if (existing) { existing.pageIds.push(page.id); existing.evidence.push(...evidence.filter((value) => !existing.evidence.includes(value))); return }
    result.push({ id: id('pattern', key), category, name, description: `Observed ${name.toLowerCase()} structure`, pageIds: [page.id], componentIds: components.filter((item) => item.usages.some((usage) => usage.pageId === page.id)).map((item) => item.componentId), evidence })
  }
  for (const page of pages) {
    const nodes = allNodes(page.structure); const tags = nodes.map((item) => item.tagName.toLowerCase()); const names = page.componentNames.map((item) => item.toLowerCase())
    if (tags.includes('form')) add('form', 'Form page', page, ['form element'])
    if (tags.includes('table')) add('page', 'Table page', page, ['table element'])
    if (names.some((name) => /pageheader|page-header/.test(name)) || tags.some((tag) => /^h1$/.test(tag))) add('page', names.some((name) => /button|action/.test(name)) ? 'Page Header with actions' : 'Page Header', page, ['title structure'])
    if (tags.includes('nav') || names.some((name) => /nav|sidebar|menu/.test(name))) add('navigation', 'Application navigation', page, ['navigation structure'])
    if (names.some((name) => /empty/.test(name))) add('feedback', 'Empty state', page, ['empty-state component'])
    if (names.some((name) => /modal|dialog/.test(name))) add('feedback', 'Modal workflow', page, ['dialog component'])
    if (nodes.some((node) => /grid/.test(node.attributes?.className ?? node.attributes?.class ?? ''))) add('layout', 'Grid layout', page, ['grid class'])
    if (nodes.some((node) => /flex/.test(node.attributes?.className ?? node.attributes?.class ?? ''))) add('layout', 'Flex layout', page, ['flex class'])
  }
  return result.sort((a, b) => b.pageIds.length - a.pageIds.length)
}

function colourVector(value: string): [number, number, number] | null { const match = /^#([0-9a-f]{6})$/i.exec(value); return match ? [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)] : null }
function findings(observed: DesignValueObservation[], components: ComponentIntelligence[], projectComponents: Component[], detectedPatterns: DesignPattern[]): ConsistencyFinding[] {
  const result: ConsistencyFinding[] = []
  const add = (finding: Omit<ConsistencyFinding, 'id' | 'evidenceSignature'>) => { const signature = JSON.stringify([finding.kind, finding.commonValue, finding.observedValue, finding.componentIds, finding.pageIds, finding.evidence]); result.push({ ...finding, id: id('finding', `${finding.kind}:${finding.title}`), evidenceSignature: crypto.createHash('sha1').update(signature).digest('hex') }) }
  for (const category of ['spacing', 'radius', 'typography'] as const) {
    const values = observed.filter((item) => item.category === category); const common = values[0]
    if (!common || common.usageCount < 2) continue
    for (const unusual of values.slice(1).filter((item) => item.usageCount <= Math.max(3, common.usageCount / 3))) add({ kind: category === 'spacing' ? 'spacing-outlier' : category === 'radius' ? 'radius-outlier' : 'typography-difference', title: `Unusual ${category} value`, description: `${unusual.value} appears less often than the common ${common.value}.`, commonValue: common.value, observedValue: unusual.value, instanceCount: unusual.usageCount, componentIds: [], pageIds: unusual.pageIds, sources: unusual.sources, evidence: [`${common.value}: ${common.usageCount} usages`, `${unusual.value}: ${unusual.usageCount} usages`] })
  }
  const colours = observed.filter((item) => item.category === 'colour' && colourVector(item.value))
  for (let i = 0; i < colours.length; i++) for (let j = i + 1; j < colours.length; j++) { const a = colourVector(colours[i].value)!, b = colourVector(colours[j].value)!; const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); if (distance > 0 && distance <= 18) add({ kind: 'near-duplicate-colour', title: 'Possible duplicate colour values', description: `${colours[i].value} and ${colours[j].value} are visually close.`, commonValue: colours[i].value, observedValue: colours[j].value, instanceCount: colours[i].usageCount + colours[j].usageCount, componentIds: [], pageIds: [...new Set([...colours[i].pageIds, ...colours[j].pageIds])], sources: [...colours[i].sources, ...colours[j].sources], evidence: [`RGB distance ${distance.toFixed(1)}`] }) }
  for (const category of ['page', 'form', 'navigation', 'layout', 'feedback'] as const) {
    const alternatives = detectedPatterns.filter((pattern) => pattern.category === category).sort((left, right) => right.pageIds.length - left.pageIds.length)
    const common = alternatives[0]
    if (!common || common.pageIds.length < 2) continue
    for (const alternate of alternatives.slice(1)) add({ kind: 'pattern-difference', title: `Possible alternate ${category} pattern`, description: `${alternate.name} differs from the more common ${common.name}.`, commonValue: common.name, observedValue: alternate.name, instanceCount: alternate.pageIds.length, componentIds: alternate.componentIds, pageIds: alternate.pageIds, sources: [], evidence: [`${common.name}: ${common.pageIds.length} pages`, `${alternate.name}: ${alternate.pageIds.length} pages`, ...alternate.evidence] })
  }
  for (const component of components) for (const relatedId of component.relatedComponentIds) if (component.componentId < relatedId) { const other = components.find((item) => item.componentId === relatedId)!; add({ kind: 'possible-duplicate-component', title: `Possible related components: ${projectComponents.find((item) => item.id === component.componentId)?.name} and ${projectComponents.find((item) => item.id === other.componentId)?.name}`, description: 'Similar category and source structure detected. Review before consolidating.', commonValue: null, observedValue: null, instanceCount: component.usages.length + other.usages.length, componentIds: [component.componentId, other.componentId], pageIds: [...new Set([...component.usages, ...other.usages].map((item) => item.pageId))], sources: [], evidence: [`Category: ${component.category}`, 'Structural tag overlap'] }) }
  for (const category of ['page', 'form', 'navigation', 'feedback'] as const) {
    const variants = detectedPatterns.filter((pattern) => pattern.category === category).sort((left, right) => right.pageIds.length - left.pageIds.length)
    if (variants.length < 2 || variants[0].pageIds.length < 2) continue
    for (const alternate of variants.slice(1)) add({ kind: 'pattern-difference', title: `Different ${category} pattern detected`, description: `${alternate.name} differs from the more common ${variants[0].name}.`, commonValue: variants[0].name, observedValue: alternate.name, instanceCount: alternate.pageIds.length, componentIds: alternate.componentIds, pageIds: alternate.pageIds, sources: [], evidence: [`${variants[0].name}: ${variants[0].pageIds.length} pages`, `${alternate.name}: ${alternate.pageIds.length} pages`] })
  }
  return result
}

export function analyseDesignSystem(rootPath: string, pages: Page[], projectComponents: Component[], tokens: Token[], framework: string): DesignSystemModel {
  const known = new Set(projectComponents.map((item) => item.name))
  const components: ComponentIntelligence[] = projectComponents.map((component) => {
    const content = read(rootPath, component.source.filePath)
    const sourceStructure = extractPageStructureFromSource(content, component.source.filePath, known, true)
    const props = extractProps(content); const contextRequirements = requirements(content); const usages = sourceRefs(pages, component)
    const tokenIds = tokens.filter((token) => content.includes(token.name) || content.includes(token.value)).map((token) => token.id)
    const layoutBehaviours = [...new Set([...content.matchAll(/(?:display\s*:\s*|\bclass(?:Name)?\s*=\s*['"][^'"]*\b)(grid|flex|inline-flex|block|absolute|fixed)\b/gi)].map((match) => match[1].toLowerCase()))]
    const responsiveBehaviours = [...new Set([...content.matchAll(/\b(?:sm|md|lg|xl|2xl):[\w-]+|@media\s*\([^)]*\)/gi)].map((match) => match[0]))].slice(0, 20)
    const hasVisualStructure = allNodes(sourceStructure).some((item) => !['script', 'style', 'template'].includes(item.tagName.toLowerCase()))
    const staticDocument = hasVisualStructure ? { html: previewMarkup(sourceStructure), css: previewCss(rootPath, component.source.filePath, content) } : null
    const dependencyPaths = dependencies(content)
    const dependencyFingerprint = crypto.createHash('sha256')
      .update(content)
      .update(dependencyPaths.map((dependency) => read(rootPath, path.join(path.dirname(component.source.filePath), dependency))).join('\n'))
      .update(tokens.filter((token) => tokenIds.includes(token.id)).map((token) => `${token.id}:${token.value}`).join('\n'))
      .digest('hex')
    return { componentId: component.id, category: categoryFor(component.name, sourceStructure), frameworkOrigin: framework, props, fixtures: fixturesFor(component.id, props), sourceStructure, previewDocument: staticDocument, contextRequirements, tokenIds, layoutBehaviours, responsiveBehaviours, usages, previewApproach: hasVisualStructure ? (contextRequirements.length ? 'context' : 'source') : 'unavailable', previewUnavailableReason: hasVisualStructure ? null : 'No safe standalone render or runtime instance was found.', dependencyPaths, dependencyFingerprint, relatedComponentIds: [], searchText: `${component.name} ${content.slice(0, 3000)} ${usages.map((item) => item.pageName).join(' ')}`.toLowerCase() }
  })
  for (const component of components) {
    const tags = new Set(allNodes(component.sourceStructure).map((item) => item.tagName.toLowerCase()))
    component.relatedComponentIds = components.filter((other) => other !== component && other.category === component.category && (() => { const otherTags = new Set(allNodes(other.sourceStructure).map((item) => item.tagName.toLowerCase())); const union = new Set([...tags, ...otherTags]); const shared = [...tags].filter((tag) => otherTags.has(tag)); const sameRoot = component.sourceStructure[0]?.tagName.toLowerCase() === other.sourceStructure[0]?.tagName.toLowerCase(); return union.size > 0 && sameRoot && shared.length / union.size >= .5 })()).map((item) => item.componentId).slice(0, 8)
  }
  const observed = observations(rootPath, pages, projectComponents, tokens)
  const detectedPatterns = patterns(pages, components)
  return { version: 1, generatedAt: new Date().toISOString(), categories: ['components', 'colours', 'typography', 'spacing', 'radius', 'borders', 'shadows', 'icons', 'breakpoints', 'layouts', 'forms', 'navigation', 'page-patterns', 'feedback-patterns', 'other-patterns'], components, observations: observed, patterns: detectedPatterns, findings: findings(observed, components, projectComponents, detectedPatterns) }
}
