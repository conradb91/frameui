import type { RecentProject, OpenProjectResult, OpenRecentResult } from './types/project'
import type { ProjectIndex, FileChangeNotice, DevCommand, IndexProgressUpdate } from './types/projectIndex'
import type { PreviewOutputLine, PreviewStatusUpdate, PreviewUrlDetected, PreviewStatusSnapshot } from './types/preview'
import type { Flow, FlowSummary } from './types/flow'
import type { ScreenDraft } from './types/screenDraft'
import type { PageStructureItem } from './types/pageStructure'
import type { CapturedPage } from './types/runtimeCapture'
import type {
  ConceptComponent,
  Feature,
  FeaturePage,
  NewPageLayoutSource,
  PageRef,
  DesignState,
  DesignStateOrigin,
  Provenance,
  Alternative,
  Journey,
  SharePreview,
  Annotation,
  DesignOperation,
  Version,
  VersionDifference,
} from './types/model/featureModel'
import type { Viewport } from './types/model/projectModel'
import type { DesignTreeRecord } from './types/designTreeRecord'
import type { SharePackageBundle } from './types/sharePackage'

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
    /** `featureId` scopes a new Journey to a Feature (spec Phase 6/7);
     * omitted/null keeps the legacy project-level flow behavior. */
    createFlow(projectId: string, name: string, description?: string, featureId?: string | null): Promise<Flow>
    getFlow(projectId: string, flowId: string): Promise<Flow | null>
    saveFlow(flow: Flow): Promise<Flow>
    deleteFlow(projectId: string, flowId: string): Promise<{ ok: true }>
    getScreenDraft(projectId: string, screenId: string): Promise<ScreenDraft | null>
    saveScreenDraft(draft: ScreenDraft): Promise<ScreenDraft>
    /** Features (spec Phase 6) — the primary unit of user-authored design
     * work. Full objects, not summaries: a Feature carries no heavy nested
     * arrays, unlike Flow. */
    listFeatures(projectId: string): Promise<Feature[]>
    getFeature(projectId: string, featureId: string): Promise<Feature | null>
    createFeature(projectId: string, name: string, description?: string): Promise<Feature>
    /** Full replace, same convention as saveFlow — always save a Feature
     * you first loaded via getFeature/createFeature/listFeatures. */
    saveFeature(feature: Feature): Promise<Feature>
    /** Cascades: deletes the Feature's own Flows/Journeys, their Screen
     * Drafts, and its Concept Components too — never leaves orphans. */
    deleteFeature(projectId: string, featureId: string): Promise<{ ok: true }>
    /** Concept Components (spec Phase 14) — designer-invented components
     * scoped to one Feature. */
    listConceptComponents(projectId: string, featureId: string): Promise<ConceptComponent[]>
    /** Create-or-update by id — callers assign a fresh crypto.randomUUID()
     * id for a brand-new concept component before the first save. */
    saveConceptComponent(projectId: string, component: ConceptComponent): Promise<ConceptComponent>
    deleteConceptComponent(projectId: string, componentId: string): Promise<{ ok: true }>

    // ---- Phase 16 — Feature Pages ----
    listFeaturePages(projectId: string, featureId: string): Promise<FeaturePage[]>
    getFeaturePage(projectId: string, pageId: string): Promise<FeaturePage | null>
    createFeaturePage(
      projectId: string,
      input: {
        featureId: string
        name: string
        description?: string
        suggestedRoute?: string | null
        initialViewport?: Viewport
        layoutSource: NewPageLayoutSource
        basedOnPageId?: string | null
        basedOnPatternName?: string | null
      },
    ): Promise<FeaturePage>
    saveFeaturePage(projectId: string, page: FeaturePage): Promise<FeaturePage>
    deleteFeaturePage(projectId: string, pageId: string): Promise<{ ok: true }>

    // ---- Phase 17 — Design States ----
    listDesignStatesForPage(projectId: string, pageRef: PageRef): Promise<DesignState[]>
    getDesignState(projectId: string, stateId: string): Promise<DesignState | null>
    createDesignState(
      projectId: string,
      input: {
        featureId: string
        pageRef: PageRef
        pageSlugHint: string
        name: string
        origin: DesignStateOrigin
        capturedPageId?: string | null
        provenance: Provenance
      },
    ): Promise<DesignState>
    /** `newOrigin` lets a captured state be duplicated as an editable
     * design state (spec Phase 17's "Default (Captured) -> duplicate as ->
     * New Validation Concept (Design)" example) or duplicated as-is. */
    duplicateDesignState(projectId: string, sourceStateId: string, newName: string, newOrigin: DesignStateOrigin): Promise<DesignState>
    saveDesignState(projectId: string, state: DesignState): Promise<DesignState>
    reorderDesignStates(projectId: string, orderedIds: string[]): Promise<{ ok: true }>
    /** Cascades to the state's own design tree and any Alternatives built
     * on top of it. */
    deleteDesignState(projectId: string, stateId: string): Promise<{ ok: true }>

    // ---- Generic design tree — shared by DesignState and Alternative ----
    getDesignTree(projectId: string, ownerId: string): Promise<DesignTreeRecord | null>
    saveDesignTree(record: DesignTreeRecord): Promise<DesignTreeRecord>

    // ---- Phase 19 — Alternatives ----
    listAlternativesForState(projectId: string, designStateId: string): Promise<Alternative[]>
    /** Clones `sourceOwnerId`'s current design tree (a DesignState's own
     * tree, or another Alternative's) into a brand-new, fully independent
     * Alternative. */
    createAlternative(
      projectId: string,
      input: { featureId: string; designStateId: string; designStateSlugHint: string; name: string; sourceOwnerId: string },
    ): Promise<Alternative>
    saveAlternative(projectId: string, alternative: Alternative): Promise<Alternative>
    /** Setting one Alternative preferred/approved clears the flag on its
     * siblings under the same DesignState. */
    setAlternativePreferred(projectId: string, alternativeId: string): Promise<Alternative>
    setAlternativeApproved(projectId: string, alternativeId: string): Promise<Alternative>
    deleteAlternative(projectId: string, alternativeId: string): Promise<{ ok: true }>

    // ---- Phase 21-23 — Journeys ----
    listJourneys(projectId: string, featureId: string): Promise<Journey[]>
    getJourney(projectId: string, journeyId: string): Promise<Journey | null>
    createJourney(projectId: string, featureId: string, name: string, description?: string): Promise<Journey>
    saveJourney(projectId: string, journey: Journey): Promise<Journey>
    deleteJourney(projectId: string, journeyId: string): Promise<{ ok: true }>

    // ---- Phase 25 — Share Previews ----
    listSharePreviews(projectId: string, featureId: string): Promise<SharePreview[]>
    getSharePreview(projectId: string, sharePreviewId: string): Promise<SharePreview | null>
    createSharePreview(
      projectId: string,
      input: Omit<SharePreview, 'id' | 'createdAt' | 'updatedAt' | 'packagePath'>,
    ): Promise<SharePreview>
    saveSharePreview(projectId: string, sharePreview: SharePreview): Promise<SharePreview>
    deleteSharePreview(projectId: string, sharePreviewId: string): Promise<{ ok: true }>
    /** Resolves the Journey/DesignState/Alternative graph into a review-safe
     * bundle written to disk and stamps `packagePath` — never a fake/no-op
     * "Share" action. */
    packageSharePreview(projectId: string, sharePreviewId: string): Promise<SharePreview>
    /** Reads a previously packaged bundle back for the in-app Share Preview
     * viewer — null if it hasn't been packaged yet. */
    readSharePackage(projectId: string, sharePreviewId: string): Promise<SharePackageBundle | null>

    // ---- Phase 26-29 — Feature work packages ----
    getDesignOperations(projectId: string, featureId: string, ownerId: string): Promise<DesignOperation[]>
    saveDesignOperations(projectId: string, featureId: string, ownerId: string, operations: DesignOperation[]): Promise<DesignOperation[]>
    listAnnotations(projectId: string, featureId: string): Promise<Annotation[]>
    saveAnnotation(projectId: string, annotation: Annotation): Promise<Annotation>
    deleteAnnotation(projectId: string, featureId: string, annotationId: string): Promise<{ ok: true }>
    listVersions(projectId: string, featureId: string): Promise<Version[]>
    createVersion(projectId: string, featureId: string, name: string, createdBy: string): Promise<Version>
    renameVersion(projectId: string, featureId: string, versionId: string, name: string): Promise<Version>
    restoreVersion(projectId: string, featureId: string, versionId: string, createdBy: string): Promise<Version>
    duplicateVersion(projectId: string, featureId: string, versionId: string, createdBy: string): Promise<Version>
    compareVersions(projectId: string, featureId: string, leftVersionId: string | null, rightVersionId: string | null): Promise<VersionDifference[]>
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
    /** Static read of a page's nested JSX, HTML or server-template
     * structure. Path-scoped to the active project root in main; source is
     * parsed as text and never executed. */
    getPageStructure(relativeFilePath: string): Promise<PageStructureItem[]>
    /** Fires as `getIndex`/`reindex` pass through each real stage of
     * `indexProject` (detecting the framework, finding pages, etc.) so the
     * renderer can show live progress instead of a fake timer. */
    onIndexProgress(callback: (update: IndexProgressUpdate) => void): () => void
  }
  preview: {
    getCommand(): Promise<DevCommand | null>
    /** PRJ-03: lets the user override the detected preview command before
     * Start/Retry. Still just command + argv — never a shell string. */
    setCommand(command: DevCommand): Promise<{ ok: boolean }>
    /** Current status + detected URL, for a view that opens after Preview
     * was already started elsewhere (e.g. Capture Session) and would
     * otherwise miss the one-time onUrlDetected push event. */
    getStatus(): Promise<PreviewStatusSnapshot>
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
  capture: {
    /** Persists one runtime DOM snapshot (spec §3) taken from the Capture
     * Session webview. Validated and written to disk in main. */
    save(capture: CapturedPage): Promise<CapturedPage>
    list(projectId: string): Promise<CapturedPage[]>
    /** App-managed screenshot storage (not a user-facing Save dialog, see
     * `export.savePng` for that) — one PNG per capture, named
     * `${captureId}.png`. */
    saveScreenshot(projectId: string, captureId: string, base64Png: string): Promise<{ ok: boolean }>
    /** Reads a previously saved screenshot back as an inline `data:` URL for
     * `<img>` `src`, or `null` if none was ever saved for this capture. */
    getScreenshotDataUrl(projectId: string, captureId: string): Promise<string | null>
  }
}

export type FrameUiPlatform = 'darwin' | 'win32' | 'linux' | (string & {})
