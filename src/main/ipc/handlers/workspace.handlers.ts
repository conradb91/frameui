import electron from 'electron'
import type { RecentProject } from '@shared/types/project'
import type { Flow, FlowSummary } from '@shared/types/flow'
import type { ScreenDraft } from '@shared/types/screenDraft'
import type { DesignNode } from '@shared/types/designNode'
import type { ConceptComponent, Feature, FeaturePage, DesignState, Alternative, Journey, SharePreview, Annotation, DesignOperation, SourceConflict, Version, VersionDifference } from '@shared/types/model/featureModel'
import { listRecentProjects } from '@core/workspace/models/recentProjectsStore'
import * as flowStore from '@core/workspace/models/flowStore'
import * as screenDraftStore from '@core/workspace/models/screenDraftStore'
import * as featureStore from '@core/workspace/models/featureStore'
import * as conceptComponentStore from '@core/workspace/models/conceptComponentStore'
import * as featurePageStore from '@core/workspace/models/featurePageStore'
import * as designStateStore from '@core/workspace/models/designStateStore'
import * as designTreeStore from '@core/workspace/models/designTreeStore'
import type { DesignTreeRecord } from '@core/workspace/models/designTreeStore'
import * as alternativeStore from '@core/workspace/models/alternativeStore'
import * as journeyStore from '@core/workspace/models/journeyStore'
import * as sharePreviewStore from '@core/workspace/models/sharePreviewStore'
import * as featureWorkPackageStore from '@core/workspace/models/featureWorkPackageStore'
import { buildSharePackage, readSharePackage, type SharePackageBundle } from '@core/design-model/sharePackage'
import { applyDesignOperations } from '@core/design-model/operations'
import * as designSystemStore from '@core/workspace/models/designSystemStore'
import type { FindingDecision, PreviewCacheEntry, RuntimeComponentRelationship, UserComponentFixture } from '@shared/types/designSystem'
import type { ExportRecord } from '@shared/types/handoff'
import {
  projectIdSchema,
  createFlowInputSchema,
  getFlowInputSchema,
  saveFlowInputSchema,
  deleteFlowInputSchema,
  getScreenDraftInputSchema,
  saveScreenDraftInputSchema,
  createFeatureInputSchema,
  getFeatureInputSchema,
  saveFeatureInputSchema,
  deleteFeatureInputSchema,
  listConceptComponentsInputSchema,
  saveConceptComponentInputSchema,
  deleteConceptComponentInputSchema,
  listFeaturePagesInputSchema,
  getFeaturePageInputSchema,
  createFeaturePageInputSchema,
  saveFeaturePageInputSchema,
  deleteFeaturePageInputSchema,
  listDesignStatesForPageInputSchema,
  getDesignStateInputSchema,
  createDesignStateInputSchema,
  duplicateDesignStateInputSchema,
  saveDesignStateInputSchema,
  reorderDesignStatesInputSchema,
  deleteDesignStateInputSchema,
  getDesignTreeInputSchema,
  saveDesignTreeInputSchema,
  listAlternativesForStateInputSchema,
  createAlternativeInputSchema,
  saveAlternativeInputSchema,
  setAlternativeFlagInputSchema,
  deleteAlternativeInputSchema,
  listJourneysInputSchema,
  getJourneyInputSchema,
  createJourneyInputSchema,
  saveJourneyInputSchema,
  deleteJourneyInputSchema,
  listSharePreviewsInputSchema,
  getSharePreviewInputSchema,
  createSharePreviewInputSchema,
  saveSharePreviewInputSchema,
  deleteSharePreviewInputSchema,
  packageSharePreviewInputSchema,
  readSharePackageInputSchema,
  getDesignOperationsInputSchema,
  getVersionDesignOperationsInputSchema,
  saveDesignOperationsInputSchema,
  listAnnotationsInputSchema,
  saveAnnotationInputSchema,
  deleteAnnotationInputSchema,
  listVersionsInputSchema,
  createVersionInputSchema,
  renameVersionInputSchema,
  restoreVersionInputSchema,
  compareVersionsInputSchema,
  listSourceConflictsInputSchema,
  resolveSourceConflictInputSchema,
  listExportHistoryInputSchema,
  recordExportInputSchema,
  saveComponentFixtureInputSchema,
  deleteComponentFixtureInputSchema,
  savePreviewCacheInputSchema,
  saveRuntimeRelationshipsInputSchema,
  saveFindingDecisionInputSchema,
  setObservationApprovedInputSchema,
} from '../schemas/workspace.schema'

const { app, ipcMain } = electron

export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspace:listRecentProjects', (): RecentProject[] => {
    return listRecentProjects(app.getPath('userData'))
  })

  ipcMain.handle('workspace:listFlows', (_event, rawProjectId): FlowSummary[] => {
    const projectId = projectIdSchema.parse(rawProjectId)
    return flowStore.listFlows(app.getPath('userData'), projectId)
  })

  ipcMain.handle('workspace:createFlow', (_event, raw): Flow => {
    const { projectId, name, description, featureId } = createFlowInputSchema.parse(raw)
    return flowStore.createFlow(app.getPath('userData'), projectId, name, description, featureId)
  })

  ipcMain.handle('workspace:getFlow', (_event, raw): Flow | null => {
    const { projectId, flowId } = getFlowInputSchema.parse(raw)
    return flowStore.getFlow(app.getPath('userData'), projectId, flowId)
  })

  ipcMain.handle('workspace:saveFlow', (_event, raw): Flow => {
    const flow = saveFlowInputSchema.parse(raw)
    return flowStore.saveFlow(app.getPath('userData'), flow)
  })

  ipcMain.handle('workspace:deleteFlow', (_event, raw): { ok: true } => {
    const { projectId, flowId } = deleteFlowInputSchema.parse(raw)
    flowStore.deleteFlow(app.getPath('userData'), projectId, flowId)
    return { ok: true }
  })

  ipcMain.handle('workspace:getScreenDraft', (_event, raw): ScreenDraft | null => {
    const { projectId, screenId } = getScreenDraftInputSchema.parse(raw)
    return screenDraftStore.getScreenDraft(app.getPath('userData'), projectId, screenId)
  })

  ipcMain.handle('workspace:saveScreenDraft', (_event, raw): ScreenDraft => {
    const draft = saveScreenDraftInputSchema.parse(raw) as { id: string; projectId: string; flowId: string; tree: DesignNode; updatedAt: string }
    return screenDraftStore.saveScreenDraft(app.getPath('userData'), draft)
  })

  ipcMain.handle('workspace:listFeatures', (_event, rawProjectId): Feature[] => {
    const projectId = projectIdSchema.parse(rawProjectId)
    return featureStore.listFeatures(app.getPath('userData'), projectId)
  })

  ipcMain.handle('workspace:getFeature', (_event, raw): Feature | null => {
    const { projectId, featureId } = getFeatureInputSchema.parse(raw)
    return featureStore.getFeature(app.getPath('userData'), projectId, featureId)
  })

  ipcMain.handle('workspace:createFeature', (_event, raw): Feature => {
    const { projectId, name, description } = createFeatureInputSchema.parse(raw)
    return featureStore.createFeature(app.getPath('userData'), projectId, name, description)
  })

  ipcMain.handle('workspace:saveFeature', (_event, raw): Feature => {
    const feature = saveFeatureInputSchema.parse(raw)
    return featureStore.saveFeature(app.getPath('userData'), feature)
  })

  ipcMain.handle('workspace:deleteFeature', (_event, raw): { ok: true } => {
    const { projectId, featureId } = deleteFeatureInputSchema.parse(raw)
    featureStore.deleteFeature(app.getPath('userData'), projectId, featureId)
    return { ok: true }
  })

  ipcMain.handle('workspace:listConceptComponents', (_event, raw): ConceptComponent[] => {
    const { projectId, featureId } = listConceptComponentsInputSchema.parse(raw)
    return conceptComponentStore.listConceptComponents(app.getPath('userData'), projectId, featureId)
  })

  ipcMain.handle('workspace:saveConceptComponent', (_event, raw): ConceptComponent => {
    const { projectId, component } = saveConceptComponentInputSchema.parse(raw)
    return conceptComponentStore.saveConceptComponent(app.getPath('userData'), projectId, component)
  })

  ipcMain.handle('workspace:deleteConceptComponent', (_event, raw): { ok: true } => {
    const { projectId, componentId } = deleteConceptComponentInputSchema.parse(raw)
    conceptComponentStore.deleteConceptComponent(app.getPath('userData'), projectId, componentId)
    return { ok: true }
  })

  // -------------------------------------------------------------------
  // Phase 16 — Feature Pages
  // -------------------------------------------------------------------

  ipcMain.handle('workspace:listFeaturePages', (_event, raw): FeaturePage[] => {
    const { projectId, featureId } = listFeaturePagesInputSchema.parse(raw)
    return featurePageStore.listFeaturePages(app.getPath('userData'), projectId, featureId)
  })

  ipcMain.handle('workspace:getFeaturePage', (_event, raw): FeaturePage | null => {
    const { projectId, pageId } = getFeaturePageInputSchema.parse(raw)
    return featurePageStore.getFeaturePage(app.getPath('userData'), projectId, pageId)
  })

  ipcMain.handle('workspace:createFeaturePage', (_event, raw): FeaturePage => {
    const { projectId, ...input } = createFeaturePageInputSchema.parse(raw)
    return featurePageStore.createFeaturePage(app.getPath('userData'), projectId, input)
  })

  ipcMain.handle('workspace:saveFeaturePage', (_event, raw): FeaturePage => {
    const { projectId, page } = saveFeaturePageInputSchema.parse(raw)
    return featurePageStore.saveFeaturePage(app.getPath('userData'), projectId, page)
  })

  ipcMain.handle('workspace:deleteFeaturePage', (_event, raw): { ok: true } => {
    const { projectId, pageId } = deleteFeaturePageInputSchema.parse(raw)
    featurePageStore.deleteFeaturePage(app.getPath('userData'), projectId, pageId)
    return { ok: true }
  })

  // -------------------------------------------------------------------
  // Phase 17 — Design States (+ generic design tree store)
  // -------------------------------------------------------------------

  ipcMain.handle('workspace:listDesignStatesForPage', (_event, raw): DesignState[] => {
    const { projectId, pageRef } = listDesignStatesForPageInputSchema.parse(raw)
    return designStateStore.listDesignStatesForPage(app.getPath('userData'), projectId, pageRef)
  })

  ipcMain.handle('workspace:getDesignState', (_event, raw): DesignState | null => {
    const { projectId, stateId } = getDesignStateInputSchema.parse(raw)
    return designStateStore.getDesignState(app.getPath('userData'), projectId, stateId)
  })

  ipcMain.handle('workspace:createDesignState', (_event, raw): DesignState => {
    const { projectId, ...input } = createDesignStateInputSchema.parse(raw)
    return designStateStore.createDesignState(app.getPath('userData'), projectId, input)
  })

  ipcMain.handle('workspace:duplicateDesignState', (_event, raw): DesignState => {
    const { projectId, sourceStateId, newName, newOrigin } = duplicateDesignStateInputSchema.parse(raw)
    const userDataPath = app.getPath('userData')
    const source = designStateStore.getDesignState(userDataPath, projectId, sourceStateId)
    const duplicate = designStateStore.duplicateDesignState(userDataPath, projectId, sourceStateId, newName, newOrigin)
    const baseline = designTreeStore.getDesignTree(userDataPath, projectId, sourceStateId)
    if (source && baseline) {
      const operations = featureWorkPackageStore.getOperations(userDataPath, projectId, source.featureId, sourceStateId)
      designTreeStore.saveDesignTree(userDataPath, { ownerId: duplicate.id, projectId, tree: applyDesignOperations(baseline.tree, operations), updatedAt: new Date().toISOString() })
    }
    return duplicate
  })

  ipcMain.handle('workspace:saveDesignState', (_event, raw): DesignState => {
    const { projectId, state } = saveDesignStateInputSchema.parse(raw)
    return designStateStore.saveDesignState(app.getPath('userData'), projectId, state)
  })

  ipcMain.handle('workspace:reorderDesignStates', (_event, raw): { ok: true } => {
    const { projectId, orderedIds } = reorderDesignStatesInputSchema.parse(raw)
    designStateStore.reorderDesignStates(app.getPath('userData'), projectId, orderedIds)
    return { ok: true }
  })

  ipcMain.handle('workspace:deleteDesignState', (_event, raw): { ok: true } => {
    const { projectId, stateId } = deleteDesignStateInputSchema.parse(raw)
    const userDataPath = app.getPath('userData')
    const state = designStateStore.getDesignState(userDataPath, projectId, stateId)
    designStateStore.deleteDesignState(userDataPath, projectId, stateId)
    if (state) featureWorkPackageStore.deleteOwner(userDataPath, projectId, state.featureId, stateId)
    return { ok: true }
  })

  ipcMain.handle('workspace:getDesignTree', (_event, raw): DesignTreeRecord | null => {
    const { projectId, ownerId } = getDesignTreeInputSchema.parse(raw)
    return designTreeStore.getDesignTree(app.getPath('userData'), projectId, ownerId)
  })

  ipcMain.handle('workspace:saveDesignTree', (_event, raw): DesignTreeRecord => {
    const record = saveDesignTreeInputSchema.parse(raw) as DesignTreeRecord
    return designTreeStore.saveDesignTree(app.getPath('userData'), record)
  })

  // -------------------------------------------------------------------
  // Phase 19 — Alternatives
  // -------------------------------------------------------------------

  ipcMain.handle('workspace:listAlternativesForState', (_event, raw): Alternative[] => {
    const { projectId, designStateId } = listAlternativesForStateInputSchema.parse(raw)
    return alternativeStore.listAlternativesForState(app.getPath('userData'), projectId, designStateId)
  })

  ipcMain.handle('workspace:createAlternative', (_event, raw): Alternative => {
    const { projectId, ...input } = createAlternativeInputSchema.parse(raw)
    const userDataPath = app.getPath('userData')
    const alternative = alternativeStore.createAlternative(userDataPath, projectId, input)
    const baseline = designTreeStore.getDesignTree(userDataPath, projectId, input.sourceOwnerId)
    if (baseline) {
      const operations = featureWorkPackageStore.getOperations(userDataPath, projectId, input.featureId, input.sourceOwnerId)
      designTreeStore.saveDesignTree(userDataPath, { ownerId: alternative.id, projectId, tree: applyDesignOperations(baseline.tree, operations), updatedAt: new Date().toISOString() })
    }
    return alternative
  })

  ipcMain.handle('workspace:saveAlternative', (_event, raw): Alternative => {
    const { projectId, alternative } = saveAlternativeInputSchema.parse(raw)
    return alternativeStore.saveAlternative(app.getPath('userData'), projectId, alternative)
  })

  ipcMain.handle('workspace:setAlternativePreferred', (_event, raw): Alternative => {
    const { projectId, alternativeId } = setAlternativeFlagInputSchema.parse(raw)
    return alternativeStore.setPreferred(app.getPath('userData'), projectId, alternativeId)
  })

  ipcMain.handle('workspace:setAlternativeApproved', (_event, raw): Alternative => {
    const { projectId, alternativeId } = setAlternativeFlagInputSchema.parse(raw)
    return alternativeStore.setApproved(app.getPath('userData'), projectId, alternativeId)
  })

  ipcMain.handle('workspace:deleteAlternative', (_event, raw): { ok: true } => {
    const { projectId, alternativeId } = deleteAlternativeInputSchema.parse(raw)
    const userDataPath = app.getPath('userData')
    const alternative = alternativeStore.getAlternative(userDataPath, projectId, alternativeId)
    alternativeStore.deleteAlternative(userDataPath, projectId, alternativeId)
    if (alternative) featureWorkPackageStore.deleteOwner(userDataPath, projectId, alternative.featureId, alternativeId)
    return { ok: true }
  })

  // -------------------------------------------------------------------
  // Phase 21-23 — Journeys
  // -------------------------------------------------------------------

  ipcMain.handle('workspace:listJourneys', (_event, raw): Journey[] => {
    const { projectId, featureId } = listJourneysInputSchema.parse(raw)
    return journeyStore.listJourneys(app.getPath('userData'), projectId, featureId)
  })

  ipcMain.handle('workspace:getJourney', (_event, raw): Journey | null => {
    const { projectId, journeyId } = getJourneyInputSchema.parse(raw)
    return journeyStore.getJourney(app.getPath('userData'), projectId, journeyId)
  })

  ipcMain.handle('workspace:createJourney', (_event, raw): Journey => {
    const { projectId, featureId, name, description } = createJourneyInputSchema.parse(raw)
    return journeyStore.createJourney(app.getPath('userData'), projectId, featureId, name, description)
  })

  ipcMain.handle('workspace:saveJourney', (_event, raw): Journey => {
    const { projectId, journey } = saveJourneyInputSchema.parse(raw)
    return journeyStore.saveJourney(app.getPath('userData'), projectId, journey)
  })

  ipcMain.handle('workspace:deleteJourney', (_event, raw): { ok: true } => {
    const { projectId, journeyId } = deleteJourneyInputSchema.parse(raw)
    journeyStore.deleteJourney(app.getPath('userData'), projectId, journeyId)
    return { ok: true }
  })

  // -------------------------------------------------------------------
  // Phase 25 — Share Previews
  // -------------------------------------------------------------------

  ipcMain.handle('workspace:listSharePreviews', (_event, raw): SharePreview[] => {
    const { projectId, featureId } = listSharePreviewsInputSchema.parse(raw)
    return sharePreviewStore.listSharePreviews(app.getPath('userData'), projectId, featureId)
  })

  ipcMain.handle('workspace:getSharePreview', (_event, raw): SharePreview | null => {
    const { projectId, sharePreviewId } = getSharePreviewInputSchema.parse(raw)
    return sharePreviewStore.getSharePreview(app.getPath('userData'), projectId, sharePreviewId)
  })

  ipcMain.handle('workspace:createSharePreview', (_event, raw): SharePreview => {
    const { projectId, ...input } = createSharePreviewInputSchema.parse(raw)
    return sharePreviewStore.createSharePreview(app.getPath('userData'), projectId, input)
  })

  ipcMain.handle('workspace:saveSharePreview', (_event, raw): SharePreview => {
    const { projectId, sharePreview } = saveSharePreviewInputSchema.parse(raw)
    return sharePreviewStore.saveSharePreview(app.getPath('userData'), projectId, sharePreview)
  })

  ipcMain.handle('workspace:deleteSharePreview', (_event, raw): { ok: true } => {
    const { projectId, sharePreviewId } = deleteSharePreviewInputSchema.parse(raw)
    sharePreviewStore.deleteSharePreview(app.getPath('userData'), projectId, sharePreviewId)
    return { ok: true }
  })

  ipcMain.handle('workspace:packageSharePreview', async (_event, raw): Promise<SharePreview> => {
    const { projectId, sharePreviewId } = packageSharePreviewInputSchema.parse(raw)
    return buildSharePackage(app.getPath('userData'), projectId, sharePreviewId)
  })

  ipcMain.handle('workspace:readSharePackage', (_event, raw): SharePackageBundle | null => {
    const { projectId, sharePreviewId } = readSharePackageInputSchema.parse(raw)
    return readSharePackage(app.getPath('userData'), projectId, sharePreviewId)
  })

  ipcMain.handle('workspace:getDesignOperations', (_event, raw): DesignOperation[] => {
    const { projectId, featureId, ownerId } = getDesignOperationsInputSchema.parse(raw)
    return featureWorkPackageStore.getOperations(app.getPath('userData'), projectId, featureId, ownerId)
  })
  ipcMain.handle('workspace:getVersionDesignOperations', (_event, raw): DesignOperation[] => {
    const { projectId, featureId, versionId } = getVersionDesignOperationsInputSchema.parse(raw)
    return featureWorkPackageStore.getVersionOperations(app.getPath('userData'), projectId, featureId, versionId)
  })
  ipcMain.handle('workspace:saveDesignOperations', (_event, raw): DesignOperation[] => {
    const { projectId, featureId, ownerId, operations } = saveDesignOperationsInputSchema.parse(raw)
    return featureWorkPackageStore.saveOperations(app.getPath('userData'), projectId, featureId, ownerId, operations as DesignOperation[])
  })
  ipcMain.handle('workspace:listAnnotations', (_event, raw): Annotation[] => {
    const { projectId, featureId } = listAnnotationsInputSchema.parse(raw)
    return featureWorkPackageStore.listAnnotations(app.getPath('userData'), projectId, featureId)
  })
  ipcMain.handle('workspace:saveAnnotation', (_event, raw): Annotation => {
    const { projectId, annotation } = saveAnnotationInputSchema.parse(raw)
    return featureWorkPackageStore.saveAnnotation(app.getPath('userData'), projectId, annotation as Annotation)
  })
  ipcMain.handle('workspace:deleteAnnotation', (_event, raw): { ok: true } => {
    const { projectId, featureId, annotationId } = deleteAnnotationInputSchema.parse(raw)
    featureWorkPackageStore.deleteAnnotation(app.getPath('userData'), projectId, featureId, annotationId)
    return { ok: true }
  })
  ipcMain.handle('workspace:listVersions', (_event, raw): Version[] => {
    const { projectId, featureId } = listVersionsInputSchema.parse(raw)
    return featureWorkPackageStore.listVersions(app.getPath('userData'), projectId, featureId)
  })
  ipcMain.handle('workspace:createVersion', (_event, raw): Version => {
    const { projectId, featureId, name, createdBy } = createVersionInputSchema.parse(raw)
    return featureWorkPackageStore.createVersion(app.getPath('userData'), projectId, featureId, name, createdBy)
  })
  ipcMain.handle('workspace:renameVersion', (_event, raw): Version => {
    const { projectId, featureId, versionId, name } = renameVersionInputSchema.parse(raw)
    return featureWorkPackageStore.renameVersion(app.getPath('userData'), projectId, featureId, versionId, name)
  })
  ipcMain.handle('workspace:restoreVersion', (_event, raw): Version => {
    const { projectId, featureId, versionId, createdBy } = restoreVersionInputSchema.parse(raw)
    return featureWorkPackageStore.restoreVersion(app.getPath('userData'), projectId, featureId, versionId, createdBy)
  })
  ipcMain.handle('workspace:duplicateVersion', (_event, raw): Version => {
    const { projectId, featureId, versionId, createdBy } = restoreVersionInputSchema.parse(raw)
    return featureWorkPackageStore.duplicateVersion(app.getPath('userData'), projectId, featureId, versionId, createdBy)
  })
  ipcMain.handle('workspace:compareVersions', (_event, raw): VersionDifference[] => {
    const { projectId, featureId, leftVersionId, rightVersionId } = compareVersionsInputSchema.parse(raw)
    return featureWorkPackageStore.compareVersions(app.getPath('userData'), projectId, featureId, leftVersionId, rightVersionId)
  })
  ipcMain.handle('workspace:listSourceConflicts', (_event, raw): SourceConflict[] => {
    const { projectId, featureId } = listSourceConflictsInputSchema.parse(raw)
    return featureWorkPackageStore.listSourceConflicts(app.getPath('userData'), projectId, featureId)
  })
  ipcMain.handle('workspace:resolveSourceConflict', (_event, raw): SourceConflict => {
    const { projectId, featureId, conflictId, resolution } = resolveSourceConflictInputSchema.parse(raw)
    return featureWorkPackageStore.resolveConflict(app.getPath('userData'), projectId, featureId, conflictId, resolution)
  })
  ipcMain.handle('workspace:listExportHistory', (_event, raw): ExportRecord[] => {
    const { projectId, featureId } = listExportHistoryInputSchema.parse(raw)
    return featureWorkPackageStore.listExportHistory(app.getPath('userData'), projectId, featureId)
  })
  ipcMain.handle('workspace:recordExport', (_event, raw): ExportRecord => {
    const { projectId, record } = recordExportInputSchema.parse(raw)
    return featureWorkPackageStore.recordExport(app.getPath('userData'), projectId, record as ExportRecord)
  })
  ipcMain.handle('workspace:getDesignSystemData', (_event, rawProjectId) => designSystemStore.getData(app.getPath('userData'), projectIdSchema.parse(rawProjectId)))
  ipcMain.handle('workspace:saveComponentFixture', (_event, raw): UserComponentFixture => { const { projectId, fixture } = saveComponentFixtureInputSchema.parse(raw); return designSystemStore.saveFixture(app.getPath('userData'), projectId, fixture as UserComponentFixture) })
  ipcMain.handle('workspace:deleteComponentFixture', (_event, raw): { ok: true } => { const { projectId, fixtureId } = deleteComponentFixtureInputSchema.parse(raw); designSystemStore.deleteFixture(app.getPath('userData'), projectId, fixtureId); return { ok: true } })
  ipcMain.handle('workspace:savePreviewCache', (_event, raw): PreviewCacheEntry => { const { projectId, entry } = savePreviewCacheInputSchema.parse(raw); return designSystemStore.savePreviewCache(app.getPath('userData'), projectId, entry as PreviewCacheEntry) })
  ipcMain.handle('workspace:saveRuntimeRelationships', (_event, raw): RuntimeComponentRelationship[] => { const { projectId, componentId, relationships } = saveRuntimeRelationshipsInputSchema.parse(raw); return designSystemStore.saveRuntimeRelationships(app.getPath('userData'), projectId, componentId, relationships as RuntimeComponentRelationship[]) })
  ipcMain.handle('workspace:saveFindingDecision', (_event, raw): FindingDecision => { const { projectId, decision } = saveFindingDecisionInputSchema.parse(raw); return designSystemStore.saveFindingDecision(app.getPath('userData'), projectId, decision as FindingDecision) })
  ipcMain.handle('workspace:setObservationApproved', (_event, raw) => { const { projectId, observationId, approved } = setObservationApprovedInputSchema.parse(raw); return designSystemStore.setObservationApproved(app.getPath('userData'), projectId, observationId, approved) })
}
