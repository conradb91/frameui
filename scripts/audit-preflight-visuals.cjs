const { _electron } = require('playwright-core')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
;(async () => {
 const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-preflight-visual-'))
 const env = { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1' }; delete env.ELECTRON_RUN_AS_NODE
 const app = await _electron.launch({ executablePath: process.env.FRAMEUI_ELECTRON_PATH || require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`], env })
 try {
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1440, height: 900 })
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/Users/leadsprint/Desktop/New-App/Budget'] }) })
  if (await page.getByRole('button', { name: 'Get started', exact: true }).count()) await page.getByRole('button', { name: 'Get started', exact: true }).click()
  await page.getByRole('button', { name: 'New Design Project', exact: true }).first().click()
  const prepare = page.getByRole('button', { name: 'Prepare Budget', exact: true })
  await prepare.waitFor({ timeout: 120000 })
  assert(await prepare.isEnabled(), 'the detected source should be selected automatically')
  for (const theme of ['light', 'dark']) {
   await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
   await page.screenshot({ path: path.join(__dirname, `../docs/preflight-${theme}.png`) })
   assert.equal(await page.locator('dialog[open]').evaluate(element => element.scrollWidth > element.clientWidth), false)
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  console.log('PASS compact detected-source dialog in light and dark themes; cancel creates no workspace')
 } finally { await app.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
