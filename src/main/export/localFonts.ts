import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
export interface ExportFontFace {
  family: string
  style: string
  postscript: string
}
let cached: Promise<ExportFontFace[]> | undefined
export function localExportFonts(): Promise<ExportFontFace[]> {
  return (cached ??= (async () => {
    if (process.platform !== 'darwin') return []
    try {
      const { stdout } = await promisify(execFile)(
        '/usr/sbin/system_profiler',
        ['SPFontsDataType', '-json'],
        { timeout: 30000, maxBuffer: 20_000_000 },
      )
      const data = JSON.parse(stdout) as {
        SPFontsDataType: {
          typefaces?: {
            family: string
            style: string
            _name: string
            enabled?: string
            valid?: string
          }[]
        }[]
      }
      return data.SPFontsDataType.flatMap((f) =>
        (f.typefaces ?? [])
          .filter((t) => t.enabled !== 'no' && t.valid !== 'no')
          .map((t) => ({ family: t.family, style: t.style, postscript: t._name })),
      )
    } catch {
      return []
    }
  })())
}
