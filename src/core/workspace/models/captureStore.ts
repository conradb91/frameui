import fs from 'node:fs'
import path from 'node:path'
import type { CapturedPage } from '@shared/types/runtimeCapture'
import { getCapturesFile, getCaptureScreenshotsDir } from '../paths'
import { readJsonFile, writeJsonFileAtomic } from '../atomicJson'

function readAll(userDataPath: string, projectId: string): CapturedPage[] {
  return readJsonFile<CapturedPage[]>(getCapturesFile(userDataPath, projectId), [])
}

export function listCaptures(userDataPath: string, projectId: string): CapturedPage[] {
  return readAll(userDataPath, projectId)
}

export function getCapture(userDataPath: string, projectId: string, captureId: string): CapturedPage | null {
  return readAll(userDataPath, projectId).find((c) => c.id === captureId) ?? null
}

export function saveCapture(userDataPath: string, capture: CapturedPage): CapturedPage {
  const captures = readAll(userDataPath, capture.projectId)
  const index = captures.findIndex((c) => c.id === capture.id)
  if (index === -1) captures.push(capture)
  else captures[index] = capture
  writeJsonFileAtomic(getCapturesFile(userDataPath, capture.projectId), captures)
  return capture
}

export function saveCaptureScreenshot(userDataPath: string, projectId: string, captureId: string, base64: string): void {
  const filePath = path.join(getCaptureScreenshotsDir(userDataPath, projectId), `${captureId}.png`)
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
}

export function getCaptureScreenshotDataUrl(userDataPath: string, projectId: string, captureId: string): string | null {
  const filePath = path.join(getCaptureScreenshotsDir(userDataPath, projectId), `${captureId}.png`)
  if (!fs.existsSync(filePath)) return null
  return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`
}
