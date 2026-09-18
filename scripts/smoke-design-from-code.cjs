const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frameui-source-design-'));
  let app;
  try {
    fs.writeFileSync(path.join(root, 'index.php'), '<main><h1>Offline dashboard</h1><button>Add item</button></main>');
    fs.writeFileSync(path.join(root, 'app.css'), 'h1{color:#123456}');
    app = await electron.launch({ executablePath: process.env.FRAMEUI_ELECTRON_PATH || require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${root}/profile`], env: { ...process.env, FRAMEUI_ALLOW_MULTIPLE_INSTANCES: '1', ELECTRON_RUN_AS_NODE: '' } });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await app.evaluate(({ dialog, ipcMain }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      globalThis.startAttempts = 0;
      ipcMain.removeHandler('preview:start');
      ipcMain.handle('preview:start', () => { globalThis.startAttempts++; return { ok: false, message: 'Runtime intentionally unavailable' }; });
    }, root);
    await page.getByRole('button', { name: 'Open Project', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Local environment', exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Continue with source design', exact: true }).click();
    await page.getByRole('button', { name: 'Use existing page', exact: true }).click();
    await page.frameLocator('iframe[title="Editable project design"]').first().getByRole('heading', { name: 'Offline dashboard' }).waitFor();
    assert.equal(await page.locator('webview').count(), 0);
    assert.equal(await app.evaluate(() => globalThis.startAttempts), 0);
    await page.getByRole('button', { name: 'Duplicate to design', exact: true }).first().click();
    for (let i = 0; i < 100 && await page.locator('iframe[title="Editable project design"]').count() !== 2; i++) await page.waitForTimeout(100);
    assert.equal(await page.locator('iframe[title="Editable project design"]').count(), 2);
    assert.equal(await app.evaluate(() => globalThis.startAttempts), 0);
    console.log('Source canvas and editable duplicate rendered with no server starts or live webviews.');
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
