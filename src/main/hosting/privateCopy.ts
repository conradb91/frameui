import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const ignored = new Set(['.git', '.frameui', 'node_modules', 'vendor', 'obj', '.frameui-copy.json'])
const localSettings = (file: string) => /(^|\/)(?:\.env(?:\..*)?|appsettings(?:\.[^/]*)?\.json|\.frameui.*)$/.test(file)
interface CopyManifest { source: string; files?: Record<string, string> }
async function sourceFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  let count = 0
  async function visit(directory: string, ancestors = new Set<string>()) {
    const real = await fs.realpath(directory)
    if ((real !== root && !real.startsWith(root + path.sep)) || ancestors.has(real)) return
    const visited = new Set(ancestors); visited.add(real)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.startsWith('.frameui-')) continue
      if (++count > 100000) throw new Error('This project contains too many files for a local copy.')
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(file, visited)
      else {
        const realFile = await fs.realpath(file).catch(() => null)
        if (!realFile?.startsWith(root + path.sep)) continue
        const stat = await fs.stat(file)
        if (stat.isDirectory()) await visit(file, visited)
        else if (stat.isFile()) files[path.relative(root, file)] = `${stat.size}:${stat.mtimeMs}`
      }
    }
  }
  await visit(root)
  return files
}
function copyTarget(storage: string, projectId: string) {
  return path.join(storage, 'local-applications', crypto.createHash('sha256').update(projectId).digest('hex'), 'project')
}
async function privateParent(target: string, destination: string, create: boolean): Promise<boolean> {
  const relative = path.relative(target, path.dirname(destination))
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('The local copy contains an invalid file path.')
  let directory = target
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    directory = part ? path.join(directory, part) : directory
    let stat = await fs.lstat(directory).catch(() => null)
    if (!stat) {
      if (!create) return false
      await fs.mkdir(directory); stat = await fs.lstat(directory)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('The local copy contains an unsafe parent folder.')
  }
  return true
}
/** Source changes flow into the private copy; local settings and generated data stay private. */
export async function privateProjectCopy(source: string, storage: string, projectId: string): Promise<string> {
  source = await fs.realpath(source)
  const target = copyTarget(storage, projectId)
  const parent = path.dirname(target)
  const marker = path.join(target, '.frameui-copy.json')
  const saved = await fs.readFile(marker, 'utf8').then(text => JSON.parse(text) as CopyManifest).catch(() => null)
  const files = await sourceFiles(source)
  if (saved?.source === source) {
    for (const [file, signature] of Object.entries(files)) {
      if (signature === saved.files?.[file] || localSettings(file.split(path.sep).join('/'))) continue
      const destination = path.join(target, file)
      await privateParent(target, destination, true)
      if ((await fs.lstat(destination).catch(() => null))?.isSymbolicLink()) await fs.unlink(destination)
      await fs.copyFile(path.join(source, file), destination)
    }
    for (const file of Object.keys(saved.files ?? {})) if (!(file in files) && !localSettings(file.split(path.sep).join('/'))) {
      const destination = path.resolve(target, file)
      if (destination.startsWith(path.resolve(target) + path.sep) && await privateParent(target, destination, false)) await fs.rm(destination, { force: true })
    }
    const temporary = `${marker}.writing`
    await fs.writeFile(temporary, JSON.stringify({ source, files }), { mode: 0o600 }); await fs.rename(temporary, marker)
    return target
  }
  await fs.mkdir(parent, { recursive: true })
  const staging = path.join(parent, `copy-${crypto.randomUUID()}`)
  try {
    await fs.mkdir(staging)
    for (const file of Object.keys(files)) { const destination = path.join(staging, file); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.copyFile(path.join(source, file), destination) }
    await fs.writeFile(path.join(staging, '.frameui-copy.json'), JSON.stringify({ source, files }), { mode: 0o600 })
    if (await fs.stat(target).then(() => true).catch(() => false)) await fs.rename(target, `${target}.recovered-${Date.now()}`)
    await fs.rename(staging, target)
    return target
  } finally { await fs.rm(staging, { recursive: true, force: true }) }
}
export async function existingPrivateProjectCopy(source: string, storage: string, projectId: string): Promise<string | null> {
  const target = copyTarget(storage, projectId)
  const marker = await fs.readFile(path.join(target, '.frameui-copy.json'), 'utf8').then(text => JSON.parse(text) as CopyManifest).catch(() => null)
  return marker?.source === await fs.realpath(source) ? target : null
}
