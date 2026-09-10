import { z } from 'zod'

export const openDialogInputSchema = z.string().optional()

export const openPathInputSchema = z.string().min(1)

export const getPageStructureInputSchema = z.string().min(1)
export const selectApplicationInputSchema = z.string().min(1).max(500)
export const projectIdInputSchema = z.string().min(1).max(500)
export const deleteProjectFromDiskInputSchema = z.object({ projectId: projectIdInputSchema, confirmationName: z.string().max(500) })
