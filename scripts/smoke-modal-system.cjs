const { _electron } = require('playwright-core')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

;(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-modal-system-'))
  const env = { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  const packagedExecutable = process.env.FRAMEUI_PACKAGED_APP
  let reviewProfile
  let app
  try {
    app = await _electron.launch({
      executablePath: packagedExecutable || process.env.FRAMEUI_ELECTRON || require('electron'),
      args: packagedExecutable ? [] : ['.', `--user-data-dir=${profile}`],
      env,
    })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    if (packagedExecutable) {
      const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData'), arch: process.arch, appPath: app.getAppPath() }))
      const metadata = JSON.parse(require('@electron/asar').extractFile(info.appPath, 'package.json').toString()).frameuiReviewProfile
      assert(info.packaged, 'review verification must run against a packaged application')
      assert.equal(info.arch, 'x64')
      assert.equal(path.basename(info.profile), metadata)
      assert(metadata.startsWith('review-'), 'the package must use a fresh build-specific review profile')
      assert.deepEqual(await page.evaluate(() => window.frameui.design.list()), [])
      assert.deepEqual(await page.evaluate(() => window.frameui.project.listLibrary()), [])
      reviewProfile = info.profile
    }
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    const skipIntroduction = page.getByRole('button', { name: 'Skip introduction', exact: true })
    if (await skipIntroduction.isVisible().catch(() => false)) await skipIntroduction.click()
    await page.getByRole('button', { name: 'Create Blank Design', exact: true }).click()
    fs.mkdirSync('docs/verification', { recursive: true })
    assert.equal(await page.getByText('A place for your next screen', { exact: true }).count(), 0, 'blank artboards must remain unobstructed')
    await page.screenshot({ path: 'docs/verification/canvas-blank-artboard.png', animations: 'disabled' })

    const settingsButton = page.getByRole('button', { name: 'Workspace settings', exact: true })
    await settingsButton.click()
    let dialog = page.getByRole('dialog', { name: 'Workspace settings' })
    await dialog.waitFor()
    assert(await dialog.evaluate((node) => node.contains(document.activeElement)), 'focus should move into the modal')
    await page.getByRole('button', { name: 'Done', exact: true }).focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close settings')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert(await settingsButton.evaluate((node) => node === document.activeElement), 'focus should return to the opener')

    await settingsButton.click()
    dialog = page.getByRole('dialog', { name: 'Workspace settings' })
    await dialog.waitFor()
    await page.locator('.frame-modal-backdrop').click({ position: { x: 3, y: 3 } })
    await dialog.waitFor({ state: 'detached' })

    const exportButton = page.getByRole('button', { name: 'Export', exact: true })
    await exportButton.click()
    dialog = page.getByRole('dialog', { name: 'Export design' })
    await dialog.waitFor()
    await page.locator('.frame-modal-backdrop').click({ position: { x: 3, y: 3 } })
    assert(await dialog.isVisible(), 'export should not close from an outside click')
    await page.keyboard.press('Escape')

    await page.keyboard.press('Meta+k')
    await page.getByLabel('Search pages, objects and commands').fill('Create variable')
    await page.keyboard.press('Enter')
    dialog = page.getByRole('dialog', { name: 'Create variable' })
    await dialog.waitFor()
    await page.getByRole('button', { name: 'Save variable', exact: true }).click()
    await page.getByText('Enter a variable name.', { exact: true }).waitFor()
    assert(await dialog.isVisible(), 'inline validation should keep the form open')
    await dialog.locator('input').first().fill('Accent')
    await page.getByRole('button', { name: 'Save variable', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await settingsButton.click()
    await page.getByRole('button', { name: 'dark appearance', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.keyboard.press('Meta+k')
    await page.getByLabel('Search pages, objects and commands').fill('Remove page')
    await page.keyboard.press('Enter')
    dialog = page.getByRole('dialog', { name: /Remove “Untitled”/ })
    await dialog.waitFor()
    await page.locator('.frame-modal-backdrop').click({ position: { x: 3, y: 3 } })
    assert(await dialog.isVisible(), 'destructive confirmation should not close from an outside click')
    await page.screenshot({ path: 'docs/verification/modal-system-dark.png', animations: 'disabled' })
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 700, height: 480 })
    await page.keyboard.press('Meta+k')
    await page.getByLabel('Search pages, objects and commands').fill('Keyboard shortcuts')
    await page.keyboard.press('Enter')
    dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    const box = await dialog.boundingBox()
    assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 700 && box.y + box.height <= 480, 'modal should remain inside a small desktop window')
    assert(await dialog.locator('.frame-modal-header').isVisible())
    assert(await dialog.locator('.frame-modal-footer').isVisible())
    await page.screenshot({ path: 'docs/verification/modal-system-small-window.png', animations: 'disabled' })
    await page.keyboard.press('Escape')
    assert.deepEqual(errors, [])
    console.log('PASS: modal focus, trap, restoration, Escape, backdrop policy, validation, destructive confirmation, themes, and small-window containment.')
  } finally {
    if (app) await app.close()
    if (reviewProfile && path.basename(reviewProfile).startsWith('review-')) fs.rmSync(reviewProfile, { recursive: true, force: true })
    fs.rmSync(profile, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
