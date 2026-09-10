import electron from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { createWriteStream, createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage } from 'node:http'

/** Public GitHub archive import works without installing Git or developer tools. */
export async function importGitHub(value: string): Promise<string | null> {
  const url = new URL(value)
  const match = /^\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/.exec(url.pathname)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !match) throw new Error('Use a GitHub project address such as https://github.com/owner/project.')
  const selected = await electron.dialog.showOpenDialog({ title: 'Choose where to save the project', properties: ['openDirectory', 'createDirectory'] })
  if (selected.canceled || !selected.filePaths[0]) return null
  const target = path.join(selected.filePaths[0], match[2])
  if (await fs.stat(target).then(() => true).catch(() => false)) throw new Error('A folder with that project name already exists. Choose a different location.')
  const temporary = await fs.mkdtemp(path.join(selected.filePaths[0], '.frameui-import-'))
  const archive = path.join(temporary, 'project.zip')
  const helpers = createRequire(__filename)(path.join(electron.app.getAppPath(), 'hosting/stacker/lib/verified-archive.cjs')) as {
    responseFor(url: string): Promise<IncomingMessage>
    verifyArchive(file: string, hash: string): Promise<string>
    extractArchive(file: string, destination: string): Promise<void>
  }
  try {
    let failure: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await helpers.responseFor(`https://codeload.github.com/${match[1]}/${match[2]}/zip/HEAD`)
        await pipeline(response, createWriteStream(archive, { mode: 0o600 }))
        const hash = crypto.createHash('sha256')
        for await (const chunk of createReadStream(archive)) hash.update(chunk)
        await helpers.verifyArchive(archive, hash.digest('hex'))
        failure = null; break
      } catch (error) { failure = error; await fs.rm(archive, { force: true }); if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt)) }
    }
    if (failure) throw failure
    const extracted = path.join(temporary, 'files')
    await helpers.extractArchive(archive, extracted)
    const directories = await fs.readdir(extracted, { withFileTypes: true })
    if (directories.length !== 1 || !directories[0].isDirectory()) throw new Error('The GitHub project download was incomplete.')
    await fs.rename(path.join(extracted, directories[0].name), target)
    return target
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}
