import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import { localExportFonts } from './localFonts'
import { buildSketchProject } from '@core/export/sketchProject'
import { createStoredZip } from './storedZip'
async function run() {
  try {
    parentPort!.postMessage({ stage: 'Checking local font references' })
    const fonts = await localExportFonts()
    const built = buildSketchProject(
      workerData.request,
      (stage) => parentPort!.postMessage({ stage }),
      fonts,
    )
    parentPort!.postMessage({ stage: 'Writing validated Sketch document' })
    const archive = createStoredZip(built.entries)
    fs.writeFileSync(workerData.tempPath, archive, { flag: 'wx' })
    parentPort!.postMessage({ report: built.report })
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
void run()
