import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const loadCommonJs = createRequire(import.meta.url)
const { scanDatabaseSources, validateDatabaseSource } = loadCommonJs('../../../hosting/stacker/lib/database-sources.cjs')

test('database preflight finds sources, excludes dependencies and fingerprints nested migrations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-sources-'))
  try {
    for (const folder of ['node_modules/pkg', 'prisma/migrations/001', 'app/Database/Migrations']) await fs.mkdir(path.join(root, folder), { recursive: true })
    await fs.writeFile(path.join(root, 'database.sql'), '-- MySQL dump\nCREATE TABLE example(id int);')
    await fs.writeFile(path.join(root, 'node_modules/pkg/test.sql'), 'ignored')
    await fs.writeFile(path.join(root, 'prisma/migrations/001/migration.sql'), 'CREATE TABLE a(id int);')
    await fs.writeFile(path.join(root, 'app/Database/Migrations/001.php'), '<?php')
    const first = await scanDatabaseSources(root)
    expect(first.filter((s: {kind: string}) => s.kind === 'file').map((s: {path: string}) => s.path)).toEqual(['database.sql'])
    expect(first.find((s: {path: string}) => s.path === 'app/Database/Migrations').count).toBe(1)
    await fs.writeFile(path.join(root, 'prisma/migrations/001/migration.sql'), 'CREATE TABLE b(id int);')
    const second = await scanDatabaseSources(root)
    expect(second.find((s: {path: string}) => s.path === 'prisma/migrations').signature).not.toBe(first.find((s: {path: string}) => s.path === 'prisma/migrations').signature)
    await expect(validateDatabaseSource(root, first[0], 'postgres')).rejects.toThrow('compatible')
    expect(await validateDatabaseSource(root, first[0], 'mariadb')).toBe(await fs.realpath(path.join(root, 'database.sql')))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('preflight rejects empty, incompatible SQLite and escaped sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-source-validation-'))
  try {
    await fs.writeFile(path.join(root, 'empty.sql'), '')
    await expect(validateDatabaseSource(root, { path: 'empty.sql', kind: 'file' }, 'postgres')).rejects.toThrow('empty')
    await fs.writeFile(path.join(root, 'database.sql'), 'CREATE TABLE a(id int);')
    await expect(validateDatabaseSource(root, { path: 'database.sql', kind: 'file' }, 'sqlite')).rejects.toThrow('SQLite')
    await fs.symlink(os.tmpdir(), path.join(root, 'outside'))
    await expect(validateDatabaseSource(root, { path: 'outside', kind: 'migrations' }, 'postgres')).rejects.toThrow('private workspace')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('plain Node processes receive private database settings with local override precedence', async () => {
  const { stackerLocalEnvironment } = loadCommonJs('../../../hosting/stacker/lib/environment.cjs')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-local-env-'))
  try {
    await fs.writeFile(path.join(root, '.env'), 'DATABASE_URL=postgresql://local/database\nLABEL=base\n')
    await fs.writeFile(path.join(root, '.env.stacker.local'), 'LABEL=override\n')
    const values = stackerLocalEnvironment({ path: root, environmentMode: 'local', framework: { id: 'node' }, envFiles: ['.env', '.env.stacker.local'] }, { includeProjectValues: true })
    expect(values.DATABASE_URL).toBe('postgresql://local/database')
    expect(values.LABEL).toBe('override')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('reopen adds new environment requirements while retaining private values and source files', async () => {
  const { privateProjectCopy } = await import('../../main/hosting/privateCopy')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-env-requirements-'))
  try {
    const source = path.join(root, 'source'); await fs.mkdir(source)
    await fs.writeFile(path.join(source, '.env'), 'DATABASE_URL=original\n')
    const copy = await privateProjectCopy(source, path.join(root, 'profile'), 'test')
    await fs.writeFile(path.join(copy, '.env'), 'DATABASE_URL=private\n')
    await fs.writeFile(path.join(source, '.env'), 'DATABASE_URL=original\nNEW_FEATURE=enabled\n')
    await privateProjectCopy(source, path.join(root, 'profile'), 'test')
    expect(await fs.readFile(path.join(copy, '.env'), 'utf8')).toBe('DATABASE_URL=private\nNEW_FEATURE=enabled\n')
    expect(await fs.readFile(path.join(source, '.env'), 'utf8')).toBe('DATABASE_URL=original\nNEW_FEATURE=enabled\n')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('new database profiles use separate persistent ports and legacy databases keep their ports', async () => {
  const { DatabaseServices } = loadCommonJs('../../../hosting/stacker/lib/database-services.cjs')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frameui-profile-ports-'))
  try {
    const first = new DatabaseServices(path.join(root, 'first'), {})
    const second = new DatabaseServices(path.join(root, 'second'), {})
    expect(first.ports.postgres).not.toBe(second.ports.postgres)
    expect(new DatabaseServices(path.join(root, 'first'), {}).ports).toEqual(first.ports)
    await fs.mkdir(path.join(root, 'legacy/postgres/data'), { recursive: true })
    expect(new DatabaseServices(path.join(root, 'legacy'), {}).ports.postgres).toBe(55433)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
