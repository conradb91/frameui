import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs/promises'
import { localExportFonts } from './localFonts'
import { buildXdDocument, validateXdArchive } from '../../core/export/xdDocument'
import { createStoredZip } from './storedZip'
import type {XdRenderedFontFace} from '../../core/export/xdFonts'
import type { XdExportRequest } from '../../shared/types/xdExport'
const { request, tempPath, renderedFonts, renderedImages } = workerData as {
  request: XdExportRequest
  tempPath: string
  renderedImages?:import('../../core/export/xdImages').XdRenderedImageEffect[]
  renderedFonts?:XdRenderedFontFace[]
}
async function run() {
  try {
    parentPort?.postMessage({stage:'Checking local font references'})
    const fonts = await localExportFonts()
    const { entries, report } = buildXdDocument(
      request,
      (stage) => parentPort?.postMessage({ stage }),
      fonts,
      renderedFonts,
      renderedImages,
    )
    const archive = createStoredZip(entries)
    validateXdArchive(archive)
    await fs.writeFile(tempPath, archive, { flag: 'wx' })
    validateXdArchive(await fs.readFile(tempPath))
    parentPort?.postMessage({ report })
  } catch (error) {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
void run()
