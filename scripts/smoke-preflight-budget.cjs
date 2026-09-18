const { _electron } = require('playwright-core')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
;(async () => {
 const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-preflight-budget-'))
 const source = '/Users/leadsprint/Desktop/New-App/Budget'
 console.log('Audit profile:', profile)
 const original = fs.readFileSync(path.join(source, '.env'), 'utf8')
 const env = { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1' }; delete env.ELECTRON_RUN_AS_NODE
 let app
 try {
  app = await _electron.launch({ executablePath: process.env.FRAMEUI_ELECTRON_PATH || require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`], env })
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, source)
  if (await page.getByRole('button', { name: 'Get started', exact: true }).count()) await page.getByRole('button', { name: 'Get started', exact: true }).click()
  await page.getByRole('button', { name: 'New Design Project', exact: true }).first().click()
  await page.getByRole('button', { name: 'Prepare Budget', exact: true }).waitFor({ timeout: 120000 })
  const migrations = page.getByRole('radio', { name: /Use migrations/ })
  if (await migrations.count()) await migrations.first().check()
  await page.getByRole('button', { name: 'Prepare Budget', exact: true }).click()
  for (let attempt = 0; attempt < 1800; attempt++) {
    if (!await page.locator('dialog[open]').count() || await page.locator('.status-recoverable').count()) break
    await page.waitForTimeout(500)
  }
  if (await page.locator('.status-recoverable').count()) {
   await page.getByRole('button', { name: 'Show activity', exact: true }).click()
   throw Error(await page.locator('dialog[open]').innerText())
  }
  assert.equal(fs.readFileSync(path.join(source, '.env'), 'utf8'), original)
  console.log('Budget preflight completed; original environment unchanged. Profile:', profile)
 } finally { if (app) await app.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
