import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clearRecentProjects, deleteProjectFromDisk, listAllProjects, listRecentProjects, recordProjectOpened, removeProjectFromFrameUi, removeProjectFromRecent } from './recentProjectsStore'

const roots: string[] = []
function temporaryRoot(prefix: string) { const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('registered projects and recent history', () => {
  test('keeps a stable id and never duplicates the same canonical folder', () => {
    const data = temporaryRoot('frameui-library-')
    const repository = temporaryRoot('frameui-repository-')
    const first = recordProjectOpened(data, repository, 'Product')
    const second = recordProjectOpened(data, path.join(repository, '.'), 'Product')
    expect(second.id).toBe(first.id)
    expect(listAllProjects(data)).toHaveLength(1)
    expect(listRecentProjects(data)).toHaveLength(1)
  })

  test('recent history can be removed or cleared without unregistering projects', () => {
    const data = temporaryRoot('frameui-library-')
    const firstPath = temporaryRoot('frameui-first-')
    const secondPath = temporaryRoot('frameui-second-')
    const first = recordProjectOpened(data, firstPath, 'First')
    recordProjectOpened(data, secondPath, 'Second')
    removeProjectFromRecent(data, first.id)
    expect(listRecentProjects(data).map((project) => project.name)).toEqual(['Second'])
    expect(listAllProjects(data)).toHaveLength(2)
    clearRecentProjects(data)
    expect(listRecentProjects(data)).toEqual([])
    expect(listAllProjects(data)).toHaveLength(2)
  })

  test('detects a moved folder and relinks it without changing project identity', () => {
    const data = temporaryRoot('frameui-library-')
    const parent = temporaryRoot('frameui-move-')
    const original = path.join(parent, 'Original'); const relocated = path.join(parent, 'Relocated')
    fs.mkdirSync(original)
    const project = recordProjectOpened(data, original, 'Original')
    fs.renameSync(original, relocated)
    expect(listAllProjects(data)[0].missing).toBe(true)
    const relinked = recordProjectOpened(data, relocated, 'Relocated', project.id)
    expect(relinked.id).toBe(project.id)
    expect(listAllProjects(data)[0].missing).toBe(false)
  })

  test('removing from FrameUI leaves the repository untouched', () => {
    const data = temporaryRoot('frameui-library-')
    const repository = temporaryRoot('frameui-keep-')
    fs.writeFileSync(path.join(repository, 'keep.txt'), 'safe')
    const project = recordProjectOpened(data, repository, 'Keep')
    removeProjectFromFrameUi(data, project.id)
    expect(fs.readFileSync(path.join(repository, 'keep.txt'), 'utf-8')).toBe('safe')
    expect(listAllProjects(data)).toEqual([])
  })

  test('disk deletion requires an exact project-name confirmation', () => {
    const data = temporaryRoot('frameui-library-')
    const parent = temporaryRoot('frameui-delete-parent-')
    const repository = path.join(parent, 'DeleteMe'); fs.mkdirSync(repository); fs.writeFileSync(path.join(repository, 'file.txt'), 'content')
    const project = recordProjectOpened(data, repository, 'DeleteMe')
    expect(() => deleteProjectFromDisk(data, project.id, 'wrong')).toThrow()
    expect(fs.existsSync(repository)).toBe(true)
    deleteProjectFromDisk(data, project.id, 'DeleteMe')
    expect(fs.existsSync(repository)).toBe(false)
    expect(listAllProjects(data)).toEqual([])
  })
})
