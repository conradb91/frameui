import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {gzipSync,gunzipSync} from 'node:zlib'
import {packDocument,unpackDocument,type ResourceDocument} from '@shared/documentResources'

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
    if (parsed.schemaVersion !== schemaVersion && !(schemaVersion===1&&parsed.schemaVersion===2&&path.basename(path.dirname(filePath))==='design-files')) {
      // Version 2 is reserved for self-contained compressed design resources.
      // Other workspace envelopes retain their original schema contract.
      return fallback
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'data')) return fallback
    if (Array.isArray(fallback) && !Array.isArray(parsed.data)) return fallback
    if (parsed.data === null && fallback !== null) return fallback
    const data=parsed.data as unknown as ResourceDocument & {compression?:string;model?:string}
    if(data?.encoding==='frameui-resources-1'){
      const resources=data.compression==='gzip'||data.compression==='gzip-json'?data.resources.map(value=>{const text=gunzipSync(Buffer.from(value,'base64')).toString('utf8');return data.compression==='gzip-json'?JSON.parse(text):text}):data.resources
      return unpackDocument<T>({...data,resources,value:data.model?JSON.parse(gunzipSync(Buffer.from(data.model,'base64')).toString('utf8')):data.value})
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
  // Design files stay self-contained and lossless. Older plain envelopes still load.
  let stored:unknown=data
  if(path.basename(path.dirname(filePath))==='design-files'){
    const packed=packDocument(data)
    stored={...packed,value:undefined,model:gzipSync(JSON.stringify(packed.value),{level:1}).toString('base64'),compression:'gzip-json',resources:packed.resources.map(value=>gzipSync(JSON.stringify(value),{level:1}).toString('base64'))}
  }
  const envelope = { schemaVersion:path.basename(path.dirname(filePath))==='design-files'?2:schemaVersion, data:stored }
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`)
  fs.writeFileSync(tmpPath, JSON.stringify(envelope), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}
