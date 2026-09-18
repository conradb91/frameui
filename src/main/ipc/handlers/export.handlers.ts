import electron from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { createStoredZip } from '../../export/storedZip'

const { ipcMain, dialog, BrowserWindow, shell, app } = electron
const savedExportPaths = new Set<string>()

const saveSvgSchema = z.object({ svg: z.string().min(1), suggestedName: z.string().min(1) })
const savePngSchema = z.object({ base64: z.string().min(1), suggestedName: z.string().min(1) })
const savePdfSchema = z.object({ html: z.string().min(1), suggestedName: z.string().min(1) })
const savePackageSchema = z.object({ suggestedFolder: z.string().min(1).max(120), files: z.array(z.object({ path: z.string().min(1).max(500), content: z.string(), mimeType: z.enum(['image/svg+xml', 'application/json']) })).min(1).max(1000) })
const saveFrameUiSchema = z.object({
  suggestedName: z.string().min(1).max(160),
  files: z.array(z.object({
    path: z.string().min(1).max(500),
    content: z.string().max(100_000_000),
    encoding: z.enum(['utf8', 'base64']),
  })).min(7).max(5000),
})

function safeArchivePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.includes('\0')) throw new Error(`Unsafe export path: ${value}`)
  return normalized
}

async function pickSavePath(defaultName: string, extensionLabel: string, extension: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = win
    ? await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: extensionLabel, extensions: [extension] }] })
    : await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: extensionLabel, extensions: [extension] }] })
  return result.canceled || !result.filePath ? null : result.filePath
}

export function registerExportHandlers(): void {
  ipcMain.handle('export:saveFrameUiPackage', async (_event, raw): Promise<{ ok: boolean; filePath?: string; byteLength?: number; error?: string }> => {
    const { files, suggestedName } = saveFrameUiSchema.parse(raw)
    const filePath = await pickSavePath(suggestedName.replace(/\.frameui$/i, '') + '.frameui', 'FrameUI Design Package', 'frameui')
    if (!filePath) return { ok: false }
    try {
      const seen = new Set<string>()
      const entries = files.map((file) => {
        const entryPath = safeArchivePath(file.path)
        if (seen.has(entryPath)) throw new Error(`Duplicate export path: ${entryPath}`)
        seen.add(entryPath)
        return { path: entryPath, data: Buffer.from(file.content, file.encoding) }
      })
      for (const required of ['manifest.json', 'document.json', 'components.json', 'tokens.json', 'interactions.json', 'assets.json', 'fonts.json']) {
        if (!seen.has(required)) throw new Error(`The package is missing ${required}.`)
      }
      const archive = createStoredZip(entries)
      fs.writeFileSync(filePath, archive)
      savedExportPaths.add(path.resolve(filePath))
      return { ok: true, filePath, byteLength: archive.length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('export:revealSaved', (_event, raw): { ok: boolean } => {
    const filePath = z.string().min(1).max(2000).parse(raw)
    const resolved = path.resolve(filePath)
    if (!savedExportPaths.has(resolved) || !fs.existsSync(resolved)) return { ok: false }
    shell.showItemInFolder(resolved)
    return { ok: true }
  })
  ipcMain.handle('export:revealFigmaImporter', (): { ok: boolean } => {
    const manifestPath = app.isPackaged
      ? path.join(process.resourcesPath, 'frameui-figma-importer', 'manifest.json')
      : path.resolve('integrations/figma-importer/manifest.json')
    if (!fs.existsSync(manifestPath)) return { ok: false }
    shell.showItemInFolder(manifestPath)
    return { ok: true }
  })
  ipcMain.handle('export:savePackage', async (_event, raw): Promise<{ ok: boolean; directoryPath?: string; fileCount?: number; error?: string }> => {
    const { files, suggestedFolder } = savePackageSchema.parse(raw)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = { title: 'Export FrameUI Feature', buttonLabel: 'Export here', properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const selected = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (selected.canceled || !selected.filePaths[0]) return { ok: false }
    const safeFolder = suggestedFolder.replace(/[^a-zA-Z0-9._ -]/g, '-').slice(0, 120) || 'FrameUI Export'
    const baseRoot = path.resolve(selected.filePaths[0], safeFolder)
    let root = baseRoot
    let suffix = 2
    while (fs.existsSync(root)) root = `${baseRoot} ${suffix++}`
    try {
      for (const file of files) {
        const relative = file.path.replace(/\\/g, '/')
        if (relative.startsWith('/') || relative.split('/').includes('..')) throw new Error(`Unsafe export path: ${file.path}`)
        const target = path.resolve(root, relative)
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Export path escaped package: ${file.path}`)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, file.content, 'utf8')
      }
      return { ok: true, directoryPath: root, fileCount: files.length }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('export:saveSvg', async (_event, raw): Promise<{ ok: boolean; filePath?: string }> => {
    const { svg, suggestedName } = saveSvgSchema.parse(raw)
    const filePath = await pickSavePath(suggestedName, 'SVG Image', 'svg')
    if (!filePath) return { ok: false }
    fs.writeFileSync(filePath, svg, 'utf-8')
    return { ok: true, filePath }
  })

  ipcMain.handle('export:savePng', async (_event, raw): Promise<{ ok: boolean; filePath?: string }> => {
    const { base64, suggestedName } = savePngSchema.parse(raw)
    const filePath = await pickSavePath(suggestedName, 'PNG Image', 'png')
    if (!filePath) return { ok: false }
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
    return { ok: true, filePath }
  })

  ipcMain.handle('export:generateReviewPdf', async (_event, raw): Promise<{ ok: boolean; filePath?: string; error?: string }> => {
    const { html, suggestedName } = savePdfSchema.parse(raw)

    const renderWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    })

    try {
      await renderWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdfBuffer = await renderWin.webContents.printToPDF({
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
      })

      const filePath = await pickSavePath(suggestedName, 'PDF Document', 'pdf')
      if (!filePath) return { ok: false }
      fs.writeFileSync(filePath, pdfBuffer)
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      renderWin.destroy()
    }
  })
}
