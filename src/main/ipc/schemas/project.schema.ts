import { z } from 'zod'

export const openDialogInputSchema = z.string().optional()

export const openPathInputSchema = z.string().min(1)

export const getPageStructureInputSchema = z.string().min(1)
