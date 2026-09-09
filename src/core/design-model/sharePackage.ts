import fs from 'node:fs'
import path from 'node:path'
import type { SharePreview, DesignState, JourneyStep, PageRef } from '@shared/types/model/featureModel'
import type { DesignNode } from '@shared/types/designNode'
import type { SharePackageBundle, SharePackageStep } from '@shared/types/sharePackage'
import { getSharePackageDir } from '@core/workspace/paths'
import * as sharePreviewStore from '@core/workspace/models/sharePreviewStore'
import * as journeyStore from '@core/workspace/models/journeyStore'
import * as designStateStore from '@core/workspace/models/designStateStore'
import * as designTreeStore from '@core/workspace/models/designTreeStore'
import * as featurePageStore from '@core/workspace/models/featurePageStore'
import * as featureStore from '@core/workspace/models/featureStore'
import * as featureWorkPackageStore from '@core/workspace/models/featureWorkPackageStore'
import { applyDesignOperations } from './operations'
import { readJsonFile, writeJsonFileAtomic } from '@core/workspace/atomicJson'

export type { SharePackageBundle }

/** Resolves one step's tree respecting the package's capture-inclusion
 * gate: a captured-origin state's tree is only included when the designer
 * explicitly turned `includeCapturedStates` on; otherwise the step is
 * still listed (so the Journey shape stays intact) but with `tree: null`
 * and the viewer shows a "content excluded" placeholder instead of
 * silently fabricating something. */
function resolveStepTree(userDataPath: string, projectId: string, step: JourneyStep, designState: DesignState | null, includeCapturedStates: boolean): DesignNode | null {
  if (step.referenceOnly) return null
  if (designState?.origin === 'captured' && !includeCapturedStates) return null
  const ownerId = step.alternativeId ?? step.designStateId
  if (!ownerId) return null
  const baseline = designTreeStore.getDesignTree(userDataPath, projectId, ownerId)?.tree ?? null
  if (!baseline || !designState) return baseline
  return applyDesignOperations(baseline, featureWorkPackageStore.getOperations(userDataPath, projectId, designState.featureId, ownerId))
}

function packageStepId(pageRef: PageRef, stateId: string | null): string {
  return `share.${pageRef.kind}_${pageRef.pageId.replace(/[^a-z0-9_]+/g, '_')}_${stateId?.replace(/[^a-z0-9_]+/g, '_') ?? 'page'}`
}

/** Page/Feature scopes are galleries rather than interaction graphs. Build
 * one step per state (or one page-level step when no state exists), keeping
 * reference-only pages present but intentionally tree-less. */
function scopedSteps(userDataPath: string, projectId: string, preview: SharePreview): JourneyStep[] {
  const refs: { pageRef: PageRef; referenceOnly: boolean }[] = []
  if (preview.scope === 'page' && preview.pageRef) {
    const feature = featureStore.getFeature(userDataPath, projectId, preview.featureId)
    refs.push({ pageRef: preview.pageRef, referenceOnly: preview.pageRef.kind === 'existing' && !!feature?.referenceOnlyPageIds.includes(preview.pageRef.pageId) })
  }
  if (preview.scope === 'feature') {
    const feature = featureStore.getFeature(userDataPath, projectId, preview.featureId)
    if (feature) {
      refs.push(...feature.pageIds.map((pageId) => ({ pageRef: { kind: 'existing' as const, pageId }, referenceOnly: false })))
      refs.push(...feature.newPageIds.map((pageId) => ({ pageRef: { kind: 'new' as const, pageId }, referenceOnly: false })))
      refs.push(...feature.referenceOnlyPageIds.map((pageId) => ({ pageRef: { kind: 'existing' as const, pageId }, referenceOnly: true })))
    }
  }
  const result: JourneyStep[] = []
  for (const { pageRef, referenceOnly } of refs) {
    const states = referenceOnly ? [] : designStateStore.listDesignStatesForPage(userDataPath, projectId, pageRef)
    const variants = states.length > 0 ? states : [null]
    for (const state of variants) {
      const index = result.length
      result.push({
        id: packageStepId(pageRef, state?.id ?? null),
        pageRef,
        designStateId: state?.id ?? null,
        alternativeId: null,
        referenceOnly,
        provenance: referenceOnly ? 'reference-only' : state?.provenance ?? (pageRef.kind === 'new' ? 'new' : 'existing'),
        position: { x: 80 + (index % 3) * 300, y: 80 + Math.floor(index / 3) * 220 },
      })
    }
  }
  return result
}

export function buildSharePackage(userDataPath: string, projectId: string, sharePreviewId: string): SharePreview {
  const preview = sharePreviewStore.getSharePreview(userDataPath, projectId, sharePreviewId)
  if (!preview) throw new Error(`SharePreview ${sharePreviewId} not found in project ${projectId}`)

  const journey = preview.journeyId ? journeyStore.getJourney(userDataPath, projectId, preview.journeyId) : null

  const sourceSteps = journey?.steps ?? scopedSteps(userDataPath, projectId, preview)
  const steps: SharePackageStep[] = sourceSteps.map((step) => {
    const designState = step.designStateId ? designStateStore.getDesignState(userDataPath, projectId, step.designStateId) : null
    const featurePage = step.pageRef.kind === 'new' ? featurePageStore.getFeaturePage(userDataPath, projectId, step.pageRef.pageId) : null
    return {
      stepId: step.id,
      pageRefKind: step.pageRef.kind,
      pageId: step.pageRef.pageId,
      featurePage,
      designStateId: step.designStateId,
      designState,
      alternativeId: step.alternativeId,
      referenceOnly: step.referenceOnly,
      tree: resolveStepTree(userDataPath, projectId, step, designState, preview.includeCapturedStates),
      position: step.position,
    }
  })

  const bundle: SharePackageBundle = {
    sharePreviewId: preview.id,
    featureId: preview.featureId,
    name: preview.name,
    scope: preview.scope,
    viewports: preview.viewports,
    includeCurrentComparison: preview.includeCurrentComparison,
    journey: journey ? { id: journey.id, name: journey.name, description: journey.description, connections: journey.connections } : null,
    steps,
    generatedAt: new Date().toISOString(),
  }

  const dir = getSharePackageDir(userDataPath, projectId, preview.id)
  writeJsonFileAtomic(path.join(dir, 'bundle.json'), bundle)
  // A plain marker file, not a portable static site — the in-app Share
  // Preview viewer reads `bundle.json` back via IPC. Hosted/portable
  // export is documented future work, not faked here with a dead link.
  fs.writeFileSync(path.join(dir, 'README.txt'), 'FrameUI Share Preview package. Open this Feature in FrameUI and use "Open Share Preview" to view it.\n')

  return sharePreviewStore.saveSharePreview(userDataPath, projectId, { ...preview, packagePath: dir })
}

export function readSharePackage(userDataPath: string, projectId: string, sharePreviewId: string): SharePackageBundle | null {
  const preview = sharePreviewStore.getSharePreview(userDataPath, projectId, sharePreviewId)
  if (!preview?.packagePath) return null
  const bundlePath = path.join(preview.packagePath, 'bundle.json')
  if (!fs.existsSync(bundlePath)) return null
  return readJsonFile<SharePackageBundle | null>(bundlePath, null)
}
