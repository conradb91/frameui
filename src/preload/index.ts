// Default-import + destructure, not named imports — see src/main/index.ts
// for why (Electron's ESM built-in module + cjs-module-lexer interop gap).
import electron from 'electron'
import type { FrameUiApi } from '@shared/ipc-contract'
import type { FileChangeNotice } from '@shared/types/projectIndex'
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
  },
  workspace: {
    listRecentProjects: () => ipcRenderer.invoke('workspace:listRecentProjects'),
    listFlows: (projectId) => ipcRenderer.invoke('workspace:listFlows', projectId),
    createFlow: (projectId, name, description) => ipcRenderer.invoke('workspace:createFlow', { projectId, name, description }),
    getFlow: (projectId, flowId) => ipcRenderer.invoke('workspace:getFlow', { projectId, flowId }),
    saveFlow: (flow) => ipcRenderer.invoke('workspace:saveFlow', flow),
    deleteFlow: (projectId, flowId) => ipcRenderer.invoke('workspace:deleteFlow', { projectId, flowId }),
    getScreenDraft: (projectId, screenId) => ipcRenderer.invoke('workspace:getScreenDraft', { projectId, screenId }),
    saveScreenDraft: (draft) => ipcRenderer.invoke('workspace:saveScreenDraft', draft),
  },
  project: {
    openDialog: (relinkId) => ipcRenderer.invoke('project:openDialog', relinkId),
    openPath: (path) => ipcRenderer.invoke('project:openPath', path),
    getIndex: () => ipcRenderer.invoke('project:getIndex'),
    reindex: () => ipcRenderer.invoke('project:reindex'),
    close: () => ipcRenderer.invoke('project:close'),
    onFileChanged: (callback) => {
      const listener = (_event: unknown, notice: FileChangeNotice) => callback(notice)
      ipcRenderer.on('project:onFileChanged', listener)
      return () => ipcRenderer.off('project:onFileChanged', listener)
    },
    getPageStructure: (relativeFilePath) => ipcRenderer.invoke('project:getPageStructure', relativeFilePath),
  },
  preview: {
    getCommand: () => ipcRenderer.invoke('preview:getCommand'),
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
  },
}

contextBridge.exposeInMainWorld('frameui', api)
