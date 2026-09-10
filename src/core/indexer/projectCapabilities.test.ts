import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { capabilitiesFor, discoverApplications } from './projectCapabilities'
import { ProjectIndexService } from './projectIndexService'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('monorepo and fallback capabilities', () => {
  test('discovers separate applications and shared UI packages', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-monorepo-')); dirs.push(root)
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-monorepo-data-')); dirs.push(data)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*', 'packages/*'] }))
    for (const target of ['apps/web', 'apps/admin', 'packages/ui']) {
      fs.mkdirSync(path.join(root, target, target.startsWith('packages') ? 'src/components' : 'src/pages'), { recursive: true })
      fs.writeFileSync(path.join(root, target, 'package.json'), JSON.stringify({ name: target.replace('/', '-'), dependencies: { react: '^18' }, scripts: target.startsWith('apps') ? { dev: 'vite' } : {} }))
      const file = target.startsWith('packages') ? 'src/components/Button.tsx' : 'src/pages/Home.tsx'
      fs.writeFileSync(path.join(root, target, file), 'export default function View(){ return <main /> }')
    }
    const apps = discoverApplications(root)
    expect(apps.filter((item) => item.kind === 'application')).toHaveLength(2)
    expect(apps.find((item) => item.kind === 'ui-package')?.name).toBe('Packages Ui')
    expect(apps.filter((item) => item.kind === 'application').every((item) => item.sharedPackageIds.length === 1)).toBe(true)
    expect(apps.find((item) => item.rootPath === 'apps/web')?.devCommand?.workingDirectory).toBe('apps/web')
    const service = new ProjectIndexService(data, 'monorepo', root)
    const index = service.load()
    expect(index.projectModel.pages.every((page) => page.applicationId === index.activeApplicationId)).toBe(true)
    const firstPageId = index.projectModel.pages[0].id
    const admin = index.applications!.find((item) => item.rootPath === 'apps/admin')!
    const selected = service.selectApplication(admin.id)
    expect(selected.projectModel.pages.every((page) => page.applicationId === admin.id)).toBe(true)
    expect(selected.projectModel.pages[0].id).not.toBe(firstPageId)
  })

  test('reports useful runtime-only and source-only levels', () => {
    expect(capabilitiesFor({ framework: 'unknown', routerStyle: 'unknown', devCommand: { command: 'make', args: ['serve'] } }).level).toBe('runtime-only')
    expect(capabilitiesFor({ framework: 'static', routerStyle: 'static', devCommand: null }).level).toBe('source-only')
  })
})
