import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

interface Envelope<T> {
  schemaVersion: number
  data: T
}

/**
 * Reads a workspace JSON file written by writeJsonFileAtomic. Missing file,
 * unreadable JSON, or a schema version this build doesn't understand all
 * fall back to `fallback` rather than throwing — workspace data is
 * recoverable/regenerable, never worth crashing the app over.
 */
export function readJsonFile<T>(filePath: string, fallback: T, schemaVersion = 1): T {
  if (!fs.existsSync(filePath)) return fallback
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Envelope<T>
    if (parsed.schemaVersion !== schemaVersion) {
      // No migrations exist yet (schemaVersion 1 is the only one). A future
      // phase adds a migrations/ step here keyed by parsed.schemaVersion.
      return fallback
    }
    return parsed.data
  } catch {
    return fallback
  }
}

/**
 * Writes via a temp file + rename so a crash or concurrent read never sees a
 * half-written file — the rename is atomic on the same filesystem.
 */
export function writeJsonFileAtomic<T>(filePath: string, data: T, schemaVersion = 1): void {
  const envelope: Envelope<T> = { schemaVersion, data }
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`)
  fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}
