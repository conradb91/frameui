import type { DesignNode } from './designNode'
import type { SharePreview, Journey, DesignState, FeaturePage, PageRefKind } from './model/featureModel'

/**
 * Review-safe bundle for one Journey step (spec Phase 25) — everything a
 * Share Preview viewer needs, with nothing beyond design data unless the
 * designer explicitly opted into `includeCapturedStates`. `pageId` is left
 * for the *viewer* (which already has the live `ProjectModel` loaded) to
 * resolve a real existing page's name/route/structure — packaging runs in
 * the main process, which has no cheap access to that index.
 */
export interface SharePackageStep {
  stepId: string
  pageRefKind: PageRefKind
  pageId: string
  featurePage: FeaturePage | null
  designStateId: string | null
  designState: DesignState | null
  alternativeId: string | null
  referenceOnly: boolean
  tree: DesignNode | null
  position: { x: number; y: number }
}

export interface SharePackageBundle {
  sharePreviewId: string
  featureId: string
  name: string
  scope: SharePreview['scope']
  viewports: SharePreview['viewports']
  includeCurrentComparison: boolean
  journey: Pick<Journey, 'id' | 'name' | 'description' | 'connections'> | null
  steps: SharePackageStep[]
  generatedAt: string
}
