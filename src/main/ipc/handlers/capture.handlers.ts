import electron from 'electron'
import type { CapturedPage } from '@shared/types/runtimeCapture'
import * as captureStore from '@core/workspace/models/captureStore'
import { capturedPageSchema, listCapturesInputSchema, saveScreenshotInputSchema, getScreenshotDataUrlInputSchema } from '../schemas/capture.schema'

const { app, ipcMain } = electron

export function registerCaptureHandlers(): void {
  ipcMain.handle('capture:save', (_event, raw): CapturedPage => {
    const capture = capturedPageSchema.parse(raw) as CapturedPage
    return captureStore.saveCapture(app.getPath('userData'), capture)
  })

  ipcMain.handle('capture:list', (_event, rawProjectId): CapturedPage[] => {
    const projectId = listCapturesInputSchema.parse(rawProjectId)
    return captureStore.listCaptures(app.getPath('userData'), projectId)
  })

  ipcMain.handle('capture:saveScreenshot', (_event, raw): { ok: true } => {
    const { projectId, captureId, base64 } = saveScreenshotInputSchema.parse(raw)
    captureStore.saveCaptureScreenshot(app.getPath('userData'), projectId, captureId, base64)
    return { ok: true }
  })

  ipcMain.handle('capture:getScreenshotDataUrl', (_event, raw): string | null => {
    const { projectId, captureId } = getScreenshotDataUrlInputSchema.parse(raw)
    return captureStore.getCaptureScreenshotDataUrl(app.getPath('userData'), projectId, captureId)
  })
}
