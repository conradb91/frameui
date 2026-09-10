const fs = require('fs/promises')
const path = require('path')

async function directorySize(target) {
  const stat = await fs.lstat(target).catch(() => null)
  if (!stat) return 0
  if (!stat.isDirectory()) return stat.size
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => [])
  const sizes = await Promise.all(entries.map(entry => directorySize(path.join(target, entry.name))))
  return sizes.reduce((total, size) => total + size, 0)
}

module.exports = { directorySize }
