import type { VisualDocument, VisualPage, VisualObject, ApplicationCandidate, CaptureRoute, CaptureProgress, CaptureStage } from './types/visualDesign'
import type { ProjectVisuals } from './types/projectVisuals'
import type { RecentProject, OpenProjectResult, OpenRecentResult, ProjectLibraryEntry } from './types/project'
import type { ProjectIndex, FileChangeNotice, DevCommand, IndexProgressUpdate } from './types/projectIndex'
import type { PreviewOutputLine, PreviewStatusUpdate, PreviewUrlDetected, PreviewStatusSnapshot } from './types/preview'
import type { Flow, FlowSummary } from './types/flow'
import type { ScreenDraft } from './types/screenDraft'
import type { PageStructureItem } from './types/pageStructure'
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
  SourceConflict,
  SourceConflictResolution,
} from './types/model/featureModel'
import type { Viewport } from './types/model/projectModel'
import type { DesignTreeRecord } from './types/designTreeRecord'
import type { SharePackageBundle } from './types/sharePackage'
import type { DesignSystemWorkspaceData, FindingDecision, PreviewCacheEntry, RuntimeComponentRelationship, UserComponentFixture } from './types/designSystem'
import type { ExportFile, ExportRecord } from './types/handoff'
import type { FrameUiPackageFile } from './types/frameuiExport'

/**
 * The complete shape of the narrow, typed bridge the preload script exposes
 * as `window.frameui`. Nothing beyond what's declared here is ever exposed to
 * the renderer — no generic `invoke(channel, ...)` passthrough. Every method
 * added here must have a corresponding main-process handler that validates
 * its own input (see src/main/ipc/schemas) rather than trusting the renderer.
 */
export interface FrameUiApi {
  prototype: import('./types/prototype').PrototypeApi
  ai: import('./types/ai').AiApi
  design: {
    fromSource(input: { projectId: string; pageId: string; width?: number; state?: string }): Promise<VisualPage>
    /** `pageCount`/`thumbnail` describe the document's own first page (a
     * Design's frame count/preview); `designCount` is only meaningful for a
     * project ("library") document — the number of Designs that belong to
     * it — and is `undefined` on a Design document itself. */
    list(): Promise<(Pick<VisualDocument, 'id' | 'name' | 'projectId' | 'libraryId' | 'updatedAt'> & { pageCount: number; thumbnail?: string; designCount?: number })[]>
    load(id: string): Promise<VisualDocument | null>
    save(document: VisualDocument): Promise<{ ok: boolean }>
    savePatch(patch: import('./designPatch').DesignPatch): Promise<{ ok: boolean }>
    login(input: {url:string;profile?: 'standard' | 'admin' | 'super-admin';username:string;password:string}): Promise<{ok:boolean;message:string}>
    scan(): Promise<ApplicationCandidate[]>
    /** Live Fidelity Capture's "Test connection" preflight — cheap reachability
     * check reusing the same guest-browser mechanism as `discover`, but never
     * crawls links or touches the route model. */
    testConnection(url: string, profile?: 'standard' | 'admin' | 'super-admin'): Promise<{ ok: true; address: string; title: string; route: string; assetsLoaded: number; assetsTotal: number }>
    discoverArtifact(importId:string,width?:number,resume?:boolean,mode?:import('./artifactDiscovery').ArtifactImportMode): Promise<{token:string;routes:CaptureRoute[];transitions:import('../core/prototype/artifactFlow').DetectedTransition[];warnings:string[];coverage:import('./artifactDiscovery').DiscoveryCoverage}>
    prepareCapture(input: { url: string; profile?: 'standard' | 'admin' | 'super-admin'; routes: { pattern: string; path: string; name: string }[] }): Promise<{ token: string }>
    discover(url: string, profile?: 'standard' | 'admin' | 'super-admin'): Promise<{ token: string; routes: CaptureRoute[]; components: number; layouts: number; warnings: string[] }>
    addRoute(token: string, address: string): Promise<CaptureRoute[]>
    captureCurrentState(guestId: number): Promise<{root: import('./types/runtimeCapture').CapturedElement; metadata:{title:string;heading?:string;width:number;height:number}; thumbnail:string; fullPageScreenshot?:string;canvasPreview?:string; fonts: NonNullable<VisualPage['fonts']>; url:string; warnings:string[]; structured?: import('./types/structuredDesign').StructuredFrame}>
    /** Additive follow-up to `captureCurrentState`: forces hover/focus/active
     * on the caller's already-normalized objects and returns them enriched
     * with variants — the live capture flow's only way to preserve a real
     * `:hover` state, since clicking "Capture screen" requires moving the
     * mouse off whatever's hovered in the webview. */
    captureLiveVisualStates(guestId: number, objects: VisualObject[]): Promise<VisualObject[]>
    cancelCapture(): Promise<{ ok: boolean }>
    capture(input: { token: string; artifactImportId?:string; routes?: string[]; controlStates?: boolean; overlays?: boolean; widths: number[]; unchanged: { route: string; hash: string }[] }): Promise<VisualPage[]>
    captureSerialized(input: { token: string; artifactImportId?:string; routes?: string[]; controlStates?: boolean; overlays?: boolean; widths: number[]; unchanged: { route: string; hash: string }[] }): Promise<string>
    /** Stage 3 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
     * dev-only read-back for `StructuredCapturePreview.tsx`, the "render
     * captured models beside the existing SVG output" debug view. Lists the
     * diagnostic `StructuredDesignDocument` files `design:capture`/
     * `design:captureCurrentState` already write. */
    listStructuredCaptures(projectId: string): Promise<{ baseName: string; route: string; viewport: string; name: string; capturedAt: string; hasLegacy: boolean; visualMatchPercent?: number }[]>
    loadStructuredCapture(projectId: string, baseName: string): Promise<{
      structured: import('./types/structuredDesign').StructuredDesignDocument
      legacy?: { objects: VisualObject[]; fonts: NonNullable<VisualPage['fonts']> }
      /** Stage 4 — the three Pixelmatch comparison images, as data URLs,
       * present only once `renderAndCompareStructuredCapture` has run. */
      images?: { original?: string; render?: string; diff?: string }
    } | null>
    onCommand(callback: (id: string) => void): () => void
    onProgress(callback: (progress: CaptureProgress) => void): () => void
    onCaptureStage(callback: (stage: CaptureStage) => void): () => void
  }
  app: {
    getVersion(): Promise<string>
    getPlatform(): Promise<FrameUiPlatform>
    getPathForFile(file: object): string
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
    getVersionDesignOperations(projectId: string, featureId: string, versionId: string): Promise<DesignOperation[]>
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
    listSourceConflicts(projectId: string, featureId: string): Promise<SourceConflict[]>
    resolveSourceConflict(projectId: string, featureId: string, conflictId: string, resolution: Exclude<SourceConflictResolution, 'unresolved'>): Promise<SourceConflict>
    listExportHistory(projectId: string, featureId: string): Promise<ExportRecord[]>
    recordExport(projectId: string, record: ExportRecord): Promise<ExportRecord>
    getDesignSystemData(projectId: string): Promise<DesignSystemWorkspaceData>
    saveComponentFixture(projectId: string, fixture: UserComponentFixture): Promise<UserComponentFixture>
    deleteComponentFixture(projectId: string, fixtureId: string): Promise<{ ok: true }>
    savePreviewCache(projectId: string, entry: PreviewCacheEntry): Promise<PreviewCacheEntry>
    saveRuntimeRelationships(projectId: string, componentId: string, relationships: RuntimeComponentRelationship[]): Promise<RuntimeComponentRelationship[]>
    saveFindingDecision(projectId: string, decision: FindingDecision): Promise<FindingDecision>
    setObservationApproved(projectId: string, observationId: string, approved: boolean): Promise<DesignSystemWorkspaceData>
  }
  project: {
    cancelPrototypeImport(id:string):Promise<{ok:boolean}>
    finishPrototypeImport(id:string):Promise<void>
    onPrototypeImportProgress(callback:(progress:import('./types/artifactImport').ArtifactImportProgress)=>void):()=>void
    addPrototypeFiles(files:object[]):Promise<string[]>
    selectStarterLocation(kind:'repository'|'application'|'prototype'|'blank'): Promise<string|string[]|null>
    createStarterProject(name:string,kind:'repository'|'application'|'prototype'|'blank',parentPath?:string): Promise<RecentProject>
    resumePrototypeImport(id:string,projectId:string):Promise<{project:RecentProject;url:string;routes:string[];warnings?:string[]}>
    importPrototype(id:string,projectId?:string,file?:string|string[]): Promise<{project:RecentProject;url:string;routes:string[];warnings?:string[]} | null>
    connectApplication(url:string,projectId?:string): Promise<RecentProject>
    getRuntime(): Promise<import('./types/project').RuntimeConnection | null>
    configureRuntime(url: string, source: import('./types/project').RuntimeSource): Promise<import('./types/project').RuntimeConnection>
    verifyRuntime(): Promise<import('./types/project').RuntimeConnection>
    downloadPrototypeInstructions(): Promise<{ saved: boolean }>
    downloadVerification(): Promise<{ saved: boolean }>

    rename(projectId: string, name: string): Promise<{ ok: true }>
    listLibrary(): Promise<ProjectLibraryEntry[]>
    removeFromRecent(projectId: string): Promise<{ ok: true }>
    clearRecent(): Promise<{ ok: true }>
    removeFromFrameUi(projectId: string): Promise<{ ok: true }>
    deleteFromDisk(projectId: string, confirmationName: string): Promise<{ ok: true }>
    reveal(projectId: string): Promise<{ ok: boolean }>
    /** Reveals one project-relative file (e.g. a page's source file) in the
     * OS file manager. Rejects (returns `ok: false`) if it resolves outside
     * the project root. */
    revealFile(projectId: string, relativePath: string): Promise<{ ok: boolean }>
    getLibraryCover(projectId: string): Promise<string | null>
    /** Shows the native folder picker. `relinkId` re-points an existing
     * (e.g. missing) recent-project entry at the newly chosen folder
     * instead of adding a new one. */
    openDialog(relinkId?: string): Promise<OpenProjectResult>
    /** Re-opens a folder already in Recent Projects without a picker. */
    openPath(path: string): Promise<OpenRecentResult>
    activate(projectId:string):Promise<{url?:string}>
    /** Returns the cached index for the currently active project, computing
     * it on first call. Null if no project is active. */
    getIndex(): Promise<ProjectIndex | null>
    /** Forces a fresh scan of the currently active project. */
    reindex(): Promise<ProjectIndex | null>
    selectApplication(applicationId: string): Promise<ProjectIndex | null>
    /** Stops watching / clears the currently active project. */
    close(): Promise<{ ok: true }>
    /** Fires when files change on disk inside the active project (after the
     * ~400ms debounce). Returns an unsubscribe function. */
    onFileChanged(callback: (notice: FileChangeNotice) => void): () => void
    /** Static read of a page's nested JSX, HTML or server-template
     * structure. Path-scoped to the active project root in main; source is
     * parsed as text and never executed. */
    getVisuals(): Promise<ProjectVisuals>
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
    saveXd(request: import('./types/xdExport').XdExportRequest | string): Promise<import('./types/xdExport').XdExportResult>
    cancelXd(jobId: string): Promise<void>
    onXdProgress(callback: (event: { jobId: string; stage: string; percentage?: number }) => void): () => void
    saveSketch(request: import('./types/sketchExport').SketchExportRequest): Promise<import('./types/sketchExport').SketchExportResult>
    cancelSketch(jobId: string): Promise<void>
    onSketchProgress(listener: (event: {jobId:string;stage:string}) => void): () => void
    saveFrameUiPackage(files: FrameUiPackageFile[], suggestedName: string): Promise<{ ok: boolean; filePath?: string; byteLength?: number; error?: string }>
    revealSaved(filePath: string): Promise<{ ok: boolean }>
    revealFigmaImporter(): Promise<{ ok: boolean }>
    saveSvg(svg: string, suggestedName: string): Promise<{ ok: boolean; filePath?: string }>
    savePng(base64: string, suggestedName: string): Promise<{ ok: boolean; filePath?: string }>
    generateReviewPdf(html: string, suggestedName: string): Promise<{ ok: boolean; filePath?: string; error?: string }>
    savePackage(files: ExportFile[], suggestedFolder: string): Promise<{ ok: boolean; directoryPath?: string; fileCount?: number; error?: string }>
  }
}

export type FrameUiPlatform = 'darwin' | 'win32' | 'linux' | (string & {})
