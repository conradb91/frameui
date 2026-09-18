const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
function sourceEngine(head) {
  return head.startsWith('SQLite format 3') ? 'sqlite' : head.startsWith('PGDMP') || /PostgreSQL database dump|SET statement_timeout|pg_catalog\./i.test(head) ? 'postgres' : /MySQL dump|MariaDB dump|ENGINE=InnoDB|AUTO_INCREMENT/i.test(head) ? 'mariadb' : undefined
}
const ignored = new Set(['node_modules', 'vendor', '.git', 'cache', 'build', 'dist', 'tmp', 'temp', '.next'])
async function scanDatabaseSources(root) {
  const sources = []
  let visited = 0
  async function walk(dir, depth = 0) {
    if (depth > 12) return
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (++visited > 50000) throw new Error('Project scan limit reached. Choose a smaller application folder.')
      if (entry.isSymbolicLink() || ignored.has(entry.name) || entry.name.startsWith('.frameui-')) continue
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(file, depth + 1)
      else if (entry.isFile() && /\.(sql|dump|backup|sqlite|sqlite3|db)$/i.test(entry.name)) {
        const stat = await fs.stat(file)
        const handle = await fs.open(file, 'r')
        let engine
        try { const buffer = Buffer.alloc(65536); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); engine = sourceEngine(buffer.subarray(0, bytesRead).toString()) } finally { await handle.close() }
        sources.push({ engine, path: path.relative(root, file), kind: 'file', signature: `${stat.size}:${stat.mtimeMs}` })
      }
    }
  }
  await walk(root)
  for (const folder of ['app/Database/Migrations', 'database/migrations', 'prisma/migrations', 'migrations', 'db/migrate', 'src/migrations', 'db/migrations', 'drizzle']) {
    const dir = path.join(root, folder)
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    const files = entries.filter(e => !e.name.startsWith('.') && (e.isDirectory() || /\.(php|sql|js|ts|rb)$/i.test(e.name)))
    if (files.length) {
      const hashes = []
      async function hashFolder(folder) {
        for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
          const file = path.join(folder, entry.name)
          if (entry.isDirectory()) await hashFolder(file)
          else if (entry.isFile()) hashes.push(path.relative(dir, file) + ':' + crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'))
        }
      }
      await hashFolder(dir)
      sources.push({ path: folder, kind: 'migrations', count: files.length, signature: crypto.createHash('sha256').update(hashes.sort().join('\n')).digest('hex') })
    }
  }
  return sources.filter(s => s.kind !== 'file' || !sources.some(m => m.kind === 'migrations' && s.path.startsWith(m.path + path.sep)))
}
async function validateDatabaseSource(root, source, engine) {
  const realRoot = await fs.realpath(root)
  const file = await fs.realpath(path.resolve(root, source.path))
  if (!file.startsWith(realRoot + path.sep)) throw new Error('Choose a database source inside the private workspace.')
  if (source.kind === 'migrations') return file
  const handle = await fs.open(file, 'r')
  let head
  try { const buffer = Buffer.alloc(65536); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); head = buffer.subarray(0, bytesRead).toString() } finally { await handle.close() }
  if (!head.length) throw new Error('The selected database file is empty.')
  const detected = sourceEngine(head)
  if (detected && detected !== engine) throw new Error(`This file contains ${detected === 'postgres' ? 'PostgreSQL' : detected === 'sqlite' ? 'SQLite' : 'MariaDB/MySQL'} data. Choose a compatible file or change the database type.`)
  if (engine === 'sqlite' && detected !== 'sqlite') throw new Error('Choose a valid SQLite database file.')
  return file
}
module.exports = { scanDatabaseSources, validateDatabaseSource }
