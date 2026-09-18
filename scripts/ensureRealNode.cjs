// Provisions a genuine Node.js binary for build tooling that misbehaves
// under Bun's own runtime (see run-electron-builder.cjs for why). Reuses
// this repo's own Stacker runtime-provisioning code — the same
// checksum-verified download path already trusted to run users' projects —
// instead of adding a second, separate download mechanism. Both
// dependencies are Electron-free and safe to require outside the app.
const path = require('node:path')
const os = require('node:os')
const { RuntimeManager, compareVersions } = require('../hosting/stacker/lib/runtime-manager.cjs')
const { nodePlatform } = require('../hosting/stacker/lib/runtime-platform.cjs')

/** Persistent so repeat builds don't re-download; deliberately separate
 * from the running app's own userData runtime cache, since this is a
 * developer-machine build concern, not app runtime state. */
function cacheRoot() {
  return path.join(os.homedir(), '.cache', 'frameui-build-node')
}

async function ensureRealNode() {
  const manager = new RuntimeManager(cacheRoot(), (event) => {
    if (event.status === 'Downloading' && event.progress != null)
      process.stderr.write(`\rDownloading Node.js ${event.version}... ${event.progress}%`)
    else if (event.status === 'Complete') process.stderr.write('\n')
  })
  const catalog = await manager.catalog()
  if (!catalog.length)
    throw new Error('No Node.js LTS release is available in the catalog for this platform/architecture.')
  const [newest] = catalog.slice().sort((a, b) => compareVersions(a.version, b.version))
  const { path: installDir } = await manager.install(newest.version)
  const { bin, executable } = nodePlatform()
  return path.join(installDir, bin, executable)
}

module.exports = { ensureRealNode }

if (require.main === module) {
  ensureRealNode()
    .then((binaryPath) => {
      process.stdout.write(binaryPath + '\n')
    })
    .catch((error) => {
      console.error(error.message || error)
      process.exit(1)
    })
}
