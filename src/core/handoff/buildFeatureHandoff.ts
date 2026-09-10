import type { DesignNode, ResponsiveOverride } from '@shared/types/designNode'
import type { DesignOperation, PageRef } from '@shared/types/model/featureModel'
import type { FeatureHandoff, HandoffChange, HandoffComponent, HandoffInput, HandoffPage } from '@shared/types/handoff'

function refKey(ref: PageRef): string { return `${ref.kind}:${ref.pageId}` }
function walk(node: DesignNode, visit: (node: DesignNode) => void): void { visit(node); node.children.forEach((child) => walk(child, visit)) }
function nodeName(node: DesignNode): string {
  if (node.kind === 'placeholder') return node.label
  if (node.kind === 'concept') return node.conceptComponentId
  if (node.kind === 'button') return node.label || 'Button'
  if (node.kind === 'heading' || node.kind === 'text') return node.content.slice(0, 48) || node.kind
  return node.kind[0].toUpperCase() + node.kind.slice(1)
}
function readable(value: unknown): string {
  if (value === undefined) return 'inherited'
  if (value === null) return 'none'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(readable).join(', ')
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key} ${readable(item)}`).join(', ')
}

export function describeDesignOperation(operation: DesignOperation): string {
  const from = readable(operation.baseValue)
  const to = readable(operation.proposedValue)
  const bp = operation.breakpoint ? ` on ${operation.breakpoint}` : ''
  switch (operation.type) {
    case 'create': return `Added ${nodeName(operation.node!)}${bp}`
    case 'delete': return `Removed element${bp}`
    case 'move': return `Moved element to a new position${bp}`
    case 'reorder': return `Changed element order${bp}`
    case 'replace': return `Replaced element${bp}`
    case 'set-layout': return `Changed layout${bp} from ${from} to ${to}`
    case 'set-responsive-override': return `Changed ${operation.property ?? 'layout'}${bp} from ${from} to ${to}`
    case 'remove-responsive-override': return `Restored inherited ${operation.property ?? 'layout'}${bp}`
    case 'change-content': return `Changed content from “${from}” to “${to}”`
    case 'create-component-instance': return `Added component ${operation.node ? nodeName(operation.node) : operation.targetNodeId}`
    case 'change-component-variant': return `Changed component variant from ${from} to ${to}`
    case 'change-state': return `Changed state from ${from} to ${to}`
    case 'change-interaction': return `Changed interaction from ${from} to ${to}`
    case 'change-visibility': return `Changed visibility${bp} from ${from} to ${to}`
    case 'set-property': return `Changed ${operation.property ?? 'property'}${bp} from ${from} to ${to}`
    case 'unset-property': return `Restored ${operation.property ?? 'property'}${bp} to ${from}`
  }
}

export function buildFeatureHandoff(input: HandoffInput): FeatureHandoff {
  const { feature, projectModel, featurePages, states, operations, annotations, journeys, versions, trees } = input
  const stateById = new Map(states.map((state) => [state.id, state]))
  const pageName = (ref: PageRef) => ref.kind === 'existing'
    ? projectModel.pages.find((page) => page.id === ref.pageId)?.name ?? ref.pageId
    : featurePages.find((page) => page.id === ref.pageId)?.name ?? ref.pageId
  const pageRefs: PageRef[] = [
    ...feature.pageIds.map((pageId) => ({ kind: 'existing' as const, pageId })),
    ...feature.newPageIds.map((pageId) => ({ kind: 'new' as const, pageId })),
    ...feature.referenceOnlyPageIds.map((pageId) => ({ kind: 'existing' as const, pageId })),
  ]

  const pages: HandoffPage[] = pageRefs.map((ref) => {
    const projectPage = ref.kind === 'existing' ? projectModel.pages.find((page) => page.id === ref.pageId) : undefined
    const featurePage = ref.kind === 'new' ? featurePages.find((page) => page.id === ref.pageId) : undefined
    const pageStates = states.filter((state) => refKey(state.pageRef) === refKey(ref))
    const pageOps = operations.filter((operation) => refKey(operation.pageRef) === refKey(ref))
    const reference = feature.referenceOnlyPageIds.includes(ref.pageId)
    const responsive: HandoffPage['responsive'] = []
    const componentIds = new Set<string>()
    for (const state of pageStates) {
      const tree = trees[state.id]
      if (!tree) continue
      walk(tree, (node) => {
        if (node.kind === 'placeholder') {
          const component = projectModel.components.find((item) => item.name === node.label)
          if (component) componentIds.add(component.id)
        }
        if (node.kind === 'concept') componentIds.add(node.conceptComponentId)
        for (const breakpoint of ['tablet', 'mobile'] as const) {
          const override = node.responsiveOverrides?.[breakpoint]
          if (override || node.responsiveHidden?.[breakpoint] !== undefined) responsive.push({
            nodeId: node.id,
            nodeName: nodeName(node),
            breakpoint,
            override: { ...(override ?? {}), ...(node.responsiveHidden?.[breakpoint] !== undefined ? { style: { opacity: node.responsiveHidden[breakpoint] ? 0 : 1, ...override?.style } } : {}) } as ResponsiveOverride,
          })
        }
      })
    }
    const pageNotes = annotations.filter((note) => refKey(note.pageRef) === refKey(ref) && note.status !== 'resolved')
    const kind = reference ? 'reference' : ref.kind === 'new' ? 'new' : pageOps.length > 0 ? 'modified' : 'existing'
    return {
      ref, name: projectPage?.name ?? featurePage?.name ?? ref.pageId,
      route: projectPage?.route ?? featurePage?.suggestedRoute ?? null,
      kind, sourcePath: projectPage?.source.filePath ?? null, responsive, annotations: pageNotes,
      componentIds: [...componentIds],
      states: pageStates.map((state) => {
        const ownOps = operations.filter((operation) => operation.designStateId === state.id)
        const relatedJourneys = journeys.flatMap((journey) => journey.connections.filter((connection) => {
          const from = journey.steps.find((step) => step.id === connection.fromStepId)
          return from?.designStateId === state.id
        }).map((connection) => `${connection.trigger}: ${connection.label || connection.elementLabel || 'Continue'}`))
        return {
          id: state.id, name: state.name, origin: state.origin,
          viewport: ['desktop', ...responsive.map((item) => item.breakpoint).filter((bp, index, all) => all.indexOf(bp) === index)],
          differences: ownOps.map(describeDesignOperation), interactions: relatedJourneys,
          componentIds: [...componentIds], notes: pageNotes.filter((note) => note.designStateId === state.id || note.designStateId === null),
        }
      }),
    }
  })

  const components: HandoffComponent[] = []
  for (const component of projectModel.components.filter((item) => feature.componentIds.includes(item.id) || pages.some((page) => page.componentIds.includes(item.id)))) {
    const intelligence = projectModel.designSystem?.components.find((item) => item.componentId === component.id)
    const instanceNodeIds = new Set<string>()
    Object.values(trees).forEach((tree) => walk(tree, (node) => { if (node.kind === 'placeholder' && node.label === component.name) instanceNodeIds.add(node.id) }))
    const componentOps = operations.filter((operation) => operation.targetNodeId === component.id || instanceNodeIds.has(operation.targetNodeId) || operation.summary.includes(component.name))
    const pageNames = pages.filter((page) => page.componentIds.includes(component.id)).map((page) => page.name)
    components.push({ id: component.id, name: component.name, kind: componentOps.length ? 'modified' : 'reused', sourcePath: component.source.filePath, usageCount: intelligence?.usages.reduce((sum, usage) => sum + usage.count, 0) ?? pageNames.length, pageNames, props: intelligence?.props.map(({ name, type, required, defaultValue }) => ({ name, type, required, defaultValue })) ?? [], variants: intelligence?.fixtures.map((fixture) => fixture.name) ?? [], changes: componentOps.map(describeDesignOperation), responsive: intelligence?.responsiveBehaviours ?? [] })
  }
  for (const component of input.conceptComponents) {
    const pageNames = pages.filter((page) => page.componentIds.includes(component.id)).map((page) => page.name)
    components.push({ id: component.id, name: component.name, kind: 'new', sourcePath: null, usageCount: pageNames.length, pageNames, props: component.properties.map((property) => ({ name: property.name, type: property.type, required: false, defaultValue: property.defaultValue })), variants: component.variants.map((variant) => variant.name), changes: [], responsive: [] })
  }

  const interactions = journeys.flatMap((journey) => journey.connections.map((connection) => {
    const from = journey.steps.find((step) => step.id === connection.fromStepId)
    const to = journey.steps.find((step) => step.id === connection.toStepId)
    const fromState = from?.designStateId ? stateById.get(from.designStateId)?.name : null
    const toState = to?.designStateId ? stateById.get(to.designStateId)?.name : null
    return { id: connection.id, journeyName: journey.name, trigger: connection.trigger, element: connection.elementLabel ?? 'Page', from: from ? `${pageName(from.pageRef)}${fromState ? ` / ${fromState}` : ''}` : 'Unknown', to: to ? `${pageName(to.pageRef)}${toState ? ` / ${toState}` : ''}` : 'Unknown', label: connection.label }
  }))
  const changes: HandoffChange[] = operations.map((operation) => ({ id: operation.id, pageName: pageName(operation.pageRef), element: operation.targetNodeId, description: describeDesignOperation(operation), technical: operation }))
  const latestApproved = [...versions].filter((version) => ['approved', 'ready-for-development'].includes(version.manifest.feature.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  const notes = annotations.filter((note) => note.status !== 'resolved' && (note.priority === 'high' || note.comment.trim().length > 0))
  return {
    feature, approvedVersion: latestApproved, pages, components, interactions, changes, notes,
    summary: {
      pages: pages.length, changedPages: pages.filter((page) => page.kind === 'modified').length,
      newPages: pages.filter((page) => page.kind === 'new').length, referencePages: pages.filter((page) => page.kind === 'reference').length,
      states: pages.reduce((sum, page) => sum + page.states.length, 0),
      responsiveViews: pages.reduce((sum, page) => sum + new Set(page.states.flatMap((state) => state.viewport)).size, 0),
      reusedComponents: components.filter((component) => component.kind === 'reused').length,
      modifiedComponents: components.filter((component) => component.kind === 'modified').length,
      newComponents: components.filter((component) => component.kind === 'new').length,
      journeySteps: journeys.reduce((sum, journey) => sum + journey.steps.length, 0), annotations: notes.length,
    },
  }
}
