import { z } from 'zod'

// Same reasoning as workspace.schema.ts's idSchema: projectId ends up in
// getCapturesFile(userDataPath, projectId) -> path.join, so it must be a
// UUID, not just a non-empty string, to rule out path traversal.
const idSchema = z.string().uuid()

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})

// A bounded map rather than a fixed set of fields — the renderer's own
// STYLE_PROPERTIES allowlist (captureScript.ts) can grow without another
// schema change, but the key/value counts and lengths are still capped
// here rather than trusted, same reasoning as every other bound below.
function boundedRecord(maxKeys: number, maxKeyLength: number, maxValueLength: number) {
  return z
    .record(z.string().max(maxKeyLength), z.string().max(maxValueLength))
    .refine((value) => Object.keys(value).length <= maxKeys, { message: `must have at most ${maxKeys} keys` })
}

const stylesSchema = boundedRecord(40, 50, 300)
const ariaSchema = boundedRecord(30, 50, 300)

// The renderer's own capture script already bounds node count/depth/text
// length (captureScript.ts), but that's a best-effort in-page script
// running against a project's own live DOM, not this app's code — this
// schema is the authoritative boundary, so every bound is re-enforced here
// rather than trusted from the caller.
export const capturedElementSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    tag: z.string().min(1).max(50),
    id: z.string().max(200).optional(),
    classes: z.string().max(2000).optional(),
    attributes: boundedRecord(20, 50, 4000).optional(),
    textPreview: z.string().max(200).optional(),
    rect: rectSchema,
    styles: stylesSchema,
    aria: ariaSchema.optional(),
    componentHint: z.string().max(200).optional(),
    children: z.array(capturedElementSchema).max(1000),
  }),
)

export const capturedPageSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  url: z.string().max(2000),
  capturedAt: z.string(),
  root: capturedElementSchema,
  screenshotFileName: z.string().max(300).optional(),
})

export const listCapturesInputSchema = idSchema

export const saveScreenshotInputSchema = z.object({
  projectId: idSchema,
  captureId: idSchema,
  // A screenshot of the guest project's own rendered page, not arbitrary
  // user input — still capped rather than trusted, per this codebase's
  // standing IPC-boundary-validates-everything convention.
  base64: z.string().min(1).max(20_000_000),
})

// Same path-traversal reasoning as idSchema above — both ids get joined
// into a file path in getCaptureScreenshotsDir.
export const getScreenshotDataUrlInputSchema = z.object({
  projectId: idSchema,
  captureId: idSchema,
})
