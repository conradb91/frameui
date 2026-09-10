// Default-import + destructure, not named imports — see src/main/index.ts
// for why (Electron's ESM built-in module + cjs-module-lexer interop gap).
import electron from 'electron'
import type { FrameUiApi } from '@shared/ipc-contract'
import type { FileChangeNotice, IndexProgressUpdate } from '@shared/types/projectIndex'
import type { PreviewOutputLine, PreviewStatusUpdate, PreviewUrlDetected } from '@shared/types/preview'

const { contextBridge, ipcRenderer } = electron

// This is the ENTIRE surface exposed to the renderer. No generic
// `invoke(channel, ...)` passthrough, no direct ipcRenderer/Node access —
// every method here is one specific, named call. Add to this file (and its
// matching handler in src/main/ipc) as each phase needs a new capability.
const api: FrameUiApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
    getPathForFile: (file) => electron.webUtils.getPathForFile(file as Parameters<typeof electron.webUtils.getPathForFile>[0]),
  },
  workspace: {
    listRecentProjects: () => ipcRenderer.invoke('workspace:listRecentProjects'),
    listFlows: (projectId) => ipcRenderer.invoke('workspace:listFlows', projectId),
    createFlow: (projectId, name, description, featureId) => ipcRenderer.invoke('workspace:createFlow', { projectId, name, description, featureId }),
    getFlow: (projectId, flowId) => ipcRenderer.invoke('workspace:getFlow', { projectId, flowId }),
    saveFlow: (flow) => ipcRenderer.invoke('workspace:saveFlow', flow),
    deleteFlow: (projectId, flowId) => ipcRenderer.invoke('workspace:deleteFlow', { projectId, flowId }),
    getScreenDraft: (projectId, screenId) => ipcRenderer.invoke('workspace:getScreenDraft', { projectId, screenId }),
    saveScreenDraft: (draft) => ipcRenderer.invoke('workspace:saveScreenDraft', draft),
    listFeatures: (projectId) => ipcRenderer.invoke('workspace:listFeatures', projectId),
    getFeature: (projectId, featureId) => ipcRenderer.invoke('workspace:getFeature', { projectId, featureId }),
    createFeature: (projectId, name, description) => ipcRenderer.invoke('workspace:createFeature', { projectId, name, description }),
    saveFeature: (feature) => ipcRenderer.invoke('workspace:saveFeature', feature),
    deleteFeature: (projectId, featureId) => ipcRenderer.invoke('workspace:deleteFeature', { projectId, featureId }),
    listConceptComponents: (projectId, featureId) => ipcRenderer.invoke('workspace:listConceptComponents', { projectId, featureId }),
    saveConceptComponent: (projectId, component) => ipcRenderer.invoke('workspace:saveConceptComponent', { projectId, component }),
    deleteConceptComponent: (projectId, componentId) => ipcRenderer.invoke('workspace:deleteConceptComponent', { projectId, componentId }),

    listFeaturePages: (projectId, featureId) => ipcRenderer.invoke('workspace:listFeaturePages', { projectId, featureId }),
    getFeaturePage: (projectId, pageId) => ipcRenderer.invoke('workspace:getFeaturePage', { projectId, pageId }),
    createFeaturePage: (projectId, input) => ipcRenderer.invoke('workspace:createFeaturePage', { projectId, ...input }),
    saveFeaturePage: (projectId, page) => ipcRenderer.invoke('workspace:saveFeaturePage', { projectId, page }),
    deleteFeaturePage: (projectId, pageId) => ipcRenderer.invoke('workspace:deleteFeaturePage', { projectId, pageId }),

    listDesignStatesForPage: (projectId, pageRef) => ipcRenderer.invoke('workspace:listDesignStatesForPage', { projectId, pageRef }),
    getDesignState: (projectId, stateId) => ipcRenderer.invoke('workspace:getDesignState', { projectId, stateId }),
    createDesignState: (projectId, input) => ipcRenderer.invoke('workspace:createDesignState', { projectId, ...input }),
    duplicateDesignState: (projectId, sourceStateId, newName, newOrigin) =>
      ipcRenderer.invoke('workspace:duplicateDesignState', { projectId, sourceStateId, newName, newOrigin }),
    saveDesignState: (projectId, state) => ipcRenderer.invoke('workspace:saveDesignState', { projectId, state }),
    reorderDesignStates: (projectId, orderedIds) => ipcRenderer.invoke('workspace:reorderDesignStates', { projectId, orderedIds }),
    deleteDesignState: (projectId, stateId) => ipcRenderer.invoke('workspace:deleteDesignState', { projectId, stateId }),

    getDesignTree: (projectId, ownerId) => ipcRenderer.invoke('workspace:getDesignTree', { projectId, ownerId }),
    saveDesignTree: (record) => ipcRenderer.invoke('workspace:saveDesignTree', record),

    listAlternativesForState: (projectId, designStateId) => ipcRenderer.invoke('workspace:listAlternativesForState', { projectId, designStateId }),
    createAlternative: (projectId, input) => ipcRenderer.invoke('workspace:createAlternative', { projectId, ...input }),
    saveAlternative: (projectId, alternative) => ipcRenderer.invoke('workspace:saveAlternative', { projectId, alternative }),
    setAlternativePreferred: (projectId, alternativeId) => ipcRenderer.invoke('workspace:setAlternativePreferred', { projectId, alternativeId }),
    setAlternativeApproved: (projectId, alternativeId) => ipcRenderer.invoke('workspace:setAlternativeApproved', { projectId, alternativeId }),
    deleteAlternative: (projectId, alternativeId) => ipcRenderer.invoke('workspace:deleteAlternative', { projectId, alternativeId }),

    listJourneys: (projectId, featureId) => ipcRenderer.invoke('workspace:listJourneys', { projectId, featureId }),
    getJourney: (projectId, journeyId) => ipcRenderer.invoke('workspace:getJourney', { projectId, journeyId }),
    createJourney: (projectId, featureId, name, description) => ipcRenderer.invoke('workspace:createJourney', { projectId, featureId, name, description }),
    saveJourney: (projectId, journey) => ipcRenderer.invoke('workspace:saveJourney', { projectId, journey }),
    deleteJourney: (projectId, journeyId) => ipcRenderer.invoke('workspace:deleteJourney', { projectId, journeyId }),

    listSharePreviews: (projectId, featureId) => ipcRenderer.invoke('workspace:listSharePreviews', { projectId, featureId }),
    getSharePreview: (projectId, sharePreviewId) => ipcRenderer.invoke('workspace:getSharePreview', { projectId, sharePreviewId }),
    createSharePreview: (projectId, input) => ipcRenderer.invoke('workspace:createSharePreview', { projectId, ...input }),
    saveSharePreview: (projectId, sharePreview) => ipcRenderer.invoke('workspace:saveSharePreview', { projectId, sharePreview }),
    deleteSharePreview: (projectId, sharePreviewId) => ipcRenderer.invoke('workspace:deleteSharePreview', { projectId, sharePreviewId }),
    packageSharePreview: (projectId, sharePreviewId) => ipcRenderer.invoke('workspace:packageSharePreview', { projectId, sharePreviewId }),
    readSharePackage: (projectId, sharePreviewId) => ipcRenderer.invoke('workspace:readSharePackage', { projectId, sharePreviewId }),

    getDesignOperations: (projectId, featureId, ownerId) => ipcRenderer.invoke('workspace:getDesignOperations', { projectId, featureId, ownerId }),
    getVersionDesignOperations: (projectId, featureId, versionId) => ipcRenderer.invoke('workspace:getVersionDesignOperations', { projectId, featureId, versionId }),
    saveDesignOperations: (projectId, featureId, ownerId, operations) => ipcRenderer.invoke('workspace:saveDesignOperations', { projectId, featureId, ownerId, operations }),
    listAnnotations: (projectId, featureId) => ipcRenderer.invoke('workspace:listAnnotations', { projectId, featureId }),
    saveAnnotation: (projectId, annotation) => ipcRenderer.invoke('workspace:saveAnnotation', { projectId, annotation }),
    deleteAnnotation: (projectId, featureId, annotationId) => ipcRenderer.invoke('workspace:deleteAnnotation', { projectId, featureId, annotationId }),
    listVersions: (projectId, featureId) => ipcRenderer.invoke('workspace:listVersions', { projectId, featureId }),
    createVersion: (projectId, featureId, name, createdBy) => ipcRenderer.invoke('workspace:createVersion', { projectId, featureId, name, createdBy }),
    renameVersion: (projectId, featureId, versionId, name) => ipcRenderer.invoke('workspace:renameVersion', { projectId, featureId, versionId, name }),
    restoreVersion: (projectId, featureId, versionId, createdBy) => ipcRenderer.invoke('workspace:restoreVersion', { projectId, featureId, versionId, createdBy }),
    duplicateVersion: (projectId, featureId, versionId, createdBy) => ipcRenderer.invoke('workspace:duplicateVersion', { projectId, featureId, versionId, createdBy }),
    compareVersions: (projectId, featureId, leftVersionId, rightVersionId) => ipcRenderer.invoke('workspace:compareVersions', { projectId, featureId, leftVersionId, rightVersionId }),
    listSourceConflicts: (projectId, featureId) => ipcRenderer.invoke('workspace:listSourceConflicts', { projectId, featureId }),
    resolveSourceConflict: (projectId, featureId, conflictId, resolution) => ipcRenderer.invoke('workspace:resolveSourceConflict', { projectId, featureId, conflictId, resolution }),
    listExportHistory: (projectId, featureId) => ipcRenderer.invoke('workspace:listExportHistory', { projectId, featureId }),
    recordExport: (projectId, record) => ipcRenderer.invoke('workspace:recordExport', { projectId, record }),
    getDesignSystemData: (projectId) => ipcRenderer.invoke('workspace:getDesignSystemData', projectId),
    saveComponentFixture: (projectId, fixture) => ipcRenderer.invoke('workspace:saveComponentFixture', { projectId, fixture }),
    deleteComponentFixture: (projectId, fixtureId) => ipcRenderer.invoke('workspace:deleteComponentFixture', { projectId, fixtureId }),
    savePreviewCache: (projectId, entry) => ipcRenderer.invoke('workspace:savePreviewCache', { projectId, entry }),
    saveRuntimeRelationships: (projectId, componentId, relationships) => ipcRenderer.invoke('workspace:saveRuntimeRelationships', { projectId, componentId, relationships }),
    saveFindingDecision: (projectId, decision) => ipcRenderer.invoke('workspace:saveFindingDecision', { projectId, decision }),
    setObservationApproved: (projectId, observationId, approved) => ipcRenderer.invoke('workspace:setObservationApproved', { projectId, observationId, approved }),
  },
  project: {
    listLibrary: () => ipcRenderer.invoke('project:listLibrary'),
    removeFromRecent: (projectId) => ipcRenderer.invoke('project:removeFromRecent', projectId),
    clearRecent: () => ipcRenderer.invoke('project:clearRecent'),
    removeFromFrameUi: (projectId) => ipcRenderer.invoke('project:removeFromFrameUi', projectId),
    deleteFromDisk: (projectId, confirmationName) => ipcRenderer.invoke('project:deleteFromDisk', { projectId, confirmationName }),
    reveal: (projectId) => ipcRenderer.invoke('project:reveal', projectId),
    getLibraryCover: (projectId) => ipcRenderer.invoke('project:getLibraryCover', projectId),
    openDialog: (relinkId) => ipcRenderer.invoke('project:openDialog', relinkId),
    openPath: (path) => ipcRenderer.invoke('project:openPath', path),
    getIndex: () => ipcRenderer.invoke('project:getIndex'),
    reindex: () => ipcRenderer.invoke('project:reindex'),
    selectApplication: (applicationId) => ipcRenderer.invoke('project:selectApplication', applicationId),
    close: () => ipcRenderer.invoke('project:close'),
    onFileChanged: (callback) => {
      const listener = (_event: unknown, notice: FileChangeNotice) => callback(notice)
      ipcRenderer.on('project:onFileChanged', listener)
      return () => ipcRenderer.off('project:onFileChanged', listener)
    },
    getPageStructure: (relativeFilePath) => ipcRenderer.invoke('project:getPageStructure', relativeFilePath),
    onIndexProgress: (callback) => {
      const listener = (_event: unknown, update: IndexProgressUpdate) => callback(update)
      ipcRenderer.on('project:onIndexProgress', listener)
      return () => ipcRenderer.off('project:onIndexProgress', listener)
    },
  },
  preview: {
    getCommand: () => ipcRenderer.invoke('preview:getCommand'),
    setCommand: (command) => ipcRenderer.invoke('preview:setCommand', command),
    getStatus: () => ipcRenderer.invoke('preview:getStatus'),
    start: () => ipcRenderer.invoke('preview:start'),
    stop: () => ipcRenderer.invoke('preview:stop'),
    onOutput: (callback) => {
      const listener = (_event: unknown, line: PreviewOutputLine) => callback(line)
      ipcRenderer.on('preview:onOutput', listener)
      return () => ipcRenderer.off('preview:onOutput', listener)
    },
    onStatus: (callback) => {
      const listener = (_event: unknown, status: PreviewStatusUpdate) => callback(status)
      ipcRenderer.on('preview:onStatus', listener)
      return () => ipcRenderer.off('preview:onStatus', listener)
    },
    onUrlDetected: (callback) => {
      const listener = (_event: unknown, detected: PreviewUrlDetected) => callback(detected)
      ipcRenderer.on('preview:onUrlDetected', listener)
      return () => ipcRenderer.off('preview:onUrlDetected', listener)
    },
    openExternal: (url) => ipcRenderer.invoke('preview:openExternal', url),
  },
  export: {
    saveSvg: (svg, suggestedName) => ipcRenderer.invoke('export:saveSvg', { svg, suggestedName }),
    savePng: (base64, suggestedName) => ipcRenderer.invoke('export:savePng', { base64, suggestedName }),
    generateReviewPdf: (html, suggestedName) => ipcRenderer.invoke('export:generateReviewPdf', { html, suggestedName }),
    savePackage: (files, suggestedFolder) => ipcRenderer.invoke('export:savePackage', { files, suggestedFolder }),
  },
  capture: {
    save: (capture) => ipcRenderer.invoke('capture:save', capture),
    list: (projectId) => ipcRenderer.invoke('capture:list', projectId),
    saveScreenshot: (projectId, captureId, base64Png) => ipcRenderer.invoke('capture:saveScreenshot', { projectId, captureId, base64: base64Png }),
    getScreenshotDataUrl: (projectId, captureId) => ipcRenderer.invoke('capture:getScreenshotDataUrl', { projectId, captureId }),
  },
}

contextBridge.exposeInMainWorld('frameui', api)
