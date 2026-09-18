// Runs electron-builder under a real Node.js binary rather than Bun.
//
// electron-builder's CLI has a `#!/usr/bin/env node` shebang, but `bun run`
// resolves and executes shebang'd JS files directly under Bun's own runtime
// instead of spawning a genuine `node` process. electron-builder's own
// error-reporting path (bluebird + source-map-support, both doing
// V8-specific `Error.prepareStackTrace` manipulation) crashes when run that
// way — confirmed by reproducing the exact same command under real Node,
// where it completes cleanly. This wrapper sidesteps the shebang entirely by
// naming the interpreter explicitly.
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { ensureRealNode } = require('./ensureRealNode.cjs')

async function main() {
  const nodeBinary = await ensureRealNode()
  const cli = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js')
  execFileSync(nodeBinary, [cli, ...process.argv.slice(2)], { stdio: 'inherit' })
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
