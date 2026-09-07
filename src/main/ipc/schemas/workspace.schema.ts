import { z } from 'zod'
import { designNodeSchema } from './designNode.schema'

// projectId/flowId/screenId are always crypto.randomUUID() values
// server-side, but they arrive back from the (untrusted) renderer on every
// workspace call and get used to build filenames (getFlowsFile,
// getScreenDraftsFile) — .uuid() isn't just validation here, it's what
// rules out a path-traversal id like "../../../../etc/passwd" ever
// reaching path.join (confirmed while auditing this: a bare .min(1)
// string would have let that through).
const idSchema = z.string().uuid()

export const projectIdSchema = idSchema

export const createFlowInputSchema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
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
