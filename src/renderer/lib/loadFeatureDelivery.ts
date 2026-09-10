import type { DesignNode } from '@shared/types/designNode'
import type { HandoffInput } from '@shared/types/handoff'
import type { Feature } from '@shared/types/model/featureModel'
import type { ProjectModel } from '@shared/types/model/projectModel'
import { applyDesignOperations } from '@core/design-model/operations'

/** Resolves each state's approved/preferred proposal and semantic operations
 * from the persisted Feature graph. Both Handoff and export use this exact
 * projection so they cannot drift apart. */
export async function loadFeatureDelivery(projectId: string, feature: Feature, projectModel: ProjectModel): Promise<HandoffInput> {
  const [featurePages, workingConceptComponents, workingJourneys, annotations, versions] = await Promise.all([
    window.frameui.workspace.listFeaturePages(projectId, feature.id),
    window.frameui.workspace.listConceptComponents(projectId, feature.id),
    window.frameui.workspace.listJourneys(projectId, feature.id),
    window.frameui.workspace.listAnnotations(projectId, feature.id),
    window.frameui.workspace.listVersions(projectId, feature.id),
  ])
  const approvedVersion = [...versions].filter((version) => ['approved', 'ready-for-development'].includes(version.manifest.feature.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  const deliveryFeature: Feature = approvedVersion ? { ...feature, ...approvedVersion.manifest.feature } : feature
  const conceptComponents = approvedVersion?.manifest.conceptComponents ?? workingConceptComponents
  const journeys = approvedVersion?.manifest.journeys ?? workingJourneys
  const refs = [
    ...deliveryFeature.pageIds.map((pageId) => ({ kind: 'existing' as const, pageId })),
    ...deliveryFeature.referenceOnlyPageIds.map((pageId) => ({ kind: 'existing' as const, pageId })),
    ...deliveryFeature.newPageIds.map((pageId) => ({ kind: 'new' as const, pageId })),
  ]
  const states = approvedVersion?.manifest.designStates ?? (await Promise.all(refs.map((ref) => window.frameui.workspace.listDesignStatesForPage(projectId, ref)))).flat()
  const versionOperations = approvedVersion ? await window.frameui.workspace.getVersionDesignOperations(projectId, feature.id, approvedVersion.id) : null
  const trees: Record<string, DesignNode> = {}
  const operationSets = await Promise.all(states.map(async (state) => {
    const alternatives = approvedVersion?.manifest.alternatives.filter((item) => item.designStateId === state.id) ?? await window.frameui.workspace.listAlternativesForState(projectId, state.id)
    const selected = alternatives.find((item) => item.isApproved) ?? alternatives.find((item) => item.isPreferred) ?? null
    const ownerId = selected?.id ?? state.id
    const [record, operations] = await Promise.all([
      window.frameui.workspace.getDesignTree(projectId, ownerId),
      versionOperations ? Promise.resolve(versionOperations.filter((operation) => operation.ownerId === ownerId)) : window.frameui.workspace.getDesignOperations(projectId, feature.id, ownerId),
    ])
    if (record) trees[state.id] = applyDesignOperations(record.tree, operations)
    return operations
  }))
  return { feature: deliveryFeature, projectModel, featurePages, states, conceptComponents, journeys, annotations, versions, operations: operationSets.flat(), trees }
}
