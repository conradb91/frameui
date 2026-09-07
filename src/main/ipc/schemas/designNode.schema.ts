import { z } from 'zod'

const editabilitySchema = z.enum(['editable', 'limited', 'locked'])
const responsiveHiddenSchema = z
  .object({ tablet: z.boolean().optional(), mobile: z.boolean().optional() })
  .partial()
  .optional()

const baseFields = {
  id: z.string().min(1),
  editability: editabilitySchema,
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  responsiveHidden: responsiveHiddenSchema,
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
    }),
  ]),
)
