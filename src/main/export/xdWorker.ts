import {unpackDocument} from '../../shared/documentResources'
import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs/promises'
import { localExportFonts } from './localFonts'
import { buildXdDocument, validateXdArchive } from '../../core/export/xdDocument'
import { createStoredZip } from './storedZip'
import type {XdRenderedFontFace} from '../../core/export/xdFonts'
import type { XdExportRequest } from '../../shared/types/xdExport'
const { request:packedRequest, tempPath, renderedFonts, renderedImages, renderedLines } = workerData as {
  request: unknown
  tempPath: string
  renderedLines?:import('./renderedText').ExportTextLines
  renderedImages?:import('../../core/export/xdImages').XdRenderedImageEffect[]
  renderedFonts?:XdRenderedFontFace[]
}
const request=unpackDocument<XdExportRequest>(packedRequest)
async function run() {
  try {
    parentPort?.postMessage({stage:'Checking local font references',percentage:55})
    const fonts = await localExportFonts()
    const { entries, report } = buildXdDocument(
      request,
      (stage) => {const match=/Serializing artboard (\d+) of (\d+)/.exec(stage);parentPort?.postMessage({stage:match?`Preparing screen ${match[1]} of ${match[2]}`:stage,percentage:match?60+25*Number(match[1])/Math.max(1,Number(match[2])):60})},
      fonts,
      renderedFonts,
      renderedImages,
      renderedLines,
    )
    parentPort?.postMessage({stage:'Packaging XD document',percentage:87})
    const archive = createStoredZip(entries)
    parentPort?.postMessage({stage:'Checking XD document',percentage:91})
    validateXdArchive(archive)
    const file=await fs.open(tempPath,'wx')
    try{let written=0;while(written<archive.length){const result=await file.write(archive,written,Math.min(4*1024*1024,archive.length-written),written);if(!result.bytesWritten)throw new Error('XD save stopped before all bytes were written.');written+=result.bytesWritten;parentPort?.postMessage({stage:'Saving XD file',percentage:94+4*written/archive.length})}await file.sync()}finally{await file.close()}
    parentPort?.postMessage({stage:'Verifying saved file',percentage:99})
    validateXdArchive(await fs.readFile(tempPath))
    parentPort?.postMessage({ report })
  } catch (error) {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
void run()
