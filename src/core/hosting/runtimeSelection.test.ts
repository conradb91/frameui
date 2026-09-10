import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { RuntimeManager, matchesConstraint } = require('../../../hosting/stacker/lib/runtime-manager.cjs')
const { matchesSdk } = require('../../../hosting/stacker/lib/dotnet-manager.cjs')

test('Node catalog retains older LTS majors and exact pinned releases', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-node-catalog-'))
  const originalFetch = globalThis.fetch
  try {
    const releases = [...Array.from({ length: 20 }, (_, index) => ({ version: `v24.0.${20 - index}`, lts: 'LTS', files: [`osx-${process.arch}-tar`] })), { version: 'v20.19.0', lts: 'LTS', files: [`osx-${process.arch}-tar`] }]
    globalThis.fetch = (async () => new Response(JSON.stringify(releases))) as unknown as typeof fetch
    const catalog = await new RuntimeManager(root).catalog()
    expect(catalog.find((item: {version: string}) => matchesConstraint(item.version, '^20.0.0'))?.version).toBe('v20.19.0')
    expect(catalog.find((item: {version: string}) => matchesConstraint(item.version, '24.0.1'))?.version).toBe('v24.0.1')
  } finally { globalThis.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }) }
})

test('.NET SDK requirements distinguish exact pins from channels and partial prefixes', () => {
  expect(matchesSdk('8.0.408', '8.0.408')).toBe(true)
  expect(matchesSdk('8.0.4080', '8.0.408')).toBe(false)
  expect(matchesSdk('8.0.425', '8.0')).toBe(true)
  expect(matchesSdk('8.01.100', '8.0')).toBe(false)
  expect(matchesSdk('8.0.425', '../8.0')).toBe(false)
})

const { matchesPhpConstraint } = require('../../../hosting/stacker/lib/php-manager.cjs')
test('PHP runtime selection respects Composer alternatives, ranges and patch requirements', () => {
  for (const [version, constraint, matches] of [
    ['8.4.20', '^7.4 || ^8.0', true], ['8.4.20', '^7.4 | ^8.0', true],
    ['8.4.20', '>=8.2 <8.4', false], ['8.4.20', '>=8.2, <8.5', true],
    ['8.4.20', '>=8.4.21', false], ['8.4.20', '8.4.19', false], ['8.4.20', '= 8.4.20', true],
    ['8.4.20', '8.3.*', false], ['8.4.20', '8.4.*', true], ['8.4.20', '!=8.4.20', false],
    ['8.4.20', '~8.3', true], ['8.4.20', '~8.3.0', false],
    ['8.4.20', '8.2 - 8.4', true], ['8.4.20', '8.2.0 - 8.4.19', false],
    ['8.4.20', 'invalid', false], ['8.4.20', '^8.4@stable', true],
    ['8.4.20', '^8.5 || >=8.4.21 <8.5', false],
  ] as const) expect(matchesPhpConstraint(version, constraint)).toBe(matches)
})
