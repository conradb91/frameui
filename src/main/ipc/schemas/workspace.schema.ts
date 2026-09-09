import { z } from 'zod'
import { designNodeSchema } from './designNode.schema'
import { capturedElementSchema } from './capture.schema'

// projectId/flowId/screenId are always crypto.randomUUID() values
// server-side, but they arrive back from the (untrusted) renderer on every
// workspace call and get used to build filenames (getFlowsFile,
// getScreenDraftsFile) — .uuid() isn't just validation here, it's what
// rules out a path-traversal id like "../../../../etc/passwd" ever
// reaching path.join (confirmed while auditing this: a bare .min(1)
// string would have let that through).
const idSchema = z.string().uuid()

export const projectIdSchema = idSchema

// Phase 16-25 objects (FeaturePage, DesignState, Alternative, Journey,
// JourneyConnection, SharePreview) use human-readable composed ids
// (`makeStableId`, e.g. "page.payment_overview") instead of a UUID — never
// used to build a filesystem path directly (always a value *inside* a
// `<projectId>.json` array, where `idSchema`'s path-traversal concern
// doesn't apply), so a plain shape+length check is enough here.
const stableIdSchema = z.string().min(1).max(300).regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+(-\d+)?$/)

export const createFlowInputSchema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  featureId: idSchema.nullable().optional().default(null),
})

export const getFlowInputSchema = z.object({
  projectId: idSchema,
  flowId: idSchema,
})

const screenNodeSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  source: z.object({
    type: z.enum(['blank', 'existing-page']),
    pageFilePath: z.string().optional(),
    referenceOnly: z.boolean().optional(),
  }),
  position: z.object({ x: z.number(), y: z.number() }),
})

const flowEdgeSchema = z.object({
  id: idSchema,
  sourceNodeId: idSchema,
  targetNodeId: idSchema,
  label: z.string().max(60),
})

export const saveFlowInputSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  featureId: idSchema.nullable(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  nodes: z.array(screenNodeSchema).max(200),
  edges: z.array(flowEdgeSchema).max(400),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const deleteFlowInputSchema = z.object({
  projectId: idSchema,
  flowId: idSchema,
})

export const getScreenDraftInputSchema = z.object({
  projectId: idSchema,
  screenId: idSchema,
})

export const saveScreenDraftInputSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  flowId: idSchema,
  tree: designNodeSchema,
  updatedAt: z.string(),
})

const featureStatusSchema = z.enum(['concept', 'designing', 'review', 'approved', 'ready-for-development', 'implemented', 'verified'])

export const createFeatureInputSchema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional().default(''),
})

export const getFeatureInputSchema = z.object({
  projectId: idSchema,
  featureId: idSchema,
})

export const saveFeatureInputSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(4000),
  status: featureStatusSchema,
  owner: z.string().max(200).nullable(),
  reviewers: z.array(z.string().max(200)).max(50),
  dueDate: z.string().nullable(),
  externalTicketRef: z.string().max(300).nullable(),
  // `Page.id` (from `ProjectModel`) is a stable slug-composed id like
  // "page.our_bills" (`IdRegistry.make`), not a UUID — confirmed by reading
  // `buildProjectModel.ts` while wiring Phase 16's `FeaturePage`, which
  // shares the same id shape. `idSchema` here would have rejected every
  // real page id at the first `saveFeature` call with actual pages in it.
  pageIds: z.array(stableIdSchema).max(500),
  referenceOnlyPageIds: z.array(stableIdSchema).max(500),
  newPageIds: z.array(stableIdSchema).max(500),
  componentIds: z.array(stableIdSchema).max(2000).optional().default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const deleteFeatureInputSchema = z.object({
  projectId: idSchema,
  featureId: idSchema,
})

const conceptComponentVariantSchema = z.object({ id: idSchema, name: z.string().min(1).max(120) })
const conceptComponentPropertySchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  type: z.enum(['text', 'number', 'boolean', 'select']),
  defaultValue: z.string().max(500),
  options: z.array(z.string().max(200)).max(50).optional(),
})

export const listConceptComponentsInputSchema = z.object({
  projectId: idSchema,
  featureId: idSchema,
})

const conceptComponentSchema = z.object({
  id: idSchema,
  featureId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  variants: z.array(conceptComponentVariantSchema).max(50),
  properties: z.array(conceptComponentPropertySchema).max(100),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const saveConceptComponentInputSchema = z.object({
  projectId: idSchema,
  component: conceptComponentSchema,
})

export const deleteConceptComponentInputSchema = z.object({
  projectId: idSchema,
  componentId: idSchema,
})

// ---------------------------------------------------------------------
// Phase 16 — Feature Pages
// ---------------------------------------------------------------------

const viewportSchema = z.enum(['desktop', 'tablet', 'mobile'])
const newPageLayoutSourceSchema = z.enum(['blank', 'project-layout', 'clone', 'pattern'])

export const listFeaturePagesInputSchema = z.object({ projectId: idSchema, featureId: idSchema })
export const getFeaturePageInputSchema = z.object({ projectId: idSchema, pageId: stableIdSchema })

export const createFeaturePageInputSchema = z.object({
  projectId: idSchema,
  featureId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  suggestedRoute: z.string().max(300).nullable().optional().default(null),
  initialViewport: viewportSchema.optional().default('desktop'),
  layoutSource: newPageLayoutSourceSchema,
  basedOnPageId: stableIdSchema.nullable().optional().default(null),
  basedOnPatternName: z.string().max(120).nullable().optional().default(null),
})

const featurePageSchema = z.object({
  id: stableIdSchema,
  featureId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  suggestedRoute: z.string().max(300).nullable(),
  initialViewport: viewportSchema,
  layoutSource: newPageLayoutSourceSchema,
  basedOnPageId: stableIdSchema.nullable(),
  basedOnPatternName: z.string().max(120).nullable(),
  status: featureStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const saveFeaturePageInputSchema = z.object({ projectId: idSchema, page: featurePageSchema })
export const deleteFeaturePageInputSchema = z.object({ projectId: idSchema, pageId: stableIdSchema })

// ---------------------------------------------------------------------
// Phase 17 — Design States
// ---------------------------------------------------------------------

const pageRefKindSchema = z.enum(['existing', 'new'])
const pageRefSchema = z.object({ kind: pageRefKindSchema, pageId: stableIdSchema })
const designStateOriginSchema = z.enum(['captured', 'design'])
const provenanceValueSchema = z.enum(['existing', 'existing-modified', 'new', 'reference-only'])

export const listDesignStatesForPageInputSchema = z.object({ projectId: idSchema, pageRef: pageRefSchema })
export const getDesignStateInputSchema = z.object({ projectId: idSchema, stateId: stableIdSchema })

export const createDesignStateInputSchema = z.object({
  projectId: idSchema,
  featureId: idSchema,
  pageRef: pageRefSchema,
  pageSlugHint: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  origin: designStateOriginSchema,
  capturedPageId: idSchema.nullable().optional().default(null),
  provenance: provenanceValueSchema,
})

export const duplicateDesignStateInputSchema = z.object({
  projectId: idSchema,
  sourceStateId: stableIdSchema,
  newName: z.string().min(1).max(120),
  newOrigin: designStateOriginSchema,
})

const designStateSchema = z.object({
  id: stableIdSchema,
  featureId: idSchema,
  pageRef: pageRefSchema,
  name: z.string().min(1).max(120),
  origin: designStateOriginSchema,
  capturedPageId: idSchema.nullable(),
  duplicatedFromStateId: stableIdSchema.nullable(),
  order: z.number().int().min(0),
  provenance: provenanceValueSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const saveDesignStateInputSchema = z.object({ projectId: idSchema, state: designStateSchema })
export const reorderDesignStatesInputSchema = z.object({ projectId: idSchema, orderedIds: z.array(stableIdSchema).max(200) })
export const deleteDesignStateInputSchema = z.object({ projectId: idSchema, stateId: stableIdSchema })

// One generic tree record shared by DesignState and Alternative.
export const getDesignTreeInputSchema = z.object({ projectId: idSchema, ownerId: stableIdSchema })
export const saveDesignTreeInputSchema = z.object({
  ownerId: stableIdSchema,
  projectId: idSchema,
  tree: designNodeSchema,
  updatedAt: z.string(),
})

// ---------------------------------------------------------------------
// Phase 19 — Alternatives
// ---------------------------------------------------------------------

export const listAlternativesForStateInputSchema = z.object({ projectId: idSchema, designStateId: stableIdSchema })

export const createAlternativeInputSchema = z.object({
  projectId: idSchema,
  featureId: idSchema,
  designStateId: stableIdSchema,
  designStateSlugHint: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  sourceOwnerId: stableIdSchema,
})

const alternativeSchema = z.object({
  id: stableIdSchema,
  featureId: idSchema,
  designStateId: stableIdSchema,
  name: z.string().min(1).max(120),
  isPreferred: z.boolean(),
  isApproved: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const saveAlternativeInputSchema = z.object({ projectId: idSchema, alternative: alternativeSchema })
export const setAlternativeFlagInputSchema = z.object({ projectId: idSchema, alternativeId: stableIdSchema })
export const deleteAlternativeInputSchema = z.object({ projectId: idSchema, alternativeId: stableIdSchema })

// ---------------------------------------------------------------------
// Phase 21-23 — Journeys, steps, interactions
// ---------------------------------------------------------------------

const journeyInteractionTriggerSchema = z.enum([
  'click',
  'hover',
  'submit',
  'back',
  'close',
  'open-modal',
  'open-drawer',
  'change-tab',
  'change-state',
  'navigate',
  'external-link',
])

const journeyStepSchema = z.object({
  id: idSchema,
  pageRef: pageRefSchema,
  designStateId: stableIdSchema.nullable(),
  alternativeId: stableIdSchema.nullable(),
  referenceOnly: z.boolean(),
  provenance: provenanceValueSchema,
  position: z.object({ x: z.number(), y: z.number() }),
})

const journeyConnectionSchema = z.object({
  id: idSchema,
  fromStepId: idSchema,
  toStepId: idSchema,
  trigger: journeyInteractionTriggerSchema,
  elementId: z.string().nullable(),
  elementLabel: z.string().max(300).nullable(),
  label: z.string().max(120),
  transitionMeta: z.record(z.string(), z.string()),
})

export const listJourneysInputSchema = z.object({ projectId: idSchema, featureId: idSchema })
export const getJourneyInputSchema = z.object({ projectId: idSchema, journeyId: stableIdSchema })

export const createJourneyInputSchema = z.object({
  projectId: idSchema,
  featureId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
})

export const saveJourneyInputSchema = z.object({
  projectId: idSchema,
  journey: z.object({
    id: stableIdSchema,
    featureId: idSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(2000),
    steps: z.array(journeyStepSchema).max(300),
    connections: z.array(journeyConnectionSchema).max(600),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
})

export const deleteJourneyInputSchema = z.object({ projectId: idSchema, journeyId: stableIdSchema })

// ---------------------------------------------------------------------
// Phase 25 — Share Previews
// ---------------------------------------------------------------------

const sharePreviewScopeSchema = z.enum(['feature', 'journey', 'page'])

export const listSharePreviewsInputSchema = z.object({ projectId: idSchema, featureId: idSchema })
export const getSharePreviewInputSchema = z.object({ projectId: idSchema, sharePreviewId: stableIdSchema })

export const createSharePreviewInputSchema = z.object({
  projectId: idSchema,
  featureId: idSchema,
  name: z.string().min(1).max(120),
  scope: sharePreviewScopeSchema,
  journeyId: stableIdSchema.nullable().optional().default(null),
  pageRef: pageRefSchema.nullable().optional().default(null),
  viewports: z.array(viewportSchema).max(4),
  includeCurrentComparison: z.boolean().optional().default(false),
  includeCapturedStates: z.boolean().optional().default(false),
})

const sharePreviewSchema = z.object({
  id: stableIdSchema,
  featureId: idSchema,
  name: z.string().min(1).max(120),
  scope: sharePreviewScopeSchema,
  journeyId: stableIdSchema.nullable(),
  pageRef: pageRefSchema.nullable(),
  viewports: z.array(viewportSchema).max(4),
  includeCurrentComparison: z.boolean(),
  includeCapturedStates: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  packagePath: z.string().nullable(),
})

export const saveSharePreviewInputSchema = z.object({ projectId: idSchema, sharePreview: sharePreviewSchema })
export const deleteSharePreviewInputSchema = z.object({ projectId: idSchema, sharePreviewId: stableIdSchema })
export const packageSharePreviewInputSchema = z.object({ projectId: idSchema, sharePreviewId: stableIdSchema })
export const readSharePackageInputSchema = z.object({ projectId: idSchema, sharePreviewId: stableIdSchema })

// ---------------------------------------------------------------------
// Phase 26-29 — Feature work packages
// ---------------------------------------------------------------------
const looseIdSchema = z.string().min(1).max(300)
const designOperationTypeSchema = z.enum(['create', 'delete', 'move', 'reorder', 'replace', 'set-property', 'unset-property', 'set-layout', 'set-responsive-override', 'remove-responsive-override', 'change-content', 'create-component-instance', 'change-component-variant', 'change-state', 'change-interaction', 'change-visibility'])
const designOperationSchema = z.object({
  id: looseIdSchema,
  revisionId: looseIdSchema,
  featureId: idSchema,
  ownerId: looseIdSchema,
  pageRef: pageRefSchema,
  designStateId: stableIdSchema,
  alternativeId: stableIdSchema.nullable(),
  type: designOperationTypeSchema,
  targetNodeId: looseIdSchema,
  key: z.string().min(1).max(800),
  summary: z.string().min(1).max(1000),
  property: z.string().max(300).nullable(),
  breakpoint: z.enum(['tablet', 'mobile']).nullable(),
  baseValue: z.unknown(),
  proposedValue: z.unknown(),
  node: designNodeSchema.nullable(),
  parentId: looseIdSchema.nullable(),
  index: z.number().int().min(0).max(10000).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const getDesignOperationsInputSchema = z.object({ projectId: idSchema, featureId: idSchema, ownerId: looseIdSchema })
export const saveDesignOperationsInputSchema = z.object({ projectId: idSchema, featureId: idSchema, ownerId: looseIdSchema, operations: z.array(designOperationSchema).max(10000) })

const annotationSchema = z.object({
  id: looseIdSchema, featureId: idSchema, pageRef: pageRefSchema,
  designStateId: stableIdSchema.nullable(), alternativeId: stableIdSchema.nullable(), viewport: viewportSchema,
  context: z.enum(['current', 'proposed']), elementId: looseIdSchema.nullable(), elementLabel: z.string().max(300).nullable(),
  componentId: looseIdSchema.nullable(), versionId: stableIdSchema.nullable(), screenshotAssetId: looseIdSchema.nullable(),
  sourceReference: z.unknown().nullable(), comment: z.string().min(1).max(10000), status: z.enum(['open', 'resolved', 'reopened']),
  priority: z.enum(['low', 'normal', 'high']), needsAttention: z.boolean(), createdAt: z.string(), updatedAt: z.string(), createdBy: z.string().max(200),
})
export const listAnnotationsInputSchema = z.object({ projectId: idSchema, featureId: idSchema })
export const saveAnnotationInputSchema = z.object({ projectId: idSchema, annotation: annotationSchema })
export const deleteAnnotationInputSchema = z.object({ projectId: idSchema, featureId: idSchema, annotationId: looseIdSchema })
export const listVersionsInputSchema = z.object({ projectId: idSchema, featureId: idSchema })
export const createVersionInputSchema = z.object({ projectId: idSchema, featureId: idSchema, name: z.string().min(1).max(120), createdBy: z.string().max(200) })
export const renameVersionInputSchema = z.object({ projectId: idSchema, featureId: idSchema, versionId: stableIdSchema, name: z.string().min(1).max(120) })
export const restoreVersionInputSchema = z.object({ projectId: idSchema, featureId: idSchema, versionId: stableIdSchema, createdBy: z.string().max(200) })
export const compareVersionsInputSchema = z.object({ projectId: idSchema, featureId: idSchema, leftVersionId: stableIdSchema.nullable(), rightVersionId: stableIdSchema.nullable() })

const userFixtureSchema = z.object({ id: looseIdSchema, projectId: idSchema, componentId: stableIdSchema, name: z.string().min(1).max(120), origin: z.enum(['detected', 'captured', 'user-defined']), props: z.record(z.string().max(100), z.string().max(1000)).refine((value) => Object.keys(value).length <= 100), updatedAt: z.string() })
const sourceReferenceSchema = z.object({ filePath: z.string().min(1).max(2000), line: z.number().int().min(1).optional(), route: z.string().max(2000).optional() })
const pageStructureSchema: z.ZodType<unknown> = z.lazy(() => z.object({ tagName: z.string().min(1).max(200), isKnownComponent: z.boolean(), sourceFilePath: z.string().max(2000).optional(), sourceLine: z.number().int().min(1).optional(), attributes: z.record(z.string().max(100), z.string().max(2000)).refine((value) => Object.keys(value).length <= 50).optional(), children: z.array(pageStructureSchema).max(500), textPreview: z.string().max(200).optional() }))
const runtimeRelationshipSchema = z.object({ id: looseIdSchema, componentId: stableIdSchema, captureId: idSchema, pageId: stableIdSchema.nullable(), routePatternId: stableIdSchema.nullable(), viewport: z.object({ width: z.number().min(0).max(20000), height: z.number().min(0).max(20000) }), stateLabel: z.string().max(200), elementPath: z.array(z.number().int().min(0).max(1000)).max(30), sourceReference: sourceReferenceSchema, visualSignature: z.string().max(100) })
const previewCacheSchema = z.object({ componentId: stableIdSchema, fixtureId: looseIdSchema.nullable(), approach: z.enum(['source', 'context', 'runtime', 'unavailable']), dependencyFingerprint: z.string().max(2000), structure: z.array(pageStructureSchema).max(500).nullable(), runtimeElement: capturedElementSchema.nullable(), runtimeCaptureId: idSchema.nullable(), failureReason: z.string().max(2000).nullable(), updatedAt: z.string() })
const findingDecisionSchema = z.object({ findingId: looseIdSchema, evidenceSignature: z.string().max(200), status: z.enum(['intentional', 'dismissed']), note: z.string().max(2000), updatedAt: z.string() })
export const saveComponentFixtureInputSchema = z.object({ projectId: idSchema, fixture: userFixtureSchema })
export const deleteComponentFixtureInputSchema = z.object({ projectId: idSchema, fixtureId: looseIdSchema })
export const savePreviewCacheInputSchema = z.object({ projectId: idSchema, entry: previewCacheSchema })
export const saveRuntimeRelationshipsInputSchema = z.object({ projectId: idSchema, componentId: stableIdSchema, relationships: z.array(runtimeRelationshipSchema).max(500) })
export const saveFindingDecisionInputSchema = z.object({ projectId: idSchema, decision: findingDecisionSchema })
export const setObservationApprovedInputSchema = z.object({ projectId: idSchema, observationId: looseIdSchema, approved: z.boolean() })
