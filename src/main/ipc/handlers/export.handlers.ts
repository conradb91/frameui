import electron from 'electron'
import fs from 'node:fs'
import { z } from 'zod'

const { ipcMain, dialog, BrowserWindow } = electron

const saveSvgSchema = z.object({ svg: z.string().min(1), suggestedName: z.string().min(1) })
const savePngSchema = z.object({ base64: z.string().min(1), suggestedName: z.string().min(1) })
const savePdfSchema = z.object({ html: z.string().min(1), suggestedName: z.string().min(1) })

async function pickSavePath(defaultName: string, extensionLabel: string, extension: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = win
    ? await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: extensionLabel, extensions: [extension] }] })
    : await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: extensionLabel, extensions: [extension] }] })
  return result.canceled || !result.filePath ? null : result.filePath
}

export function registerExportHandlers(): void {
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
