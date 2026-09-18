const { _electron } = require('playwright-core')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-onboarding-'))
  const env = { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  let reviewProfile
  try {
    const packagedExecutable = process.env.FRAMEUI_PACKAGED_APP
    app = await _electron.launch({
      executablePath: packagedExecutable || process.env.FRAMEUI_ELECTRON || require('electron'),
      args: packagedExecutable ? [] : ['.', `--user-data-dir=${path.join(root, 'profile')}`],
      env,
    })
    if (packagedExecutable) {
      const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData'), arch: process.arch }))
      assert(info.packaged)
      assert.equal(info.arch, 'x64')
      assert(path.basename(info.profile).startsWith('review-'))
      reviewProfile = info.profile
    }
    const page = await app.firstWindow()
    page.setDefaultTimeout(30_000)
    fs.mkdirSync('docs/verification', { recursive: true })

    const dialog = page.getByRole('dialog', { name: 'Welcome to FrameUI' })
    await dialog.waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('onboardingCompleted')), null)
    const dialogBox = await dialog.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert(dialogBox && viewport)
    assert(dialogBox.width <= viewport.width - 62 && dialogBox.height <= viewport.height - 62, 'onboarding must retain at least 32px around the window')

    for (let step = 1; step <= 4; step++) {
      await dialog.locator(`[data-onboarding-visual-step="${step}"]`).waitFor()
      await dialog.getByText(`${String(step).padStart(2, '0')} / 04`, { exact: true }).waitFor()
      const layout = await dialog.evaluate((node) => {
        const header = node.querySelector('.frame-onboarding-copy > header').getBoundingClientRect()
        const content = node.querySelector('.frame-onboarding-content').getBoundingClientRect()
        const footer = node.querySelector('.frame-onboarding-navigation').getBoundingClientRect()
        return { header: { bottom: header.bottom }, content: { top: content.top, bottom: content.bottom }, footer: { top: footer.top } }
      })
      assert(layout.header.bottom <= layout.content.top + 1, `step ${step} header must not overlap content`)
      assert(layout.content.bottom <= layout.footer.top + 1, `step ${step} content must not overlap navigation`)
      const halves = await dialog.evaluate(node => ['.frame-onboarding-copy', '.frame-onboarding-demo'].map(selector => node.querySelector(selector).getBoundingClientRect().width))
      assert(Math.abs(halves[0] - halves[1]) < 1, 'onboarding must be an equal split')
      assert.equal(await dialog.locator('.frame-onboarding-progress i').count(), 4)
      assert.equal(await dialog.getByRole('button', { name: 'Skip introduction', exact: true }).count(), step < 4 ? 1 : 0)
      await page.screenshot({ path: `docs/verification/onboarding-step-${step}.png`, animations: 'disabled' })
      if (step < 4) await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
    }

    await dialog.getByRole('button', { name: 'Open FrameUI', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => localStorage.getItem('onboardingCompleted')), 'true')
    await page.reload()
    assert.equal(await page.getByRole('dialog', { name: 'Welcome to FrameUI' }).count(), 0, 'completed onboarding must not reopen automatically')
    await page.getByRole('button', { name: 'Getting started', exact: true }).click()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Skip introduction', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Create Blank Design', exact: true }).click()
    await page.keyboard.press('Meta+k')
    await page.getByLabel('Search pages, objects and commands').fill('Getting started')
    await page.keyboard.press('Enter')
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await help.waitFor()
    await help.getByRole('button', { name: /View introduction/ }).click()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Skip introduction', exact: true }).click()
    console.log('PASS: four onboarding steps, abstract artwork and equal split, stable navigation, local completion, and Help reopening.')
  } finally {
    if (app) await app.close()
    if (reviewProfile && path.basename(reviewProfile).startsWith('review-')) fs.rmSync(reviewProfile, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
