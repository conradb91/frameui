import {replayStepSchema} from '../../shared/artifactDiscovery'
import {textStyleRunSchema} from './textStyleSchema'
import { prototypeSchema } from '../prototype/schema'
import { z } from 'zod'
import type { VisualObject } from '../../shared/types/visualDesign'
import { structuredFrameSchema } from '../capture-compiler/schema'
const finite = z.number().finite()
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)
export const visualObjectSchema: z.ZodType<VisualObject> = z.lazy(() =>
  z.object({
    id,
    designOnly: z.boolean().optional(),
    kind: z.enum([
      'Frame',
      'Group',
      'Section',
      'Text',
      'Rectangle',
      'Ellipse',
      'Line',
      'Polygon',
      'Vector',
      'Image',
      'Icon',
      'Component',
      'Instance',
      'Button',
      'Input',
      'Select',
      'Checkbox',
      'Radio',
      'Toggle',
      'Card',
      'Table',
      'Navigation',
      'Modal',
      'Badge',
      'Avatar',
    ]),
    name: z.string().max(1000),
    x: finite,
    y: finite,
    width: finite.min(0),
    height: finite.min(0),
    rotation: finite,
    fill: z.string(),
    stroke: z.string(),
    strokeWidth: finite.min(0),
    opacity: finite.min(0).max(1),
    fillOpacity: finite.min(0).max(1),
    strokeOpacity: finite.min(0).max(1),
    radius: z.tuple([
      finite.min(0),
      finite.min(0),
      finite.min(0),
      finite.min(0),
    ]),
    hidden: z.boolean(),
    locked: z.boolean(),
    clip: z.boolean(),
    interaction: z
      .object({
        targetPageId: z.string(),
        transition: z.enum(['Instant', 'Dissolve', 'Slide']),
        trigger: z.enum(['Click', 'Hover']),
      })
      .optional(),
    imageFit: z.enum(['cover', 'contain', 'fill']).optional(),
    arrow: z.boolean().optional(),
    text: z.string().optional(),
    textRuns: z.array(textStyleRunSchema).max(5000).optional(),
    src: z
      .string()
      .refine(
        (s) => s.startsWith('data:image/'),
        'Design images must be stored locally.',
      )
      .optional(),
    path: z.string().optional(),
    viewBox: z.string().optional(),
    fontFamily: z.string(),
    fontSize: finite.min(0),
    fontWeight: z.string(),
    lineHeight: finite,
    letterSpacing: finite,
    textAlign: z.string(),
    textDecoration: z.string().optional(),
    shadow: z.string().optional(),
    blur: finite.min(0).optional(),
    gradient: z.string().optional(),
    layout: z.object({
      direction: z.string(),
      alignment: z.string(),
      distribution: z.string(),
      gap: finite,
      padding: finite,
      wrap: z.boolean(),
      constraints: z.string(),
      minWidth: finite.optional(),
      maxWidth: finite.optional(),
      grid: z.string().optional(),
    }),
    source: z
      .object({
        file: z.string().optional(),
        component: z.string().optional(),
        route: z.string().optional(),
        selector: z.string().optional(),
        destination: z.string().optional(),
      })
      .optional(),
    componentId: z.string().optional(),
    overrides: z.array(z.string()).optional(),
    variants: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          properties: z.record(z.string()),
          objects: z.array(visualObjectSchema),
        }),
      )
      .optional(),
    variant: z.record(z.string()).optional(),
    bindings: z.record(z.string()).optional(),
    children: z.array(visualObjectSchema),
  }),
)
export const visualDocumentSchema = z.object({
  prototype: prototypeSchema.optional(),
  version: z.literal(1),
  id,
  name: z.string().max(500),
  projectId: id.optional(),
  libraryId: id.optional(),
  appUrl: z.string().url().optional(),
  pageRegistry: z.array(z.object({captureError: z.string().optional(), captureErrorProfile: z.string().optional(), url: z.string(), pattern: z.string(), name: z.string(), source: z.string().optional(), hash: z.string().optional(), needsSample: z.boolean().optional(), sources: z.array(z.enum(['source', 'runtime', 'manual'])).optional(), authProfile: z.string(), area: z.string(), status: z.enum(['Discovered', 'Needs Sample Data', 'Captured', 'Failed'])})).optional(),
  sourceComponents: z.array(z.object({ id: z.string(), name: z.string(), file: z.string() })).optional(),
  updatedAt: z.string(),
  pages: z.array(
    z.object({
      id,
      name: z.string(),
      folder: z.string(),
      sourceDesign: z.object({ pageId: z.string(), state: z.string(), states: z.array(z.string()), status: z.enum(['ready', 'partial', 'unsupported']), generatedData: z.boolean() }).optional(),
      pinned: z.boolean(),
      captureWarnings: z.array(z.string()).optional(),
      authProfile: z.string().optional(),
      state: z.string(),
      route: z.string().optional(),
      flowIntroductionFor: z.string().min(1).max(100).optional(),
      canonicalStateId:z.string().optional(),flowInstanceFor:z.string().optional(),
      artifactSource: z.object({path:z.string().max(4096),steps:z.array(replayStepSchema).max(128)}).optional(),
      sourceHash: z.string().optional(),
      capturedAt: z.string().optional(),
      width: finite.positive(),
      height: finite.positive(),
      canvasX: finite.optional(),
      canvasY: finite.optional(),
      layoutGrid: z.object({
        visible: z.boolean(),
        type: z.enum(['columns', 'grid']),
        size: finite.positive(),
        columns: finite.int().min(1).max(48),
        gutter: finite.min(0),
        margin: finite.min(0),
        color: z.string(),
        opacity: finite.min(0).max(1),
      }).optional(),
      fonts: z
        .array(
          z.object({
            family: z.string(),
            weight: z.string(),
            style: z.string(),
            unicodeRange: z.string().optional(),
            stretch: z.string().optional(),
            data: z.string().startsWith('data:'),
          }),
        )
        .optional(),
      objects: z.array(visualObjectSchema),
      structured: structuredFrameSchema.optional(),
      thumbnail: z.string().optional(),
      fullPageScreenshot: z.string().optional(),
      canvasPreview: z.string().optional(),
      edited: z.boolean().optional(),
      importedObjects: z.array(visualObjectSchema).optional(),
      captureStatus: z
        .enum([
          'Up to date',
          'Modified',
          'Source changed',
          'Capture issue',
          'Conflict',
        ])
        .optional(),
      conflicts: z
        .array(
          z.object({
            id: z.string(),
            objectId: z.string(),
            name: z.string(),
            property: z.string(),
            local: z.unknown(),
            incoming: z.unknown(),
          }),
        )
        .optional(),
    }),
  ),
  components: z.array(visualObjectSchema),
  variables: z.array(
    z.object({
      id: z.string(),
      collection: z.string(),
      name: z.string(),
      type: z.enum(['Colour', 'Number', 'String', 'Boolean']),
      value: z.string(),
    }),
  ),
})
