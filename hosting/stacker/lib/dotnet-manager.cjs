const fs = require('node:fs/promises')
const fssync = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { downloadVerified, extractArchive } = require('./verified-archive.cjs')
const METADATA = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata'
function probe(binary) {
  try { return execFileSync(binary, ['--version'], { timeout: 10000, encoding: 'utf8', env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' } }).trim() } catch { return null }
}
function matchesSdk(version, required) {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(required)) return false
  return required.split('.').length === 3 ? version === required : version.startsWith(required + '.')
}
class DotnetManager {
  constructor(root, emit) { this.root = root; this.emit = emit; this.releases = new Map() }
  cachedPath(project) {
    const root = path.join(this.root, 'dotnet', process.platform, process.arch)
    const required = project.runtime?.constraint || '8.0'
    const versions = fssync.existsSync(root) ? fssync.readdirSync(root).filter(v => matchesSdk(v, required)).sort((a,b) => b.localeCompare(a, undefined, { numeric: true })) : []
    for (const version of versions) { const dir = path.join(root, version); if (probe(path.join(dir, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet')) === version) return dir }
    for (const dir of [...require('./runtime-platform.cjs').executableEnvironment().PATH.split(path.delimiter), '/usr/local/share/dotnet', '/usr/share/dotnet']) {
      const version = probe(path.join(dir, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'))
      if (version && matchesSdk(version, required)) return dir
    }
    return null
  }
  async catalog(project) {
    const channel = (project.runtime?.constraint || '8.0').split('.').slice(0, 2).join('.')
    if (!/^\d+\.\d+$/.test(channel)) throw new Error('Invalid .NET SDK requirement.')
    const response = await fetch(`${METADATA}/${channel}/releases.json`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error('The .NET SDK catalog could not be retrieved.')
    const data = await response.json()
    const os = { darwin: 'osx', win32: 'win', linux: 'linux' }[process.platform]
    const rid = `${os}-${process.arch}`
    const result = []
    for (const release of data.releases || []) for (const sdk of release.sdks || [release.sdk]) {
      if (!sdk || sdk.version.includes('-') || !matchesSdk(sdk.version, project.runtime?.constraint || channel)) continue
      const build = sdk.files?.find(file => file.rid === rid && /\.(tar\.gz|zip)$/.test(file.url))
      if (!build || !/^https:\/\/(builds\.dotnet\.microsoft\.com|download\.visualstudio\.microsoft\.com)\//.test(build.url)) continue
      this.releases.set(sdk.version, build); result.push({ version: sdk.version, architecture: process.arch })
    }
    return result
  }
  async install(version) {
    const build = this.releases.get(version)
    if (!build) throw new Error('The .NET SDK must come from the approved release catalog.')
    const target = path.join(this.root, 'dotnet', process.platform, process.arch, version)
    const binary = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'
    if (probe(path.join(target, binary)) === version) return
    const archive = path.join(this.root, 'downloads', process.platform, process.arch, `dotnet-${version}${build.url.endsWith('.zip') ? '.zip' : '.tar.gz'}`)
    let failure
    for (let attempt = 0; attempt < 3; attempt++) {
      const staging = `${target}.installing-${require('node:crypto').randomUUID()}`
      try {
        this.emit('runtime', { runtimeType: 'dotnet', version, status: 'Downloading' })
        await downloadVerified({ urls: [build.url], archive, checksum: build.hash })
        await extractArchive(archive, staging)
        if (probe(path.join(staging, binary)) !== version) throw new Error('The extracted .NET SDK did not launch with the expected version.')
        const info = execFileSync(path.join(staging, binary), ['--info'], { encoding: 'utf8', timeout: 10000 })
        const rid = `${{ darwin: 'osx', win32: 'win', linux: 'linux' }[process.platform]}-${process.arch}`
        if (!info.includes(rid)) throw new Error('The extracted .NET SDK has the wrong operating system or architecture.')
        await fs.mkdir(path.dirname(target), { recursive: true }); await fs.rm(target, { recursive: true, force: true }); await fs.rename(staging, target)
        this.emit('runtime', { runtimeType: 'dotnet', version, status: 'Complete' }); return
      } catch (error) { failure = error; await fs.rm(archive, { force: true }); await fs.rm(staging, { recursive: true, force: true }); if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt)) }
    }
    throw failure
  }
}
module.exports = { DotnetManager, matchesSdk }
