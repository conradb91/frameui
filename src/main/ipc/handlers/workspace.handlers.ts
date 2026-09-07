import electron from 'electron'
import type { RecentProject } from '@shared/types/project'
import type { Flow, FlowSummary } from '@shared/types/flow'
import type { ScreenDraft } from '@shared/types/screenDraft'
import type { DesignNode } from '@shared/types/designNode'
import { listRecentProjects } from '@core/workspace/models/recentProjectsStore'
import * as flowStore from '@core/workspace/models/flowStore'
import * as screenDraftStore from '@core/workspace/models/screenDraftStore'
import {
  projectIdSchema,
  createFlowInputSchema,
  getFlowInputSchema,
  saveFlowInputSchema,
  deleteFlowInputSchema,
  getScreenDraftInputSchema,
  saveScreenDraftInputSchema,
} from '../schemas/workspace.schema'

const { app, ipcMain } = electron

export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspace:listRecentProjects', (): RecentProject[] => {
    return listRecentProjects(app.getPath('userData'))
  })

  ipcMain.handle('workspace:listFlows', (_event, rawProjectId): FlowSummary[] => {
    const projectId = projectIdSchema.parse(rawProjectId)
    return flowStore.listFlows(app.getPath('userData'), projectId)
  })

  ipcMain.handle('workspace:createFlow', (_event, raw): Flow => {
    const { projectId, name, description } = createFlowInputSchema.parse(raw)
    return flowStore.createFlow(app.getPath('userData'), projectId, name, description)
  })

  ipcMain.handle('workspace:getFlow', (_event, raw): Flow | null => {
    const { projectId, flowId } = getFlowInputSchema.parse(raw)
    return flowStore.getFlow(app.getPath('userData'), projectId, flowId)
  })

  ipcMain.handle('workspace:saveFlow', (_event, raw): Flow => {
    const flow = saveFlowInputSchema.parse(raw)
    return flowStore.saveFlow(app.getPath('userData'), flow)
  })

  ipcMain.handle('workspace:deleteFlow', (_event, raw): { ok: true } => {
    const { projectId, flowId } = deleteFlowInputSchema.parse(raw)
    flowStore.deleteFlow(app.getPath('userData'), projectId, flowId)
    return { ok: true }
  })

  ipcMain.handle('workspace:getScreenDraft', (_event, raw): ScreenDraft | null => {
    const { projectId, screenId } = getScreenDraftInputSchema.parse(raw)
    return screenDraftStore.getScreenDraft(app.getPath('userData'), projectId, screenId)
  })

  ipcMain.handle('workspace:saveScreenDraft', (_event, raw): ScreenDraft => {
    const draft = saveScreenDraftInputSchema.parse(raw) as { id: string; projectId: string; flowId: string; tree: DesignNode; updatedAt: string }
    return screenDraftStore.saveScreenDraft(app.getPath('userData'), draft)
  })
}
