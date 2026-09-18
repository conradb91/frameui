import { z } from 'zod'

const editabilitySchema = z.enum(['editable', 'limited', 'locked'])
const responsiveHiddenSchema = z
  .object({ tablet: z.boolean().optional(), mobile: z.boolean().optional() })
  .partial()
  .optional()

const sourceReferenceSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().optional(),
  route: z.string().optional(),
})

const provenanceSchema = z.enum(['existing', 'existing-modified', 'new', 'reference-only']).optional()
const gridPlacementSchema = z
  .object({
    columnStart: z.number().int().min(1).max(200).optional(),
    columnSpan: z.number().int().min(1).max(200).optional(),
    rowStart: z.number().int().min(1).max(200).optional(),
    rowSpan: z.number().int().min(1).max(200).optional(),
  })
  .optional()

const sizeSchema = z.union([z.number(), z.literal('auto'), z.literal('fill')])
const nodeStyleSchema = z
  .object({
    position: z.enum(['relative', 'absolute']).optional(),
    left: z.number().optional(),
    top: z.number().optional(),
    width: sizeSchema.optional(),
    height: sizeSchema.optional(),
    minWidth: z.number().optional(),
    maxWidth: z.number().optional(),
    padding: z.number().min(0).max(512).optional(),
    paddingTop: z.number().min(0).max(512).optional(),
    paddingRight: z.number().min(0).max(512).optional(),
    paddingBottom: z.number().min(0).max(512).optional(),
    paddingLeft: z.number().min(0).max(512).optional(),
    backgroundColor: z.string().max(64).optional(),
    borderColor: z.string().max(64).optional(),
    borderWidth: z.number().min(0).max(64).optional(),
    borderRadius: z.number().min(0).max(256).optional(),
    boxShadow: z.string().max(300).optional(),
    opacity: z.number().min(0).max(1).optional(),
    fontFamily: z.string().max(200).optional(),
    fontSize: z.number().min(0).max(400).optional(),
    fontWeight: z.number().min(1).max(1000).optional(),
    lineHeight: z.number().min(0).max(400).optional(),
    letterSpacing: z.number().min(-20).max(100).optional(),
    color: z.string().max(64).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
  })
  .optional()

const responsiveOverrideSchema = z.object({
  style: nodeStyleSchema,
  gap: z.number().min(0).max(256).optional(),
  direction: z.enum(['row', 'column']).optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  justify: z.enum(['start', 'center', 'end', 'space-between']).optional(),
  wrap: z.boolean().optional(),
  columns: z.number().int().min(1).max(24).optional(),
  columnGap: z.number().min(0).max(256).optional(),
  rowGap: z.number().min(0).max(256).optional(),
})
const responsiveOverridesSchema = z
  .object({ tablet: responsiveOverrideSchema.optional(), mobile: responsiveOverrideSchema.optional() })
  .partial()
  .optional()

const baseFields = {
  id: z.string().min(1),
  editability: editabilitySchema,
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  responsiveHidden: responsiveHiddenSchema,
  provenance: provenanceSchema,
  gridPlacement: gridPlacementSchema,
  style: nodeStyleSchema,
  responsiveOverrides: responsiveOverridesSchema,
  layoutIntent: z.object({ positioning: z.enum(['flow', 'absolute', 'free']).optional(), widthMode: z.enum(['fixed', 'content', 'fill']).optional(), heightMode: z.enum(['fixed', 'content', 'fill']).optional(), horizontalConstraint: z.enum(['start', 'center', 'end', 'stretch', 'scale']).optional(), verticalConstraint: z.enum(['start', 'center', 'end', 'stretch', 'scale']).optional() }).optional(),
  componentDefinitionId: z.string().max(300).optional(),
  componentInstanceProperties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  tokenBindings: z.record(z.string(), z.string()).optional(),
}

// Recursive discriminated-union schema for DesignNode — z.lazy() is
// required since each node's `children` is itself DesignNode[].
export const designNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      ...baseFields,
      kind: z.literal('stack'),
      children: z.array(designNodeSchema),
      direction: z.enum(['row', 'column']),
      gap: z.number().min(0).max(256),
      align: z.enum(['start', 'center', 'end', 'stretch']),
      wrap: z.boolean().optional(),
      justify: z.enum(['start', 'center', 'end', 'space-between']).optional(),
    }),
    z.object({
      ...baseFields,
      kind: z.enum(['text', 'heading']),
      children: z.array(designNodeSchema),
      content: z.string().max(5000),
    }),
    z.object({
      ...baseFields,
      kind: z.literal('button'),
      children: z.array(designNodeSchema),
      label: z.string().max(200),
      variant: z.enum(['primary', 'secondary']),
    }),
    z.object({
      ...baseFields,
      kind: z.literal('container'),
      children: z.array(designNodeSchema),
    }),
    z.object({
      ...baseFields,
      kind: z.literal('divider'),
      children: z.array(designNodeSchema),
    }),
    z.object({
      ...baseFields,
      kind: z.literal('image'),
      children: z.array(designNodeSchema),
      alt: z.string().max(300),
      src: z.string().max(15_000_000).optional(),
      objectFit: z.enum(['cover', 'contain', 'fill']).optional(),
      vector: z.object({ viewBox: z.string().max(100), paths: z.array(z.object({ id: z.string().max(300), d: z.string().max(100000), fill: z.string().max(64).optional(), stroke: z.string().max(64).optional(), opacity: z.number().min(0).max(1).optional() })).max(1000) }).optional(),
    }),
    z.object({
      ...baseFields,
      kind: z.literal('placeholder'),
      children: z.array(designNodeSchema),
      label: z.string().max(300),
      sourceFilePath: z.string().optional(),
      sourceLine: z.number().optional(),
      sourceReference: sourceReferenceSchema.optional(),
      attributes: z.record(z.string(), z.string()).optional(),
      textPreview: z.string().optional(),
    }),
    z.object({
      ...baseFields,
      kind: z.literal('grid'),
      children: z.array(designNodeSchema),
      columns: z.number().int().min(1).max(24),
      rows: z.union([z.number().int().min(1).max(200), z.literal('auto')]).optional(),
      columnGap: z.number().min(0).max(256),
      rowGap: z.number().min(0).max(256),
    }),
    z.object({
      ...baseFields,
      kind: z.literal('concept'),
      children: z.array(designNodeSchema),
      conceptComponentId: z.string().min(1),
      variantId: z.string().nullable(),
      propertyValues: z.record(z.string(), z.string()),
    }),
  ]),
)
