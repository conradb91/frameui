import {textStyleRunSchema,textGradientSchema} from '../visual/textStyleSchema'
import { z } from 'zod'
import type { StructuredFrame, StructuredNode } from '@shared/types/structuredDesign'

/**
 * Stage 5 of the capture-engine rebuild (docs/CAPTURE_ENGINE_REBUILD_SPEC.md):
 * `StructuredFrame` becomes real, saved data once `VisualPage.structured`
 * exists — without a schema here, `visualDocumentSchema`'s plain
 * `z.object({...})` page shape (`@core/visual/schema.ts`) would silently
 * strip an unknown `structured` field on every `design:save` (Zod's default
 * behavior for unrecognized keys), losing it. Mirrors `visualObjectSchema`'s
 * existing recursive pattern in that same file field-for-field.
 */
const finite = z.number().finite()
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)

const structuredNodeTypeSchema = z.enum([
  'Frame', 'Section', 'Container', 'Group', 'ComponentInstance',
  'Text', 'Image', 'SVG', 'Icon', 'Shape', 'Divider', 'Input', 'Button', 'Link',
  'UnknownWebElement', 'RasterFallback',
])

const structuredLayoutSchema = z.object({
  mode: z.enum(['free', 'stack', 'grid']),
  direction: z.enum(['horizontal', 'vertical']).optional(),
  reverse: z.boolean().optional(),
  wrap: z.boolean().optional(),
  align: z.string().optional(),
  justify: z.string().optional(),
  alignContent: z.string().optional(),
  gap: finite.optional(),
  gridTemplateColumns: z.string().optional(),
  gridTemplateRows: z.string().optional(),
  gridAutoFlow: z.string().optional(),
  padding: z.object({ top: finite, right: finite, bottom: finite, left: finite }).optional(),
  minWidth: finite.optional(),
  maxWidth: finite.optional(),
})

const structuredConstraintsSchema = z.object({ position: z.string() })

const structuredAppearanceSchema = z.object({
  transform: z.string().optional(),
  transformOrigin: z.string().optional(),
  zIndex: finite.optional(),
  backgroundColor: z.string().optional(),
  backgroundImage: z.string().optional(),
  backgroundSize: z.string().optional(),
  backgroundPosition: z.string().optional(),
  backgroundRepeat: z.string().optional(),
  backgroundBlendMode: z.string().optional(),
  backgroundOrigin: z.string().optional(),
  backgroundClip: z.string().optional(),
  clipPath: z.string().optional(),
  maskImage: z.string().optional(),
  maskSize: z.string().optional(),
  maskPosition: z.string().optional(),
  maskRepeat: z.string().optional(),
  maskMode: z.string().optional(),
  maskComposite: z.string().optional(),
  filter: z.string().optional(),
  backdropFilter: z.string().optional(),
  mixBlendMode: z.string().optional(),
  isolation: z.string().optional(),
  overflowClipMargin: z.string().optional(),

  objectPosition: z.string().optional(),
  border: z.object({ width: finite, style: z.string().optional(), color: z.string().optional() }).optional(),
  radius: z.tuple([finite, finite, finite, finite]),
  boxShadow: z.string().optional(),
  opacity: finite,
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: finite.optional(),
  objectFit: z.enum(['cover', 'contain', 'fill']).optional(),
  blur: finite.optional(),
  rotation: finite,
  clip: z.boolean(),
  clipX: z.boolean().optional(),
  clipY: z.boolean().optional(),
  accentColor: z.string().optional(),
  colorScheme: z.string().optional(),
})

const structuredTypographySchema = z.object({
  captureLines: z.array(z.object({text:z.string(),start:finite.optional(),x:finite,y:finite,width:finite,height:finite})).optional(),
  whiteSpace: z.string().optional(),
  fontStyle: z.string().optional(),
  textWrap: z.string().optional(),
  fontFeatureSettings: z.string().optional(),
  fontVariationSettings: z.string().optional(),
  fontOpticalSizing: z.string().optional(),
  fontKerning: z.string().optional(),
  fontStretch: z.string().optional(),
  wordSpacing: z.string().optional(),
  WebkitFontSmoothing: z.string().optional(),
  text: z.string(),
  textRuns: z.array(textStyleRunSchema).max(5000).optional(),
  gradient:textGradientSchema.nullable().optional(),
  fontFamily: z.string(),
  fontSize: finite,
  fontWeight: z.string(),
  lineHeight: finite,
  letterSpacing: finite,
  textAlign: z.string(),
  textDecoration: z.string().optional(),
  color: z.string().optional(),
})

const structuredSourceSchema = z.object({
  tag: z.string(),
  domId: z.string().optional(),
  classes: z.string().optional(),
  file: z.string().optional(),
  component: z.string().optional(),
  selector: z.string().optional(),
  href: z.string().optional(),
  imageSrc: z.string().refine((s) => s.startsWith('data:image/'), 'Design images must be stored locally.').optional(),
  svgGeometry: z.record(z.string()).optional(),
  control: z.object({ type: z.enum(['text', 'email', 'password', 'number', 'range', 'checkbox', 'radio','date','time','select','textarea']), appearance:z.string().optional(),options:z.array(z.object({value:z.string(),label:z.string(),disabled:z.boolean().optional()})).max(1000).optional(), placeholder:z.string().max(300).optional(), placeholderColor:z.string().optional(),placeholderOpacity:z.number().min(0).max(1).optional(), value: z.string().optional(), checked: z.boolean().optional(), disabled: z.boolean().optional(), min: z.string().optional(), max: z.string().optional(), step: z.string().optional() }).optional(),
})

const tokenBindablePropertySchema = z.enum([
  'backgroundColor', 'color', 'borderColor', 'fontSize', 'fontFamily', 'fontWeight',
  'lineHeight', 'letterSpacing', 'padding', 'margin', 'gap', 'borderRadius', 'boxShadow',
])
const structuredTokenBindingSchema = z.object({ value: z.string(), token: z.string().optional() })
const structuredTokenBindingsSchema = z.record(tokenBindablePropertySchema, structuredTokenBindingSchema).optional()

const structuredComponentBindingSchema = z.object({
  componentId: z.string(),
  variant: z.record(z.string()).optional(),
  confidence: finite,
})

const structuredCaptureConfidenceSchema = z.object({
  layoutConfidence: finite.optional(),
  componentConfidence: finite.optional(),
  assetConfidence: finite.optional(),
  fontConfidence: finite.optional(),
  tokenConfidence: finite.optional(),
})

export const structuredNodeSchema: z.ZodType<StructuredNode> = z.lazy(() =>
  z.object({
    id,
    type: structuredNodeTypeSchema,
    name: z.string().max(1000),
    parentId: z.string().nullable(),
    children: z.array(structuredNodeSchema),
    bounds: z.object({ x: finite, y: finite, width: finite.min(0), height: finite.min(0) }),
    layout: structuredLayoutSchema,
    appearance: structuredAppearanceSchema,
    typography: structuredTypographySchema.optional(),
    source: structuredSourceSchema,
    tokenBindings: structuredTokenBindingsSchema,
    componentBinding: structuredComponentBindingSchema.optional(),
    designProposal:z.object({kind:z.enum(['new','variant']),reason:z.string().min(24).max(2000),componentId:z.string().max(100).optional()}).optional(),
    constraints: structuredConstraintsSchema,
    visibility: z.boolean(),
    locked: z.boolean(),
    captureConfidence: structuredCaptureConfidenceSchema.optional(),
  }),
)

const structuredCaptureMetadataSchema = z.object({
  capturedAt: z.string(),
  engine: z.enum(['domSnapshot', 'design']),
  structuredNodeCount: finite.min(0),
  durationMs: finite.min(0),
  visualMatch: z.object({ diffPixels: finite.min(0), totalPixels: finite.min(0), diffPercent: finite.min(0) }).optional(),
})

// Mirrors @core/visual/schema.ts's `fonts` validator for `VisualPage` field-for-field.
const structuredFontSchema = z.object({
  family: z.string(),
  weight: z.string(),
  style: z.string(),
            unicodeRange: z.string().optional(),
            stretch: z.string().optional(),
  data: z.string().startsWith('data:'),
})

export const structuredFrameSchema: z.ZodType<StructuredFrame> = z.object({
  id,
  name: z.string().max(1000),
  viewport: z.string(),
  sourceRoute: z.string(),
  sourceState: z.string().optional(),
  width: finite.positive(),
  height: finite.positive(),
  children: z.array(structuredNodeSchema),
  captureMetadata: structuredCaptureMetadataSchema,
  fonts: z.array(structuredFontSchema).optional(),
})
