import type { RecentProject, OpenProjectResult, OpenRecentResult } from './types/project'
import type { ProjectIndex, FileChangeNotice, DevCommand } from './types/projectIndex'
import type { PreviewOutputLine, PreviewStatusUpdate, PreviewUrlDetected } from './types/preview'
import type { Flow, FlowSummary } from './types/flow'
import type { ScreenDraft } from './types/screenDraft'
import type { PageStructureItem } from './types/pageStructure'

/**
 * The complete shape of the narrow, typed bridge the preload script exposes
 * as `window.frameui`. Nothing beyond what's declared here is ever exposed to
 * the renderer — no generic `invoke(channel, ...)` passthrough. Every method
 * added here must have a corresponding main-process handler that validates
 * its own input (see src/main/ipc/schemas) rather than trusting the renderer.
 */
export interface FrameUiApi {
  app: {
    getVersion(): Promise<string>
    getPlatform(): Promise<FrameUiPlatform>
  }
  workspace: {
    listRecentProjects(): Promise<RecentProject[]>
    listFlows(projectId: string): Promise<FlowSummary[]>
    createFlow(projectId: string, name: string, description?: string): Promise<Flow>
    getFlow(projectId: string, flowId: string): Promise<Flow | null>
    saveFlow(flow: Flow): Promise<Flow>
    deleteFlow(projectId: string, flowId: string): Promise<{ ok: true }>
    getScreenDraft(projectId: string, screenId: string): Promise<ScreenDraft | null>
    saveScreenDraft(draft: ScreenDraft): Promise<ScreenDraft>
  }
  project: {
    /** Shows the native folder picker. `relinkId` re-points an existing
     * (e.g. missing) recent-project entry at the newly chosen folder
     * instead of adding a new one. */
    openDialog(relinkId?: string): Promise<OpenProjectResult>
    /** Re-opens a folder already in Recent Projects without a picker. */
    openPath(path: string): Promise<OpenRecentResult>
    /** Returns the cached index for the currently active project, computing
     * it on first call. Null if no project is active. */
    getIndex(): Promise<ProjectIndex | null>
    /** Forces a fresh scan of the currently active project. */
    reindex(): Promise<ProjectIndex | null>
    /** Stops watching / clears the currently active project. */
    close(): Promise<{ ok: true }>
    /** Fires when files change on disk inside the active project (after the
     * ~400ms debounce). Returns an unsubscribe function. */
    onFileChanged(callback: (notice: FileChangeNotice) => void): () => void
    /** Shallow, static read of a real page's top-level JSX structure —
     * path-scoped to the active project root in main. Used to seed an
     * Existing Page draft; never executes the file. */
    getPageStructure(relativeFilePath: string): Promise<PageStructureItem[]>
  }
  preview: {
    getCommand(): Promise<DevCommand | null>
    start(): Promise<{ ok: boolean; message?: string }>
    stop(): Promise<{ ok: true }>
    onOutput(callback: (line: PreviewOutputLine) => void): () => void
    onStatus(callback: (status: PreviewStatusUpdate) => void): () => void
    onUrlDetected(callback: (detected: PreviewUrlDetected) => void): () => void
    /** The only way anything in this app opens a real browser — main
     * validates the URL is http(s) before acting on it. */
    openExternal(url: string): Promise<{ ok: boolean }>
  }
  export: {
    saveSvg(svg: string, suggestedName: string): Promise<{ ok: boolean; filePath?: string }>
    savePng(base64: string, suggestedName: string): Promise<{ ok: boolean; filePath?: string }>
    generateReviewPdf(html: string, suggestedName: string): Promise<{ ok: boolean; filePath?: string; error?: string }>
  }
}

export type FrameUiPlatform = 'darwin' | 'win32' | 'linux' | (string & {})
