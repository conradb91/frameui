import { z } from 'zod'
export const textGradientSchema = z.object({
  image: z.string().max(30_000_000),
  size: z.string().optional(),
  position: z.string().optional(),
  repeat: z.string().optional(),
  clone: z.boolean().optional(),
  fragments: z
    .array(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite(),
        height: z.number().finite(),
        offset: z.number().finite(),
      }),
    )
    .optional(),
  bounds: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite(),
      height: z.number().finite(),
    })
    .optional(),
})
export const textStyleRunSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    fontWeight: z.string().max(40).optional(),
    color: z.string().max(200).optional(),
    fontStyle: z.string().optional(),
    fontFamily: z.string().optional(),
    fontSize: z.number().finite().optional(),
    lineHeight: z.number().finite().optional(),
    letterSpacing: z.number().finite().optional(),
    textDecoration: z.string().optional(),
    gradient: textGradientSchema.optional(),
  })
  .refine((run) => run.end > run.start, 'Text run must have a positive range.')
