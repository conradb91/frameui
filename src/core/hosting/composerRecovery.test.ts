import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { ComposerManager } = require('../../../hosting/stacker/lib/composer-manager.cjs')

async function fixture(valid: boolean, run: (root: string, executable: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-composer-test-'))
  try {
    const executable = path.join(root, 'php-fixture')
    await fs.writeFile(executable, `#!/bin/sh
if [ "$2" = "--version" ]; then
  printf '${valid ? 'Composer version 2.8.0' : 'Invalid executable'}'
  exit 0
fi
printf 'new composer' > "\${2#--install-dir=}/\${3#--filename=}"
`, {mode:0o755})
    await fs.writeFile(path.join(root, 'composer.phar'), 'previous working composer')
    await run(root, executable)
  } finally { await fs.rm(root, {recursive:true, force:true}) }
}

test('Composer retries interrupted retrieval and only publishes a tested executable', () => fixture(true, async (root, executable) => {
  const previous = globalThis.fetch
  let installers = 0
  const installer = '<?php // verified fixture'
  const signature = crypto.createHash('sha384').update(installer).digest('hex')
  try {
    globalThis.fetch = (async (url: string) => url.endsWith('installer.sig') ? new Response(signature) : ++installers === 1 ? new Response('interrupted', {status:503}) : new Response(installer)) as unknown as typeof fetch
    const result = await new ComposerManager(root).install(executable)
    expect(result.version).toBe('2.8.0')
    expect(installers).toBe(2)
    expect(await fs.readFile(path.join(root, 'composer.phar'), 'utf8')).toBe('new composer')
    expect((await fs.readdir(root)).filter(file => file.includes('installing') || file.startsWith('installer-'))).toEqual([])
  } finally { globalThis.fetch = previous }
}))

test('Composer executable failure preserves the previous installation and cleans staging', () => fixture(false, async (root, executable) => {
  const previous = globalThis.fetch
  const installer = '<?php // verified fixture'
  const signature = crypto.createHash('sha384').update(installer).digest('hex')
  try {
    globalThis.fetch = (async (url: string) => new Response(url.endsWith('installer.sig') ? signature : installer)) as unknown as typeof fetch
    await expect(new ComposerManager(root).install(executable)).rejects.toThrow('executable test failed')
    expect(await fs.readFile(path.join(root, 'composer.phar'), 'utf8')).toBe('previous working composer')
    expect((await fs.readdir(root)).filter(file => file.includes('installing') || file.startsWith('installer-'))).toEqual([])
  } finally { globalThis.fetch = previous }
}))

test('Composer checksum failure never runs the installer or replaces the installed file', () => fixture(true, async (root, executable) => {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = (async (url: string) => new Response(url.endsWith('installer.sig') ? '0'.repeat(96) : '<?php modified')) as unknown as typeof fetch
    await expect(new ComposerManager(root).install(executable)).rejects.toThrow('checksum verification failed')
    expect(await fs.readFile(path.join(root, 'composer.phar'), 'utf8')).toBe('previous working composer')
    expect((await fs.readdir(root)).filter(file => file.includes('installing') || file.startsWith('installer-'))).toEqual([])
  } finally { globalThis.fetch = previous }
}))
