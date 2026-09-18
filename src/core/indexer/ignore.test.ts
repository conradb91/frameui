import { expect, test } from 'bun:test'
import { createIgnoreRules, isRelevantProjectPath } from './ignore'

test('shared exclusions cover runtime output across stacks', () => {
  const rules = createIgnoreRules()
  for (const name of ['cache', 'Caches', 'LOGS', 'writable', '__pycache__', 'venv', 'target', 'obj', '.next', '.nuxt', '.svelte-kit', 'playwright-report']) {
    expect(rules.shouldSkipDir(name)).toBe(true)
    expect(isRelevantProjectPath('/project', `/project/${name}/generated.html`)).toBe(false)
  }
  for (const name of ['server.log.1', 'data.sqlite', 'bundle.js.map', 'page.php.bak']) expect(rules.shouldSkipFile(name)).toBe(true)
})

test('shared exclusions preserve view sources and their dependencies across stacks', () => {
  for (const file of ['src/pages/Logs.tsx', 'src/components/Button.vue', 'src/routes/+page.svelte', 'src/pages/index.astro', 'resources/views/home.blade.php', 'app/Views/home.php', 'templates/home.html', 'Pages/Home.cshtml', 'Components/Home.razor', 'app/routes.ts', 'public/fonts/main.woff2', 'src/styles/theme.scss', '.storybook/main.ts']) {
    expect(isRelevantProjectPath('/project', `/project/${file}`)).toBe(true)
  }
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { walkFiles } from './walkFiles'
test('nested gitignore rules prune thousands of irrelevant files before discovery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-ignore-'))
  try {
    fs.mkdirSync(path.join(root, 'generated'))
    for (let i=0;i<2000;i++) fs.writeFileSync(path.join(root, 'generated', `${i}.html`), '<h1>Not a page</h1>')
    fs.mkdirSync(path.join(root,'src'))
    fs.writeFileSync(path.join(root,'.gitignore'), 'generated/\n*.html\n!index.html\n')
    fs.writeFileSync(path.join(root,'index.html'), '<h1>Home</h1>')
    fs.writeFileSync(path.join(root,'src','.gitignore'), '!profile.html\n')
    fs.writeFileSync(path.join(root,'src','profile.html'), '<h1>Profile</h1>')
    fs.writeFileSync(path.join(root,'src','ignored.html'), '<h1>Ignored</h1>')
    const start = performance.now()
    const result = walkFiles(root, ['.html'], createIgnoreRules([],root))
    expect(result.files.map(file => path.relative(root,file)).sort()).toEqual(['index.html','src/profile.html'])
    expect(result.scannedFileCount).toBeLessThan(10)
    console.info(`Ignore fixture: 2,000 excluded files, ${(performance.now()-start).toFixed(1)} ms`)
  } finally { fs.rmSync(root,{recursive:true,force:true}) }
})
